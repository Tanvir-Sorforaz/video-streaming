const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");
const os = require("os");
const { execFile } = require("child_process");
const { Server } = require("socket.io");
const { pickVideo, pickSubtitle } = require("./filePicker");

const app = express();
const PORT = 6996;

const server = http.createServer(app);
const io = new Server(server);

let videoPath = "";
let subtitlePath = "";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

let roomState = {
  isPlaying: false,
  currentTime: 0,
  updatedAt: Date.now(),
};

let joiningInProgressUntil = 0;
const chatHistory = [];
const lastSeekByUsername = new Map();
const voiceUsers = new Map();

function saveChatItem(item, eventName, replaceEventId) {
  if (replaceEventId) {
    const existingIndex = chatHistory.findIndex((entry) => entry.eventId === replaceEventId);
    if (existingIndex !== -1) {
      chatHistory[existingIndex] = item;
    } else {
      chatHistory.push(item);
    }
  } else {
    chatHistory.push(item);
  }

  if (chatHistory.length > 50) {
    chatHistory.splice(0, chatHistory.length - 50);
  }

  io.emit(eventName, item);
}

function leaveVoice(socket) {
  const user = voiceUsers.get(socket.id);
  if (!user) return;

  voiceUsers.delete(socket.id);
  io.emit("voice-left", { id: socket.id });
  io.emit("voice-count", voiceUsers.size);
  saveChatItem({ type: "voice-leave", username: user.username, time: Date.now() }, "chat-event");
}

app.get("/video", (req, res) => {
  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunkSize = end - start + 1;
    const file = fs.createReadStream(videoPath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });

    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
    });
    fs.createReadStream(videoPath).pipe(res);
  }
});

app.use(express.static("public"));

