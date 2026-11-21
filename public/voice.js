const ICE_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
const JOIN_MUTED = false;

(() => {
  const socket = window.watchPartySocket;
  const video = document.getElementById("video");
  const overlay = document.getElementById("chatOverlay");
  const chatHead = document.getElementById("chatHead");
  const chatPanel = document.getElementById("chatPanel");
  const chatSubtitle = document.getElementById("chatSubtitle");
  const onlineCountValue = document.getElementById("onlineCountValue");
  const voiceHeaderButton = document.getElementById("voiceHeaderButton");
  const voiceJoinRow = document.getElementById("voiceJoinRow");
  const voiceJoinButton = document.getElementById("voiceJoinButton");
  const voiceCountLabel = document.getElementById("voiceCountLabel");
  const voiceError = document.getElementById("voiceError");
  const voiceErrorText = document.getElementById("voiceErrorText");
  const voiceTryAgain = document.getElementById("voiceTryAgain");
  const voiceCall = document.getElementById("voiceCall");
  const voiceParticipants = document.getElementById("voiceParticipants");
  const voiceControls = document.getElementById("voiceControls");
  const voiceMuteButton = document.getElementById("voiceMuteButton");
  const voiceLeaveButton = document.getElementById("voiceLeaveButton");
  const duckToggle = document.getElementById("duckToggle");
  const duckLabel = document.getElementById("duckLabel");
  const voiceStatus = document.getElementById("voiceStatus");
  const voiceAudioEnable = document.getElementById("voiceAudioEnable");
  const voiceSpeakerPill = document.getElementById("voiceSpeakerPill");
  const voiceMicBadge = document.getElementById("voiceMicBadge");
  const voiceSpeakingLive = document.getElementById("voiceSpeakingLive");
  const voicePopover = document.getElementById("voicePopover");

  const peerConnections = new Map();
  const participants = new Map();
  const speakingUsers = new Set();
  const analysers = new Map();
  const programmaticVolumes = [];
  let localStream = null;
  let localMuted = JOIN_MUTED;
  let joiningVoice = false;
  let inVoice = false;
  let shouldRejoin = false;
  let voiceCount = 0;
  let audioContext = null;
  let speakingInterval = null;
  let duckRestoreTimeout = null;
  let duckRampInterval = null;
  let isDucking = false;
  let duckRequested = false;
  let duckEnabled = true;
  let userVolume = video.volume;
  let pushToTalkActive = false;
  let cleaningUp = false;
  let speakerPillTimeout = null;
  let activePopoverId = null;

  function createIcon(name) {
    const iconPaths = {
      mic: ["M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z", "M19 10v1a7 7 0 0 1-14 0v-1", "M12 18v4", "M8 22h8"],
      micOff: ["M9 9v2a3 3 0 0 0 5.2 2", "M15 9V5a3 3 0 0 0-5.8-1", "M19 10v1a7 7 0 0 1-11.8 5", "M5 10v1a7 7 0 0 0 12 4.9", "M12 18v4", "M8 22h8", "m3 3 18 18"],
      headphones: ["M3 14v-3a9 9 0 0 1 18 0v3", "M3 14h4v7H5a2 2 0 0 1-2-2v-5Z", "M21 14h-4v7h2a2 2 0 0 0 2-2v-5Z"],
      leave: ["M10 17l5-5-5-5", "M15 12H3", "M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"],
      volume: ["M11 5 6 9H3v6h3l5 4V5Z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
      close: ["m6 6 12 12", "M18 6 6 18"],
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const pathData of iconPaths[name] || []) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      svg.append(path);
    }
    return svg;
  }

  function initials(username) {
    return username.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  }

  function usernameColor(username) {
    return window.watchPartyUsernameColor
      ? window.watchPartyUsernameColor(username)
      : `hsl(${Math.abs(Array.from(username).reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) | 0, 0)) % 360} 78% 74%)`;
  }

  function setVoiceError(message) {
    voiceError.hidden = !message;
    voiceErrorText.textContent = message || "";
    voiceJoinRow.hidden = Boolean(message) || inVoice || joiningVoice;
    voiceCall.hidden = !inVoice;
    voiceTryAgain.hidden = !message || message === "Voice is full";
  }

  function updateVoiceUI() {
    voiceJoinRow.hidden = inVoice || joiningVoice || !voiceError.hidden;
    voiceCall.hidden = !inVoice;
    voiceControls.hidden = !inVoice;
    voiceCountLabel.textContent = voiceCount > 0 ? `${voiceCount} in voice` : "";
    voiceCountLabel.hidden = voiceCount === 0;
    voiceJoinButton.disabled = joiningVoice;
    voiceJoinButton.textContent = joiningVoice ? "Joining..." : "Join voice";
    voiceMuteButton.setAttribute("aria-pressed", String(!localMuted));
    voiceMuteButton.replaceChildren(createIcon(localMuted ? "micOff" : "mic"));
    const muteText = document.createElement("span");
    muteText.textContent = localMuted ? "Unmute" : "Mute";
    voiceMuteButton.append(muteText);
    voiceMicBadge.hidden = !inVoice;
    voiceMicBadge.classList.toggle("muted", localMuted);
    voiceMicBadge.replaceChildren(createIcon(localMuted ? "micOff" : "mic"));
    voiceHeaderButton.setAttribute("aria-label", inVoice ? "Voice connected" : "Join voice");
    voiceHeaderButton.title = inVoice ? "Voice connected" : "Join voice";
    if (inVoice) {
      window.voiceUIActive = true;
      chatSubtitle.textContent = `Voice connected, ${voiceCount} in call`;
    } else {
      window.voiceUIActive = false;
      chatSubtitle.replaceChildren(onlineCountValue, document.createTextNode(" online"));
    }
    renderParticipants();
    updateSpeakingUI();
  }

  function updateCount(count) {
    voiceCount = Number.isFinite(count) ? count : 0;
    updateVoiceUI();
  }

  function updateParticipant(participant) {
    participants.set(participant.id, participant);
    renderParticipants();
  }

  function renderParticipants() {
    if (!voiceParticipants) return;
    voiceParticipants.replaceChildren();
    if (!inVoice) return;

    for (const participant of participants.values()) {
      const item = document.createElement("div");
      item.className = "voice-participant";
      const isSpeaking = speakingUsers.has(participant.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `voice-avatar-button ${isSpeaking ? "speaking" : ""}`;
      button.setAttribute("aria-label", participant.id === socket.id ? "You" : `Voice options for ${participant.username}`);
      button.disabled = participant.id === socket.id;

      const avatar = document.createElement("span");
      avatar.className = "voice-avatar";
      avatar.style.backgroundColor = usernameColor(participant.username);
      const initialsText = document.createElement("span");
      initialsText.textContent = initials(participant.username);
      avatar.append(initialsText);
      if (participant.muted) {
        const mutedBadge = document.createElement("span");
        mutedBadge.className = "voice-muted-badge";
        mutedBadge.setAttribute("aria-label", "Muted");
        mutedBadge.append(createIcon("micOff"));
        avatar.append(mutedBadge);
      }
      if (isSpeaking) {
        const screenReaderText = document.createElement("span");
        screenReaderText.className = "visually-hidden";
        screenReaderText.textContent = `${participant.username} is speaking`;
        avatar.append(screenReaderText);
      }
      button.append(avatar);

      const name = document.createElement("span");
      name.className = "voice-participant-name";
      name.textContent = participant.id === socket.id ? "You" : participant.username;
      item.append(button, name);
      if (participant.id !== socket.id) {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          openPeerPopover(participant.id, button);
        });
      }
      voiceParticipants.append(item);
    }
  }

  function openPeerPopover(id, anchor) {
    const peer = peerConnections.get(id);
    const participant = participants.get(id);
    if (!peer || !participant) return;
    activePopoverId = id;
    voicePopover.replaceChildren();

    const title = document.createElement("p");
    title.className = "voice-popover-title";
    title.textContent = participant.username;
    const volumeLabel = document.createElement("label");
    volumeLabel.textContent = "Volume";
    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.value = String(Math.round(peer.audio.volume * 100));
    volume.setAttribute("aria-label", `Volume for ${participant.username}`);
    volume.addEventListener("input", () => {
      peer.audio.volume = Number(volume.value) / 100;
    });
    volumeLabel.append(volume);

    const muteLabel = document.createElement("label");
    muteLabel.className = "voice-local-mute";
    const mute = document.createElement("input");
    mute.type = "checkbox";
    mute.checked = peer.audio.muted;
    mute.addEventListener("change", () => {
      peer.audio.muted = mute.checked;
      updateAnalyserMute(id, participant.muted || mute.checked);
    });
    const muteText = document.createElement("span");
    muteText.textContent = "Mute for me";
    muteLabel.append(mute, muteText);
    voicePopover.append(title, volumeLabel, muteLabel);

    const rect = anchor.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    voicePopover.style.left = `${Math.max(8, Math.min(overlayRect.width - 208, rect.left - overlayRect.left - 80))}px`;
    voicePopover.style.top = `${Math.max(8, rect.bottom - overlayRect.top + 6)}px`;
    voicePopover.hidden = false;
  }

  function closePeerPopover() {
    activePopoverId = null;
    voicePopover.hidden = true;
    voicePopover.replaceChildren();
  }

  function addAnalyser(id, stream, muted) {
    if (!audioContext || !stream) return;
    removeAnalyser(id);
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentGain);
    silentGain.connect(audioContext.destination);
    analysers.set(id, {
      source,
      analyser,
      silentGain,
      muted,
      speaking: false,
      aboveSince: null,
      belowSince: null,
      samples: new Float32Array(analyser.fftSize),
    });
  }

  function removeAnalyser(id) {
    const state = analysers.get(id);
    if (!state) return;
    state.source.disconnect();
    state.analyser.disconnect();
    state.silentGain.disconnect();
    analysers.delete(id);
    setSpeaking(id, false);
  }

  function updateAnalyserMute(id, muted) {
    const state = analysers.get(id);
    if (!state) return;
    state.muted = muted;
    if (muted) setSpeaking(id, false);
  }

  function setSpeaking(id, speaking) {
    const wasSpeaking = speakingUsers.has(id);
    if (speaking === wasSpeaking) return;
    if (speaking) speakingUsers.add(id);
    else speakingUsers.delete(id);
    updateSpeakingUI();
    if (!cleaningUp) updateDucking();
  }

  function sampleSpeaking() {
    const now = Date.now();
    for (const [id, state] of analysers) {
      if (state.muted) {
        state.aboveSince = null;
        state.belowSince = null;
        state.speaking = false;
        setSpeaking(id, false);
        continue;
      }

      state.analyser.getFloatTimeDomainData(state.samples);
      let sum = 0;
      for (const sample of state.samples) sum += sample * sample;
      const rms = Math.sqrt(sum / state.samples.length);
      if (rms > 0.035) {
        state.belowSince = null;
        if (!state.speaking) {
          state.aboveSince ??= now;
          if (now - state.aboveSince >= 150) {
            state.speaking = true;
            setSpeaking(id, true);
          }
        }
      } else {
        state.aboveSince = null;
        if (state.speaking) {
          state.belowSince ??= now;
          if (now - state.belowSince >= 400) {
            state.speaking = false;
            setSpeaking(id, false);
          }
        }
      }
    }
  }

  function startSpeakingDetection() {
    if (speakingInterval) return;
    speakingInterval = setInterval(sampleSpeaking, 100);
  }

  function updateSpeakingUI() {
    renderParticipants();
    const active = Array.from(speakingUsers, (id) => participants.get(id)).filter(Boolean);
    const names = active.map((participant) => participant.id === socket.id ? "You" : participant.username);
    const modalOpen = !chatPanel.hidden;
    const showFloatingIndicator = names.length > 0 && modalOpen === false;
    const label = names.length === 1
      ? names[0] === "You" ? "You are talking" : `${names[0]} is talking`
      : `${names.length} people talking`;
    chatHead.classList.toggle("voice-speaking", showFloatingIndicator);
    if (showFloatingIndicator) {
      clearTimeout(speakerPillTimeout);
      speakerPillTimeout = null;
      voiceSpeakerPill.hidden = false;
      voiceSpeakerPill.textContent = label;
    } else if (inVoice && modalOpen === false && !voiceSpeakerPill.hidden) {
      clearTimeout(speakerPillTimeout);
      speakerPillTimeout = setTimeout(() => {
        voiceSpeakerPill.hidden = true;
        speakerPillTimeout = null;
      }, 600);
    } else {
      clearTimeout(speakerPillTimeout);
      speakerPillTimeout = null;
      voiceSpeakerPill.hidden = true;
    }
    voiceSpeakingLive.textContent = names.length === 1
      ? names[0] === "You" ? "You are speaking" : `${names[0]} is speaking`
      : names.length > 1 ? `${names.length} people are speaking` : "";
    positionSpeakerPill();
  }

  function positionSpeakerPill() {
    if (voiceSpeakerPill.hidden) return;
    const headLeft = chatHead.offsetLeft;
    const headTop = chatHead.offsetTop;
    voiceSpeakerPill.style.top = `${headTop + Math.max(0, (chatHead.offsetHeight - voiceSpeakerPill.offsetHeight) / 2)}px`;
    voiceSpeakerPill.style.left = `${Math.max(8, headLeft - voiceSpeakerPill.offsetWidth - 8)}px`;
  }

  function writeVideoVolume(value) {
    const safeValue = Math.max(0, Math.min(1, value));
    programmaticVolumes.push({ value: safeValue, time: performance.now() });
    while (programmaticVolumes.length > 12) programmaticVolumes.shift();
    video.volume = safeValue;
  }

  function rampVideoVolume(target, showDuckedLabel) {
    clearInterval(duckRampInterval);
    const startVolume = video.volume;
    const startTime = performance.now();
    const duration = 200;
    isDucking = showDuckedLabel;
    duckLabel.hidden = !showDuckedLabel;
    if (Math.abs(startVolume - target) < 0.005) {
      writeVideoVolume(target);
      if (!showDuckedLabel) isDucking = false;
      return;
    }

    duckRampInterval = setInterval(() => {
      const progress = Math.min(1, (performance.now() - startTime) / duration);
      writeVideoVolume(startVolume + (target - startVolume) * progress);
      if (progress === 1) {
        clearInterval(duckRampInterval);
        duckRampInterval = null;
        if (!showDuckedLabel) isDucking = false;
      }
    }, 20);
  }

  function updateDucking() {
    clearTimeout(duckRestoreTimeout);
    duckRestoreTimeout = null;
    const hasSpeakers = speakingUsers.size > 0;
    if (!duckEnabled || !inVoice) {
      duckRequested = false;
      rampVideoVolume(userVolume, false);
      return;
    }
    if (hasSpeakers) {
      duckRequested = true;
      rampVideoVolume(userVolume * 0.3, true);
      return;
    }
    if (duckRequested) {
      duckRestoreTimeout = setTimeout(() => {
        duckRequested = false;
        rampVideoVolume(userVolume, false);
      }, 800);
    }
  }

  function handleVolumeChange() {
    const now = performance.now();
    const programmaticIndex = programmaticVolumes.findIndex((entry) =>
      now - entry.time < 1000 && Math.abs(entry.value - video.volume) < 0.015
    );
    if (programmaticIndex !== -1) {
      programmaticVolumes.splice(0, programmaticIndex + 1);
      if (isDucking) return;
    }

    userVolume = video.volume;
    if (duckRequested) rampVideoVolume(userVolume * 0.3, true);
  }

  function setMuted(muted) {
    localMuted = Boolean(muted);
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !localMuted;
      });
    }
    const self = participants.get(socket.id);
    if (self) {
      self.muted = localMuted;
      updateParticipant(self);
    }
    updateAnalyserMute(socket.id, localMuted);
    if (inVoice) socket.emit("voice-mute", localMuted);
    updateVoiceUI();
  }

  function setPeerBitrate(peer) {
    for (const sender of peer.connection.getSenders()) {
      if (!sender.track || sender.track.kind !== "audio" || !sender.setParameters) continue;
      try {
        const parameters = sender.getParameters();
        if (!parameters.encodings || parameters.encodings.length === 0) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate = 32000;
        sender.setParameters(parameters).catch(() => {});
      } catch (error) {
        console.debug("Could not set voice bitrate:", error);
      }
    }
  }

  function sendSignal(id, data) {
    if (socket.connected) socket.emit("voice-signal", { to: id, data });
  }

  function createPeer(participant, isCaller) {
    const existing = peerConnections.get(participant.id);
    if (existing) {
      existing.username = participant.username || existing.username;
      existing.muted = Boolean(participant.muted);
      return existing;
    }

    const connection = new RTCPeerConnection(ICE_CONFIGURATION);
    const audio = document.createElement("audio");
    audio.className = "voice-audio";
    audio.autoplay = true;
    audio.playsInline = true;
    audio.setAttribute("aria-hidden", "true");
    overlay.append(audio);
    const peer = {
      id: participant.id,
      username: participant.username || "Unknown User",
      muted: Boolean(participant.muted),
      isCaller,
      connection,
      audio,
      pendingCandidates: [],
      restartAttempted: false,
      disconnectTimeout: null,
      failureTimeout: null,
      destroying: false,
    };
    peerConnections.set(peer.id, peer);
    updateParticipant({ id: peer.id, username: peer.username, muted: peer.muted });

    if (localStream) {
      localStream.getAudioTracks().forEach((track) => connection.addTrack(track, localStream));
      setPeerBitrate(peer);
    }
    connection.onicecandidate = (event) => {
      if (event.candidate) sendSignal(peer.id, event.candidate.toJSON ? event.candidate.toJSON() : event.candidate);
    };
    connection.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {
        voiceAudioEnable.hidden = false;
      });
      addAnalyser(peer.id, stream, peer.muted || audio.muted);
    };
    connection.oniceconnectionstatechange = () => handleConnectionState(peer);
    return peer;
  }

  async function sendOffer(peer, iceRestart = false) {
    const offer = await peer.connection.createOffer(iceRestart ? { iceRestart: true } : undefined);
    await peer.connection.setLocalDescription(offer);
    sendSignal(peer.id, peer.connection.localDescription.toJSON ? peer.connection.localDescription.toJSON() : peer.connection.localDescription);
  }

  async function flushCandidates(peer) {
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      await peer.connection.addIceCandidate(candidate);
    }
  }

  async function handleSignal(message) {
    const { from, username, data } = message || {};
    if (typeof from !== "string" || !data || typeof data !== "object") return;
    let peer = peerConnections.get(from);

    if (data.type === "offer" && !peer) {
      peer = createPeer({ id: from, username }, false);
    }
    if (!peer) return;
    if (username) {
      peer.username = username;
      const participant = participants.get(from);
      if (participant) participant.username = username;
      else updateParticipant({ id: from, username, muted: peer.muted });
    }

    try {
      if (data.type === "offer") {
        await peer.connection.setRemoteDescription(data);
        await flushCandidates(peer);
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        sendSignal(from, peer.connection.localDescription.toJSON ? peer.connection.localDescription.toJSON() : peer.connection.localDescription);
      } else if (data.type === "answer") {
        await peer.connection.setRemoteDescription(data);
        await flushCandidates(peer);
      } else if (data.candidate) {
        if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(data);
        else peer.pendingCandidates.push(data);
      }
    } catch (error) {
      showConnectionProblem(peer.username);
      console.warn("Voice signaling failed:", error);
    }
  }

  function handleConnectionState(peer) {
    if (peer.destroying) return;
    const state = peer.connection.iceConnectionState;
    if (state === "connected" || state === "completed") {
      clearTimeout(peer.disconnectTimeout);
      clearTimeout(peer.failureTimeout);
      peer.disconnectTimeout = null;
      peer.failureTimeout = null;
      voiceStatus.textContent = "";
      voiceStatus.hidden = true;
      return;
    }
    if (state === "disconnected") {
      clearTimeout(peer.disconnectTimeout);
      peer.disconnectTimeout = setTimeout(() => handlePeerFailure(peer), 5000);
    } else if (state === "failed") {
      handlePeerFailure(peer);
    } else if (state === "closed") {
      showConnectionProblem(peer.username);
      destroyPeer(peer.id);
    }
  }

  async function handlePeerFailure(peer) {
    if (peer.destroying) return;
    if (peer.isCaller && !peer.restartAttempted) {
      peer.restartAttempted = true;
      try {
        peer.connection.restartIce();
        await sendOffer(peer, true);
      } catch (error) {
        console.warn("ICE restart failed:", error);
      }
    }
    clearTimeout(peer.failureTimeout);
    peer.failureTimeout = setTimeout(() => {
      if (!peer.destroying && !["connected", "completed"].includes(peer.connection.iceConnectionState)) {
        showConnectionProblem(peer.username);
        destroyPeer(peer.id);
      }
    }, 5000);
  }

  function showConnectionProblem(username) {
    voiceStatus.textContent = `Connection problem with ${username}`;
    voiceStatus.hidden = false;
  }

  function destroyPeer(id) {
    const peer = peerConnections.get(id);
    if (!peer || peer.destroying) return;
    peer.destroying = true;
    clearTimeout(peer.disconnectTimeout);
    clearTimeout(peer.failureTimeout);
    removeAnalyser(id);
    peer.connection.oniceconnectionstatechange = null;
    peer.connection.ontrack = null;
    peer.connection.onicecandidate = null;
    peer.connection.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
    peerConnections.delete(id);
    participants.delete(id);
    if (activePopoverId === id) closePeerPopover();
    renderParticipants();
    updateSpeakingUI();
  }

  async function prepareAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    if (audioContext && audioContext.state === "suspended") await audioContext.resume();
    if (audioContext && localStream) addAnalyser(socket.id, localStream, localMuted);
    startSpeakingDetection();
  }

  async function joinVoice() {
    if (inVoice || joiningVoice) return;
    if (!window.isSecureContext) {
      setVoiceError("Microphone needs a secure connection. Open the https:// link.");
      updateVoiceUI();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceError("Microphone is unavailable in this browser.");
      updateVoiceUI();
      return;
    }

    joiningVoice = true;
    voiceError.hidden = true;
    updateVoiceUI();
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      localMuted = JOIN_MUTED;
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !localMuted;
      });
      await prepareAudioContext();
      if (!socket.connected) throw new Error("The watch-party connection is not ready. Try again.");
      socket.emit("voice-join");
    } catch (error) {
      clearVoiceState();
      const message = error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
        ? "Microphone permission was denied. Allow it in your browser settings."
        : error.name === "NotFoundError"
          ? "No microphone found."
          : error.message || "Could not start voice chat. Check your microphone and try again.";
      setVoiceError(message);
      updateVoiceUI();
    }
  }

  async function startPeerOffers(peerList) {
    for (const participant of peerList) {
      if (!inVoice) return;
      const peer = createPeer(participant, true);
      try {
        await sendOffer(peer);
      } catch (error) {
        showConnectionProblem(peer.username);
        console.warn("Could not create voice offer:", error);
      }
    }
  }

  function activateVoice(peerList) {
    joiningVoice = false;
    inVoice = true;
    voiceError.hidden = true;
    participants.clear();
    participants.set(socket.id, { id: socket.id, username: window.watchPartyUsername || "You", muted: localMuted });
    for (const participant of peerList) participants.set(participant.id, participant);
    updateVoiceUI();
    startPeerOffers(peerList);
  }

  function clearVoiceState() {
    cleaningUp = true;
    joiningVoice = false;
    inVoice = false;
    window.voiceUIActive = false;
    clearInterval(speakingInterval);
    speakingInterval = null;
    clearTimeout(duckRestoreTimeout);
    duckRestoreTimeout = null;
    clearTimeout(speakerPillTimeout);
    speakerPillTimeout = null;
    clearInterval(duckRampInterval);
    duckRampInterval = null;
    duckRequested = false;
    isDucking = false;
    duckLabel.hidden = true;
    userVolume = Number.isFinite(userVolume) ? userVolume : video.volume;
    writeVideoVolume(userVolume);
    for (const id of Array.from(peerConnections.keys())) destroyPeer(id);
    for (const id of Array.from(analysers.keys())) removeAnalyser(id);
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    speakingUsers.clear();
    participants.clear();
    localMuted = JOIN_MUTED;
    pushToTalkActive = false;
    voiceAudioEnable.hidden = true;
    voiceSpeakerPill.hidden = true;
    voiceStatus.textContent = "";
    voiceStatus.hidden = true;
    setVoiceError("");
    closePeerPopover();
    updateVoiceUI();
    cleaningUp = false;
  }

  function leaveVoice() {
    const shouldNotify = inVoice || joiningVoice;
    if (shouldNotify && socket.connected) socket.emit("voice-leave");
    shouldRejoin = false;
    clearVoiceState();
  }

  function handleVoicePeers(peerList) {
    if (!Array.isArray(peerList) || !localStream) return;
    activateVoice(peerList);
  }

  function handleVoiceFull() {
    clearVoiceState();
    setVoiceError("Voice is full");
    updateVoiceUI();
  }

  function handleVoiceLeft(data) {
    if (!data || typeof data.id !== "string") return;
    destroyPeer(data.id);
    participants.delete(data.id);
    updateVoiceUI();
  }

  function handleMuteChanged(data) {
    if (!data || typeof data.id !== "string") return;
    const participant = participants.get(data.id);
    if (participant) {
      participant.muted = Boolean(data.muted);
      updateParticipant(participant);
    }
    const peer = peerConnections.get(data.id);
    if (peer) {
      peer.muted = Boolean(data.muted);
      updateAnalyserMute(data.id, peer.muted || peer.audio.muted);
    }
    if (data.id === socket.id) localMuted = Boolean(data.muted);
    updateVoiceUI();
  }

  function handleInitState(state) {
    updateCount(state.voiceCount || 0);
    participants.clear();
    for (const participant of state.voiceUsers || []) participants.set(participant.id, participant);
    renderParticipants();
  }

  function handleSocketDisconnect() {
    shouldRejoin = inVoice || joiningVoice;
    clearVoiceState();
  }

  function handleSocketConnect() {
    if (!shouldRejoin) return;
    shouldRejoin = false;
    joinVoice();
  }

  function handlePushToTalkDown(event) {
    if (event.repeat || event.key.toLowerCase() !== "v" || !inVoice || !localMuted) return;
    if (event.target.closest("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
    pushToTalkActive = true;
    setMuted(false);
  }

  function handlePushToTalkUp(event) {
    if (event.key.toLowerCase() !== "v" || !pushToTalkActive) return;
    pushToTalkActive = false;
    if (inVoice) setMuted(true);
  }

  function handleOutsideClick(event) {
    if (activePopoverId && !event.target.closest(".voice-popover") && !event.target.closest(".voice-avatar-button")) {
      closePeerPopover();
    }
  }

  voiceJoinButton.addEventListener("click", joinVoice);
  voiceTryAgain.addEventListener("click", joinVoice);
  document.getElementById("voiceHeaderButton").addEventListener("click", joinVoice);
  voiceMuteButton.addEventListener("click", () => setMuted(!localMuted));
  voiceLeaveButton.addEventListener("click", leaveVoice);
  duckToggle.addEventListener("change", () => {
    duckEnabled = duckToggle.checked;
    updateDucking();
  });
  voiceAudioEnable.addEventListener("click", async () => {
    const results = await Promise.all(Array.from(peerConnections.values(), (peer) => peer.audio.play().catch(() => null)));
    voiceAudioEnable.hidden = results.every(Boolean);
  });
  voicePopover.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", handleOutsideClick);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activePopoverId) closePeerPopover();
    handlePushToTalkDown(event);
  });
  document.addEventListener("keyup", handlePushToTalkUp);
  window.addEventListener("blur", () => {
    if (pushToTalkActive) {
      pushToTalkActive = false;
      if (inVoice) setMuted(true);
    }
  });
  window.addEventListener("beforeunload", leaveVoice);
  video.addEventListener("volumechange", handleVolumeChange);
  window.addEventListener("resize", positionSpeakerPill);
  new MutationObserver(updateSpeakingUI).observe(chatPanel, { attributes: true, attributeFilter: ["hidden"] });
  chatHead.addEventListener("click", () => setTimeout(updateSpeakingUI, 0));

  socket.on("init-state", handleInitState);
  socket.on("voice-peers", handleVoicePeers);
  socket.on("voice-signal", handleSignal);
  socket.on("voice-count", updateCount);
  socket.on("voice-left", handleVoiceLeft);
  socket.on("voice-mute-changed", handleMuteChanged);
  socket.on("voice-full", handleVoiceFull);
  socket.on("connect", handleSocketConnect);
  socket.on("disconnect", handleSocketDisconnect);

  duckToggle.checked = true;
  window.voiceSpeakingUsers = speakingUsers;
  window.voiceChat = { joinVoice, leaveVoice, createPeer, handleSignal, setMuted, startSpeakingDetection, updateDucking, destroyPeer };
  updateVoiceUI();
})();