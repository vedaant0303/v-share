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
const defaultUploadDir = process.env.RENDER
  ? path.join(__dirname, 'uploads')
  : path.join(os.homedir(), 'Downloads', 'Submitt');
const UPLOAD_DIR = process.env.UPLOAD_DIR || defaultUploadDir;

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Temporary store for Camera Beam transfers
const stagedBeams = new Map();

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

// Store connected clients for WebSocket
const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const userAgent = req.headers['user-agent'] || '';
  const isMobile = /mobile|iphone|android|ipad/i.test(userAgent);
  
  console.log(`[WS] ${isMobile ? '📱 Mobile Phone' : '💻 PC'} connected (Total: ${clients.size})`);

  broadcast({
    type: 'client_connected',
    clientCount: clients.size,
    isMobile,
    timestamp: Date.now()
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'clipboard_share') {
        // Broadcast clipboard text to all other clients
        broadcast({
          type: 'clipboard_received',
          text: data.text,
          from: isMobile ? 'Mobile' : 'PC',
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
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

// API: System Info, Network IPs, & QR Code
app.get('/api/info', async (req, res) => {
  try {
    const interfaces = getNetworkAddresses();
    let mobileUrl;
    const selectedIp = req.query.ip;

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
      interfaces,
      tunnelActive: !!activeTunnelUrl,
      tunnelUrl: activeTunnelUrl,
      uploadDirectory: UPLOAD_DIR,
      connectedClients: clients.size
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // Broadcast upload start
    broadcast({
      type: 'file_upload_start',
      name: uniqueName,
      mimeType,
      sender: sender === 'pc' ? 'PC' : 'Mobile',
      timestamp: Date.now()
    });

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

        // Notify all clients that this file completed
        broadcast({
          type: 'file_received',
          file: fileRecord,
          sender: sender === 'pc' ? 'PC' : 'Mobile',
          timestamp: Date.now()
        });

        // If uploaded from PC, explicitly notify mobile devices with file_for_mobile
        if (sender === 'pc') {
          broadcast({
            type: 'file_for_mobile',
            sender: 'PC',
            file: fileRecord,
            timestamp: Date.now()
          });
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
  const { filename } = req.body;
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

    // Broadcast file_for_mobile event to all connected devices
    broadcast({
      type: 'file_for_mobile',
      sender: 'PC',
      file: fileRecord,
      timestamp: Date.now()
    });

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
});
