//! 原生 Win32 托盘（`Shell_NotifyIconW`），用来替代 Tauri 的 `TrayIconBuilder`。
//!
//! 为什么自己写：在这台机器（Windows 11 build 29526 的新版通知区域）上，Tauri 的
//! 托盘创建**不报错也不出现** —— `build()` 返回 Ok、进程正常，但
//! `HKCU\Control Panel\NotifyIconSettings` 里始终没有本应用的条目，连 GitHub 上
//! 原始发布的官方 0.4.5 二进制也一样。所以这里直接调 Shell API，并且**每一步都写
//! 日志**（返回值 + `GetLastError()`），把失败点钉出来：
//!
//! - `tray: RegisterClassExW atom=…`
//! - `tray: CreateWindowExW hwnd=…`
//! - `tray: TaskbarCreated msg=…`
//! - `tray: ExtractIconExW count=… large=… small=…`
//! - `tray: NIM_ADD ok=… err=…`   ← 关键：这一行告诉你 Shell 有没有接受图标
//! - `tray: NIM_MODIFY(tip) ok=…`
//!
//! 结构：独立线程建一个隐藏窗口 + 自建消息循环，图标回调消息走 `WM_APP + 1`；
//! 左键显示面板，右键弹原生菜单（打开面板 / 开机自启 / 实时玻璃背景 / 退出）；
//! 收到 `TaskbarCreated`（资源管理器重启）时自动重新注册。

#![cfg(windows)]

use std::sync::atomic::{AtomicIsize, AtomicU32, Ordering};
use std::sync::OnceLock;
use tauri::AppHandle;

type Hwnd = isize;

const WM_APP: u32 = 0x8000;
const WM_TRAY: u32 = WM_APP + 1;
const WM_DESTROY: u32 = 0x0002;
const WM_LBUTTONUP: u32 = 0x0202;
const WM_LBUTTONDBLCLK: u32 = 0x0203;
const WM_RBUTTONUP: u32 = 0x0205;
const WM_CONTEXTMENU: u32 = 0x007B;

const NIM_ADD: u32 = 0x0;
const NIM_MODIFY: u32 = 0x1;
const NIF_MESSAGE: u32 = 0x1;
const NIF_ICON: u32 = 0x2;
const NIF_TIP: u32 = 0x4;

const MF_STRING: u32 = 0x0;
const MF_SEPARATOR: u32 = 0x800;
const MF_CHECKED: u32 = 0x8;
const TPM_RETURNCMD: u32 = 0x0100;
const TPM_RIGHTBUTTON: u32 = 0x0002;
const TPM_NONOTIFY: u32 = 0x0080;

const ID_OPEN: usize = 1;
const ID_AUTOSTART: usize = 2;
const ID_LIVE: usize = 3;
const ID_QUIT: usize = 4;

/// 托盘宿主窗口句柄（0 = 尚未创建）。
static TRAY_HWND: AtomicIsize = AtomicIsize::new(0);
/// 资源管理器广播的 `TaskbarCreated` 消息号。
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);
/// 应用句柄（菜单动作要回主线程调 Tauri）。
static APP: OnceLock<AppHandle> = OnceLock::new();
/// 托盘图标句柄（从自身 exe 里取，取不到退系统默认图标）。
static ICON: OnceLock<isize> = OnceLock::new();

#[repr(C)]
struct Point {
	x: i32,
	y: i32,
}

#[repr(C)]
struct Msg {
	hwnd: Hwnd,
	message: u32,
	w_param: usize,
	l_param: isize,
	time: u32,
	pt: Point,
	l_private: u32,
}

type WndProc = unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize;

#[repr(C)]
struct WndClassExW {
	cb_size: u32,
	style: u32,
	lpfn_wnd_proc: Option<WndProc>,
	cb_cls_extra: i32,
	cb_wnd_extra: i32,
	h_instance: isize,
	h_icon: isize,
	h_cursor: isize,
	hbr_background: isize,
	lpsz_menu_name: *const u16,
	lpsz_class_name: *const u16,
	h_icon_sm: isize,
}

