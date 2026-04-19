const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const readline = require("readline");
const { Server } = require("socket.io");

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

  console.log("User connected:", socket.username);

  joiningInProgressUntil = Date.now() + 1500;

  socket.emit("init-state", roomState);

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

    roomState = {
      isPlaying: data.isPlaying,
      currentTime: data.currentTime,
      updatedAt: Date.now(),
    };

    socket.broadcast.emit("sync-event", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.username);
  });
});

async function startServer() {
  videoPath = (await ask("Enter full video path: ")).trim();
  subtitlePath = (await ask("Enter full subtitle path: ")).trim();
  if (videoPath) {
    videoPath = videoPath.replace(/['"]/g, "");
  }
  if (subtitlePath) {
    subtitlePath = subtitlePath.replace(/['"]/g, "");
  }

  rl.close();

  if (!fs.existsSync(videoPath)) {
    console.log("Video file not found.");
    process.exit(1);
  }

  if (!fs.existsSync(subtitlePath)) {
    console.log("Subtitle file not found.");
    process.exit(1);
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();