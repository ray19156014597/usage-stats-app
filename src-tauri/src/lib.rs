//! usage-stats-app — Tauri shell.
//!
//! Owns the native pieces only: config storage (credentials), tray residency,
//! single-instance guard, the WebView2 login window that extracts the
//! DeepSeek usage token, and the window protocol (close → hide to tray).
//! The panel UI and all data parsing/aggregation run in the WebView (the
//! plugin's client.js + dataLayer.js); network calls go through
//! tauri-plugin-http with a scope allowlisting the two DeepSeek hosts.

mod config;
mod tray;

use config::AppConfig;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

/// Credentials handed to the WebView (the usage token lives in Rust config).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
	usage_token: String,
	api_key: String,
}

/// WebView2 login window: after a successful login the page's
/// `localStorage.userToken` appears; this probe writes it into the document
/// title, which the Rust side polls (no eval/event plumbing needed).
const TOKEN_PROBE_SCRIPT: &str = r#"
(function () {
	var timer = window.setInterval(function () {
		try {
			var raw = localStorage.getItem('userToken');
			if (!raw) return;
			var value = JSON.parse(raw);
			var token = value && (typeof value === 'string' ? value : value.value);
			if (typeof token === 'string' && token.length > 8) {
				document.title = 'USG_TOKEN:' + token;
			}
		} catch (e) { /* keep polling */ }
	}, 700);
})();
"#;

pub struct SyncState {
	/// True while a login round owns the window.
	running: Mutex<bool>,
	/// The round id that was cancelled (0 = none). A round only honours its own id,
	/// so a late cancel from an older round cannot abort a newer one.
	cancelled: Mutex<u64>,
	/// Monotonic round counter: every start gets a fresh identity.
	round: Mutex<u64>,
	last: Mutex<Option<Value>>,
}

impl SyncState {
	fn new() -> Self {
		Self {
			running: Mutex::new(false),
			cancelled: Mutex::new(0),
			round: Mutex::new(0),
			last: Mutex::new(None),
		}
	}

	fn is_cancelled(&self, round: u64) -> bool {
		*self.cancelled.lock().unwrap_or_else(|poison| poison.into_inner()) == round
	}

	fn finish(&self, round: u64) {
		// Only the round that still owns the state may clear it: a stale worker must
		// not stomp on the round a user already started after it.
		let current = *self.round.lock().unwrap_or_else(|poison| poison.into_inner());
		if current == round {
			*self.running.lock().unwrap_or_else(|poison| poison.into_inner()) = false;
		}
	}
}

//#region commands

