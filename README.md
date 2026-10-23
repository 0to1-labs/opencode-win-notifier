# opencode-win-notifier

**Windows desktop notification plugin for [opencode](https://opencode.ai) v2** — now with a custom WPF glass card.

Two notification surfaces fire together, zero dependencies, zero network calls, zero disk writes:

1. **WPF card** — a borderless dark glass card slides in from the bottom-right corner:
   - accent color / glyph / sound per event type (done ✓ green · error ✕ red · permission ⚠ amber)
   - auto fade-out countdown, **hover pauses the countdown**, click anywhere to dismiss
   - never steals keyboard focus
2. **WinRT toast** — lands in the Notification Center so you keep a history

> 中文一句话：opencode v2 的 Windows 桌面通知插件——AI 干完活、出错、等你批权限时，右下角滑入一张深色毛玻璃卡片（同时进通知中心）；无依赖、无网络、无落盘。

## What it does

| Event | Card |
|---|---|
| `session.idle` | ✓ green — **任务完成** Task finished (shows session title when known) |
| `permission.asked` | ⚠ amber — **等待授权** Your approval is needed |
| `session.error` | ✕ red — **出错了** Something went wrong |

Stop staring at the terminal while a long task runs — opencode will ping you on the desktop when it's done or needs you.

## v3.0.1 — fixed the event stream consumption

v3.0.0 called `context.event.subscribe(callback)` assuming a callback API — but the v2
`subscribe()` returns an **async iterable** (the callback was silently treated as an
options object and dropped, so no events ever arrived). v3.0.1 consumes the stream
with `for await...of` in a background loop.

Also switched to the actual v2 event names observed on the wire:
`session.execution.succeeded` (generation finished, v1 `session.idle` never fires in v2),
`session.execution.failed` (errors), plus `session.renamed` to pick up session titles.

## v3.0.0 — rewritten for the opencode v2 plugin format

opencode 2.1+ requires plugins in the `plugins/` discovery directory to be **v2-format modules**: a default-exported definition object with an `id` and a `setup` (or `effect`) function. The old "export an async function returning hooks" format (and the old `plugin` config array with file paths) is no longer loaded — that is why this plugin silently stopped working for many users after upgrading opencode.

v3 is a native v2 plugin:

- default-exports `{ id: "user.win-notifier", setup }` — no helper imports needed, still zero dependencies
- subscribes to the v2 event stream (`context.event.subscribe`)
- handles both `properties`-shaped and `data`-shaped v2 events
- subagent (child) sessions are filtered via `parentID`, rapid duplicate idles are debounced, unknown sessions still notify — prefer a stray popup over a missing one

## Install

1. Put `index.js` into the global plugin discovery directory, e.g.:

```
~/.config/opencode/plugins/win-notifier.js
```

Windows example: `C:\Users\<you>\.config\opencode\plugins\win-notifier.js`

opencode discovers `.js`/`.ts` files in `~/.config/opencode/plugins/` automatically at startup — **no config entry needed**. (Editing the file hot-reloads the plugin; no restart required on opencode 2.1+.)

2. Nothing else. No build, no npm install, no dependencies.

> Note for opencode 1.x: use the v1/v2.0 tags of this repo with the old `plugin` config array instead.

## How it works

- Exports a v2 plugin definition; `setup` subscribes to the event stream
- On trigger, spawns **detached** `powershell.exe -NoProfile -STA -EncodedCommand` processes:
  - one running a WinRT toast via `ToastNotificationManager`
  - one rendering the WPF card (`PresentationFramework`) with slide-in / fade-out animations and a `DispatcherTimer` countdown
- The command is UTF-16LE → base64 encoded, so it is immune to quoting/injection issues
- Fire-and-forget (`unref` + detached): never blocks the agent loop, never crashes the session
- Card text is passed as a single JSON blob (`ConvertFrom-Json`) — no string-injection surface

## Tuning

Top of the file:

- `CARD_DURATION_MS` — how long the card stays on screen (default 6000)
- `DEBOUNCE_MS` — merge duplicate idle events within this window (default 3000)
- `CARDS` — title / message / glyph / accent color / sound per event type (notification text is Chinese by default; edit freely)

## Notes

- Windows only (win32). On macOS/Linux you already have good options.
- The card renders via WPF, so it works even when Focus Assist / notification banners are disabled; the toast companion requires Windows PowerShell not to be muted in Settings → System → Notifications.
- Known limitation: simultaneous cards stack on top of each other (no cross-process positioning yet).

## License

MIT
