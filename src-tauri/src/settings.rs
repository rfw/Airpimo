use serde::{Deserialize, Serialize};
use std::{fs::{self, OpenOptions}, io::Write, path::Path};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme { System, Light, Dark }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Settings {
    pub device_name: String,
    pub auto_start: bool,
    pub stay_in_tray: bool,
    pub theme: Theme,
    #[serde(default = "default_fps")]
    pub fps: u16,
    #[serde(default = "default_brightness")]
    pub brightness: u8,
    #[serde(default)]
    pub uxplay_args: String,
}
pub const fn default_fps() -> u16 { 60 }
// Relative picture-darkening control, not the physical screen backlight.
// New installs default to unchanged video brightness (100%). Existing saved values remain unchanged.
pub const fn default_brightness() -> u8 { 100 }
pub fn validate_brightness(value: u8) -> Result<(), String> {
    if value <= 100 { Ok(()) } else { Err("画面亮度必须为 0–100%".into()) }
}
// GStreamer videobalance is an offset in [-1, 1], not a linear luminance multiplier.
// Use a fixed set of numeric digits in the CLI to avoid locale-dependent values.
pub fn videobalance_brightness(value: u8) -> String {
    format!("-{:.2}", (100 - value) as f64 / 100.0)
}
pub fn validate_fps(value: u16) -> Result<(), String> {
    if (1..=255).contains(&value) { Ok(()) } else { Err("请求帧率必须为 1–255 的整数".into()) }
}
impl Default for Settings {
    fn default() -> Self {
        Self { device_name: "Airpimo".to_string(), auto_start: true, stay_in_tray: true, theme: Theme::System, fps: default_fps(), brightness: default_brightness(), uxplay_args: String::new() }
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
            Ok(value) if validate_name(&value.device_name).is_ok() && validate_fps(value.fps).is_ok() && validate_brightness(value.brightness).is_ok() && crate::uxplay_args::validate(&value.uxplay_args).is_ok() => (value, true),
            _ => (Settings::default(), false),
        },
        Err(_) => (Settings::default(), true),
    }
}
pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    validate_name(&settings.device_name)?;
    validate_fps(settings.fps)?;
    validate_brightness(settings.brightness)?;
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
        let data = Settings {device_name:"Office-AirPlay".into(),auto_start:false,stay_in_tray:true,theme:Theme::Dark,fps:120,brightness:65,uxplay_args:"-vol 0.75".into()};
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
        assert_eq!(settings.brightness, 100);
        assert_eq!(settings.uxplay_args, "");
    }
    #[test] fn picture_brightness_mapping_and_boundaries() {
        assert_eq!(default_brightness(), 100);
        assert_eq!(videobalance_brightness(100), "-0.00");
        assert_eq!(videobalance_brightness(80), "-0.20");
        assert_eq!(videobalance_brightness(50), "-0.50");
        assert_eq!(videobalance_brightness(0), "-1.00");
        assert!(validate_brightness(100).is_ok());
        assert!(validate_brightness(101).is_err());
    }
    #[test] fn invalid_fps_is_rejected() {
        assert!(validate_fps(0).is_err());
        assert!(validate_fps(256).is_err());
        assert!(validate_fps(120).is_ok());
        assert!(validate_fps(255).is_ok());
    }
}
