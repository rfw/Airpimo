#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observation { Connecting, MirrorStarted, MirrorEnded, Error(&'static str, &'static str), None }

// Keep a bounded *normalized* event vocabulary. Raw UxPlay logs may contain a client's
// IP, pairing details or user-agent, and must never be saved or exported unfiltered.
pub fn classify(line: &str) -> Observation {
    let lower = line.to_ascii_lowercase();
    if lower.contains("accepted ipv4 client on socket") || lower.contains("client identified as user-agent:") {
        return Observation::Connecting;
    }
    if lower.contains("raop_rtp_mirror starting mirroring") || lower.contains("video streaming started") {
        return Observation::MirrorStarted;
    }
    if lower.contains("raop_rtp_mirror tcp socket is closed, connection ended") || lower.contains("stopping mirroring") || lower.contains("stop mirroring") || lower.contains("connection reset by peer") || lower.contains("teardown from client") {
        return Observation::MirrorEnded;
    }
    if lower.contains("address already in use") || lower.contains("could not bind") || lower.contains("port is already") {
        return Observation::Error("port_in_use", "接收端口已被占用");
    }
    if lower.contains("required gstreamer plugin") || lower.contains("missing plugin is contained") {
        return Observation::Error("missing_runtime", "GStreamer 必需解码插件无法加载；检查原生运行时兼容性");
    }
    if lower.contains("could not initialize dnssd library") || lower.contains("error 3") && lower.contains("dnssd") {
        return Observation::Error("mdns", "DNS-SD 动态库加载失败；此引擎仍需要 Bonjour，请使用经验证的内置 mDNS 版本");
    }
    if lower.contains("no dns-sd server found") || lower.contains("no dnssd server found") {
        return Observation::Error("mdns", "Bonjour/mDNS 服务未找到或未运行");
    }
    if lower.contains("no element") || lower.contains("no such element") || lower.contains("failed to load plugin") || lower.contains("plugin not found") || lower.contains("cannot load library") {
        return Observation::Error("missing_runtime", "GStreamer 插件或动态库缺失");
    }
    if lower.contains("dnssd registration failed") || lower.contains("bonjour registration failed") || lower.contains("avahi client failure") {
        return Observation::Error("mdns", "Bonjour/mDNS 服务异常");
    }
    if lower.contains("audio sink error") || lower.contains("could not open audio device") {
        return Observation::Error("audio", "音频输出设备初始化失败");
    }
    if lower.contains("raop_rtp_mirror initializing sockets failed") || lower.contains("video sink error") || lower.contains("not-negotiated") || lower.contains("decoder not found") {
        return Observation::Error("video", "视频解码或渲染异常");
    }
    Observation::None
}
pub fn backoff_secs(failures: u8) -> Option<u64> {
    match failures { 1 => Some(1), 2 => Some(2), 3 => Some(4), _ => None }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn mirror_states() {
        assert_eq!(classify("raop_rtp_mirror starting mirroring"), Observation::MirrorStarted);
        assert_eq!(classify("Stopping Mirroring"), Observation::MirrorEnded);
        assert_eq!(classify("Accepted IPv4 client on socket 28"), Observation::Connecting);
        assert_eq!(classify("raop_rtp_mirror tcp socket is closed, connection ended"), Observation::MirrorEnded);
        assert_eq!(classify("new client connected"), Observation::None); // unverified wording != mirror
    }
    #[test] fn sanitized_error_categories() {
        assert_eq!(classify("bind: Address already in use"), Observation::Error("port_in_use", "接收端口已被占用"));
        assert_eq!(classify("password 123456 192.168.1.22"), Observation::None);
        assert_eq!(classify("Required gstreamer plugin 'libav' not found"), Observation::Error("missing_runtime", "GStreamer 必需解码插件无法加载；检查原生运行时兼容性"));
        assert_eq!(classify("No DNS-SD Server found"), Observation::Error("mdns", "Bonjour/mDNS 服务未找到或未运行"));
        assert_eq!(classify("*** ERROR: Could not initialize dnssd library!: error 3"), Observation::Error("mdns", "DNS-SD 动态库加载失败；此引擎仍需要 Bonjour，请使用经验证的内置 mDNS 版本"));
    }
    #[test] fn retry_budget() {
        assert_eq!([1,2,3,4].map(backoff_secs), [Some(1),Some(2),Some(4),None]);
    }
}
