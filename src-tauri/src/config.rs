//! App config storage — same file path and shape as the Electron version
//! (`%APPDATA%\dsh-usage-stats-app\config.json`), so credentials migrated on
//! earlier runs carry over unchanged.
//!
//! Reliability contract (report F01):
//!   · a write goes through a sibling temp file + rename, so a failure or a crash
//!     mid-write leaves the previous file intact — never a truncated one;
//!   · the in-memory copy is committed only AFTER the file hit the disk, so the
//!     UI can never show a token that is not actually saved;
//!   · every failure is returned to the caller instead of being swallowed;
//!   · an unreadable/corrupt file is preserved as a diagnostic copy and reported,
//!     rather than silently treated as a first run (whose next save would wipe the
//!     other fields).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// A config read/write failure, surfaced to the WebView as a command error.
#[derive(Debug)]
pub struct ConfigError(String);

impl ConfigError {
	fn new(message: impl Into<String>) -> Self {
		Self(message.into())
	}
}

impl std::fmt::Display for ConfigError {
	fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		formatter.write_str(&self.0)
	}
}

impl From<std::io::Error> for ConfigError {
	fn from(error: std::io::Error) -> Self {
		Self(error.to_string())
	}
}

impl From<serde_json::Error> for ConfigError {
	fn from(error: serde_json::Error) -> Self {
		Self(format!("配置序列化失败：{error}"))
	}
}

pub struct AppConfig {
	path: PathBuf,
	data: Mutex<Value>,
	/// Non-null when the file on disk was unreadable or unparsable at load time.
	load_warning: Mutex<Option<String>>,
}

impl AppConfig {
	pub fn load() -> Self {
		Self::load_at(config_path())
	}

	fn load_at(path: PathBuf) -> Self {
		let mut warning = None;
		let data = match fs::read_to_string(&path) {
			Ok(raw) => match serde_json::from_str::<Value>(&raw) {
				Ok(value) if value.is_object() => value,
				Ok(_) => {
					warning = Some(keep_diagnostic_copy(&path, "不是一个 JSON 对象"));
					json!({ "version": 1 })
				}
				Err(error) => {
					warning = Some(keep_diagnostic_copy(&path, &format!("无法解析（{error}）")));
					json!({ "version": 1 })
				}
			},
			Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({ "version": 1 }),
			Err(error) => {
				warning = Some(format!("配置文件读取失败：{error}"));
				json!({ "version": 1 })
			}
		};
		Self { path, data: Mutex::new(data), load_warning: Mutex::new(warning) }
	}

	/// Set when the stored file could not be used; the settings page shows it.
	pub fn load_warning(&self) -> Option<String> {
		self.load_warning.lock().ok().and_then(|warning| warning.clone())
	}

	/// Apply one mutation: serialize the would-be state, write it, and only then
	/// commit it in memory. A failed write therefore changes nothing at all.
	fn update(&self, apply: impl FnOnce(&mut Value)) -> Result<(), ConfigError> {
		let mut data = self.data.lock().map_err(|_| ConfigError::new("配置状态锁失败"))?;
		let mut next = data.clone();
		apply(&mut next);
		let serialized = serde_json::to_string_pretty(&next)?;
		write_atomic(&self.path, &serialized)?;
		*data = next;
		Ok(())
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

	pub fn set_usage_token(&self, token: &str) -> Result<(), ConfigError> {
		let token = token.to_string();
		self.update(|data| {
			data["usageToken"] = Value::String(token);
		})
	}

	pub fn set_api_key(&self, key: &str) -> Result<(), ConfigError> {
		let key = key.to_string();
		self.update(|data| {
			data["apiKey"] = Value::String(key);
		})
	}

	pub fn autostart(&self) -> bool {
		self.data
			.lock()
			.ok()
			.and_then(|data| data.get("autostart").and_then(Value::as_bool))
			.unwrap_or(false)
	}

	pub fn set_autostart(&self, value: bool) -> Result<(), ConfigError> {
		self.update(|data| {
			data["autostart"] = Value::Bool(value);
		})
	}
}

/// Write `contents` to `path` atomically: full write + fsync into a sibling temp
/// file, then rename over the target. The previous file survives any failure.
fn write_atomic(path: &Path, contents: &str) -> Result<(), ConfigError> {
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent)?;
	}
	let stamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|elapsed| elapsed.as_nanos())
		.unwrap_or(0);
	let temp = path.with_extension(format!("json.{}.{stamp}.tmp", std::process::id()));
	let result = (|| -> Result<(), ConfigError> {
		let mut file = fs::File::create(&temp)?;
		file.write_all(contents.as_bytes())?;
		file.sync_all()?;
		drop(file);
		fs::rename(&temp, path)?;
		Ok(())
	})();
	if result.is_err() {
		let _ = fs::remove_file(&temp);
	}
	result
}

