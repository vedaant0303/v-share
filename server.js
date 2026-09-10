const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const busboy = require('busboy');
const qrcode = require('qrcode');
const { exec, spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 4000;

// Persistent User Configuration (User-selected PC destination path)
const CONFIG_FILE = path.join(__dirname, 'vshare_config.json');
let userConfig = {
  savePath: '',
  isConfigured: false
};

try {
  if (fs.existsSync(CONFIG_FILE)) {
    userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  }
} catch (e) {
  console.warn('Config notice:', e.message);
}

const defaultUploadDir = process.env.RENDER
  ? path.join(__dirname, 'uploads')
  : path.join(os.homedir(), 'Downloads', 'Submitt');

let UPLOAD_DIR = (userConfig.savePath && fs.existsSync(userConfig.savePath))
  ? userConfig.savePath
  : (process.env.UPLOAD_DIR || defaultUploadDir);

// Helper for standard OS preset directories
function getPresetPaths() {
  const home = os.homedir();
  return {
    submitt: path.join(home, 'Downloads', 'Submitt'),
    downloads: path.join(home, 'Downloads'),
    desktop: path.join(home, 'Desktop')
  };
}

// Native Windows Notification Helper
function showWindowsNotification(title, message) {
  if (process.platform !== 'win32') return;
  const script = path.join(__dirname, 'notify.ps1');
  if (fs.existsSync(script)) {
    const cleanTitle = (title || 'V-Share').replace(/["`$]/g, '');
    const cleanMsg = (message || '').replace(/["`$]/g, '');
    exec(`powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}" -title "${cleanTitle}" -message "${cleanMsg}"`, () => {});
  }
}

// Ensure upload directory exists
try {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('Directory create notice:', e.message);
}

// Temporary store for Camera Beam transfers
const stagedBeams = new Map();

// CORS & Private Network Access (enables HTTPS web apps and remote browsers to communicate with local Windows PC)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-room-id, x-sender');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Parse JSON and urlencoded for text messages
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Explicit Favicon route
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'));
});

// Ping / Health check endpoint for 24/7 Uptime monitoring & Keep-Alive (cron-job.org, UptimeRobot, etc.)
app.get(['/api/ping', '/ping', '/healthz'], (req, res) => {
  res.status(200).json({ status: 'alive', time: Date.now(), uptime: Math.floor(process.uptime()) });
});
app.head(['/api/ping', '/ping', '/healthz', '/'], (req, res) => {
  res.status(200).end();
});

// Remote Desktop / OS Sharing Status API
app.get('/api/remote/status', (req, res) => {
  res.json({
    supported: process.platform === 'win32',
    ready: !!remoteInputProcess,
    screenWidth,
    screenHeight
  });
});

// Direct Native Remote Input API (called from PC browser or WebRTC DataChannel bridge)
app.post('/api/remote-input', (req, res) => {
  try {
    const payload = req.body;
    if (payload && payload.action) {
      handleRemoteInputEvent(payload);
      return res.json({ success: true, action: payload.action });
    }
    res.status(400).json({ error: 'Missing action in remote_input' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync Cloud Bridge with PC browser active room
let activeCloudRoomId = null;
app.post('/api/sync-cloud-room', (req, res) => {
  const roomId = req.body && req.body.roomId ? String(req.body.roomId).trim() : null;
  if (roomId) {
    activeCloudRoomId = roomId;
    if (activeCloudBridgeWs && activeCloudBridgeWs.readyState === WebSocket.OPEN) {
      activeCloudBridgeWs.send(JSON.stringify({
        type: 'join_room',
        roomId: roomId,
        role: 'pc'
      }));
      console.log(`🔗 [Cloud Bridge] Dynamically synced and joined room ${roomId}`);
    }
  }
  res.json({ success: true, roomId: activeCloudRoomId });
});

// Store connected clients for WebSocket
const clients = new Set();

// In-Memory Private Room Pairing (Zero Database, 100% Private Peer-to-Peer)
const rooms = new Map(); // roomId -> { pcClients: Set(), mobileClients: Set(), createdAt: Date.now() }

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      pcClients: new Set(),
      mobileClients: new Set(),
      createdAt: Date.now()
    });
  }
  return rooms.get(roomId);
}

function broadcastToRoom(roomId, data, excludeWs = null) {
  if (!roomId || !rooms.has(roomId)) return;
  const room = rooms.get(roomId);
  const payload = JSON.stringify(data);
  const targets = new Set([...room.pcClients, ...room.mobileClients]);
  for (const client of targets) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function broadcastToPc(roomId, data, excludeWs = null) {
  const payload = JSON.stringify(data);
  let sent = false;
  if (roomId && rooms.has(roomId)) {
    const room = rooms.get(roomId);
    for (const pc of room.pcClients) {
      if (pc !== excludeWs && pc.readyState === WebSocket.OPEN) {
        pc.send(payload);
        sent = true;
      }
    }
  }
  // Fallback: If room had no connected PC, broadcast to any active PC client or Cloud Bridge
  if (!sent) {
    for (const client of clients) {
      if (client !== excludeWs && (client.role === 'pc' || client.isPcClient) && client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent = true;
      }
    }
  }
  // Also pass to Cloud Bridge if active locally
  if (activeCloudBridgeWs && activeCloudBridgeWs.readyState === WebSocket.OPEN && activeCloudBridgeWs !== excludeWs) {
    activeCloudBridgeWs.send(payload);
  }
}

function broadcastToMobile(roomId, data, excludeWs = null) {
  const payload = JSON.stringify(data);
  let sent = false;
  if (roomId && rooms.has(roomId)) {
    const room = rooms.get(roomId);
    for (const mob of room.mobileClients) {
      if (mob !== excludeWs && mob.readyState === WebSocket.OPEN) {
        mob.send(payload);
        sent = true;
      }
    }
  }
  // Fallback: If room had no connected mobile, broadcast to any active mobile client
  if (!sent) {
    for (const client of clients) {
      if (client !== excludeWs && (client.role === 'mobile' || client.isMobileClient) && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}

// Native Screen Frame Streaming API from Android App (raw binary JPEG)
app.post('/api/phone-screen-frame', express.raw({ type: '*/*', limit: '10mb' }), (req, res) => {
  const roomId = req.headers['x-room-id'];
  if (req.body && Buffer.isBuffer(req.body) && req.body.length > 0) {
    let sent = false;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      for (const pc of room.pcClients) {
        // Zero-Lag Guarantee: only push if client buffer is low (< 64KB)
        if (pc.readyState === WebSocket.OPEN && pc.bufferedAmount < 64 * 1024) {
          pc.send(req.body);
          sent = true;
        }
      }
    }
    // Fallback: if no PC in that specific room yet, broadcast to any connected PC
    if (!sent) {
      for (const client of clients) {
        if ((client.role === 'pc' || client.isPcClient || client.isLocalHost) && client.readyState === WebSocket.OPEN && client.bufferedAmount < 64 * 1024) {
          client.send(req.body);
          sent = true;
        }
      }
    }
  }
  res.status(200).send('OK');
});

// Stop Screen Share notification from Android Service
app.post('/api/phone-screen-stop', express.json(), (req, res) => {
  const roomId = req.headers['x-room-id'] || (req.body && req.body.roomId);
  if (roomId) {
    broadcastToPc(roomId, { type: 'phone_screen_stop', role: 'phone', roomId });
  } else {
    broadcast({ type: 'phone_screen_stop', role: 'phone' });
  }
  res.status(200).send('OK');
});

// Active Cloud Bridge WebSocket instance
let activeCloudBridgeWs = null;

// Native Windows Remote Input Controller (Remote Desktop)
let remoteInputProcess = null;
let screenWidth = 1920;
let screenHeight = 1080;

function initRemoteInputBridge() {
  if (process.platform !== 'win32') return;

  // Try LocalAppData first (avoids OneDrive locking), then fallback to bin/
  const localAppDataDir = path.join(process.env.LOCALAPPDATA || '', 'V-Share');
  const localExePath = path.join(localAppDataDir, 'VRemoteInput.exe');
  const binExePath = path.join(__dirname, 'bin', 'VRemoteInput.exe');
  const csSourcePath = path.join(__dirname, 'bin', 'VRemoteInput.cs');

  let binPath = null;
  if (fs.existsSync(binExePath)) {
    try {
      if (!fs.existsSync(localAppDataDir)) fs.mkdirSync(localAppDataDir, { recursive: true });
      fs.copyFileSync(binExePath, localExePath);
      binPath = localExePath;
    } catch (e) {
      binPath = binExePath; // fallback directly to workspace binary
    }
  } else if (fs.existsSync(localExePath)) {
    binPath = localExePath;
  } else if (fs.existsSync(csSourcePath)) {
    // Auto-compile from source
    console.log('[RemoteInput] Compiling VRemoteInput.cs...');
    try {
      if (!fs.existsSync(localAppDataDir)) fs.mkdirSync(localAppDataDir, { recursive: true });
      const { execSync } = require('child_process');
      execSync(`C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe /nologo /optimize /target:exe /out:"${localExePath}" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll "${csSourcePath}"`, { timeout: 30000 });
      if (fs.existsSync(localExePath)) {
        binPath = localExePath;
        console.log('[RemoteInput] Compiled VRemoteInput.exe successfully!');
      }
    } catch (e) {
      console.warn('[RemoteInput] Failed to compile VRemoteInput.cs:', e.message);
    }
  }

  if (!binPath) {
    console.warn('[RemoteInput] VRemoteInput.exe not found and could not be compiled.');
    return;
  }

  try {
    console.log(`[RemoteInput] Starting VRemoteInput from: ${binPath}`);
    remoteInputProcess = spawn(binPath, [], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutBuffer = '';
    remoteInputProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      let newlineIdx;
      while ((newlineIdx = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.substring(0, newlineIdx).trim();
        stdoutBuffer = stdoutBuffer.substring(newlineIdx + 1);

        if (!line) continue;

        if (line.startsWith('FRAME ')) {
          const b64 = line.substring(6);
          const frameMsg = {
            type: 'remote_frame',
            roomId: activeRemoteRoomId,
            frame: b64,
            data: b64,
            w: screenWidth,
            h: screenHeight
          };
          if (activeRemoteRoomId && rooms.has(activeRemoteRoomId)) {
            broadcastToRoom(activeRemoteRoomId, frameMsg);
          } else {
            broadcast(frameMsg);
          }
          if (activeCloudBridgeWs && activeCloudBridgeWs.readyState === WebSocket.OPEN) {
            activeCloudBridgeWs.send(JSON.stringify(frameMsg));
          }
        } else if (line.startsWith('SCREEN ')) {
          const parts = line.split(' ');
          if (parts.length >= 3) {
            screenWidth = parseInt(parts[1], 10) || 1920;
            screenHeight = parseInt(parts[2], 10) || 1080;
            console.log(`🖥️ [RemoteInput] PC Screen Resolution: ${screenWidth}x${screenHeight}`);
          }
        } else if (line.startsWith('CAPTURE-')) {
          console.log(`🖥️ [RemoteInput] ${line}`);
        } else if (line === 'V-REMOTE-READY') {
          console.log('✅ [RemoteInput] VRemoteInput.exe ready and accepting commands.');
        } else if (line.startsWith('ERR:')) {
          console.warn(`⚠️ [RemoteInput] ${line}`);
        }
      }
    });

    remoteInputProcess.stderr.on('data', (data) => {
      console.warn('[RemoteInput] stderr:', data.toString().trim());
    });

    remoteInputProcess.on('error', (err) => {
      console.warn('[RemoteInput] Process error:', err.message);
      remoteInputProcess = null;
    });

    remoteInputProcess.on('exit', (code) => {
      console.log(`[RemoteInput] VRemoteInput.exe exited with code ${code}`);
      remoteInputProcess = null;
    });

    // Query screen resolution
    remoteInputProcess.stdin.write('screen\n');
  } catch (err) {
    console.warn('[RemoteInput] Failed to start VRemoteInput:', err.message);
  }
}


let activeRemoteRoomId = null;

function startUnattendedCapture(roomId = null) {
  if (roomId) activeRemoteRoomId = roomId;
  if (!remoteInputProcess || !remoteInputProcess.stdin || remoteInputProcess.stdin.destroyed) {
    initRemoteInputBridge();
  }
  if (remoteInputProcess && remoteInputProcess.stdin) {
    console.log('🖥️ [RemoteInput] Starting unattended background desktop screen capture (10 FPS, 35 Quality)...');
    remoteInputProcess.stdin.write('capture start 10 35\n');
  }
}

function stopUnattendedCapture() {
  if (remoteInputProcess && remoteInputProcess.stdin && !remoteInputProcess.stdin.destroyed) {
    console.log('🖥️ [RemoteInput] Stopping unattended background desktop screen capture...');
    remoteInputProcess.stdin.write('capture stop\n');
  }
}

function handleRemoteInputEvent(event) {
  if (!event || !event.action) return;
  if (!remoteInputProcess || !remoteInputProcess.stdin || remoteInputProcess.stdin.destroyed) {
    initRemoteInputBridge();
  }
  if (!remoteInputProcess || !remoteInputProcess.stdin) return;

  try {
    const action = event.action;
    let px = null;
    let py = null;

    if (typeof event.x === 'number' && typeof event.y === 'number') {
      px = Math.min(Math.max(Math.round(event.x * screenWidth), 0), screenWidth - 1);
      py = Math.min(Math.max(Math.round(event.y * screenHeight), 0), screenHeight - 1);
    }

    console.log(`👆 [RemoteInput] Action: ${action}, Pos: (${px}, ${py}), Button: ${event.button || 'default'}`);

    if (action === 'move' && px !== null && py !== null) {
      remoteInputProcess.stdin.write(`move ${px} ${py}\n`);
    } else if (action === 'click') {
      const btn = event.button || 'left';
      if (px !== null && py !== null) {
        remoteInputProcess.stdin.write(`click ${btn} ${px} ${py}\n`);
      } else {
        remoteInputProcess.stdin.write(`click ${btn}\n`);
      }
    } else if (action === 'down') {
      const btn = event.button || 'left';
      if (px !== null && py !== null) {
        remoteInputProcess.stdin.write(`down ${btn} ${px} ${py}\n`);
      } else {
        remoteInputProcess.stdin.write(`down ${btn}\n`);
      }
    } else if (action === 'up') {
      const btn = event.button || 'left';
      if (px !== null && py !== null) {
        remoteInputProcess.stdin.write(`up ${btn} ${px} ${py}\n`);
      } else {
        remoteInputProcess.stdin.write(`up ${btn}\n`);
      }
    } else if (action === 'scroll' && typeof event.delta === 'number') {
      remoteInputProcess.stdin.write(`scroll ${Math.round(event.delta)}\n`);
    } else if (action === 'key' && event.key) {
      remoteInputProcess.stdin.write(`key ${event.key}\n`);
    } else if (action === 'text' && event.text) {
      const safeText = String(event.text).replace(/([+^%~{}()[\]])/g, '{$1}');
      remoteInputProcess.stdin.write(`key ${safeText}\n`);
    } else if (action === 'shortcut' && event.shortcut) {
      remoteInputProcess.stdin.write(`shortcut ${event.shortcut}\n`);
    }
  } catch (e) {
    console.warn('[RemoteInput] Error executing action:', e.message);
  }
}

// Start remote input bridge on Windows
initRemoteInputBridge();


wss.on('connection', (ws, req) => {
  clients.add(ws);
  const userAgent = req.headers['user-agent'] || '';
  const isMobile = /mobile|iphone|android|ipad/i.test(userAgent);
  ws.isMobileClient = isMobile;
  ws.isPcClient = !isMobile;
  ws.role = isMobile ? 'mobile' : 'pc';
  
  console.log(`[WS] ${isMobile ? '📱 Mobile Phone' : '💻 PC'} connected (Total: ${clients.size})`);

  ws.on('message', (message) => {
    // 1. High-Performance Screen Streaming (Binary Frames over WebSocket)
    if (Buffer.isBuffer(message)) {
      let sent = false;
      if (ws.roomId && rooms.has(ws.roomId)) {
        const room = rooms.get(ws.roomId);
        for (const pc of room.pcClients) {
          if (pc.readyState === WebSocket.OPEN && pc.bufferedAmount < 64 * 1024) {
            pc.send(message);
            sent = true;
          }
        }
      }
      if (!sent) {
        for (const client of clients) {
          if (client !== ws && (client.role === 'pc' || client.isPcClient || client.isLocalHost) && client.readyState === WebSocket.OPEN && client.bufferedAmount < 64 * 1024) {
            client.send(message);
            sent = true;
          }
        }
      }
      return;
    }

    try {
      const data = JSON.parse(message);

      // Private Room Pairing System
      if (data.type === 'join_room' && data.roomId) {
        const roomId = String(data.roomId).trim();
        const role = data.role || (isMobile ? 'mobile' : 'pc');
        
        // Remove from old room if switched
        if (ws.roomId && ws.roomId !== roomId && rooms.has(ws.roomId)) {
          const oldRoom = rooms.get(ws.roomId);
          oldRoom.pcClients.delete(ws);
          oldRoom.mobileClients.delete(ws);
        }

        ws.roomId = roomId;
        ws.role = role;
        ws.isPcClient = (role === 'pc');
        ws.isMobileClient = (role === 'mobile');
        const room = getOrCreateRoom(roomId);

        if (role === 'pc') {
          room.pcClients.add(ws);
        } else {
          room.mobileClients.add(ws);
        }

        console.log(`[Room ${roomId}] ${role === 'mobile' ? '📱 Mobile' : '💻 PC'} paired (PC: ${room.pcClients.size}, Mobile: ${room.mobileClients.size})`);

        // Detect local network IP for superfast Wi-Fi streaming
        const interfaces = getNetworkAddresses();
        const localIp = interfaces.length > 0 ? interfaces[0].address : null;
        const localUrl = localIp ? `http://${localIp}:${PORT}` : null;

        // Notify both devices in the private room
        broadcastToRoom(roomId, {
          type: 'room_status',
          roomId,
          role,
          pcCount: room.pcClients.size,
          mobileCount: room.mobileClients.size,
          isPaired: room.pcClients.size > 0 && room.mobileClients.size > 0,
          localIp,
          localPort: PORT,
          localUrl,
          timestamp: Date.now()
        });

        // Send direct confirmation
        ws.send(JSON.stringify({
          type: 'room_joined',
          roomId,
          role,
          pcCount: room.pcClients.size,
          mobileCount: room.mobileClients.size,
          isPaired: room.pcClients.size > 0 && room.mobileClients.size > 0,
          localIp,
          localPort: PORT,
          localUrl
        }));
        return;
      }

      if (data.type === 'clipboard_share') {
        if (ws.roomId) {
          broadcastToRoom(ws.roomId, {
            type: 'clipboard_received',
            text: data.text,
            from: isMobile ? 'Mobile' : 'PC',
            roomId: ws.roomId,
            timestamp: Date.now()
          }, ws);
        } else {
          // Broadcast clipboard text to all other clients
          broadcast({
            type: 'clipboard_received',
            text: data.text,
            from: isMobile ? 'Mobile' : 'PC',
            timestamp: Date.now()
          });
        }
      }

      // Remote Desktop / OS Sharing Handlers (Unattended + WebRTC)
      if (data.type === 'unattended_remote_start') {
        const targetRoom = data.roomId || ws.roomId;
        startUnattendedCapture(targetRoom);
        broadcastToPc(targetRoom, data, ws);
        return;
      }

      if (data.type === 'unattended_remote_stop') {
        stopUnattendedCapture();
        const targetRoom = data.roomId || ws.roomId;
        broadcastToPc(targetRoom, data, ws);
        return;
      }

      if (data.type === 'remote_frame') {
        const targetRoom = data.roomId || ws.roomId;
        broadcastToMobile(targetRoom, data, ws);
        return;
      }

      if (data.type === 'remote_input') {
        handleRemoteInputEvent(data);
        const targetRoom = data.roomId || ws.roomId;
        broadcastToPc(targetRoom, data, ws);
        return;
      }

      if (data.type === 'remote_start_request') {
        const targetRoom = data.roomId || ws.roomId;
        broadcastToPc(targetRoom, data, ws);

        if (process.platform === 'win32') {
          showWindowsNotification('📱 Remote Control Requested', 'Click Share Screen in your browser (http://localhost:' + PORT + ') to view & control PC.');
          let hasActivePc = false;
          if (targetRoom && rooms.has(targetRoom)) {
            const room = rooms.get(targetRoom);
            if (room.pcClients && room.pcClients.some(c => c.readyState === WebSocket.OPEN)) {
              hasActivePc = true;
            }
          }
          if (!hasActivePc) {
            exec(`powershell -WindowStyle Hidden -Command "Start-Process 'http://localhost:${PORT}'"`, () => {});
          }
        }
        return;
      }

      if (data.type === 'remote_stop') {
        const targetRoom = data.roomId || ws.roomId;
        broadcastToPc(targetRoom, data, ws);
        broadcastToMobile(targetRoom, data, ws);
        return;
      }

      if (data.type === 'webrtc_offer') {
        const targetRoom = data.roomId || ws.roomId;
        broadcastToMobile(targetRoom, data, ws);
        return;
      }

      if (data.type === 'webrtc_answer') {
        const targetRoom = data.roomId || ws.roomId;
        broadcastToPc(targetRoom, data, ws);
        return;
      }

      if (data.type === 'webrtc_ice_candidate') {
        const targetRoom = data.roomId || ws.roomId;
        if (data.role === 'pc') {
          broadcastToMobile(targetRoom, data, ws);
        } else {
          broadcastToPc(targetRoom, data, ws);
        }
        return;
      }

      // Phone-to-PC Screen Mirroring Signaling
      if (data.type === 'phone_screen_offer') {
        const targetRoom = data.roomId || ws.roomId;
        broadcastToPc(targetRoom, data, ws);
        return;
      }

      if (data.type === 'phone_screen_answer') {
        const targetRoom = data.roomId || ws.roomId;
        broadcastToMobile(targetRoom, data, ws);
        return;
      }

      if (data.type === 'phone_screen_ice_candidate') {
        const targetRoom = data.roomId || ws.roomId;
        if (data.role === 'phone' || data.role === 'mobile') {
          broadcastToPc(targetRoom, data, ws);
        } else {
          broadcastToMobile(targetRoom, data, ws);
        }
        return;
      }

      if (data.type === 'phone_screen_stop') {
        const targetRoom = data.roomId || ws.roomId;
        if (data.role === 'pc') {
          broadcastToMobile(targetRoom, data, ws);
        } else {
          broadcastToPc(targetRoom, data, ws);
        }
        return;
      }
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);

    if (ws.roomId && rooms.has(ws.roomId)) {
      const room = rooms.get(ws.roomId);
      room.pcClients.delete(ws);
      room.mobileClients.delete(ws);
      if (room.pcClients.size === 0 && room.mobileClients.size === 0) {
        rooms.delete(ws.roomId);
      } else {
        broadcastToRoom(ws.roomId, {
          type: 'room_status',
          roomId: ws.roomId,
          pcCount: room.pcClients.size,
          mobileCount: room.mobileClients.size,
          isPaired: room.pcClients.size > 0 && room.mobileClients.size > 0,
          timestamp: Date.now()
        });
      }
    }

    broadcast({
      type: 'client_disconnected',
      clientCount: clients.size,
      timestamp: Date.now()
    });
  });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Helper: Get local network IP addresses
function getNetworkAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // IPv4 and non-internal only
      if (net.family === 'IPv4' && !net.internal) {
        const isPriority = /wi-fi|wlan|wireless|ethernet/i.test(name) && !/vgate|vbox|vmware|wsl|hyper-v|loopback/i.test(name);
        addresses.push({
          interface: name,
          address: net.address,
          priority: isPriority ? 1 : 2
        });
      }
    }
  }

  // Sort prioritizing standard Wi-Fi and Ethernet
  addresses.sort((a, b) => a.priority - b.priority);
  return addresses;
}

// Get unique filename to avoid overwrites and guarantee proper extension
function getUniqueFilename(directory, originalName, mimeType = '') {
  let safeName = path.basename(originalName || 'file');
  let ext = path.extname(safeName);

  // If extension is missing (e.g. UUID from Drive cache), infer from mimeType
  if (!ext && mimeType) {
    if (mimeType.includes('pdf')) ext = '.pdf';
    else if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = '.jpg';
    else if (mimeType.includes('png')) ext = '.png';
    else if (mimeType.includes('webp')) ext = '.webp';
    else if (mimeType.includes('mp4')) ext = '.mp4';
    else if (mimeType.includes('quicktime') || mimeType.includes('mov')) ext = '.mov';
    else if (mimeType.includes('plain') || mimeType.includes('text')) ext = '.txt';
    else if (mimeType.includes('zip')) ext = '.zip';
    safeName += ext;
  }

  const baseName = path.basename(safeName, ext);
  let fileName = safeName;
  let counter = 1;

  while (fs.existsSync(path.join(directory, fileName))) {
    fileName = `${baseName} (${counter})${ext}`;
    counter++;
  }
  return fileName;
}

// Cloudflare Tunnel Management
let activeTunnelUrl = null;
let tunnelProcess = null;

function startCloudflareTunnel(callback) {
  if (activeTunnelUrl) {
    if (callback) callback(null, activeTunnelUrl);
    return;
  }

  const binPath = path.join(__dirname, 'cloudflared.exe');
  if (!fs.existsSync(binPath)) {
    console.log('ℹ️ cloudflared.exe not found. Public tunnel disabled.');
    if (callback) callback(new Error('cloudflared.exe not found'));
    return;
  }

  console.log('🌐 Starting Cloudflare Public Tunnel...');
  tunnelProcess = spawn(binPath, ['tunnel', '--url', `http://localhost:${PORT}`]);

  let resolved = false;

  tunnelProcess.stderr.on('data', (data) => {
    const line = data.toString();
    const match = line.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !activeTunnelUrl) {
      activeTunnelUrl = match[0];
      console.log('====================================================');
      console.log('🎉 CLOUDFLARE PUBLIC TUNNEL ACTIVE!');
      console.log(`🌍 Public HTTPS URL:  ${activeTunnelUrl}/mobile`);
      console.log('   (Accessible from ANY mobile network, 4G/5G, anywhere!)');
      console.log('====================================================');
      broadcast({
        type: 'tunnel_status',
        active: true,
        url: activeTunnelUrl
      });
      if (callback && !resolved) {
        resolved = true;
        callback(null, activeTunnelUrl);
      }
    }
  });

  tunnelProcess.on('exit', () => {
    activeTunnelUrl = null;
    broadcast({
      type: 'tunnel_status',
      active: false,
      url: null
    });
  });
}

function stopCloudflareTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch (e) {}
    tunnelProcess = null;
  }
  activeTunnelUrl = null;
  broadcast({
    type: 'tunnel_status',
    active: false,
    url: null
  });
}

// Auto-start tunnel if specified
if (process.argv.includes('--tunnel') || process.env.ENABLE_TUNNEL === 'true') {
  startCloudflareTunnel();
}

// Helper: Generate deterministic 6-digit room code for client's network/Wi-Fi
function getNetworkRoomCode(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = forwarded ? forwarded.split(',')[0].trim() : (req.socket.remoteAddress || '127.0.0.1');
  const ip = rawIp.replace(/^.*:/, ''); // Normalize IPv6 mapped IPv4 like ::ffff:192.168.0.1
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash) + ip.charCodeAt(i);
    hash |= 0;
  }
  const code = (Math.abs(hash) % 900000) + 100000;
  return String(code);
}

// API: System Info, Network IPs, & QR Code
app.get('/api/info', async (req, res) => {
  try {
    const interfaces = getNetworkAddresses();
    let mobileUrl;
    const selectedIp = req.query.ip;
    const networkRoomCode = getNetworkRoomCode(req);

    const renderUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
    if (renderUrl) {
      interfaces.unshift({
        interface: '☁️ Render Cloud (Global 24/7)',
        address: renderUrl,
        isTunnel: true,
        priority: -1
      });
    }

    if (activeTunnelUrl) {
      interfaces.unshift({
        interface: '🌐 Cloudflare Public (Anywhere)',
        address: activeTunnelUrl,
        isTunnel: true,
        priority: 0
      });
    }

    if (selectedIp) {
      if (selectedIp.startsWith('http')) {
        mobileUrl = `${selectedIp}/mobile`;
      } else {
        mobileUrl = `http://${selectedIp}:${PORT}/mobile`;
      }
    } else if (renderUrl) {
      mobileUrl = `${renderUrl}/mobile`;
    } else if (activeTunnelUrl) {
      mobileUrl = `${activeTunnelUrl}/mobile`;
    } else {
      const primaryIp = interfaces.length > 0 ? interfaces[0].address : 'localhost';
      mobileUrl = `http://${primaryIp}:${PORT}/mobile`;
    }

    const roomId = req.query.room ? String(req.query.room).trim() : networkRoomCode;
    if (roomId) {
      mobileUrl += (mobileUrl.includes('?') ? '&' : '?') + `room=${encodeURIComponent(roomId)}`;
    }

    const qrDataUrl = await qrcode.toDataURL(mobileUrl, {
      margin: 1,
      width: 280,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.json({
      port: PORT,
      primaryIp: interfaces.length > 0 ? interfaces[0].address : 'localhost',
      mobileUrl,
      qrDataUrl,
      roomId,
      networkRoomCode,
      interfaces,
      tunnelActive: !!activeTunnelUrl,
      tunnelUrl: activeTunnelUrl,
      uploadDirectory: UPLOAD_DIR,
      isCloud: !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL),
      connectedClients: clients.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings: Get destination path configuration
app.get('/api/settings/path', (req, res) => {
  res.json({
    currentPath: UPLOAD_DIR,
    isConfigured: !!userConfig.isConfigured,
    presets: getPresetPaths(),
    isCloud: !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL)
  });
});

// Settings: Update destination path on PC
app.post('/api/settings/path', (req, res) => {
  let targetPath = (req.body.savePath || '').trim();
  if (!targetPath) {
    targetPath = path.join(os.homedir(), 'Downloads', 'Submitt');
  }

  try {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    UPLOAD_DIR = targetPath;
    userConfig.savePath = targetPath;
    userConfig.isConfigured = true;

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(userConfig, null, 2), 'utf8');

    console.log(`📂 Destination path updated to: ${UPLOAD_DIR}`);

    // Broadcast update to all connected clients
    broadcast({
      type: 'path_updated',
      newPath: UPLOAD_DIR
    });

    res.json({ success: true, savePath: UPLOAD_DIR });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Tunnel API endpoints
app.post('/api/tunnel/start', (req, res) => {
  startCloudflareTunnel((err, url) => {
    if (err) {
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      return;
    }
    if (!res.headersSent) res.json({ success: true, url });
  });

  setTimeout(() => {
    if (!res.headersSent) {
      res.json({ success: true, pending: true, url: activeTunnelUrl });
    }
  }, 4000);
});

app.post('/api/tunnel/stop', (req, res) => {
  stopCloudflareTunnel();
  res.json({ success: true, active: false });
});

app.get('/api/tunnel/status', (req, res) => {
  res.json({
    active: !!activeTunnelUrl,
    url: activeTunnelUrl
  });
});

// Mobile interface direct route
app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

// API: List received files
app.get('/api/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR);
    const fileList = files
      .filter(f => !f.startsWith('.'))
      .map(file => {
        const filePath = path.join(UPLOAD_DIR, file);
        const stats = fs.statSync(filePath);
        const ext = path.extname(file).toLowerCase();
        let category = 'other';

        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'].includes(ext)) {
          category = 'image';
        } else if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.3gp'].includes(ext)) {
          category = 'video';
        } else if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) {
          category = 'audio';
        } else if (['.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx', '.pptx', '.json', '.md'].includes(ext)) {
          category = 'document';
        } else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
          category = 'archive';
        } else if (['.apk'].includes(ext)) {
          category = 'apk';
        }

        return {
          name: file,
          size: stats.size,
          modified: stats.mtimeMs,
          category,
          downloadUrl: `/download/${encodeURIComponent(file)}`,
          previewUrl: `/preview/${encodeURIComponent(file)}`
        };
      })
      .sort((a, b) => b.modified - a.modified);

    res.json({ files: fileList, count: fileList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Stream upload via busboy (zero-memory exhaustion for multi-GB 4K videos)
app.post('/api/upload', (req, res) => {
  const bb = busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 * 1024 } }); // 50GB limit
  const uploadedFiles = [];
  let fileWritePromises = [];
  const sender = (req.query.sender || req.headers['x-sender'] || 'mobile').toLowerCase();
  const roomId = req.query.room || req.headers['x-room-id'] || req.query.roomId;

  bb.on('file', (name, fileStream, info) => {
    const { filename, encoding, mimeType } = info;
    if (!filename) {
      fileStream.resume();
      return;
    }

    const safeName = path.basename(filename);
    const uniqueName = getUniqueFilename(UPLOAD_DIR, safeName, mimeType);
    const savePath = path.join(UPLOAD_DIR, uniqueName);
    const writeStream = fs.createWriteStream(savePath);

    let bytesReceived = 0;

    // Broadcast upload start to room or globally
    const uploadStartEvent = {
      type: 'file_upload_start',
      name: uniqueName,
      mimeType,
      sender: sender === 'pc' ? 'PC' : 'Mobile',
      roomId: roomId || null,
      timestamp: Date.now()
    };

    if (roomId && rooms.has(roomId)) {
      broadcastToRoom(roomId, uploadStartEvent);
    } else {
      broadcast(uploadStartEvent);
    }

    fileStream.on('data', (data) => {
      bytesReceived += data.length;
    });

    fileStream.pipe(writeStream);

    const promise = new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        const stats = fs.statSync(savePath);
        const ext = path.extname(uniqueName).toLowerCase();
        let category = 'other';
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'].includes(ext)) category = 'image';
        else if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.3gp'].includes(ext)) category = 'video';
        else if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) category = 'audio';
        else if (['.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx', '.pptx', '.json', '.md'].includes(ext)) category = 'document';
        else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) category = 'archive';
        else if (['.apk'].includes(ext)) category = 'apk';

        const fileRecord = {
          name: uniqueName,
          size: stats.size,
          modified: stats.mtimeMs,
          category,
          downloadUrl: `/download/${encodeURIComponent(uniqueName)}`,
          previewUrl: `/preview/${encodeURIComponent(uniqueName)}`
        };

        uploadedFiles.push(fileRecord);

        // Notify paired devices in this room (or globally if no room)
        const fileReceivedEvent = {
          type: 'file_received',
          file: fileRecord,
          sender: sender === 'pc' ? 'PC' : 'Mobile',
          roomId: roomId || null,
          timestamp: Date.now()
        };

        if (roomId && rooms.has(roomId)) {
          broadcastToRoom(roomId, fileReceivedEvent);
        } else {
          broadcast(fileReceivedEvent);
        }

        // If uploaded from PC, explicitly notify mobile devices with file_for_mobile
        if (sender === 'pc') {
          const fileForMobileEvent = {
            type: 'file_for_mobile',
            sender: 'PC',
            file: fileRecord,
            roomId: roomId || null,
            timestamp: Date.now()
          };
          if (roomId && rooms.has(roomId)) {
            broadcastToRoom(roomId, fileForMobileEvent);
          } else {
            broadcast(fileForMobileEvent);
          }
        }

        resolve(fileRecord);
      });

      writeStream.on('error', (err) => {
        console.error('File write error:', err);
        reject(err);
      });
    });

    fileWritePromises.push(promise);
  });

  bb.on('finish', async () => {
    try {
      await Promise.all(fileWritePromises);
      res.status(200).json({
        success: true,
        message: `${uploadedFiles.length} file(s) uploaded successfully`,
        files: uploadedFiles
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  bb.on('error', (err) => {
    console.error('Busboy error:', err);
    res.status(500).json({ success: false, error: err.message });
  });

  req.pipe(bb);
});

// API: Send existing file on PC to Mobile Phone
app.post('/api/send-to-mobile', (req, res) => {
  const { filename, roomId } = req.body;
  if (!filename) return res.status(400).json({ error: 'Filename is required' });
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  
  try {
    const stats = fs.statSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    let category = 'other';
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'].includes(ext)) category = 'image';
    else if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.3gp'].includes(ext)) category = 'video';
    else if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) category = 'audio';
    else if (['.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx', '.pptx', '.json', '.md'].includes(ext)) category = 'document';
    else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) category = 'archive';
    else if (['.apk'].includes(ext)) category = 'apk';

    const fileRecord = {
      name: filename,
      size: stats.size,
      modified: stats.mtimeMs,
      category,
      downloadUrl: `/download/${encodeURIComponent(filename)}`,
      previewUrl: `/preview/${encodeURIComponent(filename)}`
    };

    const fileEvent = {
      type: 'file_for_mobile',
      sender: 'PC',
      file: fileRecord,
      roomId: roomId || null,
      timestamp: Date.now()
    };

    if (roomId && rooms.has(roomId)) {
      broadcastToRoom(roomId, fileEvent);
    } else {
      broadcast(fileEvent);
    }

    res.json({ success: true, file: fileRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Generate QR code image buffer directly (for phone screen display)
app.get('/api/beam-qr', async (req, res) => {
  try {
    const token = req.query.token || 'DROPFILE';
    const qrBuffer = await qrcode.toBuffer(token, {
      margin: 1,
      width: 320,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).send('Error generating QR');
  }
});

// API: Stage a file for Camera Tap / Beam Transfer
app.post('/api/stage-beam', (req, res) => {
  const bb = busboy({ headers: req.headers });
  let stagedRecord = null;
  const token = 'BEAM-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  let filePromise = null;

  bb.on('file', (name, fileStream, info) => {
    const { filename, mimeType } = info;
    if (!filename) {
      fileStream.resume();
      return;
    }

    const safeName = path.basename(filename);
    const uniqueName = getUniqueFilename(UPLOAD_DIR, safeName);
    const tempName = `.staged_${token}_${uniqueName}`;
    const tempPath = path.join(UPLOAD_DIR, tempName);
    const writeStream = fs.createWriteStream(tempPath);

    fileStream.pipe(writeStream);

    filePromise = new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        const stats = fs.statSync(tempPath);
        const ext = path.extname(uniqueName).toLowerCase();
        let category = 'other';
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'].includes(ext)) category = 'image';
        else if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.3gp'].includes(ext)) category = 'video';
        else if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) category = 'audio';
        else if (['.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx', '.pptx', '.json', '.md'].includes(ext)) category = 'document';
        else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) category = 'archive';
        else if (['.apk'].includes(ext)) category = 'apk';

        stagedRecord = {
          token,
          tempPath,
          finalName: uniqueName,
          finalPath: path.join(UPLOAD_DIR, uniqueName),
          size: stats.size,
          category,
          downloadUrl: `/download/${encodeURIComponent(uniqueName)}`,
          previewUrl: `/preview/${encodeURIComponent(uniqueName)}`
        };

        stagedBeams.set(token, stagedRecord);
        resolve();
      });
      writeStream.on('error', reject);
    });
  });

  bb.on('finish', async () => {
    try {
      if (filePromise) await filePromise;
      if (stagedRecord) {
        res.json({
          success: true,
          token,
          fileName: stagedRecord.finalName,
          qrUrl: `/api/beam-qr?token=${encodeURIComponent(token)}`
        });
      } else {
        res.status(400).json({ error: 'No file received' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  req.pipe(bb);
});

// API: Claim Beam (triggered by PC Camera or instant tap)
app.post('/api/claim-beam', (req, res) => {
  const { token } = req.body;
  if (!token || !stagedBeams.has(token)) {
    return res.status(404).json({ success: false, error: 'Beam token not found or already claimed' });
  }

  const beam = stagedBeams.get(token);
  stagedBeams.delete(token);

  try {
    if (fs.existsSync(beam.tempPath)) {
      fs.renameSync(beam.tempPath, beam.finalPath);
    }

    const fileRecord = {
      name: beam.finalName,
      size: beam.size,
      modified: Date.now(),
      category: beam.category,
      downloadUrl: beam.downloadUrl,
      previewUrl: beam.previewUrl
    };

    // Broadcast file arrival to PC
    broadcast({
      type: 'file_received',
      file: fileRecord,
      beamed: true,
      timestamp: Date.now()
    });

    // Notify mobile that beam was accepted
    broadcast({
      type: 'beam_claimed',
      token,
      file: fileRecord
    });

    res.json({ success: true, file: fileRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Web Share Target API route (when user taps "Share" in ANY Android app and selects DropFile)
app.post('/mobile-share', (req, res) => {
  const bb = busboy({ headers: req.headers });
  let sharedFiles = [];
  let filePromises = [];

  bb.on('file', (name, fileStream, info) => {
    const { filename, mimeType } = info;
    if (!filename) {
      fileStream.resume();
      return;
    }

    const safeName = path.basename(filename);
    const uniqueName = getUniqueFilename(UPLOAD_DIR, safeName);
    const savePath = path.join(UPLOAD_DIR, uniqueName);
    const writeStream = fs.createWriteStream(savePath);

    fileStream.pipe(writeStream);

    const promise = new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        const stats = fs.statSync(savePath);
        const ext = path.extname(uniqueName).toLowerCase();
        let category = 'other';
        if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'].includes(ext)) category = 'image';
        else if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv', '.3gp'].includes(ext)) category = 'video';
        else if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'].includes(ext)) category = 'audio';
        else if (['.pdf', '.doc', '.docx', '.txt', '.csv', '.xlsx', '.pptx', '.json', '.md'].includes(ext)) category = 'document';
        else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) category = 'archive';
        else if (['.apk'].includes(ext)) category = 'apk';

        const fileRecord = {
          name: uniqueName,
          size: stats.size,
          modified: stats.mtimeMs,
          category,
          downloadUrl: `/download/${encodeURIComponent(uniqueName)}`,
          previewUrl: `/preview/${encodeURIComponent(uniqueName)}`
        };

        sharedFiles.push(fileRecord);
        broadcast({
          type: 'file_received',
          file: fileRecord,
          timestamp: Date.now()
        });

        resolve();
      });
      writeStream.on('error', reject);
    });
    filePromises.push(promise);
  });

  bb.on('finish', async () => {
    try {
      await Promise.all(filePromises);
      // Redirect back to mobile UI with success message
      res.redirect('/mobile?shared=success');
    } catch (err) {
      res.redirect('/mobile?shared=error');
    }
  });

  req.pipe(bb);
});

// API: Download file (guarantees original filename and extension in browser)
app.get('/download/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.download(filePath, filename);
  } else {
    res.status(404).send('File not found');
  }
});

// API: Inline Preview file (for gallery view & PDF iframe without UUID download bug)
app.get('/preview/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.pdf') res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.sendFile(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

// API: Delete a file
app.delete('/api/files/:filename', (req, res) => {
  const filename = path.basename(decodeURIComponent(req.params.filename));
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    broadcast({
      type: 'file_deleted',
      name: filename
    });
    res.json({ success: true, message: 'File deleted' });
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// API: Open Received_Files folder directly in Windows Explorer
app.post('/api/open-folder', (req, res) => {
  if (process.platform === 'win32') {
    try {
      const child = spawn('explorer.exe', [UPLOAD_DIR], { detached: true, stdio: 'ignore' });
      child.unref();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  } else {
    res.json({ success: false, message: 'Platform not supported for explorer.exe' });
  }
});

// API: Open specific file in Windows default app (reliable Start-Process)
app.post('/api/open-file', (req, res) => {
  const filename = path.basename(req.body.filename || '');
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    if (process.platform === 'win32') {
      const escaped = filePath.replace(/'/g, "''");
      exec(`powershell -Command "Start-Process -FilePath '${escaped}'"`, (err) => {
        if (err) {
          console.error('Failed to open file:', err);
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
      });
    } else {
      res.json({ success: false });
    }
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// API: Reveal file in Windows Explorer (selects the file in folder)
app.post('/api/reveal-file', (req, res) => {
  const filename = path.basename(req.body.filename || '');
  const filePath = path.join(UPLOAD_DIR, filename);

  if (fs.existsSync(filePath)) {
    if (process.platform === 'win32') {
      try {
        const child = spawn('explorer.exe', ['/select,', filePath], { detached: true, stdio: 'ignore' });
        child.unref();
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    } else {
      res.json({ success: false });
    }
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const interfaces = getNetworkAddresses();
  console.log('====================================================');
  console.log(`🚀 V-Share Server running on port ${PORT}`);
  console.log(`💻 PC Dashboard:  http://localhost:${PORT}`);
  if (interfaces.length > 0) {
    console.log(`📱 Mobile Access: http://${interfaces[0].address}:${PORT}/mobile`);
    console.log('   All detected IP addresses:');
    interfaces.forEach(i => console.log(`   - ${i.interface}: http://${i.address}:${PORT}/mobile`));
  }
  console.log(`📂 Destination:   ${UPLOAD_DIR}`);
  console.log('====================================================');

  // 24/7 Keep-Alive Engine for Render (Prevents 15-minute inactivity spin-down)
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  if (renderExternalUrl) {
    console.log(`⏱️ Render Keep-Alive active: Self-pinging every 10 minutes at ${renderExternalUrl}/api/ping`);
    const https = require('https');
    const http = require('http');
    const pingClient = renderExternalUrl.startsWith('https') ? https : http;

    setInterval(() => {
      pingClient.get(`${renderExternalUrl}/api/ping`, (res) => {
        console.log(`[Keep-Alive] 💓 Ping OK (${res.statusCode}) - Keeping Render alive 24/7`);
      }).on('error', (err) => {
        console.warn('[Keep-Alive] Ping notice:', err.message);
      });
    }, 10 * 60 * 1000); // 10 minutes (well before the 15-minute sleep threshold)
  }


  // Automatic Cloud Bridge: When running on local PC, sync files dropped on Render Cloud directly to disk!
  if (!process.env.RENDER && !process.env.RENDER_EXTERNAL_URL) {
    function startCloudBridge() {
      const cloudHost = 'v-share-o68m.onrender.com';
      const cloudWsUrl = `wss://${cloudHost}`;
      let bridgeWs;

      try {
        bridgeWs = new WebSocket(cloudWsUrl);
        activeCloudBridgeWs = bridgeWs;
      } catch (e) {
        setTimeout(startCloudBridge, 8000);
        return;
      }

      bridgeWs.on('open', async () => {
        console.log('✅ [Cloud Bridge] Connected to live Render server!');
        try {
          const https = require('https');
          const infoRes = await new Promise((resolve, reject) => {
            https.get(`https://${cloudHost}/api/info`, (res) => {
              let data = '';
              res.on('data', c => data += c);
              res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
              });
            }).on('error', reject);
          });

          const cloudRoomId = userConfig.cloudRoomId || infoRes.roomId || infoRes.networkRoomCode;
          if (cloudRoomId) {
            bridgeWs.send(JSON.stringify({
              type: 'join_room',
              roomId: cloudRoomId,
              role: 'pc'
            }));
            console.log(`🔗 [Cloud Bridge] Paired with Cloud Room ${cloudRoomId}. Incoming files will write directly to ${UPLOAD_DIR}`);
            showWindowsNotification('V-Share Background Active 🟢', `Ready! Incoming files write to ${UPLOAD_DIR}`);
          }
        } catch (e) {
          console.warn('[Cloud Bridge] Info notice:', e.message);
        }
      });

      bridgeWs.on('message', (data) => {
        // Forward binary screen stream frames directly to local PC clients
        if (Buffer.isBuffer(data)) {
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN && client.bufferedAmount === 0) {
              client.send(data);
            }
          }
          return;
        }

        try {
          const msg = JSON.parse(data);

          if (msg.type === 'unattended_remote_start') {
            console.log('🖥️ [Cloud Bridge] Received unattended remote start request from mobile!');
            startUnattendedCapture(msg.roomId);
            return;
          }

          if (msg.type === 'unattended_remote_stop') {
            stopUnattendedCapture();
            return;
          }

          if (msg.type === 'remote_input') {
            console.log(`👆 [Cloud Bridge] Received remote_input: ${msg.action} (${msg.x}, ${msg.y})`);
            handleRemoteInputEvent(msg);
            return;
          }

          if (msg.type === 'remote_start_request' || msg.type === 'remote_stop' ||
              msg.type === 'webrtc_offer' || msg.type === 'webrtc_answer' || msg.type === 'webrtc_ice_candidate' ||
              msg.type === 'phone_screen_offer' || msg.type === 'phone_screen_answer' ||
              msg.type === 'phone_screen_ice_candidate' || msg.type === 'phone_screen_stop') {
            broadcast(msg);
            return;
          }

          if (msg.type === 'file_received' && msg.file && msg.file.downloadUrl) {
            const fileName = msg.file.name;
            const destPath = path.join(UPLOAD_DIR, fileName);
            if (fs.existsSync(destPath)) {
              return;
            }

            console.log(`📥 [Cloud Bridge] Receiving "${fileName}" from Cloud to ${destPath}...`);
            const https = require('https');
            const fileUrl = `https://${cloudHost}${msg.file.downloadUrl}`;
            const fileStream = fs.createWriteStream(destPath);
            https.get(fileUrl, (res) => {
              res.pipe(fileStream);
              fileStream.on('finish', () => {
                console.log(`🎉 [Cloud Bridge] Successfully saved "${fileName}" directly to PC disk!`);
                showWindowsNotification('V-Share: File Received! 📥', `Saved "${fileName}" to ${UPLOAD_DIR}`);
                broadcast({
                  type: 'file_received',
                  file: msg.file,
                  sender: 'Mobile'
                });
              });
            }).on('error', (err) => {
              console.error(`[Cloud Bridge] Error downloading "${fileName}":`, err.message);
            });
          }
        } catch (err) {}
      });

      bridgeWs.on('close', () => {
        activeCloudBridgeWs = null;
        setTimeout(startCloudBridge, 5000);
      });

      bridgeWs.on('error', () => {
        activeCloudBridgeWs = null;
        bridgeWs.close();
      });
    }

    setTimeout(startCloudBridge, 2000);
  }
});
