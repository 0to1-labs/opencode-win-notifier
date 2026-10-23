// opencode win-notifier v3.0.4 — Windows desktop notification plugin for opencode
//
// v3.0.4: THE fix — removed `detached: true` from spawn. The opencode embedded
//   Bun runtime does not execute the command of detached child processes on
//   Windows (verified via a 6-variant spawn matrix: every detached combo
//   failed to execute; the only non-detached combo executed). This also
//   explains the plugin's on-and-off history since v1.x.
//
// v3.0.3: WPF card swapped for a WScript.Shell Popup (WPF windows are
//   suppressed by the windowsHide spawn flag's STARTF_USESHOWWINDOW/SW_HIDE).
//
// v3.0.1: event stream consumed with for-await (async iterable); v2 event
//   names: session.execution.succeeded / session.execution.failed /
//   permission.asked.
//
// Notification surfaces (both fire together):
//   1. WinRT toast  — lands in the Notification Center (history)
//   2. WScript.Shell Popup — a real dialog window, always visible, 8s timeout
//
// Security: zero dependencies, zero network, zero disk writes, single transparent file.

import { spawn } from "node:child_process";

// ---------- config ----------

const DEBOUNCE_MS = 3000; // merge duplicate completion events within this window

const CARDS = {
  idle: {
    title: "任务完成",
    message: "OpenCode 已回答完毕，回来看看吧",
  },
  error: {
    title: "出错了",
    message: "会话发生错误，需要你处理",
  },
  permission: {
    title: "等待授权",
    message: "OpenCode 需要你的批准才能继续",
  },
};

// ---------- state ----------

// sid -> { child: boolean, title: string|null }
const sessions = new Map();
// sid -> last completion notification timestamp
const lastIdleAt = new Map();

// ---------- powershell plumbing ----------

function toEncodedCommand(psScript) {
  return Buffer.from(psScript, "utf16le").toString("base64");
}

function sanitize(text) {
  return String(text ?? "").replace(/'/g, "");
}

function spawnPowerShell(psScript) {
  try {
    // CRITICAL: do NOT use `detached: true` — the opencode embedded Bun
    // runtime does not execute detached children on Windows. A non-detached
    // child survives the parent fine here (the server is long-lived, and the
    // notification processes exit on their own within seconds).
    const child = spawn("powershell.exe", ["-NoProfile", "-EncodedCommand", toEncodedCommand(psScript)], {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", () => {});
    child.unref();
  } catch { /* best-effort */ }
}

// ---------- path 1: WinRT toast (Notification Center history) ----------

function notifyToast(title, message) {
  const t = sanitize(title);
  const m = sanitize(message);
  const ps = [
    "[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime];",
    "$AppId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';",
    "$Xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);",
    `$Null = $Xml.GetElementsByTagName('text').Item(0).AppendChild($Xml.CreateTextNode('${t}'));`,
    `$Null = $Xml.GetElementsByTagName('text').Item(1).AppendChild($Xml.CreateTextNode('${m}'));`,
    "$Toast = [Windows.UI.Notifications.ToastNotification]::new($Xml);",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($Toast);",
  ].join(" ");
  spawnPowerShell(ps);
}

// ---------- path 2: WScript.Shell Popup (guaranteed visible) ----------
// A real dialog window via COM — completely independent of WPF ShowWindow
// behavior and of all Windows notification settings.

function notifyPopup(title, message) {
  const t = sanitize(title).replace(/"/g, "");
  const m = sanitize(message).replace(/"/g, "");
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell;`,
    `$ws.Popup('${m}', 8, '${t}', 64) | Out-Null;`,
  ].join(" ");
  spawnPowerShell(ps);
}

// ---------- notify ----------

function notify(card, stampText) {
  notifyToast(card.title, card.message);                           // Notification Center history
  notifyPopup(card.title, card.message + "  (" + stampText + ")"); // always-visible dialog
}

// ---------- event helpers ----------

// v2 events carry their payload in `properties` (session.* / permission.*)
// or `data` (aggregate events) — read both.
function eventSID(event) {
  if (!event) return null;
  return event.properties?.sessionID
      ?? event.data?.sessionID
      ?? event.sessionID
      ?? null;
}

function eventInfo(event) {
  if (!event) return null;
  return event.properties?.info ?? event.data?.info ?? null;
}

function stampNow() {
  const h = String(new Date().getHours()).padStart(2, "0");
  const m = String(new Date().getMinutes()).padStart(2, "0");
  return h + ":" + m;
}

// ---------- event handling ----------

function handleEvent(event) {
  const type = event?.type;
  const sid = eventSID(event);

  if (type === "session.created" && sid) {
    const info = eventInfo(event);
    sessions.set(sid, {
      child: Boolean(info?.parentID),
      title: info?.title || null,
    });
    return;
  }

  if (type === "session.renamed" && sid) {
    const info = sessions.get(sid);
    const newTitle = event?.properties?.title ?? event?.data?.title ?? null;
    if (info) info.title = newTitle || info.title;
    return;
  }

  if (type === "session.deleted" && sid) {
    sessions.delete(sid);
    lastIdleAt.delete(sid);
    return;
  }

  if (type === "session.idle" || type === "session.execution.succeeded") {
    const info = sid ? sessions.get(sid) : null;
    if (info?.child) return; // subagent finished — not worth interrupting you

    const now = Date.now();
    if (sid && now - (lastIdleAt.get(sid) ?? 0) < DEBOUNCE_MS) return;
    if (sid) lastIdleAt.set(sid, now);

    const card = { ...CARDS.idle };
    if (info?.title) card.message = "「" + info.title + "」已回答完毕";
    notify(card, stampNow());
    return;
  }

  if (type === "session.error" || type === "session.execution.failed") {
    notify(CARDS.error, stampNow());
    return;
  }

  if (type === "permission.asked" || type === "permission.v2.asked") {
    notify(CARDS.permission, stampNow());
  }
}

// ---------- plugin (opencode v2 format) ----------

export default {
  id: "user.win-notifier",
  setup: async (context) => {
    // context.event.subscribe() returns an async iterable of events — consume
    // it with for-await in a background loop (setup must not block).
    const stream = await context.event.subscribe();
    (async () => {
      for await (const event of stream) {
        try { handleEvent(event); } catch { /* best-effort */ }
      }
    })().catch(() => { /* stream ended or failed — nothing to do */ });
  },
};
