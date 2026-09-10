# V-Share (DropFile) — Complete Project Documentation

> **Fast, zero-setup, cross-device file sharing, live screen mirroring, and remote desktop ecosystem connecting Android, Windows PC, and web browsers.**

---

## 📑 Table of Contents
1. [Project Overview](#-project-overview)
2. [Key Capabilities & Features](#-key-capabilities--features)
3. [Architecture & System Design](#-architecture--system-design)
4. [Component Deep-Dive](#-component-deep-dive)
   - [Backend Server (`server.js`)](#1-backend-server-serverjs)
   - [PC Web Application (`public/index.html` & `pc.js`)](#2-pc-web-application-publicindexhtml--pcjs)
   - [Mobile Web Application (`public/mobile.html` & `mobile.js`)](#3-mobile-web-application-publicmobilehtml--mobilejs)
   - [Native Android Application (`android-app/`)](#4-native-android-application-android-app)
   - [Windows Remote Input Controller (`bin/VRemoteInput.cs`)](#5-windows-remote-input-controller-binvremoteinputcs)
5. [Data Flow & Signaling Protocols](#-data-flow--signaling-protocols)
   - [Private Room Pairing](#1-private-room-pairing)
   - [Phone-to-PC Screen Mirroring](#2-phone-to-pc-screen-mirroring)
   - [Camera Tap / Beam Transfer](#3-camera-tap--beam-transfer)
   - [Cloud Bridge Synchronization](#4-cloud-bridge-synchronization)
6. [API Reference & WebSocket Events](#-api-reference--websocket-events)
7. [Scripts & Tooling](#-scripts--tooling)
8. [Installation & Setup Guide](#-installation--setup-guide)
   - [Running on Local PC](#running-on-local-pc)
   - [Building the Android App](#building-the-android-apk)
   - [Deploying to Render](#deploying-to-render-cloud)
9. [Troubleshooting & FAQs](#-troubleshooting--faqs)

---

## 🌟 Project Overview

**V-Share** (originally *DropFile*) solves the friction of moving files, clipboard data, and screen streams between mobile devices and Windows desktop computers. Rather than relying on cloud storage uploads, email attachments, or third-party messaging apps with compression limits:

- **Local Wi-Fi Mode**: Devices communicate directly over LAN with multi-gigabit speeds and sub-10ms latencies.
- **Remote Cloud Mode**: Devices connect through a centralized WebSocket relay hosted on Render or via Cloudflare Tunnels, allowing full transfer and screen casting capabilities from anywhere in the world.
- **Zero Login / Zero Database**: Sessions use lightweight, ephemeral in-memory pairing codes (6-digit room IDs or QR codes). No account registration, passwords, or persistent tracking required.

---

## 🚀 Key Capabilities & Features

| Feature | Description |
| :--- | :--- |
| **Instant File Transfer** | Drag-and-drop or select files from any phone or PC. Streams directly to disk with zero server RAM bloat. |
| **Direct-to-Folder Delivery** | Files sent to PC are automatically saved into the configured destination folder (e.g., `Downloads\Submitt`). |
| **Phone Screen Live Cast** | High-performance, low-latency live screen mirroring from Android to PC web dashboard (WebRTC + hardware-accelerated fallback canvas). |
| **Camera Tap / Beam** | Stage a file on mobile, hold the phone screen up to your PC webcam, and receive the file automatically using QR recognition. |
| **System Share Menu Integration** | Share from Google Photos, Drive, WhatsApp, or Files directly to PC using the Android native "Send to PC (V-Share)" share sheet target. |
| **Remote Desktop & PC Control** | View PC desktop stream on phone and send remote mouse/keyboard inputs (clicks, typing, scroll) via native Windows Win32 API. |
| **Cross-Device Clipboard** | 1-click clipboard synchronization between phone and PC. |
| **File Gallery & Media Preview** | In-browser preview for images, video streaming, and inline PDF viewing without unwanted automatic downloads. |
| **Cloud Bridge Relay** | Seamlessly connects your local PC to a public Render instance so drops from outside your home network land straight on your local hard drive. |
| **Windows Background Daemon** | Runs silently in the background on Windows startup with tray/balloon notifications. |

---

## 📐 Architecture & System Design

```
                     ┌──────────────────────────────────────────────┐
                     │          Render Cloud Relay Server           │
                     │          (v-share-o68m.onrender.com)         │
                     └───────────────┬──────────────┬───────────────┘
                                     │              │
               WSS Tunnel / Remote Drops        WSS Cloud Bridge
                                     │              │
                                     ▼              ▼
┌──────────────────────────────────────┐          ┌──────────────────────────────────────┐
│         Android Mobile Device        │          │          Local Windows PC            │
│  - V-Share Native App (APK)          │          │  - Node.js Local Server (:4000)      │
│  - MediaProjection Screen Service    │          │  - VRemoteInput.exe (Win32 Hook)     │
│  - ShareActivity (System Share)      │          │  - Browser Dashboard (localhost:4000)│
│  - Browser PWA (mobile.html)         │          │  - Target Folder: Downloads\Submitt  │
└──────────────────┬───────────────────┘          └──────────────────┬───────────────────┘
                   │                                                 │
                   └──────────── Direct Wi-Fi LAN Connection ────────┘
                                (Sub-5ms, Zero Cloud Latency)
```

---

## 🔍 Component Deep-Dive

### 1. Backend Server (`server.js`)
The server acts as both the web server and the real-time signaling / streaming coordinator:
- **Express HTTP Server**: Serves static frontend assets (`public/`), file downloads (`/download/:filename`), previews (`/preview/:filename`), and REST API endpoints.
- **WebSocket Server (`ws`)**: Manages real-time bi-directional messaging, room pairing, WebRTC signaling, clipboard sharing, and binary JPEG screen frame forwarding.
- **Streaming Upload Engine (`busboy`)**: Uploads are piped directly from incoming HTTP request streams into destination file streams (`fs.createWriteStream`). This allows uploading multi-gigabyte videos without consuming Node.js memory.
- **Network Interface Resolver**: Automatically queries OS network interfaces on boot, detecting local Wi-Fi, Ethernet, and virtual LAN IPs (e.g. `192.168.x.x`), and advertises direct local URLs to connected devices.
- **Cloud Bridge Client**: When running locally on a PC, it initiates an automatic outbound WebSocket connection to the Render cloud deployment. Incoming files dropped onto the public website are streamed down and written directly to the PC's local destination folder.
- **24/7 Render Keep-Alive Engine**: Periodically pings `/api/ping` every 10 minutes to prevent Render free-tier instances from spinning down due to inactivity.

### 2. PC Web Application (`public/index.html` & `pc.js`)
- **Dashboard Interface**: Modern dark-mode UI with cyber-neon accents, glassmorphic cards, dynamic stat counters, and storage metrics.
- **File Manager**:
  - Live search filter and category filtering tabs (Images, Videos, Documents, Audio, Archives, APKs).
  - Actions: Open file in default Windows app, Reveal in Windows Explorer, Download, Copy Link, Delete.
  - Media preview modal with video player, image viewer, and PDF iframe.
- **Camera Tap Scanner**:
  - Accesses PC webcam via `navigator.mediaDevices.getUserMedia`.
  - Analyzes frames in real time using `jsQR.js`.
  - When a `BEAM-XXXXXX` QR code is held in front of the lens, it automatically claims the staged file from the server.
- **Phone Screen Live Cast Viewer**:
  - Renders incoming screen streams using WebRTC video or a hardware-accelerated canvas (`createImageBitmap`).
  - Dismiss guard: Prevents unsolicited auto-opening on page load.
  - Controls: Screenshot capture (`canvas.toBlob`), Fullscreen toggle, and Stop/Close button.

### 3. Mobile Web Application (`public/mobile.html` & `mobile.js`)
- **PWA Ready**: Works identically as a web page on Safari/Chrome or embedded inside the Android app's WebView.
- **Pairing Pill**: Shows active connection status, latency, paired PC name/ID, and allows 1-tap switching between multiple saved PCs.
- **Action Grid**:
  - **Share Phone Screen to PC**: Requests screen capture (native or browser `getDisplayMedia`) and starts live mirroring.
  - **Tap to PC Camera (Beam)**: Selects a file, uploads it to temporary staging, and presents a full-screen QR code for the PC webcam.
  - **Photos & Videos**: Native gallery file picker.
  - **Browse Files**: Generic OS file picker.
  - **Send Note / Link**: Text/URL prompt that pushes instantly to the PC clipboard.
- **Dynamic Local Wi-Fi Detection**: Checks if the PC's LAN IP is directly pingable; if reachable, automatically switches to LAN streaming for near-zero latency.

### 4. Native Android Application (`android-app/`)
Built in pure Java with Android SDK tools (no Android Studio or heavy Gradle required):
- **`MainActivity.java`**:
  - Houses the full-screen WebView with JavaScript bridges (`AndroidHost` and `AndroidBridge`).
  - Configures connection settings, target server IP testing, and native download routing.
  - Manages permissions (`CAMERA`, `READ_EXTERNAL_STORAGE`, `POST_NOTIFICATIONS`).
  - Prompts `MediaProjectionManager.createScreenCaptureIntent()` for screen mirroring.
- **`ScreenCaptureService.java`**:
  - Foreground Service displaying a persistent notification while screen sharing is active.
  - Creates a `VirtualDisplay` via `MediaProjection` rendering into an `ImageReader` (360px downscaled, 16-pixel aligned).
  - Compresses frames to lightweight ~10–14 KB JPEGs at ~14 FPS.
  - Transmits frames via pure Java `WebSocketStreamer` (`TCP_NODELAY`) with automatic HTTP fallback.
  - Implements remote termination: Listens for PC stop commands or server HTTP 410 codes to stop capturing automatically.
- **`ShareActivity.java`**:
  - Handles `android.intent.action.SEND` and `SEND_MULTIPLE`.
  - Appears in the system share menu of any app (Gallery, Drive, WhatsApp, Files).
  - Reads content URIs via `ContentResolver` and uploads directly to the configured PC server endpoint.

### 5. Windows Remote Input Controller (`bin/VRemoteInput.cs`)
- Standalone C# .NET console tool compiled to `VRemoteInput.exe`.
- Communicates with `server.js` via standard input / output pipe.
- Uses native Win32 `SendInput` APIs to execute:
  - Relative & absolute mouse movements.
  - Mouse clicks (left, right, middle, double-click).
  - Vertical wheel scrolling.
  - Keyboard key presses and text typing.

---

## 🔄 Data Flow & Signaling Protocols

### 1. Private Room Pairing
```
Mobile Device                                Server                                  PC Dashboard
      │                                         │                                         │
      ├─────── WS: join_room (RoomId) ─────────►│◄──────── WS: join_room (RoomId) ────────┤
      │                                         │                                         │
      │◄────── WS: room_status (Paired) ────────┤───────── WS: room_status (Paired) ─────►│
```
- Rooms are keyed by 6-digit IDs (e.g. `687408`).
- Both devices join the same room; the server maintains `pcClients` and `mobileClients` sets.
- Room pairing status updates dynamically when devices connect or disconnect.

### 2. Phone-to-PC Screen Mirroring
```
Mobile (Android Service)                     Server                                  PC Dashboard
      │                                         │                                         │
      ├─────── POST /api/phone-screen-start ───►│                                         │
      ├─────── WS: phone_screen_start ─────────►├─────── WS: phone_screen_start ────────►│
      │                                         │                                         │ (Viewer Opens)
      ├─────── Binary JPEG Stream (WS/HTTP) ───►├─────── Forward Binary Frames ──────────►│
      │                                         │                                         │ (Renders on Canvas)
      │                                         │                                         │
      │                                         │◄────── WS / POST: phone_screen_stop ────┤ (User clicks Stop)
      │◄────── HTTP 410 STOP / WS Stop Frame ───┤                                         │
      │ (Service Stops Automatically)           │                                         │
```

### 3. Camera Tap / Beam Transfer
```
Mobile Device                                Server                                   PC Camera
      │                                         │                                         │
      ├─────── POST /api/stage-beam (File) ────►│ (Staged as .staged_BEAM-XXXXXX)         │
      │◄────── Return Token & QR code ──────────┤                                         │
      │                                         │                                         │
      │  [Phone displays QR to PC Webcam]       │                                         │
      │                                         │◄────── POST /api/claim-beam (Token) ────┤
      │                                         │ (File moved to final destination)       │
      │◄────── WS: beam_claimed ────────────────┼─────── WS: file_received ──────────────►│
```

### 4. Cloud Bridge Synchronization
```
Remote Phone                           Render Cloud Instance                         Local PC
      │                                         │                                         │
      ├─────── POST /upload (File) ────────────►│ (Stored temporarily on Cloud)           │
      │                                         ├─────── WS: file_received ──────────────►│
      │                                         │                                         │
      │                                         │◄────── HTTPS GET /download/file ────────┤
      │                                         ├─────── Stream file to disk ────────────►│
      │                                         │                                         │ (Saved to Submitt)
```

---

## 📡 API Reference & WebSocket Events

### REST API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/upload` | `POST` | Multipart file upload (zero-RAM disk stream). Headers: `x-room-id`. |
| `/mobile-share` | `POST` | Web Share Target endpoint for browser/Android system share. |
| `/api/files` | `GET` | Returns JSON array of all files in destination folder. |
| `/download/:filename`| `GET` | Direct attachment download with RFC-5987 content-disposition. |
| `/preview/:filename` | `GET` | Inline preview for images, video, and PDF. |
| `/api/files/:filename`| `DELETE`| Deletes a file and broadcasts `file_deleted` event. |
| `/api/info` | `GET` | Server info, active network room code, port, and IP addresses. |
| `/api/stage-beam` | `POST` | Stages a file for Camera Tap transfer; returns a beam token. |
| `/api/claim-beam` | `POST` | Claims a staged beam file using token; moves file to destination. |
| `/api/phone-screen-start` | `POST` | Signals that mobile screen sharing has started. |
| `/api/phone-screen-frame` | `POST` | Receives raw binary JPEG frame from Android capture service. |
| `/api/phone-screen-stop` | `POST` | Signals end of phone screen sharing session. |
| `/api/open-folder` | `POST` | Opens destination folder in Windows File Explorer. |
| `/api/open-file` | `POST` | Launches file in default Windows program (`Start-Process`). |
| `/api/reveal-file` | `POST` | Selects and highlights file in Windows File Explorer. |

### WebSocket Event Types

| Event Type | Direction | Payload | Purpose |
| :--- | :--- | :--- | :--- |
| `join_room` | Client &rarr; Server | `{ roomId, role }` | Joins a private pairing room (`mobile` or `pc`). |
| `room_status` | Server &rarr; Client | `{ isPaired, pcCount, localUrl }` | Notifies pairing state and local IP availability. |
| `clipboard_share` | Client &rarr; Server | `{ text, roomId }` | Pushes clipboard content to paired device. |
| `phone_screen_start` | Mobile &rarr; PC | `{ roomId, role }` | Alerts PC that live screen stream is commencing. |
| `phone_screen_offer` | Mobile &rarr; PC | `{ offer, roomId }` | WebRTC session description offer. |
| `phone_screen_answer`| PC &rarr; Mobile | `{ answer, roomId }` | WebRTC session description answer. |
| `phone_screen_stop` | Either &rarr; Either | `{ roomId, role }` | Terminates active screen stream. |
| `remote_input` | Mobile &rarr; PC | `{ action, x, y, key }` | Simulates mouse/keyboard action on PC. |
| `file_received` | Server &rarr; PC | `{ file: { name, size, category } }` | Signals arrival of new file on PC. |
| `file_deleted` | Server &rarr; All | `{ name }` | Signals removal of a file. |

---

## 🛠️ Scripts & Tooling

| Script File | Purpose |
| :--- | :--- |
| `build_apk.ps1` | Compiles resources (`aapt2`), compiles Java sources (`javac`), converts bytecode (`d8`), packages APK (`jar`), aligns (`zipalign`), and signs (`apksigner`). |
| `start.bat` | Starts the Node.js server on `http://localhost:4000`. |
| `start_with_tunnel.bat` | Launches the server accompanied by Cloudflare Tunnel for instant public HTTPS URL. |
| `start_background.bat` | Launches V-Share silently in the Windows background without a console window. |
| `stop_background.bat` | Gracefully terminates all background Node.js server processes. |
| `install_startup.bat` | Installs V-Share into the user's Windows Startup folder so it boots automatically. |
| `uninstall_startup.bat` | Removes V-Share from the Windows Startup folder. |

---

## 💻 Installation & Setup Guide

### Running on Local PC

#### Prerequisites
- **Node.js**: v18.0.0 or higher ([nodejs.org](https://nodejs.org))
- **Windows OS**: Windows 10 or 11 (64-bit)

#### Quick Start
1. Clone or navigate to the repository folder:
   ```bash
   cd c:\Users\hp\OneDrive\Desktop\DropFile
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   # or double-click start.bat
   ```
4. Open your browser to `http://localhost:4000`.

---

### Building the Android APK

The build script uses Android SDK build-tools directly without requiring Gradle or Android Studio:
1. Ensure Java JDK 17+ and Android SDK Build Tools (API 34) are installed.
2. Run the PowerShell build script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\build_apk.ps1
   ```
3. The compiled and signed APKs will be saved to:
   - `public/V-Share.apk`
   - `public/DropFile.apk`
4. Install on your Android device directly from `http://<PC-IP>:4000/V-Share.apk` or via USB (`adb install -r public/V-Share.apk`).

---

### Deploying to Render Cloud

The repository is configured for zero-configuration continuous deployment on [Render](https://render.com) using `render.yaml`:
1. Push your repository to GitHub:
   ```bash
   git push origin main
   ```
2. Link your GitHub repo to a new **Web Service** on Render.
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. The live server will be available at `https://<your-service>.onrender.com`.

---

## ❓ Troubleshooting & FAQs

#### 1. Why does my phone say "Screen capture request failed: detectedLocalPcUrl is not defined"?
- This occurred in older builds due to an inner variable scope.
- **Fix**: Update to the latest code (`mobile.js?v=29`), tap the **🔄** reload button in the mobile app header, and retry.

#### 2. Why does the phone screen popup show a black screen on PC?
- If the stream has not started or WebRTC is negotiating, the PC displays a waiting card.
- Ensure the Android screen capture permission prompt ("Start now") was accepted on your phone.

#### 3. How do I change where files are saved on my PC?
- In the PC dashboard, open **Settings** (gear icon) in the header.
- Enter your preferred folder path (e.g., `D:\MyFiles` or `C:\Users\<Name>\Downloads\Submitt`).
- Click **Save Destination Folder**.

#### 4. Can I send files when I am away from home (not on the same Wi-Fi)?
- Yes. When away from your local Wi-Fi, open your Render URL (e.g. `https://v-share-o68m.onrender.com/mobile`).
- As long as your local PC server is running and paired to the same 6-digit room code, files dropped on the cloud site are automatically pulled to your PC via Cloud Bridge!
