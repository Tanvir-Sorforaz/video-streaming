const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");
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

  socket.emit("init-state", { ...roomState, chatHistory: chatHistory.slice() });
  saveChatItem({ type: "join", username, time: Date.now() }, "chat-event");
  io.emit("online-count", io.sockets.sockets.size);

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

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();