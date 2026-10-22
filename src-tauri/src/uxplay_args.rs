// Airpimo owns these settings: receiver name, requested FPS and picture brightness.
// Expert-supplied arguments take precedence over *built-in defaults*, never over
// explicit UI settings. The process is launched directly, without a shell.

pub const MAX_INPUT_BYTES: usize = 2048;
const MAX_ARGS: usize = 64;
const MAX_ARG_BYTES: usize = 512;

/// Split a command-line-like text field, preserving whitespace within paired
/// single or double quotes and literal Windows-style path separators.
pub fn parse(text: &str) -> Result<Vec<String>, String> {
    if text.len() > MAX_INPUT_BYTES { return Err("UxPlay 自定义参数最多 2048 字节".into()); }
    if text.chars().any(|c| c.is_control() && c != '\t' && c != '\n' && c != '\r') {
        return Err("UxPlay 自定义参数不能包含不支持的控制字符".into());
    }
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut token_started = false;
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if let Some(q) = quote {
            if ch == q { quote = None; }
            else if ch == '\\' && chars.peek() == Some(&q) {
                current.push(q); chars.next();
            } else { current.push(ch); }
            if current.len() > MAX_ARG_BYTES { return Err("单个 UxPlay 参数不得超过 512 字节".into()); }
            continue;
        }
        if ch == '"' || ch == '\'' { quote = Some(ch); token_started = true; }
        else if ch.is_whitespace() {
            if token_started {
                if current.is_empty() { return Err("UxPlay 参数不能包含空字符串".into()); }
                tokens.push(std::mem::take(&mut current)); token_started = false;
            }
        } else { current.push(ch); token_started = true; }
        if current.len() > MAX_ARG_BYTES { return Err("单个 UxPlay 参数不得超过 512 字节".into()); }
        if tokens.len() > MAX_ARGS { return Err("UxPlay 自定义参数最多 64 项".into()); }
    }
    if quote.is_some() { return Err("UxPlay 自定义参数引号未闭合".into()); }
    if token_started {
        if current.is_empty() { return Err("UxPlay 参数不能包含空字符串".into()); }
        tokens.push(current);
    }
    if tokens.len() > MAX_ARGS { return Err("UxPlay 自定义参数最多 64 项".into()); }
    Ok(tokens)
}

pub fn validate(value: &str) -> Result<(), String> {
    parse(value).map(|_| ())
}

fn flag_key(token: &str) -> &str { token.split_once('=').map_or(token, |(left, _)| left) }
fn is_option(token: &str) -> bool {
    token.starts_with('-') && token.len() > 1 && token.as_bytes().get(1).is_some_and(|c| c.is_ascii_alphabetic() || *c == b'-')
}
fn contains_flag(tokens: &[String], flag: &str) -> bool {
    tokens.iter().any(|token| flag_key(token) == flag)
}
fn push_default(args: &mut Vec<String>, custom: &[String], key: &str, value: Option<&str>) {
    if !contains_flag(custom, key) {
        args.push(key.into());
        if let Some(value) = value { args.push(value.into()); }
    }
}

/// The receiver's advertised name is always <configured base>@Airpimo.
/// -nh prevents UxPlay from adding the host computer name a second time.
pub fn advertised_name(name: &str) -> String {
    let base = name.trim().strip_suffix("@Airpimo").unwrap_or(name.trim());
    format!("{base}@Airpimo")
}

