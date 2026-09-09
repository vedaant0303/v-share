// DropFile PC Dashboard Controller
document.addEventListener('DOMContentLoaded', () => {
  let ws;
  let allFiles = [];
  let currentFilter = 'all';
  let systemInfo = null;
  let autoSaveToPc = localStorage.getItem('vshare_auto_save') !== 'false';
  let chosenDirectoryHandle = null;

  // Private Room Pairing Identifier (In-Memory Pairing, Zero Database)
  let currentRoomId = sessionStorage.getItem('vshare_pc_room_id');
  if (!currentRoomId) {
    currentRoomId = Math.floor(100000 + Math.random() * 900000).toString();
    sessionStorage.setItem('vshare_pc_room_id', currentRoomId);
  }

  // Display Pairing Code in UI
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  if (roomCodeDisplay) {
    roomCodeDisplay.textContent = `${currentRoomId.substring(0, 3)} ${currentRoomId.substring(3)}`;
  }

  const copyRoomCodeBtn = document.getElementById('copyRoomCodeBtn');
  if (copyRoomCodeBtn) {
    copyRoomCodeBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(currentRoomId);
      showToast(`Copied pairing code: ${currentRoomId}`, '🔒');
    });
  }

  // Native PC Folder Picker (Web File System Access API)
  const chooseFolderBtn = document.getElementById('chooseFolderBtn');
  const chosenFolderText = document.getElementById('chosenFolderText');

  if (chooseFolderBtn) {
    chooseFolderBtn.addEventListener('click', async () => {
      if (!('showDirectoryPicker' in window)) {
        showToast('Your browser saves files to PC Downloads automatically! (Chrome/Edge supports custom folder picker)', 'ℹ️');
        return;
      }
      try {
        chosenDirectoryHandle = await window.showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'downloads'
        });
        const folderName = chosenDirectoryHandle.name || 'Selected Folder';
        if (chosenFolderText) {
          chosenFolderText.textContent = `📁 ${folderName}`;
        }
        chooseFolderBtn.style.background = 'rgba(16, 185, 129, 0.25)';
        chooseFolderBtn.style.borderColor = '#10b981';
        chooseFolderBtn.style.color = '#34d399';
        showToast(`✅ Incoming mobile files will save directly to PC folder: ${folderName}`, '📂');
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('Directory picker error:', e);
          showToast('Folder selection cancelled or permission denied', '⚠️');
        }
      }
    });
  }

  // Save file directly to chosen PC folder
  async function saveFileDirectlyToPcFolder(file) {
    if (!chosenDirectoryHandle) {
      if (autoSaveToPc) triggerBrowserDownload(file);
      return;
    }
    try {
      const response = await fetch(file.downloadUrl);
      const blob = await response.blob();
      const fileHandle = await chosenDirectoryHandle.getFileHandle(file.name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast(`💾 Saved "${file.name}" to your chosen PC folder!`, '📂');
    } catch (err) {
      console.warn('Directory handle write fallback:', err);
      if (autoSaveToPc) triggerBrowserDownload(file);
    }
  }

  // Trigger direct browser download to PC Downloads folder
  function triggerBrowserDownload(file) {
    if (!file || !file.downloadUrl) return;
    const a = document.createElement('a');
    a.href = file.downloadUrl;
    a.download = file.name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
    showToast(`💾 Saved "${file.name}" to PC Downloads!`, '📥');
  }

  // Audio Chime Synthesizer
  function playNotificationChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

      osc2.frequency.setValueAtTime(880, ctx.currentTime);
      osc2.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.2); // D6

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();
      osc1.stop(ctx.currentTime + 0.5);
      osc2.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  // Toast Notification
  function showToast(message, icon = '⚡') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Format File Size
  function formatBytes(bytes, decimals = 1) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  // Format Time
  function formatTime(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  // Fetch System Info & QR Code
  async function loadSystemInfo() {
    try {
      const res = await fetch(`/api/info?room=${encodeURIComponent(currentRoomId)}`);
      systemInfo = await res.json();
      renderFiles();

      const qrImg = document.getElementById('qrImage');
      const mobileInput = document.getElementById('mobileUrlInput');
      const ipSelector = document.getElementById('ipSelector');

      qrImg.src = systemInfo.qrDataUrl;
      mobileInput.value = systemInfo.mobileUrl;

      // In Cloud mode, hide local tunnel button since it's already live globally
      if (systemInfo.isCloud) {
        const toggleTunnelBtn = document.getElementById('toggleTunnelBtn');
        if (toggleTunnelBtn) toggleTunnelBtn.style.display = 'none';
      }

      // Populate network interfaces selector
      ipSelector.innerHTML = '';
      systemInfo.interfaces.forEach((iface, index) => {
        const option = document.createElement('option');
        option.value = iface.address;
        option.textContent = `${iface.interface} (${iface.address})`;
        if (index === 0) option.selected = true;
        ipSelector.appendChild(option);
      });

      // Tunnel button handling
      const toggleTunnelBtn = document.getElementById('toggleTunnelBtn');
      const toggleTunnelText = document.getElementById('toggleTunnelText');
      const tunnelIcon = document.getElementById('tunnelIcon');

      function updateTunnelUi(isActive, url) {
        if (!toggleTunnelBtn || !toggleTunnelText) return;
        if (isActive) {
          toggleTunnelBtn.style.background = 'rgba(16, 185, 129, 0.15)';
          toggleTunnelBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          toggleTunnelBtn.style.color = '#34d399';
          toggleTunnelText.textContent = 'Public Link Active (Tap to Stop)';
          if (tunnelIcon) tunnelIcon.textContent = '🟢';
        } else {
          toggleTunnelBtn.style.background = 'rgba(37, 99, 235, 0.12)';
          toggleTunnelBtn.style.borderColor = 'rgba(37, 99, 235, 0.35)';
          toggleTunnelBtn.style.color = '#60a5fa';
          toggleTunnelText.textContent = 'Enable Public Internet Link';
          if (tunnelIcon) tunnelIcon.textContent = '🌐';
        }
      }

      updateTunnelUi(systemInfo.tunnelActive, systemInfo.tunnelUrl);

      if (toggleTunnelBtn && !toggleTunnelBtn.dataset.bound) {
        toggleTunnelBtn.dataset.bound = 'true';
        toggleTunnelBtn.addEventListener('click', async () => {
          const isCurrentlyActive = toggleTunnelText.textContent.includes('Active');
          toggleTunnelText.textContent = isCurrentlyActive ? 'Stopping...' : 'Connecting to Cloudflare...';
          try {
            const endpoint = isCurrentlyActive ? '/api/tunnel/stop' : '/api/tunnel/start';
            const res = await fetch(endpoint, { method: 'POST' });
            const data = await res.json();
            // Wait 2 seconds for tunnel to resolve and refresh system info
            setTimeout(async () => {
              await loadSystemInfo();
              showToast(isCurrentlyActive ? 'Public tunnel stopped' : '🎉 Public Cloudflare link ready!', '🌐');
            }, 2500);
          } catch (e) {
            showToast('Tunnel error: ' + e.message, '⚠️');
            await loadSystemInfo();
          }
        });
      }

      ipSelector.addEventListener('change', async (e) => {
        const selectedVal = e.target.value;
        let newUrl;
        if (selectedVal.startsWith('http')) {
          newUrl = `${selectedVal}/mobile?room=${encodeURIComponent(currentRoomId)}`;
        } else {
          newUrl = `http://${selectedVal}:${systemInfo.port}/mobile?room=${encodeURIComponent(currentRoomId)}`;
        }
        mobileInput.value = newUrl;
        
        try {
          const qrRes = await fetch(`/api/info?ip=${encodeURIComponent(selectedVal)}&room=${encodeURIComponent(currentRoomId)}`);
          const data = await qrRes.json();
          if (data.qrDataUrl) {
            qrImg.src = data.qrDataUrl;
          }
        } catch (err) {}
      });

    } catch (err) {
      console.error('Failed to load system info:', err);
    }
  }

  // Fetch Received Files
  async function loadFiles() {
    try {
      const res = await fetch('/api/files');
      const data = await res.json();
      allFiles = data.files || [];
      renderFiles();
    } catch (err) {
      console.error('Failed to load files:', err);
    }
  }

  // Render Files Grid matching reference screenshot
  function renderFiles() {
    const grid = document.getElementById('fileGrid');
    const countBadge = document.getElementById('fileCountBadge');

    const filtered = currentFilter === 'all' 
      ? allFiles 
      : allFiles.filter(f => f.category === currentFilter);

    countBadge.textContent = `${allFiles.length} file${allFiles.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📱 ➡️ 💻</div>
          <h3>${allFiles.length === 0 ? 'No files received yet' : 'No matching files found'}</h3>
          <p>${allFiles.length === 0 ? 'Scan the QR code on your mobile phone to drop photos and videos!' : 'Try switching to "All" to view your files.'}</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = '';
    filtered.forEach(file => {
      const card = document.createElement('div');
      card.className = 'file-card';

      let thumbHtml = '';
      const ext = (file.name.split('.').pop() || '').toUpperCase();

      if (file.category === 'image') {
        thumbHtml = `<img src="${file.previewUrl}" alt="${file.name}" loading="lazy" />`;
      } else if (file.category === 'video') {
        thumbHtml = `
          <video src="${file.previewUrl}" preload="metadata"></video>
          <span style="position:absolute;font-size:24px;opacity:0.8;">🎬</span>
        `;
      } else {
        // Document / PDF / Other style matching reference mockup
        const badgeLabel = ext === 'PDF' ? 'PDF' : (ext.length <= 4 ? ext : 'DOC');
        thumbHtml = `
          <div class="doc-icon-badge">
            <svg class="doc-svg" viewBox="0 0 32 40" fill="none">
              <path d="M4 0C1.79 0 0 1.79 0 4V36C0 38.21 1.79 40 4 40H28C30.21 40 32 38.21 32 36V12L20 0H4Z" fill="#1e2636"/>
              <path d="M20 0V12H32L20 0Z" fill="#323e57"/>
              <text x="16" y="27" font-family="Inter, sans-serif" font-weight="700" font-size="7.5" fill="#cbd5e1" text-anchor="middle">${badgeLabel}</text>
            </svg>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="file-thumb-area" data-action="preview" data-name="${encodeURIComponent(file.name)}">
          ${thumbHtml}
        </div>
        <div class="file-info">
          <div class="file-title" title="${file.name}" data-action="preview" data-name="${encodeURIComponent(file.name)}">
            ${file.name}
          </div>
          <div class="file-meta-row">
            <span>${formatBytes(file.size)}</span>
            <span>${formatTime(file.modified)}</span>
          </div>
        </div>
        <div class="file-actions-row">
          ${systemInfo && systemInfo.isCloud ? `
            <a class="card-action-btn card-download-btn" href="${file.downloadUrl}" download="${file.name}" title="Download directly to PC Downloads folder">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              <span>Download</span>
            </a>
            <button class="card-action-btn" data-action="preview" data-name="${encodeURIComponent(file.name)}" title="Preview file">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <span>Preview</span>
            </button>
            <button class="card-action-btn icon-only" data-action="send-mobile" data-name="${encodeURIComponent(file.name)}" title="Send to Mobile Phone">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                <line x1="12" y1="18" x2="12.01" y2="18"></line>
              </svg>
            </button>
            <button class="card-action-btn icon-only delete-btn" data-action="delete" data-name="${encodeURIComponent(file.name)}" title="Delete file">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          ` : `
            <button class="card-action-btn" data-action="reveal" data-name="${encodeURIComponent(file.name)}" title="Show in Windows Explorer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span>Folder</span>
            </button>
            <button class="card-action-btn" data-action="open" data-name="${encodeURIComponent(file.name)}" title="Open with default Windows app">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              <span>Open</span>
            </button>
            <a class="card-action-btn card-download-btn icon-only" href="${file.downloadUrl}" download="${file.name}" title="Download to PC">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </a>
            <button class="card-action-btn icon-only" data-action="send-mobile" data-name="${encodeURIComponent(file.name)}" title="Send to Mobile Phone">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                <line x1="12" y1="18" x2="12.01" y2="18"></line>
              </svg>
            </button>
            <button class="card-action-btn icon-only delete-btn" data-action="delete" data-name="${encodeURIComponent(file.name)}" title="Delete file">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          `}
        </div>
      `;

      grid.appendChild(card);
    });

    // Attach card event listeners
    grid.querySelectorAll('[data-action="preview"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filename = decodeURIComponent(el.getAttribute('data-name'));
        const file = allFiles.find(f => f.name === filename);
        if (file) openPreviewModal(file);
      });
    });

    grid.querySelectorAll('[data-action="send-mobile"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filename = decodeURIComponent(el.getAttribute('data-name'));
        sendFileToMobile(filename);
      });
    });

    grid.querySelectorAll('[data-action="reveal"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filename = decodeURIComponent(el.getAttribute('data-name'));
        revealInExplorer(filename);
      });
    });

    grid.querySelectorAll('[data-action="open"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filename = decodeURIComponent(el.getAttribute('data-name'));
        openFileInApp(filename);
      });
    });

    grid.querySelectorAll('[data-action="delete"]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const filename = decodeURIComponent(el.getAttribute('data-name'));
        deleteFile(filename);
      });
    });
  }

  // Filter Buttons
  document.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      renderFiles();
    });
  });

  // Modal Preview
  const modal = document.getElementById('previewModal');
  const modalFilename = document.getElementById('modalFilename');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalCloseBtn');
  const modalRevealBtn = document.getElementById('modalRevealBtn');
  const modalOpenInAppBtn = document.getElementById('modalOpenInAppBtn');
  const modalDownloadBtn = document.getElementById('modalDownloadBtn');
  let currentModalFile = null;

  function openPreviewModal(file) {
    currentModalFile = file;
    modalFilename.textContent = file.name;
    modalDownloadBtn.href = file.downloadUrl;
    modalDownloadBtn.setAttribute('download', file.name);
    modalBody.innerHTML = '';

    if (file.category === 'image') {
      modalBody.innerHTML = `<img src="${file.previewUrl}" alt="${file.name}" />`;
    } else if (file.category === 'video') {
      modalBody.innerHTML = `
        <video controls autoplay style="width:100%; max-height:70vh; border-radius:8px;">
          <source src="${file.previewUrl}">
          Your browser does not support HTML5 video.
        </video>
      `;
    } else if (file.category === 'audio') {
      modalBody.innerHTML = `
        <div style="text-align:center; padding: 40px 20px;">
          <div style="font-size: 64px; margin-bottom: 20px;">🎵</div>
          <audio controls autoplay style="width: 100%; max-width: 480px;">
            <source src="${file.previewUrl}">
          </audio>
        </div>
      `;
    } else if (file.name.endsWith('.pdf')) {
      modalBody.innerHTML = `<iframe src="${file.previewUrl}" style="width:100%; height:70vh; border:none; border-radius:8px;"></iframe>`;
    } else {
      modalBody.innerHTML = `
        <div style="text-align:center; padding: 40px 20px; color: var(--text-secondary);">
          <div style="font-size: 64px; margin-bottom: 12px;">📄</div>
          <p style="font-size:16px; margin-bottom: 16px;">${file.name}</p>
          <p>Preview not available for this file type. You can open it in its default app.</p>
        </div>
      `;
    }

    if (systemInfo && systemInfo.isCloud) {
      modalOpenInAppBtn.style.display = 'none';
      modalRevealBtn.style.display = 'none';
    } else {
      modalOpenInAppBtn.style.display = 'inline-flex';
      modalRevealBtn.style.display = 'inline-flex';
    }

    modal.classList.add('active');
  }

  function closeModal() {
    modal.classList.remove('active');
    modalBody.innerHTML = '';
  }

  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  modalRevealBtn.addEventListener('click', () => {
    if (currentModalFile) revealInExplorer(currentModalFile.name);
  });

  modalOpenInAppBtn.addEventListener('click', () => {
    if (currentModalFile) openFileInApp(currentModalFile.name);
  });

  // Send File from PC to Mobile Phone
  async function sendFileToMobile(filename) {
    try {
      showToast(`Sending "${filename}" to mobile...`, '📱');
      const res = await fetch('/api/send-to-mobile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, roomId: currentRoomId })
      });
      const data = await res.json();
      if (data.success) {
        showToast(`Sent "${filename}" to mobile phone!`, '🎉');
      } else {
        showToast(`Failed to send to mobile`, '❌');
      }
    } catch (err) {
      console.error(err);
      showToast(`Network error sending to mobile`, '❌');
    }
  }

  // Windows Integration APIs
  async function revealInExplorer(filename) {
    try {
      await fetch('/api/reveal-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      showToast(`Showing "${filename}" in folder`, '📂');
    } catch (err) {
      console.error(err);
    }
  }

  async function openFileInApp(filename) {
    try {
      await fetch('/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename })
      });
      showToast(`Opening "${filename}"`, '🚀');
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteFile(filename) {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (res.ok) {
        allFiles = allFiles.filter(f => f.name !== filename);
        renderFiles();
        showToast(`Deleted ${filename}`, '🗑️');
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Auto-Save Toggle Setup
  const autoSaveBtn = document.getElementById('autoSaveToggle');
  const autoSaveText = document.getElementById('autoSaveText');
  const autoSaveIcon = document.getElementById('autoSaveIcon');

  function updateAutoSaveUi() {
    if (!autoSaveBtn) return;
    if (autoSaveToPc) {
      autoSaveBtn.style.background = 'rgba(16, 185, 129, 0.15)';
      autoSaveBtn.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      autoSaveBtn.style.color = '#34d399';
      if (autoSaveText) autoSaveText.textContent = 'Auto-Save: ON';
      if (autoSaveIcon) autoSaveIcon.textContent = '⚡';
    } else {
      autoSaveBtn.style.background = '#151a24';
      autoSaveBtn.style.borderColor = 'var(--border-subtle)';
      autoSaveBtn.style.color = '#94a3b8';
      if (autoSaveText) autoSaveText.textContent = 'Auto-Save: OFF';
      if (autoSaveIcon) autoSaveIcon.textContent = '⏸️';
    }
  }

  if (autoSaveBtn) {
    updateAutoSaveUi();
    autoSaveBtn.addEventListener('click', () => {
      autoSaveToPc = !autoSaveToPc;
      localStorage.setItem('vshare_auto_save', autoSaveToPc ? 'true' : 'false');
      updateAutoSaveUi();
      showToast(autoSaveToPc ? '⚡ Auto-Save enabled: Files automatically download to PC!' : '⏸️ Auto-Save paused: Click Download on files manually', autoSaveToPc ? '📥' : 'ℹ️');
    });
  }

  // Download All Files Button
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => {
      if (!allFiles || allFiles.length === 0) {
        showToast('No files received to download yet', 'ℹ️');
        return;
      }
      showToast(`Downloading ${allFiles.length} file(s) to PC Downloads...`, '📥');
      allFiles.forEach((file, index) => {
        setTimeout(() => {
          triggerBrowserDownload(file);
        }, index * 350);
      });
    });
  }

  // Open Folder Handler
  document.getElementById('openFolderBtn').addEventListener('click', async () => {
    if (systemInfo && systemInfo.isCloud) {
      showToast('📂 Cloud Mode: Incoming files are saved into your PC Downloads folder!', '📥');
      if (allFiles.length > 0) {
        triggerBrowserDownload(allFiles[0]);
      }
      return;
    }
    try {
      const res = await fetch('/api/open-folder', { method: 'POST' });
      const data = await res.json();
      if (data && data.success) {
        showToast('Opened Submitt folder in Explorer', '📂');
      } else {
        showToast('📂 Files are saved in your PC Downloads folder', '📥');
      }
    } catch (err) {
      showToast('📂 Files are saved in your PC Downloads folder', '📥');
    }
  });

  // --- PC Destination Save Location Setup & Onboarding ---
  const pathModal = document.getElementById('pathSetupModal');
  const folderSettingsBtn = document.getElementById('folderSettingsBtn');
  const closePathSetupBtn = document.getElementById('closePathSetupBtn');
  const cancelPathBtn = document.getElementById('cancelPathBtn');
  const savePathBtn = document.getElementById('savePathBtn');
  const customPathInput = document.getElementById('customPathInput');
  const saveLocationBtnText = document.getElementById('saveLocationBtnText');
  const presetButtons = document.querySelectorAll('.preset-path-btn');

  let pathConfig = null;

  async function loadPathSettings(checkFirstTime = false) {
    try {
      const res = await fetch('/api/settings/path');
      pathConfig = await res.json();

      if (customPathInput && pathConfig.currentPath) {
        customPathInput.value = pathConfig.currentPath;
      }

      if (saveLocationBtnText && pathConfig.currentPath) {
        const parts = pathConfig.currentPath.split(/[\\/]/).filter(Boolean);
        const folderName = parts.pop() || 'Submitt';
        saveLocationBtnText.textContent = `Save: ${folderName}`;
      }

      // If user hasn't configured their path yet, show onboarding modal!
      if (checkFirstTime && !pathConfig.isConfigured && !pathConfig.isCloud) {
        setTimeout(openPathModal, 600);
      }
    } catch (e) {
      console.warn('Path settings load notice:', e);
    }
  }

  function openPathModal() {
    if (!pathModal) return;
    pathModal.classList.add('active');
    if (customPathInput && pathConfig && pathConfig.currentPath) {
      customPathInput.value = pathConfig.currentPath;
    }
  }

  function closePathModal() {
    if (!pathModal) return;
    pathModal.classList.remove('active');
  }

  if (folderSettingsBtn) {
    folderSettingsBtn.addEventListener('click', openPathModal);
  }
  if (closePathSetupBtn) {
    closePathSetupBtn.addEventListener('click', closePathModal);
  }
  if (cancelPathBtn) {
    cancelPathBtn.addEventListener('click', closePathModal);
  }

  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.getAttribute('data-preset');
      if (pathConfig && pathConfig.presets && pathConfig.presets[presetKey]) {
        customPathInput.value = pathConfig.presets[presetKey];
        presetButtons.forEach(b => {
          b.style.borderColor = 'var(--border-subtle)';
          b.style.background = '#141a24';
          b.style.color = '#e2e8f0';
        });
        btn.style.borderColor = 'var(--accent-blue)';
        btn.style.background = 'rgba(37, 99, 235, 0.2)';
        btn.style.color = '#60a5fa';
      }
    });
  });

  if (savePathBtn) {
    savePathBtn.addEventListener('click', async () => {
      const chosenPath = (customPathInput.value || '').trim();
      if (!chosenPath) {
        showToast('Please specify a folder path', '⚠️');
        return;
      }
      savePathBtn.textContent = 'Saving...';
      try {
        const res = await fetch('/api/settings/path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ savePath: chosenPath })
        });
        const data = await res.json();
        if (data.success) {
          showToast(`📁 Save location set to: ${data.savePath}`, '✅');
          closePathModal();
          await loadPathSettings(false);
          await loadFiles();
        } else {
          showToast(`Failed: ${data.error}`, '❌');
        }
      } catch (err) {
        showToast('Error saving path: ' + err.message, '❌');
      } finally {
        savePathBtn.textContent = '💾 Confirm Save Path';
      }
    });
  }

  // Copy Mobile URL Button
  document.getElementById('copyUrlBtn').addEventListener('click', () => {
    const input = document.getElementById('mobileUrlInput');
    navigator.clipboard.writeText(input.value);
    showToast('Copied Mobile URL to clipboard!', '📋');
  });

  // PC File Drop Zone Upload
  const dropZone = document.getElementById('dropZone');
  const filePicker = document.getElementById('filePicker');

  dropZone.addEventListener('click', () => filePicker.click());

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  filePicker.addEventListener('change', () => {
    if (filePicker.files && filePicker.files.length > 0) {
      uploadFiles(filePicker.files);
      filePicker.value = '';
    }
  });

  // Upload Files Function
  function uploadFiles(files) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    const progressCard = document.getElementById('uploadProgressCard');
    const progressFill = document.getElementById('progressBarFill');
    const progressText = document.getElementById('uploadPercentText');
    const statusText = document.getElementById('uploadStatusText');

    progressCard.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    statusText.textContent = `Uploading ${files.length} file(s)...`;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?sender=pc&room=${encodeURIComponent(currentRoomId)}`, true);
    xhr.setRequestHeader('X-Sender', 'pc');
    xhr.setRequestHeader('X-Room-Id', currentRoomId);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
      }
    };

    xhr.onload = () => {
      progressCard.style.display = 'none';
      if (xhr.status === 200) {
        showToast('Sent to connected mobile phone(s)!', '📱');
        loadFiles();
      } else {
        showToast('Upload failed', '❌');
      }
    };

    xhr.onerror = () => {
      progressCard.style.display = 'none';
      showToast('Error uploading files', '❌');
    };

    xhr.send(formData);
  }

  // WebSocket Setup
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      console.log('Connected to DropFile WebSocket');
      ws.send(JSON.stringify({
        type: 'join_room',
        roomId: currentRoomId,
        role: 'pc'
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'room_status' || msg.type === 'room_joined') {
          const statusPill = document.getElementById('connectionStatus');
          const statusText = document.getElementById('statusText');
          if (statusPill && statusText) {
            if (msg.mobileCount > 0 || msg.isPaired) {
              statusPill.style.background = 'rgba(0, 242, 254, 0.12)';
              statusPill.style.borderColor = 'rgba(0, 242, 254, 0.3)';
              statusPill.style.color = '#00f2fe';
              statusText.textContent = '🟢 Paired with Mobile';
              showToast('Mobile phone paired with your PC room!', '📱');
            } else {
              statusText.textContent = `Room: ${currentRoomId} (Waiting)`;
            }
          }
        }

        if (msg.type === 'client_connected') {
          const statusPill = document.getElementById('connectionStatus');
          const statusText = document.getElementById('statusText');
          if (msg.isMobile && statusPill && statusText) {
            statusPill.style.background = 'rgba(0, 242, 254, 0.12)';
            statusPill.style.borderColor = 'rgba(0, 242, 254, 0.3)';
            statusPill.style.color = '#00f2fe';
            statusText.textContent = 'Connections: Mobile Active';
            showToast('Mobile phone connected!', '📱');
          }
        }

        if (msg.type === 'file_upload_start') {
          showToast(`Receiving: ${msg.name}...`, '📥');
        }

        if (msg.type === 'file_received') {
          playNotificationChime();
          showToast(`Received: ${msg.file.name}`, '🎉');
          allFiles.unshift(msg.file);
          renderFiles();

          // Save directly to chosen PC folder or browser Downloads folder
          if (chosenDirectoryHandle) {
            saveFileDirectlyToPcFolder(msg.file);
          } else if (autoSaveToPc && msg.file) {
            triggerBrowserDownload(msg.file);
          }
        }

        if (msg.type === 'file_deleted') {
          allFiles = allFiles.filter(f => f.name !== msg.name);
          renderFiles();
        }

        if (msg.type === 'path_updated') {
          loadPathSettings(false);
          loadFiles();
        }

        if (msg.type === 'clipboard_received') {
          playNotificationChime();
          showToast(`📋 Received from ${msg.from}: ${msg.text.substring(0, 30)}...`, '💬');
        }

      } catch (err) {
        console.error('WS message error:', err);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWebSocket, 3000);
    };
  }

  // --- PC Camera Tap Scanner Logic ---
  const scannerCard = document.getElementById('scannerCard');
  const toggleCameraScannerBtn = document.getElementById('toggleCameraScannerBtn');
  const closeScannerBtn = document.getElementById('closeScannerBtn');
  const scannerVideo = document.getElementById('scannerVideo');
  const scannerCanvas = document.getElementById('scannerCanvas');
  const scannerFeedback = document.getElementById('scannerFeedback');

  let cameraStream = null;
  let scanAnimationId = null;
  let isClaimingBeam = false;

  async function startCameraScanner() {
    scannerCard.style.display = 'block';
    scannerFeedback.textContent = 'Opening PC camera...';
    scannerFeedback.style.color = 'var(--accent-cyan)';

    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      scannerVideo.srcObject = cameraStream;
      await scannerVideo.play();
      scannerFeedback.textContent = '📷 Looking for mobile phone screen... Hold phone facing camera!';
      requestAnimationFrame(scanVideoFrame);
    } catch (err) {
      console.error('Camera access error:', err);
      scannerFeedback.textContent = '❌ Camera access denied or not available. Check browser permissions.';
      scannerFeedback.style.color = '#f87171';
    }
  }

  function stopCameraScanner() {
    if (scanAnimationId) {
      cancelAnimationFrame(scanAnimationId);
      scanAnimationId = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
    scannerCard.style.display = 'none';
  }

  function scanVideoFrame() {
    if (!cameraStream || scannerVideo.readyState !== scannerVideo.HAVE_ENOUGH_DATA) {
      scanAnimationId = requestAnimationFrame(scanVideoFrame);
      return;
    }

    const canvas = scannerCanvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = scannerVideo.videoWidth;
    canvas.height = scannerVideo.videoHeight;

    ctx.drawImage(scannerVideo, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (window.jsQR && !isClaimingBeam) {
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      });

      if (code && code.data && code.data.startsWith('BEAM-')) {
        handleBeamDetected(code.data);
        return;
      }
    }

    scanAnimationId = requestAnimationFrame(scanVideoFrame);
  }

  async function handleBeamDetected(token) {
    isClaimingBeam = true;
    playNotificationChime();
    scannerFeedback.innerHTML = '⚡ <b>BEAM DETECTED!</b> Receiving document into PC...';
    scannerFeedback.style.color = '#34d399';

    const reticle = document.querySelector('.scanner-reticle');
    if (reticle) reticle.style.borderColor = '#10b981';

    try {
      const res = await fetch('/api/claim-beam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const data = await res.json();

      if (data.success) {
        showToast(`🎉 Captured "${data.file.name}" via Camera Tap!`, '📷');
        setTimeout(() => {
          isClaimingBeam = false;
          if (reticle) reticle.style.borderColor = 'rgba(0, 242, 254, 0.8)';
          scannerFeedback.textContent = '📷 Looking for next mobile phone screen...';
          scannerFeedback.style.color = 'var(--accent-cyan)';
          scanAnimationId = requestAnimationFrame(scanVideoFrame);
        }, 2000);
      } else {
        isClaimingBeam = false;
        scannerFeedback.textContent = '⚠️ Beam code expired. Try again.';
        scanAnimationId = requestAnimationFrame(scanVideoFrame);
      }
    } catch (err) {
      console.error('Error claiming beam:', err);
      isClaimingBeam = false;
      scanAnimationId = requestAnimationFrame(scanVideoFrame);
    }
  }

  toggleCameraScannerBtn.addEventListener('click', () => {
    if (scannerCard.style.display === 'block') {
      stopCameraScanner();
    } else {
      startCameraScanner();
    }
  });

  closeScannerBtn.addEventListener('click', stopCameraScanner);

  // Initial Boot
  loadSystemInfo();
  loadFiles();
  loadPathSettings(true);
  connectWebSocket();
});
