//! usage-stats-app — Tauri shell.
//!
//! Owns the native pieces only: config storage (credentials), tray residency,
//! single-instance guard, the WebView2 login window that extracts the
//! DeepSeek usage token, and the window protocol (close → hide to tray).
//! The panel UI and all data parsing/aggregation run in the WebView (the
//! plugin's client.js + dataLayer.js); network calls go through
//! tauri-plugin-http with a scope allowlisting the two DeepSeek hosts.

mod config;

use config::AppConfig;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WindowEvent};
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
	running: Mutex<bool>,
	cancel: Mutex<bool>,
	last: Mutex<Option<Value>>,
}

impl SyncState {
	fn new() -> Self {
		Self {
			running: Mutex::new(false),
			cancel: Mutex::new(false),
			last: Mutex::new(None),
		}
	}
}

//#region commands

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
	state.set_usage_token(token);
	Ok(json!({ "ok": true, "configured": true, "source": "app" }))
}

#[tauri::command]
fn clear_token(state: tauri::State<'_, AppConfig>) -> Result<Value, String> {
	state.set_usage_token("");
	Ok(json!({ "ok": true, "configured": false, "source": null }))
}

#[tauri::command]
async fn sync_start(app: tauri::AppHandle, state: tauri::State<'_, SyncState>) -> Result<Value, String> {
	{
		let mut running = state.running.lock().unwrap_or_else(|poison| poison.into_inner());
		if *running {
			return Err("sync-already-running".into());
		}
		*running = true;
	}
	*state.cancel.lock().unwrap_or_else(|poison| poison.into_inner()) = false;

	let url = "https://platform.deepseek.com"
		.parse::<tauri::Url>()
		.map_err(|error| error.to_string())?;
	let login = tauri::WebviewWindowBuilder::new(&app, "login", WebviewUrl::External(url))
		.inner_size(1100.0, 800.0)
		.title("DeepSeek 登录")
		.initialization_script(TOKEN_PROBE_SCRIPT)
		.build()
		.map_err(|error| error.to_string())?;

	// Poll the login window's title from a worker thread; when the probe
	// reports the token, persist it and close the window.
	let app_task = app.clone();
	let login_task = login.clone();
	std::thread::spawn(move || {
		let mut ok = false;
		for _ in 0..600 {
			if *app_task.state::<SyncState>().cancel.lock().unwrap_or_else(|poison| poison.into_inner()) {
				break;
			}
			std::thread::sleep(Duration::from_millis(800));
			match login_task.title() {
				Ok(title) => {
					if let Some(token) = title.strip_prefix("USG_TOKEN:") {
						app_task.state::<AppConfig>().set_usage_token(token);
						*app_task.state::<SyncState>().last.lock().unwrap_or_else(|poison| poison.into_inner()) =
							Some(json!({ "ok": true, "source": "sync" }));
						ok = true;
						break;
					}
				}
				Err(_) => break, // window closed by the user
			}
		}
		let _ = login_task.close();
		{
			let sync_state = app_task.state::<SyncState>();
			if !ok {
				let canceled = *sync_state.cancel.lock().unwrap_or_else(|poison| poison.into_inner());
				if !canceled {
					*sync_state.last.lock().unwrap_or_else(|poison| poison.into_inner()) =
						Some(json!({ "ok": false, "message": "auth-not-completed" }));
				}
			}
			*sync_state.running.lock().unwrap_or_else(|poison| poison.into_inner()) = false;
		}
	});

	Ok(json!({ "ok": true, "opened": true, "running": true }))
}

#[tauri::command]
fn sync_status(state: tauri::State<'_, SyncState>) -> Value {
	let running = *state.running.lock().unwrap_or_else(|poison| poison.into_inner());
	let last = state.last.lock().unwrap_or_else(|poison| poison.into_inner()).clone();
	json!({ "running": running, "last": last })
}

#[tauri::command]
fn sync_cancel(state: tauri::State<'_, SyncState>) -> Value {
	*state.cancel.lock().unwrap_or_else(|poison| poison.into_inner()) = true;
	json!({ "ok": true, "running": false })
}

/// Live tray tooltip: pushed by the WebView whenever platform data loads
/// (no duplicate upstream requests on the Rust side).
#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, today_tokens: u64, month_cost: f64) {
	if let Some(tray) = app.tray_by_id("main") {
		let fmt = |n: u64| {
			let digits = n.to_string();
			let mut out = String::new();
			for (index, ch) in digits.chars().enumerate() {
				if index > 0 && (digits.len() - index) % 3 == 0 { out.push(','); }
				out.push(ch);
			}
			out
		};
		let _ = tray.set_tooltip(Some(format!(
			"DeepSeek 用量\n今日 {} Tokens\n本月 ¥{:.2}",
			fmt(today_tokens),
			month_cost
		)));
	}
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

/** Recreate the tray menu (the autostart checkbox reflects the config). */
fn rebuild_tray_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
	let autostart = app.state::<AppConfig>().autostart();
	let open = MenuItem::with_id(app, "open", "打开面板", true, None::<&str>)?;
	let auto = CheckMenuItem::with_id(app, "autostart", "开机自启", true, autostart, None::<&str>)?;
	let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
	let menu = Menu::with_items(app, &[&open, &auto, &quit])?;
	if let Some(tray) = app.tray_by_id("main") {
		tray.set_menu(Some(menu))?;
	}
	Ok(())
}

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
		.invoke_handler(tauri::generate_handler![
			get_credentials,
			save_token,
			clear_token,
			sync_start,
			sync_status,
			sync_cancel,
			update_tray_tooltip
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
				// 面板按 440px 宽设计，默认窗口略微放大后字号显得偏大 —— 用 WebView 的
				// 整体缩放（等价 Ctrl+-）把字号/间距/格子一起收一档，比逐条改 CSS 稳。
				let _ = window.set_zoom(DEFAULT_ZOOM);
				let _ = window.show();
			}

			// Tray: left-click shows the panel; menu has open/autostart/quit.
			let mut builder = TrayIconBuilder::with_id("main")
				.tooltip("DeepSeek 用量")
				.on_menu_event(|app, event| match event.id.as_ref() {
					"open" => show_main(app),
					"quit" => app.exit(0),
					"autostart" => {
						let next = !app.state::<AppConfig>().autostart();
						app.state::<AppConfig>().set_autostart(next);
						if next { let _ = app.autolaunch().enable(); }
						else { let _ = app.autolaunch().disable(); }
						let _ = rebuild_tray_menu(app);
					}
					_ => {}
				})
				.on_tray_icon_event(|tray, event| {
					if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
						show_main(tray.app_handle());
					}
				});
			if let Some(icon) = app.default_window_icon() {
				builder = builder.icon(icon.clone());
			}
			builder.build(app)?;
			rebuild_tray_menu(app.handle())?;

			// Apply the persisted autostart preference on boot.
			if app.state::<AppConfig>().autostart() {
				let _ = app.autolaunch().enable();
			}
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running usage-stats-app");
}
