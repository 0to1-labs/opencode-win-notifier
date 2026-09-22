// opencode win-notifier v1.2.0 — Windows desktop notification plugin for opencode
// Hooks: session.idle -> generation completed; permission.ask -> permission toast; session.error -> error toast
//
// v1.2.0 change: dual-path notification for maximum reliability:
//   1) WinRT Toast (best-effort, lands in Notification Center)
//   2) WScript.Shell Popup (always visible: creates a real dialog window,
//      independent of all notification settings/services)
//
// Security: zero dependencies, zero network, zero disk writes, single transparent file.

import { spawn } from "node:child_process";

let currentSessionID = null;

function toEncodedCommand(psScript) {
  return Buffer.from(psScript, "utf16le").toString("base64");
}

function sanitize(text) {
  return String(text ?? "").replace(/'/g, "");
}

// Path 1: WinRT Toast (modern, goes to Notification Center; may be silently filtered)
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
  try {
    spawn("powershell.exe", ["-NoProfile", "-EncodedCommand", toEncodedCommand(ps)], {
      detached: true, stdio: "ignore", windowsHide: true,
    }).unref();
  } catch { /* best-effort */ }
}

// Path 2: WScript.Shell Popup (real dialog window; completely independent of
// Windows notification infrastructure — always visible)
function notifyPopup(title, message) {
  const t = sanitize(title).replace(/"/g, "");
  const m = sanitize(message).replace(/"/g, "");
  const ps = [
    `$ws = New-Object -ComObject WScript.Shell;`,
    `$ws.Popup('${m}', 8, '${t}', 64) | Out-Null;`,
  ].join(" ");
  try {
    spawn("powershell.exe", ["-NoProfile", "-EncodedCommand", toEncodedCommand(ps)], {
      detached: true, stdio: "ignore", windowsHide: true,
    }).unref();
  } catch { /* best-effort */ }
}

function notify(title, message) {
  notifyToast(title, message);   // try modern toast (notification center)
  notifyPopup(title, message);   // guarantee visibility with a real popup window
}

function eventSessionID(event) {
  if (!event) return null;
  if (event.sessionID) return event.sessionID;
  if (event.properties?.sessionID) return event.properties.sessionID;
  if (event.properties?.info?.id) return event.properties.info.id;
  return null;
}

export default async function WinNotifier() {
  return {
    event: async ({ event }) => {
      const sid = eventSessionID(event);
      if (event?.type === "session.created" && sid) {
        currentSessionID = sid;
      }
      if (event?.type === "session.idle" && sid === currentSessionID) {
        notify("OpenCode", "Generation completed");
      }
      if (event?.type === "session.error") {
        notify("OpenCode", "Session error occurred");
      }
    },
    "permission.ask": async () => {
      notify("OpenCode", "Permission requested - your approval is needed");
    },
  };
}
