const socket = io({ autoConnect: false });
window.watchPartySocket = socket;

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
const voiceSettings = document.getElementById("voiceSettings");
const voiceControls = document.getElementById("voiceControls");
const duckControl = document.querySelector(".duck-control");
const chatAvatar = document.getElementById("chatAvatar");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const onlineCount = document.getElementById("onlineCountValue");
const chatSubtitle = document.getElementById("chatSubtitle");
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
let popoverOpen = false;
let popoverCloseTimer = null;
let keyboardHeadTop = null;
const mobilePopoverQuery = window.matchMedia("(max-width: 600px), (orientation: portrait) and (hover: none) and (pointer: coarse), (orientation: landscape) and (hover: none) and (pointer: coarse)");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
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
  window.watchPartyUsername = username;
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
  } else if (item.type === "voice-join") {
    element.append(document.createTextNode(" joined voice"));
  } else if (item.type === "voice-leave") {
    element.append(document.createTextNode(" left voice"));
  } else if (item.type === "seek") {
    element.append(document.createTextNode(` skipped to ${formatVideoTime(item.currentTime)}`));
  } else {
    const action = item.type === "play" ? " played" : " paused";
    element.append(document.createTextNode(`${action} at ${formatVideoTime(item.currentTime)}`));
  }
}

function renderEvent(item) {
  const event = document.createElement("div");
  event.className = `chat-event ${item.type === "join" || item.type === "voice-join" ? "join-event" : ""} ${item.type === "leave" || item.type === "voice-leave" ? "leave-event" : ""}`;
  event.title = new Date(item.time).toLocaleTimeString();
  if (item.eventId) event.dataset.eventId = item.eventId;
  appendActivityText(event, item);
  return event;
}

function appendChatItem(item, shouldScroll, animate = false) {
  const nearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 48;
  const element = item.type === "message" ? renderMessage(item) : renderEvent(item);
  if (animate) element.classList.add("chat-item-enter", item.username === currentUsername ? "mine" : "other");
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

function getMobileInsets() {
  const styles = getComputedStyle(chatHead);
  const safeInset = (side) => Number.parseFloat(styles.getPropertyValue(`--chat-safe-${side}`)) || 0;
  return {
    top: 12 + safeInset("top"),
    right: 12 + safeInset("right"),
    bottom: 12 + safeInset("bottom"),
    left: 12 + safeInset("left"),
  };
}

function positionPreviews() {
  const headLeft = chatHead.offsetLeft;
  const headTop = chatHead.offsetTop;
  const insets = getMobileInsets();
  const leftInset = mobilePopoverQuery.matches ? insets.left : 8;
  const rightInset = mobilePopoverQuery.matches ? insets.right : 8;
  const width = Math.min(mobilePopoverQuery.matches ? 190 : 200, Math.max(0, player.clientWidth - leftInset - rightInset));
  const preferredLeft = mobilePopoverQuery.matches
    ? headLeft - width - 8
    : headLeft + chatHead.offsetWidth - width;
  const left = Math.max(leftInset, Math.min(player.clientWidth - width - rightInset, preferredLeft));
  chatPreviews.style.left = `${left}px`;
  const preferredTop = mobilePopoverQuery.matches ? headTop : headTop + chatHead.offsetHeight + 8;
  chatPreviews.style.top = `${Math.max(8, Math.min(player.clientHeight - 40, preferredTop))}px`;
}

function showPreview(item) {
  if (popoverOpen) return;
  positionPreviews();

  let preview = item.eventId ? previewNodes.get(item.eventId) : null;
  const isUpdate = Boolean(preview);
  if (!preview) {
    preview = document.createElement("div");
    preview.className = `chat-preview ${item.type === "message" ? "message-preview" : "event-preview"}`;
    if (item.eventId) preview.dataset.eventId = item.eventId;
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
  }, 3500);

  while (chatPreviews.children.length > 3) {
    const oldest = chatPreviews.firstElementChild;
    if (oldest.timeoutId) clearTimeout(oldest.timeoutId);
    if (oldest.dataset.eventId) previewNodes.delete(oldest.dataset.eventId);
    oldest.remove();
  }
}

