//! App config storage — same file path and shape as the Electron version
//! (`%APPDATA%\dsh-usage-stats-app\config.json`), so credentials migrated on
//! earlier runs carry over unchanged.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Value};

pub struct AppConfig {
	path: PathBuf,
	data: Mutex<Value>,
}

impl AppConfig {
	pub fn load() -> Self {
		let path = config_path();
		let data = fs::read_to_string(&path)
			.ok()
			.and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
			.filter(|value| value.is_object())
			.unwrap_or_else(|| json!({ "version": 1 }));
		Self { path, data: Mutex::new(data) }
	}

	fn save(&self) {
		if let Ok(data) = self.data.lock() {
			if let Some(parent) = self.path.parent() {
				let _ = fs::create_dir_all(parent);
			}
			let _ = fs::write(&self.path, serde_json::to_string_pretty(&*data).unwrap_or_default());
		}
	}

	pub fn usage_token(&self) -> String {
		self.data
			.lock()
			.ok()
			.and_then(|data| data.get("usageToken").and_then(Value::as_str).map(str::to_string))
			.unwrap_or_default()
	}

	pub fn api_key(&self) -> String {
		self.data
			.lock()
			.ok()
			.and_then(|data| data.get("apiKey").and_then(Value::as_str).map(str::to_string))
			.unwrap_or_default()
	}

	pub fn set_usage_token(&self, token: &str) {
		if let Ok(mut data) = self.data.lock() {
			data["usageToken"] = Value::String(token.to_string());
		}
		self.save();
	}

	pub fn autostart(&self) -> bool {
		self.data
			.lock()
			.ok()
			.and_then(|data| data.get("autostart").and_then(Value::as_bool))
			.unwrap_or(false)
	}

	pub fn set_autostart(&self, value: bool) {
		if let Ok(mut data) = self.data.lock() {
			data["autostart"] = Value::Bool(value);
		}
		self.save();
	}
}

fn config_path() -> PathBuf {
	let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
	base.join("dsh-usage-stats-app").join("config.json")
}
