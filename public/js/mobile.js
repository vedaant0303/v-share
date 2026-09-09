// DropFile Mobile Client Controller
function initMobileApp() {
  let ws;
  let transferredFiles = [];
  let receivedFromPcFiles = [];
  try {
    const stored = localStorage.getItem('dropfile_received_from_pc');
    if (stored) {
      receivedFromPcFiles = JSON.parse(stored);
    }
  } catch (e) {}
  const toastContainer = document.getElementById('toastContainer');

  // Room Pairing for Mobile (Zero Database, In-Memory 1-to-1 Pairing)
  // Room & Device Management (Multi-PC 1-Tap Switching)
  const urlParams = new URLSearchParams(window.location.search);
  let currentRoomId = (urlParams.get('room') || localStorage.getItem('vshare_room_id') || '').trim();
  if (urlParams.get('room')) {
    localStorage.setItem('vshare_room_id', currentRoomId);
  }

  // Saved Target PCs: [{ id: '759721', name: 'Main PC', lastSeen: Date.now() }]
  let savedDevices = [];
  try {
    savedDevices = JSON.parse(localStorage.getItem('vshare_saved_devices') || '[]');
  } catch (e) {
    savedDevices = [];
  }

  // Ensure current room is present in saved devices
  if (currentRoomId) {
    const exists = savedDevices.find(d => d.id === currentRoomId);
    if (!exists) {
      savedDevices.unshift({ id: currentRoomId, name: `PC ${currentRoomId}`, lastSeen: Date.now() });
      saveDevicesToStorage();
    }
  }

  function saveDevicesToStorage() {
    try {
      localStorage.setItem('vshare_saved_devices', JSON.stringify(savedDevices));
    } catch (e) {}
  }

  function renderDeviceChips() {
    const container = document.getElementById('deviceChipsList');
    const dropSubtitle = document.getElementById('mobileDropSubtitle');
    if (!container) return;

    if (savedDevices.length === 0 && currentRoomId) {
      savedDevices.push({ id: currentRoomId, name: `PC ${currentRoomId}`, lastSeen: Date.now() });
      saveDevicesToStorage();
    }

    if (savedDevices.length === 0) {
      container.innerHTML = `
        <div style="font-size: 12px; color: #64748b; padding: 4px 2px;">
          No PC added yet. Tap <b>+ Add Another PC</b> or <b>📷 Scan QR</b>!
        </div>
      `;
      if (dropSubtitle) dropSubtitle.textContent = 'Pair with a PC to start dropping files';
      return;
    }

    const activeDevice = savedDevices.find(d => d.id === currentRoomId) || savedDevices[0];
    if (activeDevice && currentRoomId !== activeDevice.id) {
      currentRoomId = activeDevice.id;
      localStorage.setItem('vshare_room_id', currentRoomId);
    }

    if (dropSubtitle && activeDevice) {
      dropSubtitle.innerHTML = `Saves directly to: <b style="color: #00f2fe;">${activeDevice.name}</b> (${activeDevice.id.length === 6 ? `${activeDevice.id.substring(0,3)} ${activeDevice.id.substring(3)}` : activeDevice.id})`;
    }

    container.innerHTML = '';
    savedDevices.forEach(device => {
      const isActive = (device.id === currentRoomId);
      const chip = document.createElement('div');
      chip.className = `pc-device-chip ${isActive ? 'active' : ''}`;
      chip.style.cssText = `
        flex-shrink: 0;
        background: ${isActive ? 'rgba(0, 242, 254, 0.14)' : '#151a24'};
        border: 1.5px solid ${isActive ? '#00f2fe' : 'rgba(255, 255, 255, 0.09)'};
        border-radius: 12px;
        padding: 8px 12px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 9px;
        box-shadow: ${isActive ? '0 0 14px rgba(0, 242, 254, 0.3)' : 'none'};
        transition: all 0.2s ease;
      `;

      chip.innerHTML = `
        <span style="font-size: 18px;">💻</span>
        <div style="text-align: left; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 5px;">
            <span style="font-size: 12.5px; font-weight: 700; color: ${isActive ? '#ffffff' : '#cbd5e1'}; white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis;">${device.name}</span>
            ${isActive ? '<span style="font-size: 8.5px; font-weight: 800; background: #10b981; color: #022c22; padding: 1px 5px; border-radius: 999px;">ACTIVE</span>' : ''}
          </div>
          <div style="font-size: 10.5px; color: ${isActive ? '#00f2fe' : '#64748b'}; font-family: monospace; font-weight: 600;">
            ${device.id.length === 6 ? `${device.id.substring(0,3)} ${device.id.substring(3)}` : device.id}
          </div>
        </div>
        ${savedDevices.length > 1 ? `<button class="delete-pc-btn" title="Remove this PC" data-id="${device.id}" style="background: none; border: none; color: #64748b; font-size: 14px; cursor: pointer; padding: 0 4px; margin-left: 2px;">&times;</button>` : ''}
      `;

      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('delete-pc-btn')) return;
        switchActiveDevice(device.id);
      });

      container.appendChild(chip);
    });

    container.querySelectorAll('.delete-pc-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        removeDevice(id);
      });
    });
  }

  function switchActiveDevice(roomId) {
    if (!roomId) return;
    currentRoomId = roomId;
    localStorage.setItem('vshare_room_id', currentRoomId);
    const dev = savedDevices.find(d => d.id === roomId);
    const name = dev ? dev.name : `PC ${roomId}`;

    updateRoomPairingUi(currentRoomId, false);
    renderDeviceChips();
    playSuccessChime();
    showToast(`🎯 Switched target to: ${name}!`, '💻');

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'join_room',
        roomId: currentRoomId,
        role: 'mobile'
      }));
    }
  }

  function addOrUpdateDevice(roomId, name) {
    if (!roomId) return;
    const cleanId = String(roomId).replace(/\s+/g, '').trim();
    const cleanName = (name || '').trim() || `PC ${cleanId}`;

    const existingIndex = savedDevices.findIndex(d => d.id === cleanId);
    if (existingIndex >= 0) {
      savedDevices[existingIndex].name = cleanName;
      savedDevices[existingIndex].lastSeen = Date.now();
    } else {
      savedDevices.unshift({ id: cleanId, name: cleanName, lastSeen: Date.now() });
    }
    saveDevicesToStorage();
    switchActiveDevice(cleanId);
  }

  function removeDevice(roomId) {
    savedDevices = savedDevices.filter(d => d.id !== roomId);
    saveDevicesToStorage();
    if (currentRoomId === roomId && savedDevices.length > 0) {
      switchActiveDevice(savedDevices[0].id);
    } else {
      renderDeviceChips();
    }
  }

  function updateRoomPairingUi(roomId, isPaired = false) {
    const roomStatusDot = document.getElementById('roomStatusDot');
    const roomStatusTitle = document.getElementById('roomStatusTitle');
    const roomStatusSubtitle = document.getElementById('roomStatusSubtitle');
    const mobileRoomCodeText = document.getElementById('mobileRoomCodeText');
    const activeDev = savedDevices.find(d => d.id === roomId);
    const displayName = activeDev ? activeDev.name : 'Your PC';

    if (mobileRoomCodeText) {
      if (roomId) {
        mobileRoomCodeText.textContent = roomId.length === 6 ? `${roomId.substring(0, 3)} ${roomId.substring(3)}` : roomId;
      } else {
        mobileRoomCodeText.textContent = 'Not Paired';
      }
    }

    if (roomStatusTitle) {
      if (roomId) {
        roomStatusTitle.textContent = isPaired ? `🟢 Paired with ${displayName}` : `⏳ Connecting to ${displayName}...`;
      } else {
        roomStatusTitle.textContent = 'Tap to Pair with Your PC';
      }
    }

    if (roomStatusSubtitle) {
      if (roomId) {
        roomStatusSubtitle.innerHTML = `Target PC: <b style="color: #60a5fa;">${displayName}</b> (${roomId.length === 6 ? `${roomId.substring(0, 3)} ${roomId.substring(3)}` : roomId})`;
      } else {
        roomStatusSubtitle.textContent = 'Enter the 6-digit code shown on your PC';
      }
    }

    if (roomStatusDot) {
      if (isPaired) {
        roomStatusDot.style.background = '#10b981';
        roomStatusDot.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.7)';
      } else if (roomId) {
        roomStatusDot.style.background = '#f59e0b';
        roomStatusDot.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.7)';
      } else {
        roomStatusDot.style.background = '#ef4444';
        roomStatusDot.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.7)';
      }
    }
  }

  // Pair PC Modal & Live Camera Scanner Handling
  const pairModal = document.getElementById('pairModal');
  const changeRoomBtn = document.getElementById('changeRoomBtn');
  const openScannerBtn = document.getElementById('openScannerBtn');
  const addNewPcBtn = document.getElementById('addNewPcBtn');
  const closePairModalBtn = document.getElementById('closePairModalBtn');
  const manualRoomCodeInput = document.getElementById('manualRoomCodeInput');
  const manualDeviceNameInput = document.getElementById('manualDeviceNameInput');
  const connectRoomBtn = document.getElementById('connectRoomBtn');
  const startScanFromModalBtn = document.getElementById('startScanFromModalBtn');
  const stopScannerBtn = document.getElementById('stopScannerBtn');
  const mobileScannerContainer = document.getElementById('mobileScannerContainer');
  const mobileScannerVideo = document.getElementById('mobileScannerVideo');
  const mobileScannerCanvas = document.getElementById('mobileScannerCanvas');
  const mobileScannerFeedback = document.getElementById('mobileScannerFeedback');

  let mobileCameraStream = null;
  let mobileScanAnimId = null;
  let isScanningQr = false;

  async function startMobileQrScanner() {
    if (pairModal) pairModal.classList.add('active');
    if (mobileScannerContainer) mobileScannerContainer.style.display = 'block';
    if (startScanFromModalBtn) startScanFromModalBtn.style.display = 'none';
    if (mobileScannerFeedback) {
      mobileScannerFeedback.textContent = 'Opening camera...';
      mobileScannerFeedback.style.color = '#00f2fe';
    }

    try {
      try {
        mobileCameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }
        });
      } catch (err1) {
        console.warn('FacingMode constraint failed, trying basic video:', err1);
        mobileCameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }

      if (mobileScannerVideo) {
        mobileScannerVideo.srcObject = mobileCameraStream;
        mobileScannerVideo.setAttribute('playsinline', '');
        mobileScannerVideo.setAttribute('webkit-playsinline', '');
        mobileScannerVideo.muted = true;
        try {
          await mobileScannerVideo.play();
        } catch (err) {
          console.warn('Video play blocked, waiting for user click:', err);
          if (mobileScannerFeedback) {
            mobileScannerFeedback.textContent = '▶️ Tap on the box above to start camera view';
          }
        }
      }
      isScanningQr = true;
      if (mobileScannerFeedback) {
        mobileScannerFeedback.textContent = '📷 Aim at the QR code on your PC screen!';
      }
      requestAnimationFrame(scanMobileVideoFrame);
    } catch (err) {
      console.error('Camera access error:', err);
      if (mobileScannerFeedback) {
        mobileScannerFeedback.textContent = '❌ Camera permission denied or not supported. Use "Snap Photo" or enter the 6-digit code below.';
        mobileScannerFeedback.style.color = '#f87171';
      }
      showToast('Camera access blocked. Tap "Snap Photo" or use code below.', '⚠️');
    }
  }

  if (mobileScannerVideo) {
    mobileScannerVideo.addEventListener('click', () => {
      mobileScannerVideo.play().catch(e => console.log('Video click play:', e));
    });
  }

  // Fallback Camera Snapshot Scanner
  const snapshotQrInput = document.getElementById('snapshotQrInput');
  const snapshotQrBtn = document.getElementById('snapshotQrBtn');

  if (snapshotQrBtn && snapshotQrInput) {
    snapshotQrBtn.addEventListener('click', () => {
      snapshotQrInput.click();
    });
  }

  if (snapshotQrInput) {
    snapshotQrInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (window.jsQR) {
              const code = window.jsQR(imgData.data, imgData.width, imgData.height);
              if (code && code.data) {
                handleMobileQrDetected(code.data);
                return;
              }
            }
            showToast('Could not read QR from photo. Hold camera closer or type code below.', '⚠️');
          };
          img.src = event.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  function stopMobileQrScanner() {
    isScanningQr = false;
    if (mobileScanAnimId) {
      cancelAnimationFrame(mobileScanAnimId);
      mobileScanAnimId = null;
    }
    if (mobileCameraStream) {
      mobileCameraStream.getTracks().forEach(track => track.stop());
      mobileCameraStream = null;
    }
    if (mobileScannerVideo) {
      mobileScannerVideo.srcObject = null;
    }
    if (mobileScannerContainer) mobileScannerContainer.style.display = 'none';
    if (startScanFromModalBtn) startScanFromModalBtn.style.display = 'flex';
  }

  function scanMobileVideoFrame() {
    if (!isScanningQr || !mobileCameraStream || !mobileScannerVideo || mobileScannerVideo.readyState !== mobileScannerVideo.HAVE_ENOUGH_DATA) {
      if (isScanningQr) {
        mobileScanAnimId = requestAnimationFrame(scanMobileVideoFrame);
      }
      return;
    }

    const canvas = mobileScannerCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = mobileScannerVideo.videoWidth;
    canvas.height = mobileScannerVideo.videoHeight;

    ctx.drawImage(mobileScannerVideo, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (window.jsQR) {
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code && code.data) {
        handleMobileQrDetected(code.data);
        return;
      }
    }

    mobileScanAnimId = requestAnimationFrame(scanMobileVideoFrame);
  }

  function handleMobileQrDetected(rawData) {
    let extractedRoom = null;
    const data = String(rawData).trim();

    if (data.includes('room=')) {
      const match = data.match(/room=([0-9a-zA-Z_-]+)/);
      if (match && match[1]) extractedRoom = match[1];
    } else if (/^\d{6}$/.test(data)) {
      extractedRoom = data;
    } else if (data.startsWith('http')) {
      try {
        const u = new URL(data);
        extractedRoom = u.searchParams.get('room');
      } catch (e) {}
    }

    if (extractedRoom) {
      stopMobileQrScanner();
      const customName = manualDeviceNameInput ? manualDeviceNameInput.value.trim() : '';
      addOrUpdateDevice(extractedRoom, customName || `PC ${extractedRoom}`);
      if (pairModal) pairModal.classList.remove('active');
    } else {
      mobileScanAnimId = requestAnimationFrame(scanMobileVideoFrame);
    }
  }

  if (openScannerBtn) {
    openScannerBtn.addEventListener('click', () => {
      startMobileQrScanner();
    });
  }

  if (addNewPcBtn) {
    addNewPcBtn.addEventListener('click', () => {
      if (manualRoomCodeInput) manualRoomCodeInput.value = '';
      if (manualDeviceNameInput) manualDeviceNameInput.value = '';
      stopMobileQrScanner();
      if (pairModal) pairModal.classList.add('active');
    });
  }

  if (startScanFromModalBtn) {
    startScanFromModalBtn.addEventListener('click', () => {
      startMobileQrScanner();
    });
  }

  if (stopScannerBtn) {
    stopScannerBtn.addEventListener('click', () => {
      stopMobileQrScanner();
    });
  }

  if (changeRoomBtn && pairModal) {
    changeRoomBtn.addEventListener('click', () => {
      if (manualRoomCodeInput) {
        manualRoomCodeInput.value = currentRoomId || '';
      }
      stopMobileQrScanner();
      pairModal.classList.add('active');
    });
  }

  if (closePairModalBtn && pairModal) {
    closePairModalBtn.addEventListener('click', () => {
      stopMobileQrScanner();
      pairModal.classList.remove('active');
    });
  }

  if (connectRoomBtn && manualRoomCodeInput) {
    connectRoomBtn.addEventListener('click', () => {
      const code = (manualRoomCodeInput.value || '').replace(/\s+/g, '').trim();
      if (!code) {
        showToast('Please enter the 6-digit code from your PC', '⚠️');
        return;
      }
      const customName = (manualDeviceNameInput ? manualDeviceNameInput.value : '').trim();
      stopMobileQrScanner();
      addOrUpdateDevice(code, customName || `PC ${code}`);
      if (pairModal) pairModal.classList.remove('active');
    });
  }

  // Synthesized notification chime for mobile
  function playSuccessChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15); // G5

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.35);

      // Tactile haptic feedback if supported
      if (navigator.vibrate) {
        navigator.vibrate([40, 60, 40]);
      }
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  function showToast(message, icon = '⚡') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function setConnected(isConnected) {
    const pill = document.getElementById('mobileStatusPill');
    const text = document.getElementById('mobileStatusText');
    if (!pill || !text) return;
    if (isConnected) {
      pill.style.background = 'rgba(16, 185, 129, 0.15)';
      pill.style.borderColor = 'rgba(16, 185, 129, 0.35)';
      pill.style.color = '#34d399';
      text.textContent = 'Connected to PC';
    } else {
      pill.style.background = 'rgba(239, 68, 68, 0.15)';
      pill.style.borderColor = 'rgba(239, 68, 68, 0.35)';
      pill.style.color = '#f87171';
      text.textContent = 'Disconnected';
    }
  }

  // Immediate HTTP Ping to verify server reachability instantly
  async function checkServerHealth() {
    try {
      const res = await fetch('/api/info', { cache: 'no-cache' });
      if (res.ok) {
        setConnected(true);
        const data = await res.json();
        // If phone has not paired yet, auto-adopt the stable Wi-Fi network room code!
        if (!currentRoomId && (data.networkRoomCode || data.roomId)) {
          currentRoomId = data.networkRoomCode || data.roomId;
          localStorage.setItem('vshare_room_id', currentRoomId);
          updateRoomPairingUi(currentRoomId, false);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'join_room',
              roomId: currentRoomId,
              role: 'mobile'
            }));
          }
        }
      }
    } catch (err) {
      setConnected(false);
    }
  }

  // WebSocket for Live PC Status
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      ws = new WebSocket(`${protocol}//${location.host}`);

      ws.onopen = () => {
        setConnected(true);
        if (currentRoomId) {
          ws.send(JSON.stringify({
            type: 'join_room',
            roomId: currentRoomId,
            role: 'mobile'
          }));
        }
      };

      ws.onclose = () => {
        // Double check via HTTP before declaring disconnected
        checkServerHealth();
        setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        checkServerHealth();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'room_status' || msg.type === 'room_joined') {
            const isPaired = (msg.pcCount > 0) || msg.isPaired;
            updateRoomPairingUi(currentRoomId, isPaired);
            if (isPaired) {
              setConnected(true);
              showToast('🟢 Paired with your PC!', '💻');
            }
          }
          if (msg.type === 'clipboard_received' && msg.from === 'PC') {
            playSuccessChime();
            showToast(`PC sent: "${msg.text.substring(0, 30)}..."`, '💻');
          }
          if (msg.type === 'beam_claimed') {
            if (msg.token === activeBeamToken || activeBeamToken) {
              handleBeamSuccess(msg.file);
            }
          }
          if (msg.type === 'file_for_mobile' || (msg.type === 'file_received' && msg.sender === 'PC')) {
            handleIncomingFileFromPc(msg.file);
          }
          if (msg.type === 'webrtc_offer') {
            handleIncomingWebRtcOffer(msg.offer);
          }
          if (msg.type === 'webrtc_ice_candidate' && mobilePeerConnection && msg.candidate) {
            try {
              mobilePeerConnection.addIceCandidate(new RTCIceCandidate(msg.candidate));
            } catch (e) {
              console.error('Error adding ICE candidate on Mobile:', e);
            }
          }
          const frameData = msg.frame || msg.data;
          if (msg.type === 'remote_frame' && frameData) {
            const screenImg = document.getElementById('remoteScreenImg');
            const canvas = document.getElementById('remoteScreenCanvas');
            const waiting = document.getElementById('remoteWaitingCard');
            const lockedNotice = document.getElementById('remoteLockedNotice');

            if (waiting && waiting.style.display !== 'none') {
              waiting.style.display = 'none';
              showToast('🟢 Unattended Remote PC Desktop Active!', '🖥️');
            }

            // Direct hardware-accelerated image blitting for Android & iOS
            if (screenImg) {
              screenImg.src = 'data:image/jpeg;base64,' + frameData;
              if (screenImg.style.display !== 'block') screenImg.style.display = 'block';
            }

            // Canvas fallback
            if (canvas) {
              canvas.style.display = 'block';
              const ctx = canvas.getContext('2d');
              const img = new Image();
              img.onload = () => {
                if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
                  canvas.width = img.naturalWidth;
                  canvas.height = img.naturalHeight;
                }
                ctx.drawImage(img, 0, 0);
              };
              img.src = 'data:image/jpeg;base64,' + frameData;
            }

            if (lockedNotice) {
              // Frames under 3.5KB indicate black frame from locked or asleep Windows session
              if (frameData.length < 3500) {
                lockedNotice.style.display = 'block';
              } else {
                lockedNotice.style.display = 'none';
              }
            }
          }
          if (msg.type === 'remote_stop') {
            handleRemoteSessionStopped();
          }
        } catch (err) {}
      };
    } catch (e) {
      checkServerHealth();
    }
  }

  // File Upload Logic
  const mobileDropCard = document.getElementById('mobileDropCard');
  const generalFilePicker = document.getElementById('generalFilePicker');
  const cameraPicker = document.getElementById('cameraPicker');
  const mediaPicker = document.getElementById('mediaPicker');

  const galleryBtn = document.getElementById('galleryBtn');
  const docsBtn = document.getElementById('docsBtn');
  const syncTabBtn = document.getElementById('syncTabBtn');
  const textSyncSection = document.getElementById('textSyncSection');

  // Triggers with null checks
  if (mobileDropCard && mediaPicker) mobileDropCard.addEventListener('click', () => mediaPicker.click());
  if (galleryBtn && mediaPicker) galleryBtn.addEventListener('click', () => mediaPicker.click());
  if (docsBtn && generalFilePicker) docsBtn.addEventListener('click', () => generalFilePicker.click());

  if (syncTabBtn && textSyncSection) {
    syncTabBtn.addEventListener('click', () => {
      if (textSyncSection.style.display === 'none') {
        textSyncSection.style.display = 'block';
        textSyncSection.scrollIntoView({ behavior: 'smooth' });
      } else {
        textSyncSection.style.display = 'none';
      }
    });
  }

  [generalFilePicker, cameraPicker, mediaPicker].forEach(picker => {
    if (picker) {
      picker.addEventListener('change', () => {
        if (picker.files && picker.files.length > 0) {
          uploadFiles(picker.files);
          picker.value = '';
        }
      });
    }
  });

  // Mobile Drag and Drop
  ['dragenter', 'dragover'].forEach(name => {
    mobileDropCard.addEventListener(name, (e) => {
      e.preventDefault();
      mobileDropCard.style.borderColor = 'var(--accent-cyan)';
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    mobileDropCard.addEventListener(name, (e) => {
      e.preventDefault();
      mobileDropCard.style.borderColor = 'rgba(0, 242, 254, 0.4)';
    });
  });

  mobileDropCard.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  // Upload function with live speed and progress
  function uploadFiles(files) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    const progressCard = document.getElementById('mobileUploadProgressCard');
    const progressBar = document.getElementById('mobileProgressBarFill');
    const percentText = document.getElementById('mobileUploadPercent');
    const statusText = document.getElementById('mobileUploadStatus');
    const speedText = document.getElementById('mobileUploadSpeed');

    progressCard.style.display = 'block';
    progressBar.style.width = '0%';
    percentText.textContent = '0%';
    statusText.textContent = `Sending ${files.length} file${files.length === 1 ? '' : 's'} to PC...`;
    speedText.textContent = 'Calculating speed...';

    const startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;

    const xhr = new XMLHttpRequest();
    const uploadUrl = currentRoomId
      ? `/api/upload?room=${encodeURIComponent(currentRoomId)}`
      : '/api/upload';
    xhr.open('POST', uploadUrl, true);
    if (currentRoomId) {
      xhr.setRequestHeader('X-Room-Id', currentRoomId);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = `${percent}%`;
        percentText.textContent = `${percent}%`;

        // Calculate upload speed
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.5) {
          const bytesDiff = e.loaded - lastLoaded;
          const speed = bytesDiff / timeDiff; // bytes per second
          speedText.textContent = `${formatBytes(speed)}/s &bull; ${formatBytes(e.loaded)} of ${formatBytes(e.total)}`;
          lastLoaded = e.loaded;
          lastTime = now;
        }
      }
    };

    xhr.onload = () => {
      progressCard.style.display = 'none';
      if (xhr.status === 200) {
        playSuccessChime();
        showToast('Successfully transferred to PC!', '🎉');
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.files && res.files.length > 0) {
            res.files.forEach(f => transferredFiles.unshift(f));
            renderTransferHistory();
          }
        } catch (e) {}
      } else {
        showToast('Transfer failed. Please check PC connection.', '❌');
      }
    };

    xhr.onerror = () => {
      progressCard.style.display = 'none';
      showToast('Network error during transfer', '❌');
    };

    xhr.send(formData);
  }

  // Render Transfer History
  function renderTransferHistory() {
    const list = document.getElementById('transferList');
    const count = document.getElementById('transferCount');

    count.textContent = `${transferredFiles.length} item${transferredFiles.length === 1 ? '' : 's'}`;

    if (transferredFiles.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; color: var(--text-muted); font-size: 13px; padding: 20px 0;">
          No files dropped yet in this session
        </div>
      `;
      return;
    }

    list.innerHTML = '';
    transferredFiles.forEach(file => {
      const item = document.createElement('div');
      item.className = 'transfer-queue-item';
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 9px; min-width: 0;">
          <span style="font-size: 18px;">${file.category === 'image' ? '🖼️' : file.category === 'video' ? '🎬' : '📄'}</span>
          <div style="min-width: 0;">
            <div class="transfer-queue-name" title="${file.name}">${file.name}</div>
            <div style="font-size: 11px; color: #64748b;">${formatBytes(file.size)}</div>
          </div>
        </div>
        <span class="transfer-status-done">✓ Delivered</span>
      `;
      list.appendChild(item);
    });
  }

  // --- PC-to-Mobile Receiving & Auto-Download Logic ---
  const incomingModal = document.getElementById('incomingModal');
  const closeIncomingModal = document.getElementById('closeIncomingModal');
  const incomingFileName = document.getElementById('incomingFileName');
  const incomingFileSize = document.getElementById('incomingFileSize');
  const incomingDownloadBtn = document.getElementById('incomingDownloadBtn');
  const incomingPreviewBtn = document.getElementById('incomingPreviewBtn');
  const autoDownloadToggle = document.getElementById('autoDownloadToggle');

  function handleIncomingFileFromPc(file) {
    playSuccessChime();
    
    // Deduplicate and persist to localStorage
    receivedFromPcFiles = receivedFromPcFiles.filter(f => f.name !== file.name);
    receivedFromPcFiles.unshift(file);
    if (receivedFromPcFiles.length > 50) receivedFromPcFiles.pop();
    try {
      localStorage.setItem('dropfile_received_from_pc', JSON.stringify(receivedFromPcFiles));
    } catch (e) {}

    renderReceivedFromPc();
    updatePcFilesBadge();

    // Populate modal
    if (incomingFileName) incomingFileName.textContent = file.name;
    if (incomingFileSize) incomingFileSize.textContent = formatBytes(file.size);
    if (incomingDownloadBtn) {
      incomingDownloadBtn.href = file.downloadUrl;
      incomingDownloadBtn.setAttribute('download', file.name);
    }
    if (incomingPreviewBtn) incomingPreviewBtn.href = file.previewUrl;
    if (incomingModal) incomingModal.classList.add('active');

    // Check if Auto-Download is enabled
    const isAuto = autoDownloadToggle ? autoDownloadToggle.checked : true;
    if (isAuto) {
      triggerFileDownload(file);
    } else {
      showToast(`Received "${file.name}" from PC!`, '📥');
    }
  }

  function getMimeType(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg'].includes(ext)) return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'mp4') return 'video/mp4';
    if (ext === 'mov') return 'video/quicktime';
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'pdf') return 'application/pdf';
    if (['doc', 'docx'].includes(ext)) return 'application/msword';
    return 'application/octet-stream';
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function triggerFileDownload(file) {
    // If running inside Android Native App with AndroidHost bridge
    if (window.AndroidHost && window.AndroidHost.downloadFile) {
      window.AndroidHost.downloadFile(file.downloadUrl, file.name, getMimeType(file.name));
      showToast(`Downloading "${file.name}" to phone...`, '📥');
      return;
    }

    // iOS Safari trigger: direct navigation to attachment endpoint
    if (isIOS) {
      window.location.href = file.downloadUrl;
      showToast(`Saving "${file.name}"...`, '📥');
      return;
    }

    // Standard browser download trigger
    try {
      const downloadLink = document.createElement('a');
      downloadLink.href = file.downloadUrl;
      downloadLink.download = file.name;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      showToast(`Saving "${file.name}" to Downloads...`, '📥');
    } catch (err) {
      window.location.href = file.downloadUrl;
    }
  }

  function openFileInViewer(file) {
    // If running inside Android Native App with AndroidHost bridge
    if (window.AndroidHost && window.AndroidHost.openExternal) {
      const fullUrl = location.origin + file.previewUrl;
      window.AndroidHost.openExternal(fullUrl, getMimeType(file.name));
      return;
    }

    // Fallback: window.open or navigate
    window.open(file.previewUrl, '_blank');
  }

  // Media Preview Modal Logic
  const previewModal = document.getElementById('previewModal');
  const modalFilename = document.getElementById('modalFilename');
  const modalBody = document.getElementById('modalBody');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalOpenInAppBtn = document.getElementById('modalOpenInAppBtn');
  const modalDownloadBtn = document.getElementById('modalDownloadBtn');
  let currentPreviewFile = null;

  function openPreviewModal(file) {
    currentPreviewFile = file;
    if (modalFilename) modalFilename.textContent = file.name;
    if (modalBody) {
      modalBody.innerHTML = '';
      if (file.category === 'image') {
        modalBody.innerHTML = `<img src="${file.previewUrl}" alt="${file.name}" style="max-width:100%; max-height:55vh; border-radius:8px; object-fit:contain;" />`;
      } else if (file.category === 'video') {
        modalBody.innerHTML = `<video src="${file.previewUrl}" controls autoplay style="width:100%; max-height:55vh; border-radius:8px;"></video>`;
      } else if (file.category === 'audio') {
        modalBody.innerHTML = `
          <div style="text-align:center; padding: 24px;">
            <div style="font-size: 48px; margin-bottom: 12px;">🎵</div>
            <audio src="${file.previewUrl}" controls autoplay style="width:100%;"></audio>
          </div>
        `;
      } else {
        modalBody.innerHTML = `
          <div style="text-align:center; padding: 24px 10px;">
            <div style="font-size: 48px; margin-bottom: 8px;">📄</div>
            <div style="font-weight:600; font-size:14px; color:#fff; word-break:break-all;">${file.name}</div>
            <div style="font-size:12px; color:#94a3b8; margin-top:4px;">${formatBytes(file.size)}</div>
            <p style="font-size:12px; color:#64748b; margin-top:14px;">Tap "Open in App" to view in your phone reader</p>
          </div>
        `;
      }
    }

    if (modalOpenInAppBtn) {
      modalOpenInAppBtn.onclick = () => openFileInViewer(file);
    }
    if (modalDownloadBtn) {
      modalDownloadBtn.onclick = () => triggerFileDownload(file);
    }
    if (previewModal) previewModal.classList.add('active');
  }

  if (modalCloseBtn && previewModal) {
    modalCloseBtn.addEventListener('click', () => previewModal.classList.remove('active'));
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) previewModal.classList.remove('active');
    });
  }

  if (closeIncomingModal && incomingModal) {
    closeIncomingModal.addEventListener('click', () => {
      incomingModal.classList.remove('active');
    });
    incomingModal.addEventListener('click', (e) => {
      if (e.target === incomingModal) incomingModal.classList.remove('active');
    });
  }

  // Render Files Received from PC
  function renderReceivedFromPc() {
    const list = document.getElementById('receivedFromPcList');
    const count = document.getElementById('receivedFromPcCount');
    if (!list || !count) return;

    count.textContent = `${receivedFromPcFiles.length} file${receivedFromPcFiles.length === 1 ? '' : 's'}`;

    if (receivedFromPcFiles.length === 0) {
      list.innerHTML = `
        <div style="text-align: center; color: #94a3b8; font-size: 12.5px; padding: 16px 12px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.08);">
          <div style="font-size: 26px; margin-bottom: 6px;">💻 ➡️ 📱</div>
          <div style="color: #f1f5f9; font-weight: 600; font-size: 13px; margin-bottom: 4px;">No files beamed from PC yet</div>
          <div style="color: #64748b; font-size: 11.5px; line-height: 1.45; margin-bottom: 12px;">
            Drop any file on your PC screen or click <b>📱</b> next to any file on PC to beam it here instantly.
          </div>
          <button id="quickViewPcFilesBtn" type="button" class="btn-get-app" style="width: auto; padding: 8px 16px; font-size: 12px; margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">
            📂 Browse All Files on PC
          </button>
        </div>
      `;
      const quickBtn = document.getElementById('quickViewPcFilesBtn');
      if (quickBtn) {
        quickBtn.addEventListener('click', () => {
          if (allPcFilesContainer) {
            allPcFilesContainer.style.display = 'block';
            if (pcFilesArrow) pcFilesArrow.textContent = '▲ Hide';
            loadAllPcFiles();
            allPcFilesContainer.scrollIntoView({ behavior: 'smooth' });
          }
        });
      }
      return;
    }

    list.innerHTML = '';
    receivedFromPcFiles.forEach(file => {
      const item = document.createElement('div');
      item.className = 'transfer-queue-item';
      item.style.cursor = 'pointer';
      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1;">
          <span style="font-size: 18px;">${file.category === 'image' ? '🖼️' : file.category === 'video' ? '🎬' : '📄'}</span>
          <div style="min-width: 0;">
            <div class="transfer-queue-name" title="${file.name}">${file.name}</div>
            <div style="font-size: 11px; color: #64748b;">${formatBytes(file.size)}</div>
          </div>
        </div>
        <div style="display: flex; gap: 5px; flex-shrink: 0;" onclick="event.stopPropagation();">
          <button class="mobile-action-btn" data-action="open-rec" style="padding: 5px 9px; font-size: 11px;">
            👁️ Open
          </button>
          <button class="btn-get-app" data-action="down-rec" style="padding: 5px 9px; font-size: 11px;">
            ⬇️ Save
          </button>
        </div>
      `;

      item.addEventListener('click', () => openPreviewModal(file));
      item.querySelector('[data-action="open-rec"]').addEventListener('click', (e) => {
        e.stopPropagation();
        openPreviewModal(file);
      });
      item.querySelector('[data-action="down-rec"]').addEventListener('click', (e) => {
        e.stopPropagation();
        triggerFileDownload(file);
      });

      list.appendChild(item);
    });
  }

  // Browse All PC Files Accordion
  const togglePcFilesBtn = document.getElementById('togglePcFilesBtn');
  const allPcFilesContainer = document.getElementById('allPcFilesContainer');
  const allPcFilesList = document.getElementById('allPcFilesList');
  const pcFilesArrow = document.getElementById('pcFilesArrow');

  if (togglePcFilesBtn && allPcFilesContainer) {
    togglePcFilesBtn.addEventListener('click', async () => {
      const isVisible = allPcFilesContainer.style.display === 'block';
      if (isVisible) {
        allPcFilesContainer.style.display = 'none';
        if (pcFilesArrow) pcFilesArrow.textContent = '▼ Tap to View';
      } else {
        allPcFilesContainer.style.display = 'block';
        if (pcFilesArrow) pcFilesArrow.textContent = '▲ Hide';
        loadAllPcFiles();
      }
    });
  }

  async function loadAllPcFiles() {
    if (!allPcFilesList) return;
    allPcFilesList.innerHTML = '<div style="text-align: center; color: #64748b; font-size: 12px; padding: 12px 0;">Loading PC files...</div>';
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      const files = data.files || [];

      if (files.length === 0) {
        allPcFilesList.innerHTML = '<div style="text-align: center; color: #64748b; font-size: 12px; padding: 12px 0;">No files found on PC</div>';
        return;
      }

      allPcFilesList.innerHTML = '';
      files.forEach(file => {
        const row = document.createElement('div');
        row.className = 'transfer-queue-item';
        row.style.cursor = 'pointer';
        row.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
            <span style="font-size: 16px;">${file.category === 'image' ? '🖼️' : file.category === 'video' ? '🎬' : '📄'}</span>
            <div style="min-width: 0;">
              <div class="transfer-queue-name" style="font-size: 12px;" title="${file.name}">${file.name}</div>
              <div style="font-size: 10.5px; color: #64748b;">${formatBytes(file.size)}</div>
            </div>
          </div>
          <div style="display: flex; gap: 5px; flex-shrink: 0;" onclick="event.stopPropagation();">
            <button class="mobile-action-btn" data-action="open-pc-file" style="padding: 5px 9px; font-size: 11px;">
              👁️ Open
            </button>
            <button class="btn-get-app" data-action="down-pc-file" style="padding: 5px 9px; font-size: 11px;">
              ⬇️ Save
            </button>
          </div>
        `;

        row.addEventListener('click', () => openPreviewModal(file));
        row.querySelector('[data-action="open-pc-file"]').addEventListener('click', (e) => {
          e.stopPropagation();
          openPreviewModal(file);
        });
        row.querySelector('[data-action="down-pc-file"]').addEventListener('click', (e) => {
          e.stopPropagation();
          triggerFileDownload(file);
        });

        allPcFilesList.appendChild(row);
      });
      const badge = document.getElementById('pcFilesCountBadge');
      if (badge) badge.textContent = `${files.length} on PC`;
    } catch (err) {
      allPcFilesList.innerHTML = '<div style="text-align: center; color: #ef4444; font-size: 12px; padding: 12px 0;">Failed to load PC files</div>';
    }
  }

  async function updatePcFilesBadge() {
    const badge = document.getElementById('pcFilesCountBadge');
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      const count = (data.files || []).length;
      if (badge) {
        badge.textContent = `${count} on PC`;
      }
    } catch (e) {
      if (badge) badge.textContent = 'PC Files';
    }
  }

  // --- Camera Beam Flow ---
  let activeBeamToken = null;
  const beamDocBtn = document.getElementById('beamDocBtn');
  const beamFilePicker = document.getElementById('beamFilePicker');
  const beamModal = document.getElementById('beamModal');
  const closeBeamModal = document.getElementById('closeBeamModal');
  const beamFileName = document.getElementById('beamFileName');
  const beamQrImage = document.getElementById('beamQrImage');
  const beamInstantSendBtn = document.getElementById('beamInstantSendBtn');

  if (beamDocBtn && beamFilePicker) {
    beamDocBtn.addEventListener('click', () => beamFilePicker.click());

    beamFilePicker.addEventListener('change', async () => {
      if (beamFilePicker.files && beamFilePicker.files.length > 0) {
        const file = beamFilePicker.files[0];
        beamFilePicker.value = '';
        await stageBeamFile(file);
      }
    });
  }

  async function stageBeamFile(file) {
    showToast(`Staging "${file.name}" for Camera Tap...`, '📷');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/stage-beam', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        activeBeamToken = data.token;
        beamFileName.textContent = data.fileName;
        beamQrImage.src = data.qrUrl;
        beamModal.classList.add('active');
        playSuccessChime();
        showToast('Hold this screen facing PC camera!', '💻');
      } else {
        showToast('Failed to stage document', '❌');
      }
    } catch (err) {
      console.error('Error staging beam:', err);
      showToast('Error preparing document', '❌');
    }
  }

  function closeBeam() {
    beamModal.classList.remove('active');
    activeBeamToken = null;
  }

  closeBeamModal.addEventListener('click', closeBeam);

  // Instant Wi-Fi Beam button in modal
  beamInstantSendBtn.addEventListener('click', async () => {
    if (!activeBeamToken) return;
    try {
      beamInstantSendBtn.textContent = 'Sending...';
      const res = await fetch('/api/claim-beam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: activeBeamToken })
      });
      const data = await res.json();
      beamInstantSendBtn.textContent = '⚡ Or Tap to Beam Instantly';
      if (data.success) {
        handleBeamSuccess(data.file);
      }
    } catch (err) {
      beamInstantSendBtn.textContent = '⚡ Or Tap to Beam Instantly';
    }
  });

  function handleBeamSuccess(file) {
    playSuccessChime();
    closeBeam();
    showToast(`Delivered "${file.name}" to PC!`, '🎉');
    transferredFiles.unshift(file);
    renderTransferHistory();
  }

  // Handle WebSocket Beam notifications
  const origOnMessage = ws ? ws.onmessage : null;

  // Enhance WebSocket message listener
  function setupEnhancedWs() {
    if (!ws) return;
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'beam_claimed') {
          if (msg.token === activeBeamToken || activeBeamToken) {
            handleBeamSuccess(msg.file);
          }
        }
      } catch (e) {}
    });
  }

  // Send text to PC
  document.getElementById('mobileSendTextBtn').addEventListener('click', () => {
    const input = document.getElementById('mobileTextInput');
    const text = input.value.trim();

    if (!text) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'clipboard_share', text }));
      input.value = '';
      playSuccessChime();
      showToast('Delivered to PC screen!', '💬');
    } else {
      showToast('Connecting to PC...', '⏳');
    }
  });

  // --- PWA Installation Setup ---
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW register error', err));
  }

  let deferredPrompt;
  const pwaBanner = document.getElementById('pwaBanner');
  const pwaInstallBtn = document.getElementById('pwaInstallBtn');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (pwaBanner) pwaBanner.style.display = 'flex';
  });

  if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          pwaBanner.style.display = 'none';
        }
        deferredPrompt = null;
      }
    });
  }

  // Device Detection: iOS vs Android promo display
  const androidPromoCard = document.getElementById('androidPromoCard');
  const iosPromoCard = document.getElementById('iosPromoCard');
  const iosGuideModal = document.getElementById('iosGuideModal');
  const closeIosGuideModal = document.getElementById('closeIosGuideModal');
  const btnGotItIos = document.getElementById('btnGotItIos');

  if (isIOS) {
    if (androidPromoCard) androidPromoCard.style.display = 'none';
    if (iosPromoCard) iosPromoCard.style.display = 'flex';
  }

  if (iosPromoCard) {
    iosPromoCard.addEventListener('click', () => {
      if (iosGuideModal) iosGuideModal.classList.add('active');
    });
  }

  [closeIosGuideModal, btnGotItIos].forEach(btn => {
    if (btn && iosGuideModal) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        iosGuideModal.classList.remove('active');
      });
    }
  });

  if (iosGuideModal) {
    iosGuideModal.addEventListener('click', (e) => {
      if (e.target === iosGuideModal) iosGuideModal.classList.remove('active');
    });
  }

  // Mobile User Guide Modal
  const openMobileGuideBtn = document.getElementById('openMobileGuideBtn');
  const mobileGuideModal = document.getElementById('mobileGuideModal');
  const closeMobileGuideBtn = document.getElementById('closeMobileGuideBtn');
  const gotItMobileGuideBtn = document.getElementById('gotItMobileGuideBtn');

  if (openMobileGuideBtn && mobileGuideModal) {
    openMobileGuideBtn.addEventListener('click', () => {
      mobileGuideModal.classList.add('active');
    });
  }

  [closeMobileGuideBtn, gotItMobileGuideBtn].forEach(btn => {
    if (btn && mobileGuideModal) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        mobileGuideModal.classList.remove('active');
      });
    }
  });

  if (mobileGuideModal) {
    mobileGuideModal.addEventListener('click', (e) => {
      if (e.target === mobileGuideModal) mobileGuideModal.classList.remove('active');
    });
  }

  // Check if opened after native share
  if (window.location.search.includes('shared=success')) {
    playSuccessChime();
    showToast('🎉 Shared document uploaded to PC!', '✅');
  }

  // --- Remote PC Desktop Pure Touchscreen Landscape Controller ---
  let mobilePeerConnection = null;
  let remoteScreenStream = null;
  let remoteControlActive = false;

  const remoteDesktopOverlay = document.getElementById('remoteDesktopOverlay');
  const openRemoteBtn = document.getElementById('openRemoteBtn');
  const remotePcPromoCard = document.getElementById('remotePcPromoCard');
  const closeRemoteOverlayBtn = document.getElementById('closeRemoteOverlayBtn');
  const remoteScreenVideo = document.getElementById('remoteScreenVideo');
  const remoteVideoWrapper = document.getElementById('remoteVideoWrapper');
  const remoteTouchSurface = document.getElementById('remoteTouchSurface');
  const remoteWaitingCard = document.getElementById('remoteWaitingCard');
  const remoteWaitingTitle = document.getElementById('remoteWaitingTitle');
  const remoteWaitingMsg = document.getElementById('remoteWaitingMsg');
  const requestRemoteStartBtn = document.getElementById('requestRemoteStartBtn');

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  function sendRemoteInput(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'remote_input',
        roomId: currentRoomId,
        ...payload
      }));
    }
  }

  function primeRemoteVideoPlayback() {
    if (remoteScreenVideo) {
      remoteScreenVideo.muted = true;
      remoteScreenVideo.defaultMuted = true;
      remoteScreenVideo.playsInline = true;
      remoteScreenVideo.setAttribute('playsinline', '');
      remoteScreenVideo.setAttribute('webkit-playsinline', '');
      remoteScreenVideo.setAttribute('muted', '');
      try {
        const p = remoteScreenVideo.play();
        if (p !== undefined) p.catch(() => {});
      } catch (e) {}
    }
  }

  function openRemoteDesktop() {
    if (remoteDesktopOverlay) {
      remoteDesktopOverlay.style.display = 'flex';
      remoteControlActive = true;
      primeRemoteVideoPlayback();

      // Auto-switch to landscape mode in Android Native App & Web Browser
      if (window.AndroidHost && window.AndroidHost.setLandscape) {
        window.AndroidHost.setLandscape(true);
      }
      try {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      } catch (e) {}

      requestRemoteStart();
    }
  }

  function closeRemoteDesktop() {
    if (remoteDesktopOverlay) {
      remoteDesktopOverlay.style.display = 'none';
      remoteControlActive = false;

      // Restore portrait orientation in Android Native App & Web Browser
      if (window.AndroidHost && window.AndroidHost.setLandscape) {
        window.AndroidHost.setLandscape(false);
      }
      try {
        if (screen.orientation && screen.orientation.unlock) {
          screen.orientation.unlock();
        }
      } catch (e) {}

      const canvas = document.getElementById('remoteScreenCanvas');
      if (canvas) {
        canvas.style.display = 'none';
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      if (remoteScreenStream) {
        remoteScreenStream.getTracks().forEach(t => t.stop());
        remoteScreenStream = null;
      }
      if (mobilePeerConnection) {
        try { mobilePeerConnection.close(); } catch (e) {}
        mobilePeerConnection = null;
      }
      if (remoteScreenVideo) remoteScreenVideo.srcObject = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'unattended_remote_stop', roomId: currentRoomId, role: 'mobile' }));
        ws.send(JSON.stringify({ type: 'remote_stop', role: 'mobile' }));
      }
    }
  }

  function requestRemoteStart() {
    primeRemoteVideoPlayback();
    if (remoteWaitingCard) remoteWaitingCard.style.display = 'flex';
    if (remoteWaitingTitle) remoteWaitingTitle.textContent = 'Connecting to PC Screen...';
    if (remoteWaitingMsg) remoteWaitingMsg.textContent = 'Connecting unattended screen stream and hardware controls...';
    if (requestRemoteStartBtn) requestRemoteStartBtn.textContent = '⏳ Connecting to PC...';

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'unattended_remote_start',
        roomId: currentRoomId,
        role: 'mobile'
      }));
      showToast('Connecting to PC Desktop...', '🖥️');
    } else {
      showToast('Connecting to PC first...', '⏳');
    }
  }

  async function handleIncomingWebRtcOffer(offer) {
    try {
      if (mobilePeerConnection) {
        try { mobilePeerConnection.close(); } catch (e) {}
      }

      mobilePeerConnection = new RTCPeerConnection(rtcConfig);

      mobilePeerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          remoteScreenStream = event.streams[0];
          if (remoteScreenVideo) {
            remoteScreenVideo.srcObject = remoteScreenStream;
            remoteScreenVideo.muted = true;
            remoteScreenVideo.defaultMuted = true;
            remoteScreenVideo.playsInline = true;
            remoteScreenVideo.setAttribute('playsinline', '');
            remoteScreenVideo.setAttribute('webkit-playsinline', '');
            remoteScreenVideo.setAttribute('muted', '');

            const playStream = () => {
              if (remoteScreenVideo.paused) {
                const p = remoteScreenVideo.play();
                if (p !== undefined) {
                  p.then(() => {
                    console.log('✅ Remote video playing smoothly');
                  }).catch(e => {
                    console.warn('Play attempt notice:', e);
                  });
                }
              }
            };

            playStream();
            remoteScreenVideo.onloadedmetadata = playStream;
            remoteScreenVideo.oncanplay = playStream;
            remoteScreenVideo.onloadeddata = playStream;
          }
          if (remoteWaitingCard) remoteWaitingCard.style.display = 'none';
          showToast('🟢 Fullscreen PC Touchscreen Active!', '🖥️');
        }
      };

      mobilePeerConnection.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'webrtc_ice_candidate',
            candidate: event.candidate,
            role: 'mobile'
          }));
        }
      };

      await mobilePeerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await mobilePeerConnection.createAnswer();
      await mobilePeerConnection.setLocalDescription(answer);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'webrtc_answer',
          answer: answer,
          role: 'mobile'
        }));
      }
    } catch (err) {
      console.error('Error answering WebRTC offer on Mobile:', err);
    }
  }

  function handleRemoteSessionStopped() {
    const screenImg = document.getElementById('remoteScreenImg');
    const canvas = document.getElementById('remoteScreenCanvas');
    const lockedNotice = document.getElementById('remoteLockedNotice');
    if (screenImg) screenImg.style.display = 'none';
    if (lockedNotice) lockedNotice.style.display = 'none';
    if (canvas) {
      canvas.style.display = 'none';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    if (remoteWaitingCard) {
      remoteWaitingCard.style.display = 'flex';
      if (remoteWaitingTitle) remoteWaitingTitle.textContent = 'Screen Share Ended';
      if (remoteWaitingMsg) remoteWaitingMsg.textContent = 'PC desktop stream has ended.';
      if (requestRemoteStartBtn) requestRemoteStartBtn.textContent = '🚀 Reconnect Fullscreen PC';
    }
    if (remoteScreenVideo) remoteScreenVideo.srcObject = null;
    if (mobilePeerConnection) {
      try { mobilePeerConnection.close(); } catch (e) {}
      mobilePeerConnection = null;
    }
  }

  // --- Accurate Touchscreen Mapping Helper ---
  function getNormalizedTouchCoords(touch) {
    const screenImg = document.getElementById('remoteScreenImg');
    const canvas = document.getElementById('remoteScreenCanvas');
    const isImgActive = screenImg && screenImg.style.display !== 'none' && screenImg.naturalWidth > 0;
    const isCanvasActive = canvas && canvas.style.display !== 'none' && canvas.width > 0;

    const rect = remoteTouchSurface.getBoundingClientRect();
    const contW = rect.width || window.innerWidth;
    const contH = rect.height || window.innerHeight;

    let contentW = 1920;
    let contentH = 1080;

    if (isImgActive) {
      contentW = screenImg.naturalWidth;
      contentH = screenImg.naturalHeight;
    } else if (isCanvasActive) {
      contentW = canvas.width;
      contentH = canvas.height;
    } else if (remoteScreenVideo && remoteScreenVideo.videoWidth) {
      contentW = remoteScreenVideo.videoWidth;
      contentH = remoteScreenVideo.videoHeight;
    }

    const contAspect = contW / contH;
    const contentAspect = contentW / contentH;

    let renderedW, renderedH, offsetX, offsetY;

    if (contAspect > contentAspect) {
      renderedH = contH;
      renderedW = contH * contentAspect;
      offsetX = (contW - renderedW) / 2;
      offsetY = 0;
    } else {
      renderedW = contW;
      renderedH = contW / contentAspect;
      offsetX = 0;
      offsetY = (contH - renderedH) / 2;
    }

    const relX = touch.clientX - rect.left - offsetX;
    const relY = touch.clientY - rect.top - offsetY;

    const normX = Math.min(Math.max(relX / renderedW, 0), 1);
    const normY = Math.min(Math.max(relY / renderedH, 0), 1);

    return { x: normX, y: normY };
  }

  function showTouchRipple(clientX, clientY) {
    if (!remoteTouchSurface) return;
    const ripple = document.createElement('div');
    ripple.className = 'touch-ripple';
    ripple.style.left = `${clientX}px`;
    ripple.style.top = `${clientY}px`;
    remoteTouchSurface.appendChild(ripple);
    setTimeout(() => ripple.remove(), 400);
  }

  // --- Direct Touchscreen Interaction Logic ---
  let touchStartX = 0;
  let touchStartY = 0;
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartTime = 0;
  let isDragging = false;
  let longPressTimer = null;
  let isLongPressTriggered = false;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let lastScrollY = 0;
  let lastSendTime = 0;

  if (remoteTouchSurface) {
    remoteTouchSurface.addEventListener('touchstart', (e) => {
      e.preventDefault();
      touchStartTime = Date.now();
      isDragging = false;
      isLongPressTriggered = false;

      // Resume video playback if browser autoplay held it
      if (remoteScreenVideo && (remoteScreenVideo.paused || remoteScreenVideo.ended)) {
        remoteScreenVideo.muted = true;
        remoteScreenVideo.play().catch(() => {});
      }

      const count = e.touches.length;

      if (count === 1) {
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;

        const coords = getNormalizedTouchCoords(t);
        showTouchRipple(t.clientX, t.clientY);
        sendRemoteInput({ action: 'move', x: coords.x, y: coords.y });

        // Long press detection for Right Click (500ms)
        clearTimeout(longPressTimer);
        longPressTimer = setTimeout(() => {
          if (!isDragging) {
            isLongPressTriggered = true;
            if (navigator.vibrate) navigator.vibrate(40);
            sendRemoteInput({ action: 'click', button: 'right', x: coords.x, y: coords.y });
            showToast('Right Click 🖱️', '⚡');
          }
        }, 500);

      } else if (count === 2) {
        clearTimeout(longPressTimer);
        lastScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    remoteTouchSurface.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const count = e.touches.length;
      const now = Date.now();

      if (count === 1) {
        const t = e.touches[0];
        lastTouchX = t.clientX;
        lastTouchY = t.clientY;
        const dist = Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY);

        // If moved significantly, cancel long press and enter mouse drag mode
        if (dist > 8) {
          clearTimeout(longPressTimer);
          const coords = getNormalizedTouchCoords(t);

          if (!isDragging) {
            isDragging = true;
            sendRemoteInput({ action: 'down', button: 'left', x: coords.x, y: coords.y });
          }

          if (now - lastSendTime > 16) {
            lastSendTime = now;
            sendRemoteInput({ action: 'move', x: coords.x, y: coords.y });
          }
        }
      } else if (count === 2) {
        clearTimeout(longPressTimer);
        const currentY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const diff = currentY - lastScrollY;
        if (Math.abs(diff) > 10) {
          lastScrollY = currentY;
          sendRemoteInput({ action: 'scroll', delta: diff > 0 ? 120 : -120 });
        }
      }
    }, { passive: false });

    remoteTouchSurface.addEventListener('touchend', (e) => {
      e.preventDefault();
      clearTimeout(longPressTimer);
      const duration = Date.now() - touchStartTime;

      if (e.touches.length === 0) {
        if (isDragging) {
          // Release mouse drag
          const coords = getNormalizedTouchCoords({ clientX: lastTouchX, clientY: lastTouchY });
          sendRemoteInput({ action: 'up', button: 'left', x: coords.x, y: coords.y });
          isDragging = false;
        } else if (!isLongPressTriggered) {
          // Tap detected! Check if double-tap
          const now = Date.now();
          const distFromLastTap = Math.hypot(lastTouchX - lastTapX, lastTouchY - lastTapY);
          const isDouble = (now - lastTapTime < 380) && (distFromLastTap < 40);

          const coords = getNormalizedTouchCoords({ clientX: lastTouchX, clientY: lastTouchY });

          if (isDouble) {
            sendRemoteInput({ action: 'click', button: 'double', x: coords.x, y: coords.y });
            lastTapTime = 0;
          } else {
            sendRemoteInput({ action: 'click', button: 'left', x: coords.x, y: coords.y });
            lastTapTime = now;
            lastTapX = lastTouchX;
            lastTapY = lastTouchY;
          }
        }
      }
    }, { passive: false });
  }

  // Open & Close Handlers
  if (openRemoteBtn) openRemoteBtn.addEventListener('click', openRemoteDesktop);
  if (remotePcPromoCard) remotePcPromoCard.addEventListener('click', openRemoteDesktop);
  if (closeRemoteOverlayBtn) closeRemoteOverlayBtn.addEventListener('click', closeRemoteDesktop);
  if (requestRemoteStartBtn) requestRemoteStartBtn.addEventListener('click', requestRemoteStart);

  // noVNC-Style Mobile Control Dock Handlers
  const dockWinBtn = document.getElementById('remoteDockWinBtn');
  const dockDesktopBtn = document.getElementById('remoteDockDesktopBtn');
  const dockRightClickBtn = document.getElementById('remoteDockRightClickBtn');
  const dockKbdBtn = document.getElementById('remoteDockKbdBtn');
  const dockTaskMgrBtn = document.getElementById('remoteDockTaskMgrBtn');
  const kbdDrawer = document.getElementById('remoteKeyboardDrawer');
  const kbdInput = document.getElementById('remoteKbdInput');
  const sendTextBtn = document.getElementById('remoteSendTextBtn');
  const keyEnterBtn = document.getElementById('remoteKeyEnterBtn');
  const keyEscBtn = document.getElementById('remoteKeyEscBtn');
  const keyTabBtn = document.getElementById('remoteKeyTabBtn');
  const keyBkspBtn = document.getElementById('remoteKeyBkspBtn');
  const closeKbdBtn = document.getElementById('closeKbdDrawerBtn');

  if (dockWinBtn) {
    dockWinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'shortcut', shortcut: 'win' });
      showToast('🪟 Windows Start Menu', '⚡');
    });
  }

  if (dockDesktopBtn) {
    dockDesktopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'shortcut', shortcut: 'win+d' });
      showToast('🖥️ Show Desktop (Win+D)', '⚡');
    });
  }

  if (dockRightClickBtn) {
    dockRightClickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'click', button: 'right' });
      showToast('🖱️ Right Click', '⚡');
    });
  }

  if (dockTaskMgrBtn) {
    dockTaskMgrBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'shortcut', shortcut: 'taskmgr' });
      showToast('⚡ Task Manager (Ctrl+Shift+Esc)', '⚡');
    });
  }

  if (dockKbdBtn && kbdDrawer) {
    dockKbdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = kbdDrawer.style.display === 'none';
      kbdDrawer.style.display = isHidden ? 'flex' : 'none';
      if (isHidden && kbdInput) kbdInput.focus();
    });
  }

  if (closeKbdBtn && kbdDrawer) {
    closeKbdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      kbdDrawer.style.display = 'none';
    });
  }

  if (sendTextBtn && kbdInput) {
    sendTextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const txt = kbdInput.value;
      if (txt) {
        sendRemoteInput({ action: 'text', text: txt });
        kbdInput.value = '';
        showToast(`Sent: "${txt}"`, '⌨️');
      }
    });
    kbdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendTextBtn.click();
      }
    });
  }

  if (keyEnterBtn) {
    keyEnterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'key', key: '{ENTER}' });
    });
  }

  if (keyEscBtn) {
    keyEscBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'key', key: '{ESC}' });
    });
  }

  if (keyTabBtn) {
    keyTabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'key', key: '{TAB}' });
    });
  }

  if (keyBkspBtn) {
    keyBkspBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendRemoteInput({ action: 'key', key: '{BACKSPACE}' });
    });
  }

  // Initial render of received files and PC file count
  renderDeviceChips();
  renderReceivedFromPc();
  updatePcFilesBadge();
  updateRoomPairingUi(currentRoomId, false);

  // Check connection immediately via HTTP and start WebSocket
  checkServerHealth();
  connectWebSocket();
  setupEnhancedWs();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileApp);
} else {
  initMobileApp();
}