function wiggleHead() {
  if (!mobilePopoverQuery.matches) return;
  chatHead.classList.remove("wiggle");
  requestAnimationFrame(() => chatHead.classList.add("wiggle"));
  setTimeout(() => chatHead.classList.remove("wiggle"), 500);
}

function popBadge() {
  if (!mobilePopoverQuery.matches || chatBadge.hidden) return;
  chatBadge.classList.remove("pop");
  requestAnimationFrame(() => chatBadge.classList.add("pop"));
  setTimeout(() => chatBadge.classList.remove("pop"), 350);
}

function vibrateLightly() {
  try {
    navigator.vibrate?.(10);
  } catch (error) {}
}

function receiveChatItem(item) {
  if (!item || typeof item.username !== "string") return;
  if (item.type === "message" && typeof item.text !== "string") return;

  if (item.eventId && eventNodes.has(item.eventId)) {
    const updatedEvent = renderEvent(item);
    eventNodes.get(item.eventId).replaceWith(updatedEvent);
    eventNodes.set(item.eventId, updatedEvent);
  } else {
    appendChatItem(item, popoverOpen, popoverOpen);
  }

  const isFirstEvent = !item.eventId || !seenEventIds.has(item.eventId);
  if (item.eventId) seenEventIds.add(item.eventId);
  if (isFirstEvent && item.username !== currentUsername && !popoverOpen) {
    unreadCount += 1;
    updateBadge();
    wiggleHead();
    popBadge();
    vibrateLightly();
  }
  showPreview(item);
}

function positionPopover() {
  if (!mobilePopoverQuery.matches) return;
  const insets = getMobileInsets();
  const headLeft = chatHead.offsetLeft;
  const sideIsLeft = headLeft + chatHead.offsetWidth / 2 < player.clientWidth / 2;
  chatPanel.classList.toggle("popover-left", sideIsLeft);
  chatPanel.style.left = `${Math.max(insets.left, Math.min(player.clientWidth - chatPanel.offsetWidth - insets.right,
    sideIsLeft ? headLeft : headLeft + chatHead.offsetWidth - chatPanel.offsetWidth))}px`;
  const top = chatHead.offsetTop + chatHead.offsetHeight + 8;
  chatPanel.style.top = `${top}px`;
  chatPanel.style.right = "auto";

  const playerRect = player.getBoundingClientRect();
  const viewportBottom = window.visualViewport
    ? window.visualViewport.offsetTop + window.visualViewport.height - playerRect.top
    : player.clientHeight;
  const boundary = Math.min(player.clientHeight * (isLandscapePopover() ? 0.6 : 0.45), viewportBottom);
  const availableHeight = Math.max(0, boundary - top - 8);
  chatPanel.style.height = `${Math.min(228, availableHeight)}px`;
}

function isLandscapePopover() {
  return matchMedia("(orientation: landscape)").matches;
}

function handleKeyboardViewport() {
  if (!mobilePopoverQuery.matches) return;
  const viewport = window.visualViewport;
  const baselineHeight = Math.max(window.screen.height, window.innerHeight, player.clientHeight);
  const keyboardOpen = popoverOpen && viewport && document.activeElement === chatInput
    && viewport.height < baselineHeight - 80;
  if (keyboardOpen) {
    keyboardHeadTop ??= chatHead.offsetTop;
    const insets = getMobileInsets();
    const playerRect = player.getBoundingClientRect();
    const viewportBottom = viewport.offsetTop + viewport.height - playerRect.top;
    const boundary = Math.min(player.clientHeight * (isLandscapePopover() ? 0.6 : 0.45), viewportBottom);
    const minimumPanelHeight = Math.min(120, Math.max(0, boundary - chatHead.offsetHeight - 16));
    const maxHeadTop = Math.max(insets.top, boundary - chatHead.offsetHeight - 8 - minimumPanelHeight);
    if (chatHead.offsetTop > maxHeadTop) chatHead.style.top = `${maxHeadTop}px`;
  } else {
    restoreKeyboardHeadPosition();
  }
  if (!popoverOpen) return;
  positionPopover();
  if (keyboardOpen) chatMessages.scrollTop = chatMessages.scrollHeight;
}

