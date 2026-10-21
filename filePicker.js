// filePicker.js
// Opens a native file picker on the current platform.
//
// Return values for both functions:
//   string    → absolute path of the selected file
//   null      → user cancelled
//   undefined → no picker backend available (caller should fall back to terminal)

const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

function isTermux() {
  return (
    typeof process.env.PREFIX === "string" &&
    process.env.PREFIX.includes("com.termux")
  );
}

// ── Termux / Android ──────────────────────────────────────────
// termux-storage-get opens the Android file picker and COPIES the
// selected file to outPath. That copy is what gives us a usable
// local path.
function tryTermux(outPath) {
  try {
    // Remove any previous picked file so we can tell if a new one was selected
    try { fs.unlinkSync(outPath); } catch (_) {}

    const result = spawnSync("termux-storage-get", [outPath], {
      stdio: "inherit",
    });

    if (result.error) return undefined;  // binary missing
    if (result.status !== 0) return null; // cancelled / failed

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      return outPath;
    }
    return null;
  } catch (_) {
    return undefined;
  }
}

// ── Windows ───────────────────────────────────────────────────
function tryWindows(filterString) {
  const ps = `
    Add-Type -AssemblyName System.Windows.Forms | Out-Null;
    $f = New-Object System.Windows.Forms.OpenFileDialog;
    $f.Filter = '${filterString}';
    $f.Title = 'Select a file';
    if ($f.ShowDialog() -eq 'OK') { Write-Output $f.FileName }
  `;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-Command", ps],
    { encoding: "utf8" }
  );
  if (result.error) return undefined;
  const out = (result.stdout || "").trim();
  return out || null;
}

// ── macOS ─────────────────────────────────────────────────────
function tryMac(prompt) {
  const script = `POSIX path of (choose file with prompt "${prompt}")`;
  const result = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (result.error) return undefined;
  const out = (result.stdout || "").trim();
  return out || null;
}

// ── Desktop Linux ─────────────────────────────────────────────
function tryLinux(filterName, filterPattern) {
  const result = spawnSync(
    "zenity",
    [
      "--file-selection",
      `--title=Select ${filterName}`,
      `--file-filter=${filterName} | ${filterPattern}`,
    ],
    { encoding: "utf8" }
  );
  if (result.error) return undefined;
  const out = (result.stdout || "").trim();
  return out || null;
}

// ── Public API ────────────────────────────────────────────────
function pickVideo() {
  if (isTermux()) {
    return tryTermux(path.join(os.homedir(), "picked_video.mp4"));
  }
  if (process.platform === "win32") {
    return tryWindows(
      "Video files|*.mp4;*.mkv;*.avi;*.webm;*.mov;*.flv|All files|*.*"
    );
  }
  if (process.platform === "darwin") {
    return tryMac("Select a video");
  }
  if (process.platform === "linux") {
    return tryLinux(
      "Video files",
      "*.mp4 *.mkv *.avi *.webm *.mov *.flv"
    );
  }
  return undefined;
}

function pickSubtitle() {
  if (isTermux()) {
    return tryTermux(path.join(os.homedir(), "picked_subtitle.srt"));
  }
  if (process.platform === "win32") {
    return tryWindows(
      "Subtitle files|*.srt;*.vtt;*.ass|All files|*.*"
    );
  }
  if (process.platform === "darwin") {
    return tryMac("Select a subtitle");
  }
  if (process.platform === "linux") {
    return tryLinux("Subtitle files", "*.srt *.vtt *.ass");
  }
  return undefined;
}

module.exports = { pickVideo, pickSubtitle };