/// `NOTIFYICONDATAW`（V3 布局，x64 下 976 字节）。
#[repr(C)]
struct NotifyIconDataW {
	cb_size: u32,
	hwnd: Hwnd,
	u_id: u32,
	u_flags: u32,
	u_callback_message: u32,
	h_icon: isize,
	sz_tip: [u16; 128],
	dw_state: u32,
	dw_state_mask: u32,
	sz_info: [u16; 256],
	u_timeout_or_version: u32,
	sz_info_title: [u16; 64],
	dw_info_flags: u32,
	guid_item: [u32; 4],
	h_balloon_icon: isize,
}

#[link(name = "kernel32")]
extern "system" {
	fn GetModuleHandleW(module_name: *const u16) -> isize;
}

#[link(name = "user32")]
extern "system" {
	fn RegisterClassExW(class: *const WndClassExW) -> u16;
	fn CreateWindowExW(
		ex_style: u32,
		class_name: *const u16,
		window_name: *const u16,
		style: u32,
		x: i32,
		y: i32,
		width: i32,
		height: i32,
		parent: Hwnd,
		menu: isize,
		instance: isize,
		param: *mut std::ffi::c_void,
	) -> Hwnd;
	fn DefWindowProcW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
	fn DestroyWindow(hwnd: Hwnd) -> i32;
	fn GetMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32) -> i32;
	fn TranslateMessage(msg: *const Msg) -> i32;
	fn DispatchMessageW(msg: *const Msg) -> isize;
	fn PostQuitMessage(code: i32);
	fn PostMessageW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> i32;
	fn RegisterWindowMessageW(name: *const u16) -> u32;
	fn CreatePopupMenu() -> isize;
	fn AppendMenuW(menu: isize, flags: u32, id: usize, text: *const u16) -> i32;
	fn DestroyMenu(menu: isize) -> i32;
	fn TrackPopupMenu(
		menu: isize,
		flags: u32,
		x: i32,
		y: i32,
		reserved: i32,
		hwnd: Hwnd,
		rect: *const std::ffi::c_void,
	) -> i32;
	fn SetForegroundWindow(hwnd: Hwnd) -> i32;
	fn GetCursorPos(point: *mut Point) -> i32;
	fn LoadIconW(instance: isize, name: *const u16) -> isize;
}

#[link(name = "shell32")]
extern "system" {
	fn Shell_NotifyIconW(message: u32, data: *const NotifyIconDataW) -> i32;
	fn ExtractIconExW(
		file: *const u16,
		index: i32,
		large: *mut isize,
		small: *mut isize,
		count: u32,
	) -> u32;
}

