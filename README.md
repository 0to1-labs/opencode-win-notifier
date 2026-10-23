# opencode-win-notifier

**Windows desktop notification plugin for [opencode](https://opencode.ai) v2.**

Two notification surfaces fire together, zero dependencies, zero network calls, zero disk writes:

1. **WinRT toast** — lands in the Notification Center so you keep a history
2. **WScript.Shell popup** — a real dialog window that is always visible (8 s timeout), immune to Focus Assist, notification settings, and WPF window-visibility quirks

> 中文一句话：opencode v2 的 Windows 桌面通知插件——AI 干完活、出错、等你批权限时弹系统通知和一个保证可见的对话框；无依赖、无网络、无落盘。

## What it does

| Event | Notification |
|---|---|
| `session.execution.succeeded` | **任务完成** Task finished (shows session title when known) |
| `permission.asked` | **等待授权** Your approval is needed |
| `session.execution.failed` / `session.error` | **出错了** Something went wrong |

Stop staring at the terminal while a long task runs — opencode will ping you on the desktop when it's done or needs you.

## v3.0.4 — the "sometimes it doesn't pop up" bug, finally root-caused

The full fix history of the v3 line (each step verified on a real Windows 11 + opencode 2.1 setup):

- **v3.0.4 — removed `detached: true` from `spawn()`.** The opencode embedded Bun runtime does not execute the commands of detached child processes on Windows. Verified with a six-variant spawn matrix: every detached combination spawned a process that silently did nothing; the only non-detached variant executed. This is the true root cause of this plugin's flaky notifications since v1.x, and likely affects many other spawn-based opencode plugins on Windows.
- **v3.0.3 — WPF card swapped for a WScript.Shell popup.** `windowsHide: true` sets `STARTF_USESHOWWINDOW/SW_HIDE` in STARTUPINFO, which is inherited by WPF windows spawned that way and keeps them invisible. Toasts and COM popups are immune.
- **v3.0.1 — v2 event stream fixes.** `context.event.subscribe()` returns an async iterable (consume with `for await...of`, not a callback), and v2's real completion event is `session.execution.succeeded` (v1's `session.idle` never fires in v2).
- **v3.0.0 — rewritten for the opencode v2 plugin format.** opencode 2.1+ no longer loads v1-format plugins (async function returning hooks) from the `plugins/` discovery directory or the old `plugin` config array.

## Install

1. Put `index.js` into the global plugin discovery directory:

```
~/.config/opencode/plugins/win-notifier.js
```

Windows example: `C:\Users\<you>\.config\opencode\plugins\win-notifier.js`

opencode discovers `.js`/`.ts` files in `~/.config/opencode/plugins/` automatically at startup — **no config entry needed**. (Editing the file hot-reloads the plugin; run `opencode service restart` to be safe.)

2. Nothing else. No build, no npm install, no dependencies.

> Note for opencode 1.x: use the v1/v2.0 tags of this repo with the old `plugin` config array instead.

## How it works

- Exports a v2 plugin definition; `setup` consumes the event stream with `for await...of`
- On trigger, spawns `powershell.exe -NoProfile -EncodedCommand` processes (UTF-16LE → base64, immune to quoting/injection):
  - one firing a WinRT toast via `ToastNotificationManager`
  - one showing a `WScript.Shell` COM popup
- Spawn details matter on Windows:
  - **no `detached: true`** — detached children don't execute under the embedded Bun runtime
  - `stdio` uses pipes — a fully-ignored stdio prevents execution on some hosts
  - outputs are drained to avoid pipe backpressure
- Fire-and-forget (`unref`): never blocks the agent loop, never crashes the session

## Tuning

Top of the file:

- `DEBOUNCE_MS` — merge duplicate completion events within this window (default 3000)
- `CARDS` — title / message per event type (notification text is Chinese by default; edit freely)
- The popup timeout (8 s) lives in `notifyPopup`

## Notes

- Windows only (win32). On macOS/Linux you already have good options.
- The toast companion requires Windows PowerShell not to be muted in Settings → System → Notifications.

## License

MIT