function restoreKeyboardHeadPosition() {
  if (keyboardHeadTop === null) return;
  const insets = getMobileInsets();
  const maxTop = Math.max(insets.top, player.clientHeight - chatHead.offsetHeight - insets.bottom);
  chatHead.style.top = `${Math.max(insets.top, Math.min(maxTop, keyboardHeadTop))}px`;
  keyboardHeadTop = null;
}

voiceSettings.addEventListener("keydown", (event) => {
  if (!mobilePopoverQuery.matches || event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closePopover();
}, true);

function openPopover() {
  clearTimeout(popoverCloseTimer);
  popoverCloseTimer = null;
  popoverOpen = true;
  chatPanel.hidden = false;
  chatPanel.inert = false;
  chatPanel.setAttribute("aria-hidden", "false");
  chatHead.setAttribute("aria-expanded", "true");
  chatHead.setAttribute("aria-label", "Close watch-party chat");
  chatHead.classList.toggle("popover-open", mobilePopoverQuery.matches);
  chatPanel.classList.remove("is-closing");
  chatPanel.classList.toggle("is-open", mobilePopoverQuery.matches);
  unreadCount = 0;
  updateBadge();
  chatPreviews.querySelectorAll(".chat-preview").forEach((preview) => clearTimeout(preview.timeoutId));
  chatPreviews.replaceChildren();
  previewNodes.clear();
  newMessagesBtn.hidden = true;
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (mobilePopoverQuery.matches) clampChatHead();
  positionPopover();
  if (mobilePopoverQuery.matches) vibrateLightly();
}

function closePopover() {
  if (!popoverOpen) return;
  popoverOpen = false;
  restoreKeyboardHeadPosition();
  chatPanel.inert = true;
  chatPanel.setAttribute("aria-hidden", "true");
  chatHead.setAttribute("aria-expanded", "false");
  chatHead.setAttribute("aria-label", "Open watch-party chat");
  chatHead.classList.remove("popover-open");
  newMessagesBtn.hidden = true;
  if (mobilePopoverQuery.matches) {
    chatPanel.classList.remove("is-open");
    chatPanel.classList.add("is-closing");
    popoverCloseTimer = setTimeout(() => {
      chatPanel.hidden = true;
      chatPanel.classList.remove("is-closing");
      popoverCloseTimer = null;
    }, reducedMotionQuery.matches ? 150 : 220);
  } else {
    chatPanel.hidden = true;
  }
  chatHead.focus();
}

function toggleChat() {
  if (!popoverOpen) openPopover();
  else closePopover();
}

function clampChatHead() {
  if (chatOverlay.hidden) return;
  const insets = getMobileInsets();
  const leftInset = mobilePopoverQuery.matches ? insets.left : 8;
  const rightInset = mobilePopoverQuery.matches ? insets.right : 8;
  const topInset = mobilePopoverQuery.matches ? insets.top : 8;
  const bottomInset = mobilePopoverQuery.matches ? insets.bottom : 8;
  const maxLeft = Math.max(leftInset, player.clientWidth - chatHead.offsetWidth - rightInset);
  let maxTop = Math.max(topInset, player.clientHeight - chatHead.offsetHeight - bottomInset);
  if (mobilePopoverQuery.matches && popoverOpen) {
    const boundary = player.clientHeight * (isLandscapePopover() ? 0.6 : 0.45);
    const minPanelHeight = Math.min(120, Math.max(0, boundary - chatHead.offsetHeight - 16));
    maxTop = Math.min(maxTop, Math.max(topInset, boundary - chatHead.offsetHeight - 8 - minPanelHeight));
  }
  const playerRect = player.getBoundingClientRect();
  const headRect = chatHead.getBoundingClientRect();
  const currentLeft = mobilePopoverQuery.matches ? headRect.left - playerRect.left : chatHead.offsetLeft;
  const currentTop = mobilePopoverQuery.matches ? headRect.top - playerRect.top : chatHead.offsetTop;
  chatHead.style.right = "auto";
  chatHead.style.left = `${Math.max(leftInset, Math.min(maxLeft, currentLeft))}px`;
  chatHead.style.top = `${Math.max(topInset, Math.min(maxTop, currentTop))}px`;
  chatHead.classList.toggle("chat-head-left", chatHead.offsetLeft + chatHead.offsetWidth / 2 < player.clientWidth / 2);
  positionPreviews();
  if (popoverOpen) positionPopover();
}

function restoreChatHeadPosition() {
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem("watch-party-chat-head") || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      chatHead.style.left = `${saved.left}px`;
      chatHead.style.top = `${saved.top}px`;
      restored = true;
    }
  } catch (error) {
    console.warn("Could not restore chat position:", error);
  }
  if (mobilePopoverQuery.matches && !restored) {
    const insets = getMobileInsets();
    chatHead.style.left = `${player.clientWidth - chatHead.offsetWidth - insets.right}px`;
    chatHead.style.top = `${insets.top}px`;
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
    if (mobilePopoverQuery.matches) {
      const insets = getMobileInsets();
      const snapLeft = chatHead.offsetLeft + chatHead.offsetWidth / 2 < player.clientWidth / 2
        ? insets.left
        : player.clientWidth - chatHead.offsetWidth - insets.right;
      chatHead.style.left = `${snapLeft}px`;
      chatHead.classList.toggle("chat-head-left", snapLeft < player.clientWidth / 2);
      positionPreviews();
      if (popoverOpen) positionPopover();
    }
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

chatCloseBtn.addEventListener("click", closePopover);
chatPanel.addEventListener("click", (event) => event.stopPropagation());
chatPanel.addEventListener("pointerdown", (event) => event.stopPropagation());
player.addEventListener("click", (event) => {
  if (!mobilePopoverQuery.matches || !popoverOpen || chatPanel.contains(event.target) || chatHead.contains(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  closePopover();
});
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
  if (event.key === "Escape") closePopover();
});
chatInput.addEventListener("keyup", (event) => event.stopPropagation());
chatInput.addEventListener("focus", () => {
  if (mobilePopoverQuery.matches && popoverOpen && keyboardHeadTop === null) keyboardHeadTop = chatHead.offsetTop;
});
chatInput.addEventListener("blur", () => requestAnimationFrame(handleKeyboardViewport));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && popoverOpen) {
    closePopover();
    return;
  }
  if (event.key.toLowerCase() !== "c" || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target.closest("input, textarea, [contenteditable='true']")) return;
  toggleChat();
});

