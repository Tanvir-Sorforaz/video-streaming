const socket = io({ autoConnect: false });

const video = document.getElementById("video");
const backBtn = document.getElementById("back");
const forwardBtn = document.getElementById("forward");

const nameBox = document.getElementById("nameBox");
const usernameInput = document.getElementById("username");
const joinBtn = document.getElementById("joinBtn");
// these are new 
const fitBtn = document.getElementById("fit");
const player = document.getElementById("player");

let isRemoteUpdate = false;
let joined = false;
let suppressEmitUntil = 0;
let lastHeartbeatAt = 0;

function nowMs() {
  return Date.now();
}

function canEmit() {
  return joined && !isRemoteUpdate && nowMs() > suppressEmitUntil;
}

function emitState(type) {
  if (!canEmit()) return;

  socket.emit("sync-event", {
    type,
    currentTime: video.currentTime,
    isPlaying: !video.paused
  });
}

function safePlay() {
  video.play().catch(() => {});
}

function joinRoom() {
  const username = usernameInput.value.trim();

  if (!username) {
    alert("Please enter your name");
    return;
  }

  socket.auth = { username };
  socket.connect();
  joined = true;
  nameBox.style.display = "none";

  // helps mobile browsers allow future playback after user interaction
  safePlay();
}

joinBtn.addEventListener("click", joinRoom);

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    joinRoom();
  }
});

backBtn.addEventListener("click", () => {
  video.currentTime = Math.max(0, video.currentTime - 10);
  emitState("seek");
});

forwardBtn.addEventListener("click", () => {
  video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
  emitState("seek");
});

socket.on("init-state", (state) => {
  isRemoteUpdate = true;
  suppressEmitUntil = nowMs() + 1500;

  let targetTime = state.currentTime;

  if (state.isPlaying) {
    targetTime += (Date.now() - state.updatedAt) / 1000;
  }

  const diff = Math.abs(video.currentTime - targetTime);

  if (diff > 0.8) {
    video.currentTime = targetTime;
  }

  if (state.isPlaying) {
    safePlay();
  } else {
    video.pause();
  }

  setTimeout(() => {
    isRemoteUpdate = false;
  }, 300);
});

socket.on("sync-event", (data) => {
  isRemoteUpdate = true;
  suppressEmitUntil = nowMs() + 500;

  const diff = Math.abs(video.currentTime - data.currentTime);

  if (data.type === "play") {
    if (diff > 1.2) {
      video.currentTime = data.currentTime;
    }
    safePlay();
  } 
  else if (data.type === "pause") {
    if (diff > 0.8) {
      video.currentTime = data.currentTime;
    }
    video.pause();
  } 
  else if (data.type === "seek") {
    video.currentTime = data.currentTime;
    if (data.isPlaying) {
      safePlay();
    } else {
      video.pause();
    }
  } 
  else if (data.type === "heartbeat") {
    if (!video.seeking && diff > 1.5) {
      video.currentTime = data.currentTime;
    }
  }

  setTimeout(() => {
    isRemoteUpdate = false;
  }, 250);
});

video.addEventListener("play", () => {
  if (!canEmit()) return;
  emitState("play");
});

video.addEventListener("pause", () => {
  if (!canEmit()) return;
  emitState("pause");
});

video.addEventListener("seeked", () => {
  if (!canEmit()) return;
  emitState("seek");
});

video.addEventListener("timeupdate", () => {
  if (!canEmit()) return;
  if (video.paused || video.seeking) return;

  const now = nowMs();
  if (now - lastHeartbeatAt > 5000) {
    lastHeartbeatAt = now;
    socket.emit("sync-event", {
      type: "heartbeat",
      currentTime: video.currentTime,
      isPlaying: true
    });
  }
});

let fitMode = false;

async function openPlayerFullscreen() {
  try {
    if (player.requestFullscreen) {
      await player.requestFullscreen();
    } else if (player.webkitRequestFullscreen) {
      await player.webkitRequestFullscreen();
    }
  } catch (err) {
    console.log("Fullscreen failed:", err);
  }
}

fitBtn.addEventListener("click", async () => {
  fitMode = !fitMode;

  if (fitMode) {
    video.classList.remove("fit-contain");
    video.classList.add("fit-cover");
    await openPlayerFullscreen();
    fitBtn.textContent = "↙ Exit Fit";
  } else {
    video.classList.remove("fit-cover");
    video.classList.add("fit-contain");

    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
      await document.webkitExitFullscreen();
    }

    fitBtn.textContent = "📱 Fit";
  }
});