fn wide(text: &str) -> Vec<u16> {
	text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn last_error() -> u32 {
	std::io::Error::last_os_error().raw_os_error().unwrap_or(0) as u32
}

fn copy_tip(target: &mut [u16; 128], text: &str) {
	let mut index = 0usize;
	for unit in text.encode_utf16() {
		if index + 1 >= target.len() {
			break;
		}
		target[index] = unit;
		index += 1;
	}
	target[index] = 0;
}

fn icon_handle() -> isize {
	if let Some(handle) = ICON.get() {
		return *handle;
	}
	let mut handle = 0isize;
	if let Ok(exe) = std::env::current_exe() {
		let path = wide(&exe.to_string_lossy());
		let mut large = 0isize;
		let mut small = 0isize;
		let count = unsafe { ExtractIconExW(path.as_ptr(), 0, &mut large, &mut small, 1) };
		log::info!(
			"tray: ExtractIconExW count={count} large={large} small={small} err={}",
			last_error()
		);
		handle = if large != 0 { large } else { small };
	}
	if handle == 0 {
		handle = unsafe { LoadIconW(0, 32512 as *const u16) };
		log::warn!("tray: falling back to system icon handle={handle}");
	}
	let _ = ICON.set(handle);
	handle
}

fn add_icon(hwnd: Hwnd) {
	let mut data: NotifyIconDataW = unsafe { std::mem::zeroed() };
	data.cb_size = std::mem::size_of::<NotifyIconDataW>() as u32;
	data.hwnd = hwnd;
	data.u_id = 1;
	data.u_flags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
	data.u_callback_message = WM_TRAY;
	data.h_icon = icon_handle();
	copy_tip(&mut data.sz_tip, "DeepSeek 用量");
	let ok = unsafe { Shell_NotifyIconW(NIM_ADD, &data) };
	log::info!(
		"tray: NIM_ADD ok={ok} hwnd={hwnd} icon={} cbSize={} err={}",
		data.h_icon,
		data.cb_size,
		last_error()
	);
}

/// 更新托盘悬浮提示（WebView 每次拿到数据后调用）。
pub fn set_tip(text: &str) {
	let hwnd = TRAY_HWND.load(Ordering::Relaxed);
	if hwnd == 0 {
		return;
	}
	let mut data: NotifyIconDataW = unsafe { std::mem::zeroed() };
	data.cb_size = std::mem::size_of::<NotifyIconDataW>() as u32;
	data.hwnd = hwnd;
	data.u_id = 1;
	data.u_flags = NIF_TIP;
	copy_tip(&mut data.sz_tip, text);
	let ok = unsafe { Shell_NotifyIconW(NIM_MODIFY, &data) };
	log::debug!("tray: NIM_MODIFY(tip) ok={ok} err={}", last_error());
}

/// 启动托盘：建窗口 + 消息循环（独立线程，不阻塞 Tauri 主线程）。
pub fn init(app: AppHandle) {
	if APP.set(app).is_err() {
		log::warn!("tray: init called twice, ignored");
		return;
	}
	match std::thread::Builder::new()
		.name("usg-tray".into())
		.spawn(|| unsafe { message_loop() })
	{
		Ok(_) => log::info!("tray: host thread started"),
		Err(error) => log::error!("tray: host thread failed: {error}"),
	}
}

unsafe fn message_loop() {
	let instance = GetModuleHandleW(std::ptr::null());
	let class_name = wide("USGTrayHostWindow");
	let mut class: WndClassExW = std::mem::zeroed();
	class.cb_size = std::mem::size_of::<WndClassExW>() as u32;
	class.lpfn_wnd_proc = Some(wnd_proc);
	class.h_instance = instance;
	class.lpsz_class_name = class_name.as_ptr();
	let atom = RegisterClassExW(&class);
	log::info!("tray: RegisterClassExW atom={atom} err={}", last_error());
	if atom == 0 {
		// ERROR_CLASS_ALREADY_EXISTS：上一次托盘线程留下的注册，可直接复用。
		log::warn!("tray: class registration returned 0 (err={})", last_error());
	}

	let title = wide("DeepSeek 用量 托盘");
	let hwnd = CreateWindowExW(
		0,
		class_name.as_ptr(),
		title.as_ptr(),
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		instance,
		std::ptr::null_mut(),
	);
	log::info!("tray: CreateWindowExW hwnd={hwnd} err={}", last_error());
	if hwnd == 0 {
		return;
	}
	TRAY_HWND.store(hwnd, Ordering::Relaxed);

	let taskbar_created = RegisterWindowMessageW(wide("TaskbarCreated").as_ptr());
	TASKBAR_CREATED.store(taskbar_created, Ordering::Relaxed);
	log::info!("tray: TaskbarCreated msg={taskbar_created}");

	add_icon(hwnd);

	let mut message: Msg = std::mem::zeroed();
	loop {
		let result = GetMessageW(&mut message, 0, 0, 0);
		if result <= 0 {
			break;
		}
		TranslateMessage(&message);
		DispatchMessageW(&message);
	}
	log::info!("tray: message loop ended");
}

fn on_main<F: FnOnce(&AppHandle) + Send + 'static>(run: F) {
	let Some(app) = APP.get().cloned() else {
		log::warn!("tray: no app handle yet");
		return;
	};
	let inner = app.clone();
	if let Err(error) = app.run_on_main_thread(move || run(&inner)) {
		log::error!("tray: run_on_main_thread failed: {error}");
	}
}