/// 应用版本号（设置页底部展示，来自 Cargo.toml）。
#[tauri::command]
fn app_version() -> String {
	env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_credentials(state: tauri::State<'_, AppConfig>) -> Credentials {
	Credentials {
		usage_token: state.usage_token(),
		api_key: state.api_key(),
	}
}

#[tauri::command]
fn save_token(state: tauri::State<'_, AppConfig>, token: String) -> Result<Value, String> {
	let token = token.trim();
	if token.is_empty() {
		return Err("token must be a non-empty string".into());
	}
	// The write can fail (read-only profile, locked file, full disk). Returning Err
	// is the only honest answer: the old code reported success and lost the token.
	state.set_usage_token(token).map_err(|error| error.to_string())?;
	Ok(json!({ "ok": true, "configured": true, "source": "app" }))
}

#[tauri::command]
fn clear_token(state: tauri::State<'_, AppConfig>) -> Result<Value, String> {
	state.set_usage_token("").map_err(|error| error.to_string())?;
	Ok(json!({ "ok": true, "configured": false, "source": null }))
}

#[tauri::command]
fn save_api_key(state: tauri::State<'_, AppConfig>, key: String) -> Result<Value, String> {
	let key = key.trim();
	if key.is_empty() {
		return Err("API key must be a non-empty string".into());
	}
	state.set_api_key(key).map_err(|error| error.to_string())?;
	Ok(json!({ "ok": true, "configured": true }))
}

#[tauri::command]
fn clear_api_key(state: tauri::State<'_, AppConfig>) -> Result<Value, String> {
	state.set_api_key("").map_err(|error| error.to_string())?;
	Ok(json!({ "ok": true, "configured": false }))
}

/// Report a config that could not be used at startup (corrupt/unreadable file).
#[tauri::command]
fn config_warning(state: tauri::State<'_, AppConfig>) -> Value {
	json!({ "ok": true, "warning": state.load_warning() })
}

/// A captured value must look like a platform session token before it is written:
/// the probe reads `localStorage.userToken`, and an unrelated value there (or a
/// half-written one) must not replace a working token.
fn looks_like_usage_token(token: &str) -> bool {
	(16..=4096).contains(&token.len())
		&& token
			.bytes()
			.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

#[tauri::command]
async fn sync_start(app: tauri::AppHandle, state: tauri::State<'_, SyncState>) -> Result<Value, String> {
	let round = {
		let mut running = state.running.lock().unwrap_or_else(|poison| poison.into_inner());
		if *running {
			return Err("sync-already-running".into());
		}
		*running = true;
		let mut counter = state.round.lock().unwrap_or_else(|poison| poison.into_inner());
		*counter += 1;
		*counter
	};

	let url = "https://platform.deepseek.com"
		.parse::<tauri::Url>()
		.map_err(|error| error.to_string())?;
	// Build the window before promising anything: a failure must not leave `running`
	// stuck at true (that used to wedge every later attempt until a restart).
	let login = match tauri::WebviewWindowBuilder::new(&app, "login", WebviewUrl::External(url))
		.inner_size(1100.0, 800.0)
		.title("DeepSeek 登录")
		.initialization_script(TOKEN_PROBE_SCRIPT)
		.build()
	{
		Ok(window) => window,
		Err(error) => {
			state.finish(round);
			return Err(error.to_string());
		}
	};

	// Poll the login window's title from a worker thread; when the probe
	// reports the token, persist it and close the window.
	let app_task = app.clone();
	let login_task = login.clone();
	std::thread::spawn(move || {
		let mut ok = false;
		for _ in 0..600 {
			let sync_state = app_task.state::<SyncState>();
			if sync_state.is_cancelled(round) {
				break;
			}
			std::thread::sleep(Duration::from_millis(800));
			// Re-check after the sleep: cancelling during it must not still save.
			if sync_state.is_cancelled(round) {
				break;
			}
			match login_task.title() {
				Ok(title) => {
					if let Some(token) = title.strip_prefix("USG_TOKEN:") {
						// The token rode in the window title (the only channel an external page
						// can write to). Clear it immediately so it does not linger in the
						// title, taskbar caption or Alt-Tab preview.
						let _ = login_task.eval("document.title = 'DeepSeek 登录';");
						// The cancel can land between the title read and the write.
						if !sync_state.is_cancelled(round) {
							if !looks_like_usage_token(token) {
								*sync_state.last.lock().unwrap_or_else(|poison| poison.into_inner()) =
									Some(json!({ "ok": false, "message": "token-invalid-shape" }));
							} else {
								match app_task.state::<AppConfig>().set_usage_token(token) {
									Ok(()) => {
										*sync_state.last.lock().unwrap_or_else(|poison| poison.into_inner()) =
											Some(json!({ "ok": true, "source": "sync" }));
										ok = true;
									}
									Err(error) => {
										*sync_state.last.lock().unwrap_or_else(|poison| poison.into_inner()) =
											Some(json!({ "ok": false, "message": format!("save-failed: {error}") }));
									}
								}
							}
						}
						break;
					}
				}
				Err(_) => break, // window closed by the user
			}
		}
		let _ = login_task.close();
		{
			let sync_state = app_task.state::<SyncState>();
			let cancelled = sync_state.is_cancelled(round);
			if !ok && !cancelled {
				*sync_state.last.lock().unwrap_or_else(|poison| poison.into_inner()) =
					Some(json!({ "ok": false, "message": "auth-not-completed" }));
			}
			if cancelled {
				*sync_state.last.lock().unwrap_or_else(|poison| poison.into_inner()) =
					Some(json!({ "ok": false, "message": "cancelled" }));
			}
			sync_state.finish(round);
		}
	});

	Ok(json!({ "ok": true, "opened": true, "running": true, "round": round }))
}

#[tauri::command]
fn sync_status(state: tauri::State<'_, SyncState>) -> Value {
	let running = *state.running.lock().unwrap_or_else(|poison| poison.into_inner());
	let last = state.last.lock().unwrap_or_else(|poison| poison.into_inner()).clone();
	json!({ "running": running, "last": last })
}

#[tauri::command]
fn sync_cancel(state: tauri::State<'_, SyncState>) -> Value {
	let round = *state.round.lock().unwrap_or_else(|poison| poison.into_inner());
	if round > 0 {
		*state.cancelled.lock().unwrap_or_else(|poison| poison.into_inner()) = round;
	}
	// Report the state that actually holds right now: the worker thread still owns
	// `running` until it wakes up, and claiming otherwise made an immediate retry
	// look like a fresh failure.
	let running = *state.running.lock().unwrap_or_else(|poison| poison.into_inner());
	json!({ "ok": true, "cancelled": round > 0, "running": running, "round": round })
}

/// Live tray tooltip: pushed by the WebView whenever the CURRENT month loads
/// (no duplicate upstream requests on the Rust side). `month_label` and
/// `currency` come from the payload so a historical month can never be shown as
/// "this month" (the renderer refuses to push those in the first place).
#[tauri::command]
fn update_tray_tooltip(today_tokens: u64, month_cost: f64, currency: Option<String>, month_label: Option<String>) {
	let fmt = |n: u64| {
		let digits = n.to_string();
		let mut out = String::new();
		for (index, ch) in digits.chars().enumerate() {
			if index > 0 && (digits.len() - index) % 3 == 0 { out.push(','); }
			out.push(ch);
		}
		out
	};
	let symbol = match currency.as_deref() {
		Some("USD") => "$",
		Some("EUR") => "€",
		_ => "¥",
	};
	let month_line = match month_label.as_deref().filter(|label| !label.is_empty()) {
		Some(label) => format!("本月（{label}） {symbol}{:.2}", month_cost),
		None => format!("本月 {symbol}{:.2}", month_cost),
	};
	tray::set_tip(&format!(
		"DeepSeek 用量\n今日 {} Tokens\n{}",
		fmt(today_tokens),
		month_line
	));
}

//#endregion

fn show_main(app: &tauri::AppHandle) {
	if let Some(window) = app.get_webview_window("main") {
		let _ = window.show();
		let _ = window.unminimize();
		let _ = window.set_focus();
	}
}

/// 面板按 440px 宽设计；窗口略大时字号会显得偏大 —— 用 WebView 整体缩放收一档。
const DEFAULT_ZOOM: f64 = 0.94;

/// Windows 11 只给**有边框**的窗口默认圆角；无边框窗口必须显式声明，否则系统材质
/// 会以**直角矩形**铺满整个窗口，在面板圆角外露出一块方形玻璃 —— 用户实测反馈
/// "边缘也不应该是直角"。这里要求 DWM 按圆角裁剪窗口；CSS 面板取同一个半径
/// （8px，见 src/renderer/app.css），两者形状吻合。
#[cfg(windows)]
fn round_window_corners(window: &tauri::WebviewWindow) {
	use std::ffi::c_void;

	#[link(name = "dwmapi")]
	extern "system" {
		fn DwmSetWindowAttribute(hwnd: isize, attribute: u32, value: *const c_void, size: u32) -> i32;
	}

	const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
	const DWMWCP_ROUND: i32 = 2;

	if let Ok(hwnd) = window.hwnd() {
		let preference: i32 = DWMWCP_ROUND;
		unsafe {
			DwmSetWindowAttribute(
				hwnd.0 as isize,
				DWMWA_WINDOW_CORNER_PREFERENCE,
				&preference as *const i32 as *const c_void,
				std::mem::size_of::<i32>() as u32,
			);
		}
	}
}

#[cfg(not(windows))]
fn round_window_corners(_window: &tauri::WebviewWindow) {}

//#region 玻璃背后的屏幕画面（独立版里的"页面内容"）

/// 玻璃背后的"页面内容"：插件里面板浮在**会话内容**上，独立版就把窗口后方的
/// **真实屏幕画面**抓进页面，面板再用插件原配方 `backdrop-filter: blur(6px)`
/// 去糊它 —— 两边因此完全同构，连模糊半径都是同一个 6px。
///
/// 抓屏时必须把自己的窗口从捕获里排除（`WDA_EXCLUDEFROMCAPTURE`），否则抓回来
/// 的是玻璃本身，会形成回环。
struct BackdropFrame {
	width: u32,
	height: u32,
	bgra: Vec<u8>,
}

/// 抓帧状态。
struct BackdropState {
	/// setup 里窗口显示前预抓的首帧（画面里没有自己，最干净）。
	pending: Option<BackdropFrame>,
	/// 当前是否处于"实时背景"模式：该模式下窗口**持续**对屏幕捕获隐身，
	/// 换取逐帧抓取（否则每帧都要等 DWM 应用排除状态，约 60ms）。
	live: bool,
	/// 用户偏好（托盘菜单"实时玻璃背景"的勾选状态）；窗口隐藏时只是临时退出
	/// 实时模式，偏好保留，重新显示后继续实时。
	pref_live: bool,
}

struct BackdropCache(Mutex<BackdropState>);

#[cfg(windows)]
mod backdrop_capture {
	use std::ffi::c_void;

	#[repr(C)]
	struct BitmapInfoHeader {
		bi_size: u32,
		bi_width: i32,
		bi_height: i32,
		bi_planes: u16,
		bi_bit_count: u16,
		bi_compression: u32,
		bi_size_image: u32,
		bi_x_pels_per_meter: i32,
		bi_y_pels_per_meter: i32,
		bi_clr_used: u32,
		bi_clr_important: u32,
	}

	const BI_RGB: u32 = 0;
	const DIB_RGB_COLORS: u32 = 0;
	const SRCCOPY: u32 = 0x00CC_0020;
	const WDA_NONE: u32 = 0;
	const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;

	#[link(name = "user32")]
	extern "system" {
		fn GetDC(hwnd: *mut c_void) -> *mut c_void;
		fn ReleaseDC(hwnd: *mut c_void, hdc: *mut c_void) -> i32;
		fn SetWindowDisplayAffinity(hwnd: isize, affinity: u32) -> i32;
	}

	#[link(name = "gdi32")]
	extern "system" {
		fn CreateCompatibleDC(hdc: *mut c_void) -> *mut c_void;
		fn CreateCompatibleBitmap(hdc: *mut c_void, width: i32, height: i32) -> *mut c_void;
		fn SelectObject(hdc: *mut c_void, object: *mut c_void) -> *mut c_void;
		fn BitBlt(
			dst: *mut c_void,
			x: i32,
			y: i32,
			width: i32,
			height: i32,
			src: *mut c_void,
			src_x: i32,
			src_y: i32,
			rop: u32,
		) -> i32;
		fn GetDIBits(
			hdc: *mut c_void,
			bitmap: *mut c_void,
			start: u32,
			lines: u32,
			bits: *mut c_void,
			header: *mut BitmapInfoHeader,
			usage: u32,
		) -> i32;
		fn StretchBlt(
			dst: *mut c_void,
			x: i32,
			y: i32,
			width: i32,
			height: i32,
			src: *mut c_void,
			src_x: i32,
			src_y: i32,
			src_width: i32,
			src_height: i32,
			rop: u32,
		) -> i32;
		fn SetStretchBltMode(hdc: *mut c_void, mode: i32) -> i32;
		fn DeleteObject(object: *mut c_void) -> i32;
		fn DeleteDC(hdc: *mut c_void) -> i32;
	}

	/// 抓屏缩放：30fps 时每帧要传回 WebView 的像素数据是主要开销，抓一半分辨率
	/// 再让页面拉伸 —— 玻璃本身还有 6px 模糊，肉眼看不出差别，开销降到 1/4。
	pub const SCALE: f64 = 0.5;
	const HALFTONE: i32 = 4;

	/// 把屏幕 (x, y, width, height) 按 `scale` 抓成自上而下的 BGRA 像素，
	/// 返回 (实际宽, 实际高, 像素)。
	pub fn grab(
		x: i32,
		y: i32,
		width: i32,
		height: i32,
		scale: f64,
	) -> Option<(u32, u32, Vec<u8>)> {
		if width <= 0 || height <= 0 {
			return None;
		}
		let out_width = ((width as f64) * scale).round().max(1.0) as i32;
		let out_height = ((height as f64) * scale).round().max(1.0) as i32;
		unsafe {
			let screen = GetDC(std::ptr::null_mut());
			if screen.is_null() {
				return None;
			}
			let memory = CreateCompatibleDC(screen);
			let bitmap = CreateCompatibleBitmap(screen, out_width, out_height);
			if memory.is_null() || bitmap.is_null() {
				if !memory.is_null() {
					DeleteDC(memory);
				}
				ReleaseDC(std::ptr::null_mut(), screen);
				return None;
			}
			let previous = SelectObject(memory, bitmap);
			let copied = if scale >= 0.999 {
				BitBlt(memory, 0, 0, out_width, out_height, screen, x, y, SRCCOPY)
			} else {
				SetStretchBltMode(memory, HALFTONE);
				StretchBlt(
					memory,
					0,
					0,
					out_width,
					out_height,
					screen,
					x,
					y,
					width,
					height,
					SRCCOPY,
				)
			};
			let mut header: BitmapInfoHeader = std::mem::zeroed();
			header.bi_size = std::mem::size_of::<BitmapInfoHeader>() as u32;
			header.bi_width = out_width;
			header.bi_height = -out_height;
			header.bi_planes = 1;
			header.bi_bit_count = 32;
			header.bi_compression = BI_RGB;
			let mut pixels = vec![0u8; (out_width * out_height * 4) as usize];
			let lines = GetDIBits(
				memory,
				bitmap,
				0,
				out_height as u32,
				pixels.as_mut_ptr() as *mut c_void,
				&mut header,
				DIB_RGB_COLORS,
			);
			SelectObject(memory, previous);
			DeleteObject(bitmap);
			DeleteDC(memory);
			ReleaseDC(std::ptr::null_mut(), screen);
			if copied == 0 || lines == 0 {
				None
			} else {
				Some((out_width as u32, out_height as u32, pixels))
			}
		}
	}

	/// 让本窗口从屏幕捕获里消失 / 恢复 —— 只能由窗口所属进程设置。
	pub fn set_capture_excluded(hwnd: isize, excluded: bool) -> bool {
		unsafe {
			SetWindowDisplayAffinity(
				hwnd,
				if excluded {
					WDA_EXCLUDEFROMCAPTURE
				} else {
					WDA_NONE
				},
			) != 0
		}
	}
}

/// 抓取窗口当前所在区域的屏幕画面（物理像素；按 SCALE 缩放以降低 30fps 的每帧开销）。
#[cfg(windows)]
fn grab_window_region(window: &tauri::WebviewWindow) -> Option<(u32, u32, Vec<u8>)> {
	let position = window.outer_position().ok()?;
	let size = window.outer_size().ok()?;
	if size.width == 0 || size.height == 0 {
		return None;
	}
	backdrop_capture::grab(
		position.x,
		position.y,
		size.width as i32,
		size.height as i32,
		backdrop_capture::SCALE,
	)
}

#[cfg(not(windows))]
fn grab_window_region(_window: &tauri::WebviewWindow) -> Option<(u32, u32, Vec<u8>)> {
	None
}

/// 抓屏前把自己排除两帧（DWM 在下一帧合成时才生效），抓完立刻恢复 ——
/// 用户平时截图、录屏完全不受影响。
#[cfg(windows)]
fn grab_window_region_excluding_self(window: &tauri::WebviewWindow) -> Option<(u32, u32, Vec<u8>)> {
	let hwnd = window.hwnd().ok().map(|handle| handle.0 as isize);
	let excluded = match hwnd {
		Some(hwnd) => backdrop_capture::set_capture_excluded(hwnd, true),
		None => false,
	};
	if excluded {
		std::thread::sleep(Duration::from_millis(60));
	}
	let frame = grab_window_region(window);
	if let (true, Some(hwnd)) = (excluded, hwnd) {
		backdrop_capture::set_capture_excluded(hwnd, false);
	}
	frame
}

#[cfg(not(windows))]
fn grab_window_region_excluding_self(window: &tauri::WebviewWindow) -> Option<(u32, u32, Vec<u8>)> {
	grab_window_region(window)
}

/// 设置/恢复"对屏幕捕获隐身"（只影响捕获，不影响屏幕显示）。
fn apply_capture_exclusion(window: &tauri::WebviewWindow, excluded: bool) -> bool {
	#[cfg(windows)]
	{
		match window.hwnd().ok().map(|handle| handle.0 as isize) {
			Some(hwnd) => backdrop_capture::set_capture_excluded(hwnd, excluded),
			None => false,
		}
	}
	#[cfg(not(windows))]
	{
		let _ = (window, excluded);
		false
	}
}

/// 抓一帧给 WebView：`[u32 宽][u32 高][BGRA…]`（小端）。
/// 首帧优先用 setup 里预先抓好的缓存；实时模式下不再逐帧开关排除状态（快路径）。
#[tauri::command]
fn capture_backdrop(
	window: tauri::WebviewWindow,
	cache: tauri::State<'_, BackdropCache>,
) -> Result<tauri::ipc::Response, String> {
	let (pending, live) = {
		let mut state = cache
			.0
			.lock()
			.map_err(|_| "backdrop cache poisoned".to_string())?;
		(state.pending.take(), state.live)
	};
	let frame = match pending {
		Some(frame) => Some((frame.width, frame.height, frame.bgra)),
		None if live => grab_window_region(&window),
		None => grab_window_region_excluding_self(&window),
	};
	let Some((width, height, bgra)) = frame else {
		return Err("capture failed".to_string());
	};
	let mut payload = Vec::with_capacity(8 + bgra.len());
	payload.extend_from_slice(&width.to_le_bytes());
	payload.extend_from_slice(&height.to_le_bytes());
	payload.extend_from_slice(&bgra);
	Ok(tauri::ipc::Response::new(payload))
}

/// 进入/退出"实时背景"：实时模式下窗口持续对屏幕捕获隐身，抓帧走无等待快路径。
#[tauri::command]
fn set_backdrop_live(
	window: tauri::WebviewWindow,
	cache: tauri::State<'_, BackdropCache>,
	live: bool,
) -> Result<bool, String> {
	let mut state = cache
		.0
		.lock()
		.map_err(|_| "backdrop cache poisoned".to_string())?;
	state.live = live;
	Ok(apply_capture_exclusion(&window, live))
}

/// 渲染层上报实时背景的实测帧率/单帧耗时（只写日志；渲染层按 Ctrl+Alt+F 开启上报）。
#[tauri::command]
fn report_backdrop_fps(fps: f64, cost: f64) {
	tauri_plugin_log::log::info!("[USG-FPS] fps={fps:.1} cost_ms={cost:.1}");
}

/// 托盘"实时玻璃背景"当前的勾选状态（用户偏好）。
#[tauri::command]
fn backdrop_live_pref(cache: tauri::State<'_, BackdropCache>) -> bool {
	cache
		.0
		.lock()
		.map(|state| state.pref_live)
		.unwrap_or(true)
}

/// 切换"实时玻璃背景"偏好（面板设置页与快捷键 Ctrl+Alt+L 用）：更新偏好、应用/解除
/// 屏幕捕获排除、重建托盘勾选、广播给渲染层，返回切换后的值。托盘菜单走同一套语义。
#[tauri::command]
fn set_backdrop_live_pref(
	window: tauri::WebviewWindow,
	cache: tauri::State<'_, BackdropCache>,
	enabled: bool,
) -> Result<bool, String> {
	{
		let mut state = cache
			.0
			.lock()
			.map_err(|_| "backdrop cache poisoned".to_string())?;
		state.pref_live = enabled;
		state.live = enabled;
	}
	apply_capture_exclusion(&window, enabled);
	let _ = window.emit("usg-live-backdrop", enabled);
	Ok(enabled)
}

//#endregion

/// 默认摆放在主显示器**工作区**（已排除任务栏）的右下角，留 24px 边距 ——
/// 桌面小组件的常规落点，不再出现在屏幕正中。窗口大小超出工作区时退回左上角。
fn place_bottom_right(window: &tauri::WebviewWindow) {
	const MARGIN: i32 = 24;
	let monitor = match window.current_monitor() {
		Ok(Some(monitor)) => monitor,
		_ => match window.primary_monitor() {
			Ok(Some(monitor)) => monitor,
			_ => return,
		},
	};
	let area = monitor.work_area();
	let size = window
		.outer_size()
		.unwrap_or_else(|_| PhysicalSize::new(560, 780));
	let x = area.position.x + area.size.width as i32 - size.width as i32 - MARGIN;
	let y = area.position.y + area.size.height as i32 - size.height as i32 - MARGIN;
	let _ = window.set_position(PhysicalPosition::new(
		x.max(area.position.x),
		y.max(area.position.y),
	));
}

//#region tray bridge
// 托盘换成原生 Shell_NotifyIcon（见 tray.rs）后，菜单项动作留在这里：托盘线程
// 不能直接摸 Tauri 的状态，统一由这几个函数在主线程执行。

/// 托盘菜单要显示的状态快照：(开机自启, 实时玻璃背景)。
pub(crate) fn tray_state(app: &tauri::AppHandle) -> (bool, bool) {
	let autostart = app.state::<AppConfig>().autostart();
	let live = app
		.state::<BackdropCache>()
		.0
		.lock()
		.map(|state| state.pref_live)
		.unwrap_or(true);
	(autostart, live)
}

pub(crate) fn tray_show(app: &tauri::AppHandle) {
	show_main(app);
}

pub(crate) fn tray_toggle_autostart(app: &tauri::AppHandle) -> bool {
	let next = !app.state::<AppConfig>().autostart();
	// A failed write is logged, not swallowed silently: the menu check state follows
	// the value that was actually stored.
	let persisted = app.state::<AppConfig>().set_autostart(next).is_ok();
	if !persisted {
		log::warn!("tray: autostart preference could not be written to the config file");
	}
	let result = if next {
		app.autolaunch().enable()
	} else {
		app.autolaunch().disable()
	};
	if let Err(error) = result {
		log::warn!("tray: autostart switch failed: {error}");
	}
	persisted && next
}

/// 实时玻璃背景：勾选 = 持续抓屏（窗口对屏幕捕获隐身，截图里看不到）；
/// 取消 = 回到跟手模式（只在事件/低频时抓一两帧，截图正常）。
pub(crate) fn tray_toggle_live(app: &tauri::AppHandle) -> Option<bool> {
	let cache = app.state::<BackdropCache>();
	let next = {
		let mut state = cache.0.lock().ok()?;
		let next = !state.pref_live;
		state.pref_live = next;
		state.live = next;
		next
	};
	if let Some(window) = app.get_webview_window("main") {
		apply_capture_exclusion(&window, next);
		let _ = window.emit("usg-live-backdrop", next);
	}
	Some(next)
}

pub(crate) fn tray_quit(app: &tauri::AppHandle) {
	app.exit(0);
}

//#endregion

pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_log::Builder::new().build())
		.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
			show_main(app);
		}))
		.plugin(tauri_plugin_http::init())
		.plugin(tauri_plugin_autostart::init(
			tauri_plugin_autostart::MacosLauncher::LaunchAgent,
			None,
		))
		.manage(AppConfig::load())
		.manage(SyncState::new())
		.manage(BackdropCache(Mutex::new(BackdropState {
			pending: None,
			live: false,
			// 默认开启实时玻璃背景；`USG_CAPTURE_SAFE=1` 启动时退到跟手模式，
			// 便于对窗口本身截图/录屏（实时模式会把自己从屏幕捕获里排除）。
			pref_live: std::env::var("USG_CAPTURE_SAFE").is_err(),
		})))
		.invoke_handler(tauri::generate_handler![
			app_version,
			get_credentials,
			save_token,
			clear_token,
			save_api_key,
			clear_api_key,
			config_warning,
			sync_start,
			sync_status,
			sync_cancel,
			update_tray_tooltip,
			capture_backdrop,
			set_backdrop_live,
			backdrop_live_pref,
			set_backdrop_live_pref,
			report_backdrop_fps
		])
		.setup(|app| {
			// Close → hide to tray (tray stays resident).
			if let Some(window) = app.get_webview_window("main") {
				let app_handle = app.handle().clone();
				window.on_window_event(move |event| {
					if let WindowEvent::CloseRequested { api, .. } = event {
						api.prevent_close();
						if let Some(window) = app_handle.get_webview_window("main") {
							let _ = window.hide();
						}
					}
				});
				// 先定位再显示（配置里 visible=false），避免窗口先出现在默认位置再跳一下。
				place_bottom_right(&window);
				// 无边框窗口要显式要求圆角，否则系统材质是直角矩形（见上）。
				round_window_corners(&window);
				// 趁窗口还没显示，先抓一帧"窗口背后的画面"当页面内容（此时画面里
				// 没有自己，最干净）；渲染层一加载就能直接用，第一帧不会闪系统材质。
				if let Some((width, height, bgra)) = grab_window_region(&window) {
					if let Ok(mut state) = app.state::<BackdropCache>().0.lock() {
						state.pending = Some(BackdropFrame {
							width,
							height,
							bgra,
						});
					}
				}
				// 面板按 440px 宽设计，默认窗口略微放大后字号显得偏大 —— 用 WebView 的
				// 整体缩放（等价 Ctrl+-）把字号/间距/格子一起收一档，比逐条改 CSS 稳。
				let _ = window.set_zoom(DEFAULT_ZOOM);
				let _ = window.show();
			}

			// 托盘：原生 Shell_NotifyIcon（见 tray.rs）—— Tauri 自带的托盘在这台机器上只 build
			// 成功、Shell 里不落地（官方 0.4.5 二进制同样如此），所以整块换成原生实现。
			tray::init(app.handle().clone());

			// Apply the persisted autostart preference on boot.
			if app.state::<AppConfig>().autostart() {
				let _ = app.autolaunch().enable();
			}
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running usage-stats-app");
}
