// opencode win-notifier v3.0.0 — Windows desktop notification plugin for opencode
//
// v3.0.0: rewritten for the opencode v2 plugin format.
//   - Exports a v2 plugin definition: default export { id, setup } via
//     @opencode-ai/plugin/v2/promise define().
//   - Listens on the v2 event stream (context.event.subscribe):
//       session.idle   -> task finished card (green check)
//       session.error  -> error card (red cross)
//       permission.asked / permission.v2.asked -> approval card (amber warning)
//   - v2 events carry their payload in `properties` (session.* events) or
//     `data` (aggregate events) — both are handled.
//   - Notification core unchanged from v2.0.0: WinRT toast (Notification
//     Center history) + custom WPF glass card (slide-in bottom-right, hover
//     pauses countdown, click dismisses, never steals focus).
//   - Subagent (child) sessions are filtered via parentID; rapid duplicate
//     idles are debounced; unknown sessions still notify (prefer a stray
//     popup over a missing one).
//
// Security: zero dependencies, zero network, zero disk writes, single transparent file.
// NOTE: no imports needed — the v2 plugin definition is a plain default-exported
// object ({ id, setup }); define() from @opencode-ai/plugin/v2/promise is an
// identity helper, so we skip it to stay dependency-free.

import { spawn } from "node:child_process";

// ---------- config ----------

const DEBOUNCE_MS = 3000;      // merge duplicate session.idle within this window
const CARD_DURATION_MS = 6000; // card stays on screen before fading out

const CARDS = {
  idle: {
    title: "任务完成",
    message: "OpenCode 已回答完毕，回来看看吧",
    glyph: 0x2713, // ✓
    accent: "#2EA043",
    sound: "asterisk",
  },
  error: {
    title: "出错了",
    message: "会话发生错误，需要你处理",
    glyph: 0x2715, // ✕
    accent: "#D73A49",
    sound: "hand",
  },
  permission: {
    title: "等待授权",
    message: "OpenCode 需要你的批准才能继续",
    glyph: 0x26A0, // ⚠
    accent: "#D29922",
    sound: "exclamation",
  },
};

// ---------- state ----------

// sid -> { child: boolean, title: string|null }
const sessions = new Map();
// sid -> last idle notification timestamp
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
    spawn("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", toEncodedCommand(psScript)], {
      detached: true, stdio: "ignore", windowsHide: true,
    }).unref();
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

// ---------- path 2: WPF card (the fancy one) ----------

const CARD_PS = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$cfg = @'
__JSON__
'@ | ConvertFrom-Json

$xamlText = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" ResizeMode="NoResize" AllowsTransparency="True"
        Background="Transparent" Topmost="True" ShowInTaskbar="False"
        ShowActivated="False" Width="380" Height="116">
  <Border x:Name="Card" CornerRadius="14" Padding="18,14" Margin="18" Cursor="Hand">
    <Border.Background>
      <SolidColorBrush Color="#F216181D" />
    </Border.Background>
    <Border.Effect>
      <DropShadowEffect BlurRadius="20" ShadowDepth="3" Opacity="0.5" />
    </Border.Effect>
    <StackPanel Orientation="Horizontal">
      <Grid Width="42" Height="42">
        <Ellipse Fill="__ACCENT__" />
        <TextBlock x:Name="Glyph" Foreground="White" FontSize="19" FontWeight="Bold"
                   HorizontalAlignment="Center" VerticalAlignment="Center" />
      </Grid>
      <StackPanel Margin="16,0,0,0" VerticalAlignment="Center" Width="262">
        <TextBlock x:Name="Title" Foreground="White" FontSize="14.5" FontWeight="SemiBold" />
        <TextBlock x:Name="Message" Foreground="#C8FFFFFF" FontSize="12" TextWrapping="Wrap"
                   Margin="0,4,0,0" TextTrimming="CharacterEllipsis" />
        <TextBlock x:Name="Stamp" Foreground="#59FFFFFF" FontSize="10.5" Margin="0,7,0,0" />
      </StackPanel>
    </StackPanel>
  </Border>
