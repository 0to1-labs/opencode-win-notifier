# opencode-win-notifier

Minimal **Windows desktop notification plugin for [opencode](https://opencode.ai)**.

Fires a native Windows toast when your agent needs you — **zero dependencies, zero network calls, zero disk writes**. One transparent ~50-line file you can read in a minute.

> 中文一句话:opencode 的 Windows 桌面通知插件——AI 干完活、出错、等你批权限时弹系统气泡;无依赖、无网络、无落盘,单文件透明代码。

## What it does

| Event | Notification |
|---|---|
| `session.idle` | **Generation completed** — your agent finished working |
| `permission.ask` | **Permission requested** — your approval is needed |
| `session.error` | **Session error occurred** — something went wrong |

Stop staring at the terminal while a long task runs — opencode will ping you on the desktop when it's done or needs you.

## Install

1. Put `index.js` anywhere you like, e.g. `~/.config/opencode/plugins-store/opencode-win-notifier/index.js`
2. Reference it in your opencode config:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins-store/opencode-win-notifier/index.js"
  ]
}
```

(Relative plugin paths resolve from the location of the `opencode.json` that declares them.)

3. Restart opencode. Done — no build, no npm install, nothing to configure.

## How it works

- Registers opencode plugin hooks (`event` + `permission.ask`)
- On trigger, spawns a **detached** `powershell.exe -NoProfile -EncodedCommand` process
- The command is UTF-16LE → base64 encoded, so it is immune to quoting/injection issues
- Inside PowerShell: a `System.Windows.Forms.NotifyIcon` balloon tip (surface as toast on Win10/11)
- Fire-and-forget (`unref` + detached): never blocks the agent loop, never crashes the session

## Why another notifier plugin?

The opencode ecosystem already has two desktop-notification plugins — neither worked for me on Windows:

- **`opencode-notifier` (npm, 0.2.2)** — fails to load under opencode 0.18.31's embedded runtime with `Invalid Date` (its bundled `bun:sqlite` analytics init; loads fine under standalone Bun 1.4.2, so it's a runtime-combination bug), and analytics can't be disabled before the crash point
- **`opencode-notificator` (panta82, GitHub)** — no Windows branch, the notification functions only implement `darwin` (`osascript`) and `linux` (`notify-send`)

So: 50 lines of transparent, dependency-free, Windows-only code. Nothing to trust but what you can read.

## Security review checklist

If you're the kind of person who reviews plugins before loading them (you should be):

- [x] No dependencies — imports `node:child_process` only
- [x] No network — no fetch/http/net/dns anywhere
- [x] No disk writes, no env reads, no telemetry
- [x] Child process only spawns `powershell.exe -NoProfile -EncodedCommand` with an internally-built script (title/message sanitized against single-quote injection)
- [x] Everything is best-effort and wrapped in try/catch — notification failures can never break your session

## Tuning

Notification text is currently hardcoded ("Generation completed" etc.). Edit `index.js` directly — it's 50 lines, change whatever you like. Sound/timeout tweaks happen in the `ShowBalloonTip(...)` call.

## Notes

- Windows only (win32). On macOS/Linux you already have good options (see the two plugins above).
- If no toast appears while dispatch succeeds: check Focus Assist / notification banners are enabled, and that *Windows PowerShell* isn't muted in Settings → System → Notifications.

## License

MIT
