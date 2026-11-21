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
const chatOverlay = document.getElementById("chatOverlay");
const chatHead = document.getElementById("chatHead");
const chatBadge = document.getElementById("chatBadge");
const chatPreviews = document.getElementById("chatPreviews");
const chatPanel = document.getElementById("chatPanel");
const chatCloseBtn = document.getElementById("chatClose");
const chatAvatar = document.getElementById("chatAvatar");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const onlineCount = document.getElementById("onlineCount");
const newMessagesBtn = document.getElementById("newMessages");

let isRemoteUpdate = false;
let joined = false;
let suppressEmitUntil = 0;
let lastHeartbeatAt = 0;
let currentUsername = "";
let unreadCount = 0;
let headDragged = false;
let suppressHeadClick = false;
let headPointerStart = null;
const eventNodes = new Map();
const seenEventIds = new Set();
const previewNodes = new Map();

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

  currentUsername = username;
  chatAvatar.textContent = getInitials(username);
  chatOverlay.hidden = false;
  restoreChatHeadPosition();
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

  renderChatHistory(state.chatHistory || []);
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

socket.on("chat-message", (item) => {
  receiveChatItem(item);
});

socket.on("chat-event", (item) => {
  receiveChatItem(item);
});

socket.on("online-count", (count) => {
  onlineCount.textContent = String(count);
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

function getInitials(username) {
  return username.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "WP";
}

function usernameColor(username) {
  let hash = 0;
  for (let index = 0; index < username.length; index += 1) {
    hash = (hash * 31 + username.charCodeAt(index)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 78% 74%)`;
}

function formatVideoTime(seconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function renderMessage(item) {
  const message = document.createElement("div");
  message.className = `chat-message ${item.username === currentUsername ? "mine" : "other"}`;
  message.title = new Date(item.time).toLocaleTimeString();

  if (item.username !== currentUsername) {
    const username = document.createElement("span");
    username.className = "message-username";
    username.textContent = item.username;
    username.style.color = usernameColor(item.username);
    message.append(username);
  }

  const text = document.createElement("span");
  text.textContent = item.text;
  message.append(text);
  return message;
}

function appendActivityText(element, item) {
  const username = document.createElement("span");
  username.className = "activity-username";
  username.textContent = item.username;
  element.append(username);

  if (item.type === "join") {
    element.append(document.createTextNode(" joined"));
  } else if (item.type === "leave") {
    element.append(document.createTextNode(" left"));
  } else if (item.type === "seek") {
    element.append(document.createTextNode(` skipped to ${formatVideoTime(item.currentTime)}`));
  } else {
    const action = item.type === "play" ? " played" : " paused";
    element.append(document.createTextNode(`${action} at ${formatVideoTime(item.currentTime)}`));
  }
}

function renderEvent(item) {
  const event = document.createElement("div");
  event.className = `chat-event ${item.type === "join" ? "join-event" : ""} ${item.type === "leave" ? "leave-event" : ""}`;
  event.title = new Date(item.time).toLocaleTimeString();
  if (item.eventId) event.dataset.eventId = item.eventId;
  appendActivityText(event, item);
  return event;
}

function appendChatItem(item, shouldScroll) {
  const nearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 48;
  const element = item.type === "message" ? renderMessage(item) : renderEvent(item);
  if (item.eventId) eventNodes.set(item.eventId, element);
  chatMessages.append(element);

  while (chatMessages.children.length > 150) {
    const oldest = chatMessages.firstElementChild;
    if (oldest.dataset.eventId) eventNodes.delete(oldest.dataset.eventId);
    oldest.remove();
  }

  if (shouldScroll && nearBottom) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (shouldScroll && !nearBottom) {
    newMessagesBtn.hidden = false;
  }
}

function renderChatHistory(items) {
  chatMessages.replaceChildren();
  eventNodes.clear();
  seenEventIds.clear();
  chatPreviews.replaceChildren();
  previewNodes.clear();
  unreadCount = 0;
  updateBadge();

  items.slice(-150).forEach((item) => {
    appendChatItem(item, false);
    if (item.eventId) seenEventIds.add(item.eventId);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
  newMessagesBtn.hidden = true;
}

function updateBadge() {
  chatBadge.hidden = unreadCount === 0;
  chatBadge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
}

function positionPreviews() {
  const headLeft = chatHead.offsetLeft;
  const headTop = chatHead.offsetTop;
  const width = Math.min(200, Math.max(0, player.clientWidth - 16));
  const left = Math.max(8, Math.min(player.clientWidth - width - 8, headLeft + chatHead.offsetWidth - width));
  chatPreviews.style.left = `${left}px`;
  chatPreviews.style.top = `${Math.min(player.clientHeight - 40, headTop + chatHead.offsetHeight + 8)}px`;
}

function showPreview(item) {
  if (!chatPanel.hidden) return;
  positionPreviews();

  let preview = item.eventId ? previewNodes.get(item.eventId) : null;
  const isUpdate = Boolean(preview);
  if (!preview) {
    preview = document.createElement("div");
    preview.className = `chat-preview ${item.type === "message" ? "message-preview" : "event-preview"}`;
    chatPreviews.append(preview);
    if (item.eventId) previewNodes.set(item.eventId, preview);
  } else {
    preview.replaceChildren();
  }

  if (item.type === "message") {
    const username = document.createElement("span");
    username.textContent = `${item.username}: `;
    username.style.color = usernameColor(item.username);
    const text = document.createElement("span");
    text.textContent = item.text;
    preview.append(username, text);
  } else {
    appendActivityText(preview, item);
  }

  if (!isUpdate) {
    requestAnimationFrame(() => preview.classList.add("visible"));
  }

  if (preview.timeoutId) clearTimeout(preview.timeoutId);
  preview.timeoutId = setTimeout(() => {
    preview.classList.remove("visible");
    setTimeout(() => {
      preview.remove();
      if (item.eventId) previewNodes.delete(item.eventId);
    }, 200);
  }, 4000);

  while (chatPreviews.children.length > 3) {
    const oldest = chatPreviews.firstElementChild;
    if (oldest.timeoutId) clearTimeout(oldest.timeoutId);
    if (oldest.dataset.eventId) previewNodes.delete(oldest.dataset.eventId);
    oldest.remove();
  }
}

function receiveChatItem(item) {
  if (!item || typeof item.username !== "string") return;
  if (item.type === "message" && typeof item.text !== "string") return;

  if (item.eventId && eventNodes.has(item.eventId)) {
    const updatedEvent = renderEvent(item);
    eventNodes.get(item.eventId).replaceWith(updatedEvent);
    eventNodes.set(item.eventId, updatedEvent);
  } else {
    appendChatItem(item, !chatPanel.hidden);
  }

  const isFirstEvent = !item.eventId || !seenEventIds.has(item.eventId);
  if (item.eventId) seenEventIds.add(item.eventId);
  if (isFirstEvent && item.username !== currentUsername && chatPanel.hidden) {
    unreadCount += 1;
    updateBadge();
  }
  showPreview(item);
}

function openChat() {
  chatPanel.hidden = false;
  unreadCount = 0;
  updateBadge();
  chatPreviews.replaceChildren();
  previewNodes.clear();
  newMessagesBtn.hidden = true;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function closeChat() {
  chatPanel.hidden = true;
  newMessagesBtn.hidden = true;
}

function toggleChat() {
  if (chatPanel.hidden) openChat();
  else closeChat();
}

function clampChatHead() {
  const maxLeft = Math.max(8, player.clientWidth - chatHead.offsetWidth - 8);
  const maxTop = Math.max(8, player.clientHeight - chatHead.offsetHeight - 8);
  chatHead.style.left = `${Math.max(8, Math.min(maxLeft, chatHead.offsetLeft))}px`;
  chatHead.style.top = `${Math.max(8, Math.min(maxTop, chatHead.offsetTop))}px`;
  positionPreviews();
}

function restoreChatHeadPosition() {
  try {
    const saved = JSON.parse(localStorage.getItem("watch-party-chat-head") || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      chatHead.style.left = `${saved.left}px`;
      chatHead.style.top = `${saved.top}px`;
    }
  } catch (error) {
    console.warn("Could not restore chat position:", error);
  }
  clampChatHead();
}

function saveChatHeadPosition() {
  try {
    localStorage.setItem("watch-party-chat-head", JSON.stringify({
      left: chatHead.offsetLeft,
      top: chatHead.offsetTop,
    }));
  } catch (error) {
    console.warn("Could not save chat position:", error);
  }
}

chatHead.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  headDragged = false;
  headPointerStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: chatHead.offsetLeft,
    top: chatHead.offsetTop,
  };
  chatHead.setPointerCapture(event.pointerId);
});

chatHead.addEventListener("pointermove", (event) => {
  if (!headPointerStart || event.pointerId !== headPointerStart.pointerId) return;
  const deltaX = event.clientX - headPointerStart.x;
  const deltaY = event.clientY - headPointerStart.y;
  if (!headDragged && Math.hypot(deltaX, deltaY) > 5) headDragged = true;
  if (!headDragged) return;

  chatHead.style.left = `${headPointerStart.left + deltaX}px`;
  chatHead.style.top = `${headPointerStart.top + deltaY}px`;
  clampChatHead();
});

function finishChatHeadDrag(event) {
  if (!headPointerStart || event.pointerId !== headPointerStart.pointerId) return;
  if (headDragged) {
    suppressHeadClick = true;
    saveChatHeadPosition();
  }
  headPointerStart = null;
}

chatHead.addEventListener("pointerup", finishChatHeadDrag);
chatHead.addEventListener("pointercancel", finishChatHeadDrag);
chatHead.addEventListener("click", () => {
  if (suppressHeadClick) {
    suppressHeadClick = false;
    return;
  }
  toggleChat();
});

chatCloseBtn.addEventListener("click", closeChat);
chatPanel.addEventListener("click", (event) => event.stopPropagation());
chatPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
newMessagesBtn.addEventListener("click", () => {
  chatMessages.scrollTop = chatMessages.scrollHeight;
  newMessagesBtn.hidden = true;
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("chat-message", text);
  chatInput.value = "";
  chatInput.focus();
});

chatInput.addEventListener("keydown", (event) => {
  event.stopPropagation();
  if (event.key === "Escape") closeChat();
});
chatInput.addEventListener("keyup", (event) => event.stopPropagation());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !chatPanel.hidden) {
    closeChat();
    return;
  }
  if (event.key.toLowerCase() !== "c" || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target.closest("input, textarea, [contenteditable='true']")) return;
  toggleChat();
});

window.addEventListener("resize", clampChatHead);