/// Preserve an unparsable config instead of overwriting it on the next save.
/// Returns the warning text shown by the settings page (it never contains data).
fn keep_diagnostic_copy(path: &Path, reason: &str) -> String {
	let stamp = SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.map(|elapsed| elapsed.as_secs())
		.unwrap_or(0);
	let copy = path.with_extension(format!("json.corrupt-{stamp}"));
	let kept = fs::copy(path, &copy).is_ok();
	let where_to = if kept {
		copy.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default()
	} else {
		String::new()
	};
	if kept {
		format!("配置文件{reason}；原件已备份为 {where_to}，本次以空配置启动。")
	} else {
		format!("配置文件{reason}；备份失败，本次以空配置启动。")
	}
}

fn config_path() -> PathBuf {
	let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
	base.join("dsh-usage-stats-app").join("config.json")
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::sync::atomic::{AtomicU32, Ordering};

	fn temp_file(tag: &str) -> PathBuf {
		static COUNTER: AtomicU32 = AtomicU32::new(0);
		let id = COUNTER.fetch_add(1, Ordering::SeqCst);
		let dir = std::env::temp_dir().join(format!("usg-config-{tag}-{}-{id}", std::process::id()));
		let _ = fs::remove_dir_all(&dir);
		fs::create_dir_all(&dir).unwrap();
		dir.join("config.json")
	}

	fn set_readonly(path: &Path, readonly: bool) {
		let mut permissions = fs::metadata(path).unwrap().permissions();
		permissions.set_readonly(readonly);
		fs::set_permissions(path, permissions).unwrap();
	}

	#[test]
	fn save_lands_on_disk_and_leaves_no_temp_files() {
		let path = temp_file("save");
		let config = AppConfig::load_at(path.clone());
		config.set_usage_token("TOKEN_1").unwrap();
		assert_eq!(config.usage_token(), "TOKEN_1");
		let on_disk = fs::read_to_string(&path).unwrap();
		assert!(on_disk.contains("TOKEN_1"), "the token must be on disk: {on_disk}");
		let leftovers: Vec<String> = fs::read_dir(path.parent().unwrap())
			.unwrap()
			.filter_map(|entry| entry.ok().map(|item| item.file_name().to_string_lossy().to_string()))
			.filter(|name| name.ends_with(".tmp"))
			.collect();
		assert!(leftovers.is_empty(), "a successful save must not leave temp files: {leftovers:?}");
		let reloaded = AppConfig::load_at(path.clone());
		assert_eq!(reloaded.usage_token(), "TOKEN_1");
	}

	#[test]
	fn failed_write_keeps_memory_and_disk_unchanged() {
		let path = temp_file("readonly");
		let config = AppConfig::load_at(path.clone());
		config.set_usage_token("TOKEN_BEFORE").unwrap();
		set_readonly(&path, true);
		let failed = config.set_usage_token("TOKEN_AFTER");
		assert!(failed.is_err(), "a write that cannot happen must be reported");
		assert_eq!(config.usage_token(), "TOKEN_BEFORE", "memory must not run ahead of the disk");
		let on_disk = fs::read_to_string(&path).unwrap();
		assert!(on_disk.contains("TOKEN_BEFORE"), "the previous file must survive a failed save");
		set_readonly(&path, false);
		assert_eq!(AppConfig::load_at(path).usage_token(), "TOKEN_BEFORE");
	}

	#[test]
	fn corrupt_file_is_preserved_and_reported() {
		let path = temp_file("corrupt");
		fs::write(&path, r#"{"version":1,"apiKey":"sk-orig"#).unwrap();
		let config = AppConfig::load_at(path.clone());
		assert_eq!(config.usage_token(), "");
		let warning = config.load_warning();
		assert!(warning.is_some(), "a corrupt config must be reported, not silently reset");
		let backup = fs::read_dir(path.parent().unwrap())
			.unwrap()
			.filter_map(|entry| entry.ok().map(|item| item.file_name().to_string_lossy().to_string()))
			.find(|name| name.contains(".corrupt-"));
		assert!(backup.is_some(), "the unreadable original must be kept as a diagnostic copy");
		// A later save starts from the default config, but the original still exists.
		config.set_usage_token("TOKEN_NEW").unwrap();
		let kept = fs::read_to_string(path.parent().unwrap().join(backup.unwrap())).unwrap();
		assert!(kept.contains("sk-orig"), "the backup keeps the user's original bytes");
	}
}
