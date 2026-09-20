// opencode win-notifier — self-built desktop notification plugin (Windows only)
// Hooks: session.idle -> generation completed toast; permission.ask -> permission toast
// Verified code path: node:child_process spawn powershell.exe with -EncodedCommand (UTF-16LE base64)
// No network, no disk writes, no dependencies.

import { spawn } from "node:child_process";

let currentSessionID = null;

function toEncodedCommand(psScript) {
  return Buffer.from(psScript, "utf16le").toString("base64");
}

function sanitize(text) {
  return String(text ?? "").replace(/'/g, "");
}

function notify(title, message) {
  const t = sanitize(title);
  const m = sanitize(message);
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "Add-Type -AssemblyName System.Drawing;",
    "$n = New-Object System.Windows.Forms.NotifyIcon;",
    "$n.Icon = [System.Drawing.SystemIcons]::Information;",
    "$n.Visible = $true;",
    `$n.ShowBalloonTip(4000, '${t}', '${m}', 'Info');`,
    "Start-Sleep -Milliseconds 4500;",
    "$n.Dispose();",
  ].join(" ");
  try {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-EncodedCommand", toEncodedCommand(ps)],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();
  } catch {
    // notifications are best-effort; never break the agent loop
  }
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