app.get("/subtitle", (req, res) => {
  if (!subtitlePath || !fs.existsSync(subtitlePath)) {
    return res.status(404).send("Subtitle file not found");
  }

  res.sendFile(subtitlePath);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  const username = socket.handshake.auth.username || "Unknown User";
  socket.username = username;
  socket.chatMessageTimes = [];
  socket.pendingActivityEvents = [];

  console.log("User connected:", socket.username);

  joiningInProgressUntil = Date.now() + 1500;

  socket.emit("init-state", {
    ...roomState,
    chatHistory: chatHistory.slice(),
    voiceCount: voiceUsers.size,
    voiceUsers: Array.from(voiceUsers, ([id, user]) => ({ id, ...user })),
  });
  saveChatItem({ type: "join", username, time: Date.now() }, "chat-event");
  io.emit("online-count", io.sockets.sockets.size);

  socket.voiceSignalTimes = [];

  socket.on("voice-join", () => {
    if (voiceUsers.has(socket.id)) return;
    if (voiceUsers.size >= 8) {
      socket.emit("voice-full");
      return;
    }

    const peers = Array.from(voiceUsers, ([id, user]) => ({ id, ...user }));
    voiceUsers.set(socket.id, { username: socket.username, muted: false });
    socket.emit("voice-peers", peers);
    io.emit("voice-count", voiceUsers.size);
    saveChatItem({ type: "voice-join", username: socket.username, time: Date.now() }, "chat-event");
  });

  socket.on("voice-signal", (payload) => {
    if (!payload || typeof payload.to !== "string" || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      return;
    }
    if (!voiceUsers.has(socket.id) || !voiceUsers.has(payload.to)) return;

    const now = Date.now();
    socket.voiceSignalTimes = socket.voiceSignalTimes.filter((time) => now - time < 5000);
    if (socket.voiceSignalTimes.length >= 100) return;
    socket.voiceSignalTimes.push(now);

    io.to(payload.to).emit("voice-signal", {
      from: socket.id,
      username: socket.username,
      data: payload.data,
    });
  });

  socket.on("voice-mute", (muted) => {
    const user = voiceUsers.get(socket.id);
    if (!user || typeof muted !== "boolean") return;

    user.muted = muted;
    io.emit("voice-mute-changed", { id: socket.id, muted });
  });

  socket.on("voice-leave", () => leaveVoice(socket));

  socket.on("chat-message", (payload) => {
    if (typeof payload !== "string") return;

    const text = payload.trim().slice(0, 300);
    if (!text) return;

    const now = Date.now();
    socket.chatMessageTimes = socket.chatMessageTimes.filter((time) => now - time < 5000);
    if (socket.chatMessageTimes.length >= 5) return;
    socket.chatMessageTimes.push(now);

    saveChatItem({ type: "message", username, text, time: now }, "chat-message");
  });

  socket.on("sync-event", (data) => {
    if (data.type === "heartbeat" && Date.now() < joiningInProgressUntil) {
      return;
    }

    if (data.type === "play") {
      console.log(`${socket.username} played the video at ${data.currentTime.toFixed(2)}s`);
    } 
    else if (data.type === "pause") {
      console.log(`${socket.username} paused the video at ${data.currentTime.toFixed(2)}s`);
    } 
    else if (data.type === "seek") {
      console.log(`${socket.username} seeked the video to ${data.currentTime.toFixed(2)}s`);
    }

    if (data.type === "play" || data.type === "pause" || data.type === "seek") {
      const now = Date.now();
      let eventId;
      let replaceEventId;

      if (data.type === "seek") {
        const previousSeek = lastSeekByUsername.get(username);
        if (previousSeek && now - previousSeek.time < 1500) {
          eventId = previousSeek.eventId;
          replaceEventId = eventId;
        } else {
          eventId = `${socket.id}-${now}`;
        }
        lastSeekByUsername.set(username, { eventId, time: now });
      }

      const activity = {
        type: data.type,
        username,
        currentTime: data.currentTime,
        time: now,
        ...(eventId ? { eventId } : {}),
      };

      if (data.type === "play" || data.type === "pause") {
        const pendingActivity = { item: activity, timer: null };
        pendingActivity.timer = setTimeout(() => {
          const pendingIndex = socket.pendingActivityEvents.indexOf(pendingActivity);
          if (pendingIndex === -1) return;
          socket.pendingActivityEvents.splice(pendingIndex, 1);
          saveChatItem(activity, "chat-event");
        }, data.type === "pause" ? 1500 : 300);
        socket.pendingActivityEvents.push(pendingActivity);
      } else {
        socket.pendingActivityEvents.forEach(({ timer }) => clearTimeout(timer));
        socket.pendingActivityEvents = [];
        saveChatItem(activity, "chat-event", replaceEventId);
      }
    }

    roomState = {
      isPlaying: data.isPlaying,
      currentTime: data.currentTime,
      updatedAt: Date.now(),
    };

    socket.broadcast.emit("sync-event", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.username);
    leaveVoice(socket);
    socket.pendingActivityEvents.forEach(({ item, timer }) => {
      clearTimeout(timer);
      saveChatItem(item, "chat-event");
    });
    socket.pendingActivityEvents = [];
    saveChatItem({ type: "leave", username, time: Date.now() }, "chat-event");
    io.emit("online-count", io.sockets.sockets.size);
  });
});

async function resolveVideoPath() {
  console.log("Opening video picker...");
  const picked = pickVideo();

  if (picked === undefined) {
    // No picker backend available → old terminal prompt
    return (await ask("Enter full video path: ")).trim();
  }
  if (picked === null) {
    console.log("No video selected. Exiting.");
    rl.close();
    process.exit(1);
  }
  console.log(`Selected video: ${picked}`);
  return picked;
}

async function resolveSubtitlePath() {
  const proceed = (
    await ask("Add a subtitle file? (y/N): ")
  ).trim().toLowerCase();

  if (proceed !== "y" && proceed !== "yes") {
    return "";
  }

  console.log("Opening subtitle picker...");
  const picked = pickSubtitle();

  if (picked === undefined) {
    return (await ask("Enter full subtitle path (Or press enter to skip): ")).trim();
  }
  if (picked === null) {
    console.log("No subtitle selected, skipping.");
    return "";
  }
  console.log(`Selected subtitle: ${picked}`);
  return picked;
}

function getIPs() {
  const lan = [];
  const tailscale = [];

  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.internal || (address.family !== "IPv4" && address.family !== 4)) continue;

      const octets = address.address.split(".").map(Number);
      if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) {
        tailscale.push(address.address);
      } else {
        lan.push(address.address);
      }
    }
  }

  return {
    lan: [...new Set(lan)],
    tailscale: [...new Set(tailscale)],
  };
}