/// Build the canonical effective argv; never depend on UxPlay's behavior with
/// duplicate flags. Explicit UI-owned flags are always applied once at the end.
pub fn effective(name: &str, fps: u16, brightness: u8, user: &str) -> Result<Vec<String>, String> {
    let custom = parse(user)?;
    let mut args = Vec::new();
    push_default(&mut args, &custom, "-d", Some("1"));
    push_default(&mut args, &custom, "-vol", Some("0.5"));
    #[cfg(any(windows, target_os = "macos"))]
    push_default(&mut args, &custom, "-avdec", None);
    #[cfg(target_os = "macos")]
    push_default(&mut args, &custom, "-vsync", Some("no"));

    let mut i = 0;
    while i < custom.len() {
        let token = &custom[i];
        if ["-n", "-fps", "-vc", "-nh"].contains(&flag_key(token).to_ascii_lowercase().as_str()) {
            // Strip both the conflicting option and its optional separate value.
            // Do not eat the next flag if the caller omitted the value.
            if flag_key(token) != "-nh" && !token.contains('=') && i + 1 < custom.len() && !is_option(&custom[i + 1]) { i += 1; }
        } else { args.push(token.clone()); }
        i += 1;
    }
    args.extend(["-nh".into(), "-n".into(), advertised_name(name), "-fps".into(), fps.to_string()]);
    // -vc replaces the video conversion stage of UxPlay's native GStreamer
    // pipeline. The watermark is composited into decoded VIDEO frames only:
    // no Tauri overlay, no additional native window, no encoded-stream changes.
    // Keep videobalance ahead of the watermark so a dimmed video does not dim
    // the Airpimo label. Always provide -vc, including brightness=100%.
    let mut converter = String::from("videoconvert");
    if brightness < 100 {
        converter.push_str(&format!(
            " ! videobalance brightness={}",
            crate::settings::videobalance_brightness(brightness)
        ));
    }
    converter.push_str(concat!(
        " ! textoverlay text=Airpimo halignment=right valignment=bottom",
        " xpad=16 ypad=16 font-desc=\"Sans 14\" color=0x99FFFFFF",
        " draw-shadow=true draw-outline=false shaded-background=false"
    ));
    args.push("-vc".into());
    args.push(converter);
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quoted_args_and_windows_paths_are_preserved() {
        assert_eq!(parse(r#"-vol 0.75 -vsync no -name "Living room" -path 'C:\Program Files\Airpimo'"#).unwrap(),
            vec!["-vol", "0.75", "-vsync", "no", "-name", "Living room", "-path", r"C:\Program Files\Airpimo"]);
        assert_eq!(parse("  \t ").unwrap(), Vec::<String>::new());
    }
    #[test]
    fn invalid_input_is_rejected() {
        assert!(parse("-vol \"unfinished").is_err());
        assert_eq!(parse("-vol 0.7\n-foo 1").unwrap(), vec!["-vol", "0.7", "-foo", "1"]);
        assert!(parse(&"x".repeat(2049)).is_err());
        assert!(parse(&"-x ".repeat(65)).is_err());
        assert!(parse("-foo \"\"").is_err());
    }
    #[test]
    fn explicit_settings_override_custom_but_custom_overrides_defaults() {
        let args = effective("Airpimo", 60, 80, "-n Evil -fps 240 -vc wrong -vol 0.9 -d 2").unwrap();
        let strings = args.iter().map(String::as_str).collect::<Vec<_>>();
        assert_eq!(strings.iter().filter(|&&s| s == "-n").count(), 1);
        assert_eq!(strings.iter().filter(|&&s| s == "-fps").count(), 1);
        assert_eq!(strings.iter().filter(|&&s| s == "-vc").count(), 1);
        assert!(!strings.contains(&"Evil"));
        assert!(!strings.contains(&"240"));
        assert!(!strings.contains(&"wrong"));
        assert_eq!(strings.windows(2).find(|s| s[0] == "-vol").unwrap()[1], "0.9");
        assert_eq!(strings.windows(2).find(|s| s[0] == "-d").unwrap()[1], "2");
        assert_eq!(strings.windows(2).find(|s| s[0] == "-fps").unwrap()[1], "60");
    }
    #[test]
    fn watermark_is_present_at_full_brightness_and_custom_converter_cannot_replace_it() {
        let args = effective("Room", 100, 100, "-vc=bad -vol=0.7").unwrap();
        let converters = args.windows(2).filter(|pair| pair[0] == "-vc").collect::<Vec<_>>();
        assert_eq!(converters.len(), 1);
        assert!(!converters[0][1].contains("videobalance"));
        assert!(converters[0][1].contains("textoverlay text=Airpimo"));
        assert!(converters[0][1].contains("font-desc=\"Sans 14\""));
        assert!(!args.iter().any(|x| x.contains("bad")));
        assert!(args.contains(&"-vol=0.7".to_string()));
    }
    #[test]
    fn brightness_control_and_bottom_right_watermark_are_composed_in_order() {
        let args = effective("Room", 60, 75, "").unwrap();
        let pipeline = args.windows(2).find(|pair| pair[0] == "-vc").unwrap()[1].as_str();
        assert!(pipeline.starts_with("videoconvert ! videobalance brightness=-0.25 ! textoverlay"));
        for key in ["halignment=right", "valignment=bottom", "xpad=16", "ypad=16", "color=0x99FFFFFF"] {
            assert!(pipeline.contains(key), "missing {key}");
        }
        assert_eq!(args.iter().filter(|item| item.as_str() == "-vc").count(), 1);
    }
}
