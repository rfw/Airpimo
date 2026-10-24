use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, io::Write, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme { System, Light, Dark }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Settings {
    pub device_name: String,
    pub auto_start: bool,
    #[serde(default = "default_stay_in_tray")]
    pub stay_in_tray: bool,
    pub theme: Theme,
    #[serde(default = "default_fps")]
    pub fps: u16,
    #[serde(default)]
    pub uxplay_args: String,
}
pub const fn default_stay_in_tray() -> bool { true }
pub const fn default_fps() -> u16 { 60 }
pub fn validate_fps(value: u16) -> Result<(), String> {
    if (1..=255).contains(&value) { Ok(()) } else { Err("请求帧率必须为 1–255 的整数".into()) }
}
impl Default for Settings {
    fn default() -> Self {
        Self { device_name: "AirPlay".to_string(), auto_start: true, stay_in_tray: true, theme: Theme::System, fps: default_fps(), uxplay_args: String::new() }
    }
}
pub fn validate_name(value: &str) -> Result<(), String> {
    let name = value.trim();
    if name.is_empty() { return Err("设备名称不能为空".to_string()); }
    if name.chars().count() > 48 { return Err("设备名称最多 48 个字符".to_string()); }
    if name.chars().any(|ch| ch.is_control() || "<>\"\\/".contains(ch)) {
        return Err("设备名称包含不支持的字符".to_string());
    }
    Ok(())
}
pub fn load(path: &Path) -> (Settings, bool) {
    match fs::read(path) {
        Ok(data) => match serde_json::from_slice::<Settings>(&data) {
            Ok(value) if validate_name(&value.device_name).is_ok() && validate_fps(value.fps).is_ok() && crate::uxplay_args::validate(&value.uxplay_args).is_ok() => (value, true),
            _ => (Settings::default(), false),
        },
        Err(_) => (Settings::default(), true),
    }
}
pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    validate_name(&settings.device_name)?;
    validate_fps(settings.fps)?;
    crate::uxplay_args::validate(&settings.uxplay_args)?;
    let dir = path.parent().ok_or("配置路径无效")?;
    fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp)
        .or_else(|_| { let _ = fs::remove_file(&tmp); OpenOptions::new().write(true).create_new(true).open(&tmp) })
        .map_err(|e| format!("创建配置临时文件失败: {e}"))?;
    f.write_all(&bytes).and_then(|_| f.sync_all()).map_err(|e| { let _ = fs::remove_file(&tmp); format!("写入配置失败: {e}") })?;
    drop(f);
    fs::rename(&tmp, path).map_err(|e| { let _ = fs::remove_file(&tmp); format!("原子替换配置失败: {e}") })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn name_validation() {
        assert!(validate_name("Mac-AirPlay").is_ok());
        assert!(validate_name("客厅 投屏").is_ok());
        assert!(validate_name(" ").is_err());
        assert!(validate_name("a\nb").is_err());
        assert!(validate_name(&"a".repeat(49)).is_err());
    }
    #[test] fn settings_roundtrip() {
        let path = std::env::temp_dir().join(format!("uxplay-setting-{}-test.json", std::process::id()));
        let data = Settings {device_name:"Office-AirPlay".into(),auto_start:false,stay_in_tray:true,theme:Theme::Dark,fps:120,uxplay_args:"-vol 0.75".into()};
        save(&path,&data).unwrap();
        let (loaded,valid) = load(&path); assert!(valid); assert_eq!(loaded, data);
        let _=fs::remove_file(path);
    }
    #[test] fn old_settings_keep_user_choices_and_default_to_60fps() {
        let legacy = r#"{"device_name":"Livingroom","auto_start":false,"stay_in_tray":true,"theme":"dark"}"#;
        let settings: Settings = serde_json::from_str(legacy).unwrap();
        assert_eq!(settings.device_name, "Livingroom");
        assert_eq!(settings.theme, Theme::Dark);
        assert!(!settings.auto_start);
        assert!(settings.stay_in_tray);
        assert_eq!(settings.fps, 60);
        assert_eq!(settings.uxplay_args, "");
        // Pre-tray-preference settings and explicitly disabled installs both preserve intent.
        let old = r#"{"device_name":"Old-AirPlay","auto_start":true,"theme":"system"}"#;
        let missing: Settings = serde_json::from_str(old).unwrap();
        assert!(missing.stay_in_tray);
        let off = r#"{"device_name":"Old-AirPlay","auto_start":true,"stay_in_tray":false,"theme":"system"}"#;
        let disabled: Settings = serde_json::from_str(off).unwrap();
        assert!(!disabled.stay_in_tray);
    }
    #[test] fn invalid_fps_is_rejected() {
        assert!(validate_fps(0).is_err());
        assert!(validate_fps(256).is_err());
        assert!(validate_fps(120).is_ok());
        assert!(validate_fps(255).is_ok());
    }
}