function runTailscale(args) {
  const candidates = ["tailscale"];
  if (process.platform === "win32") {
    candidates.push("C:\\Program Files\\Tailscale\\tailscale.exe");
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
  }

  return new Promise((resolve) => {
    let candidateIndex = 0;

    const tryNext = () => {
      if (candidateIndex >= candidates.length) {
        resolve(null);
        return;
      }

      const executable = candidates[candidateIndex];
      candidateIndex += 1;

      try {
        execFile(executable, args, { timeout: 4000, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
          if (error) {
            tryNext();
            return;
          }
          resolve(stdout.trim());
        });
      } catch (error) {
        tryNext();
      }
    };

    tryNext();
  });
}

async function getTailscaleHttpsUrl() {
  try {
    const status = await runTailscale(["status", "--json"]);
    if (!status) return null;

    const data = JSON.parse(status);
    const dnsName = data.Self?.DNSName?.trim().replace(/\.$/, "");
    return dnsName ? `https://${dnsName}` : null;
  } catch (error) {
    return null;
  }
}

async function isServeConfigured(port) {
  try {
    const status = await runTailscale(["serve", "status"]);
    return Boolean(status && status.includes(String(port)));
  } catch (error) {
    return false;
  }
}

function colorize(text, colorCode) {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return `\x1b[${colorCode}m${text}\x1b[0m`;
}

function printAccessUrl(label, url, note, colorCode) {
  const details = note ? ` ${colorize(note, "90")}` : "";
  console.log(`  ${colorize(label.padEnd(12), colorCode)} ${url}${details}`);
}

async function startServer() {
  videoPath = await resolveVideoPath();
  if (videoPath) {
    videoPath = videoPath.replace(/['"]/g, "");
  }

  if (!videoPath || !fs.existsSync(videoPath)) {
    console.log("Video file not found.");
    rl.close();
    process.exit(1);
  }

  subtitlePath = await resolveSubtitlePath();
  if (subtitlePath) {
    subtitlePath = subtitlePath.replace(/['"]/g, "");
  }

  rl.close();

  if (subtitlePath && !fs.existsSync(subtitlePath)) {
    console.log("Subtitle file not found.");
    process.exit(1);
  }

  server.listen(PORT, "0.0.0.0", async () => {
    console.log("");
    console.log(colorize("+--------------------------------------------------+", "90"));
    console.log(`${colorize("|", "90")} ${colorize("VIDEO WATCH PARTY", "1;36")}${" ".repeat(30)}${colorize("|", "90")}`);
    console.log(colorize("+--------------------------------------------------+", "90"));
    console.log(`${colorize("  SERVER", "1;32")}  Server running on port ${PORT}`);
    console.log("");

    const ips = getIPs();
    printAccessUrl("LOCAL", `http://localhost:${PORT}`, "this computer", "1;37");
    for (const ip of ips.lan) {
      printAccessUrl("WI-FI / LAN", `http://${ip}:${PORT}`, "video and chat only, no microphone", "36");
    }
    for (const ip of ips.tailscale) {
      printAccessUrl("TAILSCALE HTTP", `http://${ip}:${PORT}`, "video and chat only, no microphone", "35");
    }

    try {
      const tailscaleUrl = await getTailscaleHttpsUrl();
      if (!tailscaleUrl) {
        console.log(`  ${colorize("VOICE CHAT", "1;32")}  Tailscale HTTPS not found. Start and connect Tailscale VPN.`);
        return;
      }

      printAccessUrl("VOICE CHAT", tailscaleUrl, "use this one for voice chat", "1;32");
      if (!await isServeConfigured(PORT)) {
        console.log(`  ${colorize("SETUP", "1;33")}      Not serving yet. Run: tailscale serve --bg ${PORT}`);
      }
    } catch (error) {
      console.log(`  ${colorize("VOICE CHAT", "1;32")}  Tailscale HTTPS not found. Start and connect Tailscale VPN.`);
    }

    console.log("");
  });
}

startServer();