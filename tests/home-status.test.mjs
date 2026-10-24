import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Node's type-stripping test runner does not resolve extensionless TS imports.
// Resolve only this module's existing bundler-style import, without changing
// production module paths or compiler options.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "../lib/i18n" && context.parentURL?.endsWith("/home-status.ts")) {
      return nextResolve("../lib/i18n.ts", context);
    }
    if (specifier === "./state" && context.parentURL?.endsWith("/home-status.ts")) {
      return nextResolve("./state.ts", context);
    }
    return nextResolve(specifier, context);
  },
});
const { homeStatus } = await import("../src/domain/home-status.ts");
import { defaultSnapshot } from "../src/domain/state.ts";

const status = (patch = {}, { ready = true, bootError = "", now = 5000 } = {}) =>
  homeStatus({ ...defaultSnapshot, ...patch }, ready, bootError, now);

test("initialization, boot failures and explicit stopped state stay distinct", () => {
  assert.deepEqual(status({}, { ready: false }), {
    tone: "neutral",
    label: "正在初始化",
    details: "正在读取本机接收服务状态",
  });
  assert.deepEqual(status({}, { bootError: "  后端服务不可用  " }), {
    tone: "error",
    label: "无法连接本机服务",
    details: "后端服务不可用",
  });
  const stopped = status();
  assert.equal(stopped.label, "接收已停止");
  assert.equal(stopped.tone, "neutral");
  assert.match(stopped.details, /开始接收/);
});

test("starting, connecting and waiting are normal transitions, not warnings", () => {
  const cases = [
    ["starting", "正在启动接收"],
    ["connecting", "正在连接设备"],
    ["waiting", "等待设备连接"],
  ];
  for (const [stage, label] of cases) {
    const result = status({ stage, process_running: true });
    assert.equal(result.label, label);
    assert.equal(result.tone, "neutral");
  }
});

test("waiting for devices never asserts verified discovery from process presence", () => {
  const unverified = status({ stage: "waiting", process_running: true, discovery_verified: false });
  assert.equal(unverified.label, "等待设备连接");
  assert.match(unverified.details, /发现尚未验证/);
  assert.doesNotMatch(unverified.details, /广播已验证/);
  const verified = status({ stage: "waiting", process_running: true, discovery_verified: true });
  assert.equal(verified.label, "等待设备连接");
  assert.match(verified.details, /广播已验证/);
  assert.doesNotMatch(verified.details, /尚未验证/);
});

test("waiting tooltip preserves useful context after disconnect or timeout", () => {
  const base = { stage: "waiting", process_running: true };
  assert.match(status({ ...base, detail: "投屏已断开，接收进程仍运行" }).details, /上次投屏已断开/);
  assert.match(status({ ...base, detail: "本次连接未完成，继续等待手机投屏" }).details, /上次连接未完成/);
});

test("active mirroring only claims video connection and formats elapsed time", () => {
  const base = { stage: "connected", process_running: true };
  assert.equal(status({ ...base, connected_since: 4939 }).label, "正在投屏 · 00:01:01");
  assert.equal(status(base).label, "正在投屏");
  assert.match(status(base).details, /音频输出尚未单独验证/);
  assert.match(status({ ...base, audio_verified: true }).details, /音频状态已验证/);
  assert.equal(status(base).tone, "success");
});

test("inconsistent active stages without receiver process must not show connected", () => {
  for (const stage of ["connected", "connecting", "waiting"]) {
    const result = status({ stage, process_running: false });
    assert.equal(result.label, "接收已停止");
    assert.equal(result.tone, "neutral");
  }
});

test("errors use concise stable labels while retaining diagnostics", () => {
  const expected = {
    missing_binary: "接收引擎不可用",
    missing_runtime: "媒体组件不可用",
    port_in_use: "接收端口被占用",
    mdns: "设备发现服务异常",
    audio: "音频输出异常",
    video: "视频播放异常",
    crash: "接收引擎意外退出",
    unknown: "接收服务异常",
  };
  for (const [issue, label] of Object.entries(expected)) {
    const result = status({ stage: "error", issue, detail: "内核错误：具体故障信息" });
    assert.equal(result.tone, "error", issue);
    assert.equal(result.label, label, issue);
    assert.equal(result.details, "内核错误：具体故障信息", issue);
  }
  const noIssue = status({ stage: "error", issue: null, detail: "" });
  assert.equal(noIssue.label, "接收服务异常");
  assert.match(noIssue.details, /诊断/);
});

test("service errors take priority over connected and startup states", () => {
  const s = { stage: "error", issue: "crash", process_running: true };
  assert.equal(status(s).label, "接收引擎意外退出");
  assert.equal(status(s, { bootError: "IPC 不可用" }).label, "无法连接本机服务");
  assert.equal(status(s, { ready: false, bootError: "IPC 不可用" }).label, "正在初始化");
});