function updateMobileChatLayout() {
  if (mobilePopoverQuery.matches) {
    voiceSettings.append(duckControl);
    if (popoverOpen) {
      chatPanel.hidden = false;
      chatPanel.inert = false;
      chatPanel.setAttribute("aria-hidden", "false");
      chatPanel.classList.remove("is-closing");
      chatPanel.classList.add("is-open");
      chatHead.classList.add("popover-open");
    }
  } else {
    voiceControls.append(duckControl);
    chatHead.style.removeProperty("left");
    chatHead.style.removeProperty("right");
    chatHead.style.removeProperty("top");
    chatPanel.style.removeProperty("left");
    chatPanel.style.removeProperty("top");
    chatPanel.style.removeProperty("right");
    chatPanel.style.removeProperty("height");
    chatPanel.classList.remove("is-open", "is-closing", "popover-left");
    chatHead.classList.remove("popover-open");
  }
  if (!chatOverlay.hidden) {
    if (!mobilePopoverQuery.matches) restoreChatHeadPosition();
    clampChatHead();
    if (popoverOpen) positionPopover();
  }
}

window.addEventListener("resize", clampChatHead);
mobilePopoverQuery.addEventListener("change", updateMobileChatLayout);
window.visualViewport?.addEventListener("resize", handleKeyboardViewport);
updateMobileChatLayout();
window.watchPartyUsernameColor = usernameColor;