unsafe fn open_menu(hwnd: Hwnd) {
	let Some(app) = APP.get().cloned() else {
		return;
	};
	let (autostart, live) = crate::tray_state(&app);

	let menu = CreatePopupMenu();
	AppendMenuW(menu, MF_STRING, ID_OPEN, wide("打开面板").as_ptr());
	AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
	AppendMenuW(
		menu,
		MF_STRING | if autostart { MF_CHECKED } else { 0 },
		ID_AUTOSTART,
		wide("开机自启").as_ptr(),
	);
	AppendMenuW(
		menu,
		MF_STRING | if live { MF_CHECKED } else { 0 },
		ID_LIVE,
		wide("实时玻璃背景").as_ptr(),
	);
	AppendMenuW(menu, MF_SEPARATOR, 0, std::ptr::null());
	AppendMenuW(menu, MF_STRING, ID_QUIT, wide("退出").as_ptr());

	let mut point: Point = std::mem::zeroed();
	GetCursorPos(&mut point);
	SetForegroundWindow(hwnd);
	let command = TrackPopupMenu(
		menu,
		TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY,
		point.x,
		point.y,
		0,
		hwnd,
		std::ptr::null(),
	);
	DestroyMenu(menu);
	// 菜单关闭后补一条空消息，否则点空白处菜单不消失。
	PostMessageW(hwnd, 0, 0, 0);
	log::info!("tray: menu command={command}");

	match command as usize {
		ID_OPEN => on_main(|app| crate::tray_show(app)),
		ID_AUTOSTART => on_main(|app| {
			let next = crate::tray_toggle_autostart(app);
			log::info!("tray: autostart -> {next}");
		}),
		ID_LIVE => on_main(|app| match crate::tray_toggle_live(app) {
			Some(next) => log::info!("tray: live backdrop -> {next}"),
			None => log::warn!("tray: live backdrop lock poisoned"),
		}),
		ID_QUIT => on_main(|app| {
			log::info!("tray: quit requested");
			crate::tray_quit(app);
		}),
		_ => {}
	}
}

unsafe extern "system" fn wnd_proc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize {
	match msg {
		WM_TRAY => {
			let event = (lparam as usize & 0xFFFF) as u32;
			match event {
				WM_LBUTTONUP | WM_LBUTTONDBLCLK => on_main(|app| crate::tray_show(app)),
				WM_RBUTTONUP | WM_CONTEXTMENU => open_menu(hwnd),
				_ => {}
			}
			0
		}
		WM_DESTROY => {
			TRAY_HWND.store(0, Ordering::Relaxed);
			PostQuitMessage(0);
			0
		}
		_ => {
			let taskbar = TASKBAR_CREATED.load(Ordering::Relaxed);
			if taskbar != 0 && msg == taskbar {
				log::info!("tray: TaskbarCreated received, re-adding icon");
				add_icon(hwnd);
				return 0;
			}
			DefWindowProcW(hwnd, msg, wparam, lparam)
		}
	}
}

/// 让托盘随进程退出一起清理（`quit` 菜单会直接 `app.exit`，这里只是兜底）。
#[allow(dead_code)]
pub fn shutdown() {
	let hwnd = TRAY_HWND.swap(0, Ordering::Relaxed);
	if hwnd != 0 {
		unsafe { DestroyWindow(hwnd) };
	}
}