</Window>
'@
$xamlText = $xamlText.Replace('__ACCENT__', $cfg.accent)
$reader = New-Object System.Xml.XmlNodeReader ([xml]$xamlText)
$win = [Windows.Markup.XamlReader]::Load($reader)

$win.FindName('Glyph').Text = [char]::ConvertFromUtf32([int]$cfg.glyph)
$win.FindName('Title').Text = $cfg.title
$win.FindName('Message').Text = $cfg.message
$win.FindName('Stamp').Text = $cfg.stamp

$work = [System.Windows.SystemParameters]::WorkArea
$win.Left = $work.Right - $win.Width - 14
$win.Top = $work.Bottom - $win.Height - 14
$win.Opacity = 0

$script:slide = New-Object System.Windows.Media.TranslateTransform($win.Width, 0)
# NOTE: a top-level WPF Window does not support RenderTransform (it is an HWND),
# so the slide-in animation is applied to the card content Border instead.
$win.FindName('Card').RenderTransform = $slide

$win.Add_ContentRendered({
  try {
    switch ($cfg.sound) {
      'exclamation' { [System.Media.SystemSounds]::Exclamation.Play() }
      'hand'        { [System.Media.SystemSounds]::Hand.Play() }
      default       { [System.Media.SystemSounds]::Asterisk.Play() }
    }
  } catch {}
  $fadeIn = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, [TimeSpan]::FromMilliseconds(260))
  $win.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fadeIn)
  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut
  $anim = New-Object System.Windows.Media.Animation.DoubleAnimation($win.Width, 0, [TimeSpan]::FromMilliseconds(380))
  $anim.EasingFunction = $ease
  $script:slide.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $anim)
})

$script:done = $false
$script:dismiss = {
  if ($script:done) { return }
  $script:done = $true
  $script:timer.Stop()
  $out = New-Object System.Windows.Media.Animation.DoubleAnimation(1, 0, [TimeSpan]::FromMilliseconds(260))
  $out.Add_Completed({ $win.Close() })
  $win.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $out)
}

$script:timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds($cfg.duration)
$timer.Add_Tick({ & $script:dismiss })
$timer.Start()

$win.Add_MouseEnter({ $script:timer.Stop() })
$win.Add_MouseLeave({ $script:timer.Start() })
$win.Add_MouseLeftButtonDown({ & $script:dismiss })

$app = New-Object System.Windows.Application
$app.ShutdownMode = [System.Windows.ShutdownMode]::OnLastWindowClose
$app.Run($win) | Out-Null
`;

function notifyCard(card, stampText) {
  const cfg = JSON.stringify({
    title: card.title,
    message: card.message,
    glyph: card.glyph,
    accent: card.accent,
    sound: card.sound,
    duration: CARD_DURATION_MS,
    stamp: stampText,
  }).replace(/'/g, "''");
  const ps = CARD_PS.replace("__JSON__", cfg);
  spawnPowerShell(ps);
}

// ---------- notify ----------

function notify(card, stampText) {
  notifyToast(card.title, card.message); // Notification Center history
  notifyCard(card, stampText);           // on-screen card
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

// ---------- plugin (opencode v2 format) ----------

export default {
  id: "user.win-notifier",
  setup: async (context) => {
    await context.event.subscribe((event) => {
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

      if (type === "session.deleted" && sid) {
        sessions.delete(sid);
        lastIdleAt.delete(sid);
        return;
      }

      if (type === "session.idle") {
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

      if (type === "session.error") {
        notify(CARDS.error, stampNow());
        return;
      }

      if (type === "permission.asked" || type === "permission.v2.asked") {
        notify(CARDS.permission, stampNow());
      }
    });
  },
};
