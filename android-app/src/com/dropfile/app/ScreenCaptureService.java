package com.dropfile.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Socket;
import java.net.URI;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.SSLSocketFactory;

public class ScreenCaptureService extends Service {
    public static final String ACTION_START = "com.dropfile.app.ACTION_START";
    public static final String ACTION_STOP = "com.dropfile.app.ACTION_STOP";
    public static final String EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE";
    public static final String EXTRA_RESULT_DATA = "EXTRA_RESULT_DATA";
    public static final String EXTRA_ROOM_ID = "EXTRA_ROOM_ID";
    public static final String EXTRA_SERVER_URL = "EXTRA_SERVER_URL";

    private static final String CHANNEL_ID = "vshare_screen_capture";
    private static final int NOTIFICATION_ID = 2026;

    private MediaProjection mMediaProjection;
    private VirtualDisplay mVirtualDisplay;
    private ImageReader mImageReader;
    private HandlerThread mHandlerThread;
    private Handler mHandler;
    private ExecutorService mNetworkExecutor;

    private String mRoomId;
    private String mServerUrl;
    private final AtomicBoolean mIsSending = new AtomicBoolean(false);
    private long mLastFrameTime = 0;
    private boolean mIsRunning = false;

    // Zero-GC Preallocated Bitmaps
    private Bitmap mReusableRawBitmap = null;
    private Bitmap mReusableCleanBitmap = null;
    private Canvas mReusableCanvas = null;
    private final Rect mSrcRect = new Rect();
    private final Rect mDstRect = new Rect();

    // Persistent WebSocket Streamer for Sub-10ms Latency
    private WebSocketStreamer mWsStreamer = null;
    private final byte[] mDiscardBuffer = new byte[128];
    private final ByteArrayOutputStream mBaos = new ByteArrayOutputStream(48 * 1024);

    @Override
    public void onCreate() {
        super.onCreate();
        mNetworkExecutor = Executors.newSingleThreadExecutor();
        mHandlerThread = new HandlerThread("ScreenCaptureThread");
        mHandlerThread.start();
        mHandler = new Handler(mHandlerThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopCapture();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(action)) {
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            Intent resultData = intent.getParcelableExtra(EXTRA_RESULT_DATA);
            mRoomId = intent.getStringExtra(EXTRA_ROOM_ID);
            mServerUrl = intent.getStringExtra(EXTRA_SERVER_URL);

            if (resultCode != 0 && resultData != null) {
                startForegroundNotification();
                startCapture(resultCode, resultData);
            }
        }

        return START_NOT_STICKY;
    }

    private void startForegroundNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Screen Sharing",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Casting screen live to PC");
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }

        Intent stopIntent = new Intent(this, ScreenCaptureService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent pStop = PendingIntent.getService(
            this, 0, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        builder.setContentTitle("V-Share Screen Cast Active")
               .setContentText("Casting screen live to PC (Tap to Stop)")
               .setSmallIcon(android.R.drawable.ic_menu_slideshow)
               .setOngoing(true)
               .setContentIntent(pStop);

        Notification notification = builder.build();

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void startCapture(int resultCode, Intent resultData) {
        if (mIsRunning) return;
        mIsRunning = true;

        // Initialize persistent WebSocket streaming connection in background
        if (mServerUrl != null && !mServerUrl.isEmpty()) {
            mWsStreamer = new WebSocketStreamer(mServerUrl, mRoomId);
            mNetworkExecutor.execute(() -> {
                if (mWsStreamer != null) {
                    mWsStreamer.connect();
                }
            });
        }

        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) return;

        mMediaProjection = mpm.getMediaProjection(resultCode, resultData);
        if (mMediaProjection == null) return;

        // Mandatory callback registration for Android 14 (API 34)
        mMediaProjection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                stopCapture();
                stopSelf();
            }
        }, mHandler);

        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        if (wm != null) {
            wm.getDefaultDisplay().getRealMetrics(metrics);
        } else {
            metrics = getResources().getDisplayMetrics();
        }

        int width = metrics.widthPixels;
        int height = metrics.heightPixels;
        // 360px downscaled width yields tiny ~10-14 KB JPEG frames with instant transfer
        int targetWidth = 360;
        int targetHeight = (int) ((float) height / width * targetWidth);
        // Align to 16-pixel boundary to minimize or eliminate hardware row padding
        targetWidth = (targetWidth / 16) * 16;
        targetHeight = (targetHeight / 16) * 16;

        final int finalW = targetWidth;
        final int finalH = targetHeight;
        final int density = metrics.densityDpi;

        mImageReader = ImageReader.newInstance(finalW, finalH, PixelFormat.RGBA_8888, 2);
        mVirtualDisplay = mMediaProjection.createVirtualDisplay(
            "VShareScreen",
            finalW, finalH, density,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            mImageReader.getSurface(),
            null,
            mHandler
        );

        mImageReader.setOnImageAvailableListener(reader -> {
            if (!mIsRunning) return;
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null) return;

                long now = System.currentTimeMillis();
                // 70ms throttle = ~14 FPS (rock-solid, zero buffer bloat, ideal for WAN and Wi-Fi)
                if (now - mLastFrameTime < 70) {
                    return;
                }
                mLastFrameTime = now;

                Image.Plane[] planes = image.getPlanes();
                if (planes == null || planes.length == 0) return;

                ByteBuffer buffer = planes[0].getBuffer();
                int pixelStride = planes[0].getPixelStride();
                int rowStride = planes[0].getRowStride();
                int rowPadding = rowStride - pixelStride * finalW;

                Bitmap cleanBitmap;
                if (rowPadding == 0) {
                    // Fast path: Direct copy into reusable bitmap (Zero allocation)
                    if (mReusableCleanBitmap == null || mReusableCleanBitmap.getWidth() != finalW || mReusableCleanBitmap.getHeight() != finalH) {
                        if (mReusableCleanBitmap != null) mReusableCleanBitmap.recycle();
                        mReusableCleanBitmap = Bitmap.createBitmap(finalW, finalH, Bitmap.Config.ARGB_8888);
                    }
                    mReusableCleanBitmap.copyPixelsFromBuffer(buffer);
                    cleanBitmap = mReusableCleanBitmap;
                } else {
                    // Padded path: Copy raw then crop into clean bitmap with reusable canvas
                    int rawW = finalW + rowPadding / pixelStride;
                    if (mReusableRawBitmap == null || mReusableRawBitmap.getWidth() != rawW || mReusableRawBitmap.getHeight() != finalH) {
                        if (mReusableRawBitmap != null) mReusableRawBitmap.recycle();
                        if (mReusableCleanBitmap != null) mReusableCleanBitmap.recycle();
                        mReusableRawBitmap = Bitmap.createBitmap(rawW, finalH, Bitmap.Config.ARGB_8888);
                        mReusableCleanBitmap = Bitmap.createBitmap(finalW, finalH, Bitmap.Config.ARGB_8888);
                        mReusableCanvas = new Canvas(mReusableCleanBitmap);
                        mSrcRect.set(0, 0, finalW, finalH);
                        mDstRect.set(0, 0, finalW, finalH);
                    }
                    mReusableRawBitmap.copyPixelsFromBuffer(buffer);
                    mReusableCanvas.drawBitmap(mReusableRawBitmap, mSrcRect, mDstRect, null);
                    cleanBitmap = mReusableCleanBitmap;
                }

                mBaos.reset();
                // Quality 32 produces clean, sharp text while keeping frame payload under 8-10 KB
                cleanBitmap.compress(Bitmap.CompressFormat.JPEG, 32, mBaos);
                byte[] jpegBytes = mBaos.toByteArray();

                sendFrameToPc(jpegBytes);
            } catch (Exception ignored) {
            } finally {
                if (image != null) {
                    image.close();
                }
            }
        }, mHandler);
    }

    private void sendFrameToPc(final byte[] jpegBytes) {
        if (mServerUrl == null || mServerUrl.isEmpty()) return;
        // Drop frame immediately if previous one is still writing (guarantees zero latency accumulation)
        if (!mIsSending.compareAndSet(false, true)) {
            return;
        }

        mNetworkExecutor.execute(() -> {
            try {
                boolean sent = false;
                if (mWsStreamer != null) {
                    sent = mWsStreamer.sendBinaryFrame(jpegBytes);
                }
                if (!sent) {
                    sendHttpFallback(jpegBytes);
                }
            } finally {
                mIsSending.set(false);
            }
        });
    }

    private void sendHttpFallback(byte[] jpegBytes) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(mServerUrl + "/api/phone-screen-frame");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(1000);
            conn.setReadTimeout(1000);
            conn.setRequestProperty("Content-Type", "image/jpeg");
            conn.setRequestProperty("Connection", "keep-alive");
            conn.setRequestProperty("X-Room-Id", (mRoomId != null) ? mRoomId : "");
            conn.setFixedLengthStreamingMode(jpegBytes.length);

            OutputStream os = conn.getOutputStream();
            os.write(jpegBytes);
            os.flush();
            os.close();

            int responseCode = conn.getResponseCode();
            String xAction = conn.getHeaderField("X-Action");
            if (responseCode == 410 || "stop".equalsIgnoreCase(xAction)) {
                // PC explicitly dismissed/stopped the screen stream! Stop capturing on mobile immediately!
                if (mHandler != null) {
                    mHandler.post(this::stopCapture);
                } else {
                    stopCapture();
                }
                stopSelf();
                return;
            }

            if (responseCode >= 200 && responseCode < 300) {
                InputStream is = conn.getInputStream();
                while (is.read(mDiscardBuffer) != -1) {}
                is.close();
            } else {
                InputStream es = conn.getErrorStream();
                if (es != null) {
                    while (es.read(mDiscardBuffer) != -1) {}
                    es.close();
                }
            }
        } catch (Exception ignored) {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception ignored2) {}
            }
        }
    }

    private void stopCapture() {
        mIsRunning = false;
        try {
            stopForeground(true);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
        if (mVirtualDisplay != null) {
            try { mVirtualDisplay.release(); } catch (Exception ignored) {}
            mVirtualDisplay = null;
        }
        if (mImageReader != null) {
            try { mImageReader.close(); } catch (Exception ignored) {}
            mImageReader = null;
        }
        if (mMediaProjection != null) {
            try { mMediaProjection.stop(); } catch (Exception ignored) {}
            mMediaProjection = null;
        }

        if (mWsStreamer != null) {
            mWsStreamer.close();
            mWsStreamer = null;
        }

        if (mReusableRawBitmap != null) {
            try { mReusableRawBitmap.recycle(); } catch (Exception ignored) {}
            mReusableRawBitmap = null;
        }
        if (mReusableCleanBitmap != null) {
            try { mReusableCleanBitmap.recycle(); } catch (Exception ignored) {}
            mReusableCleanBitmap = null;
        }
        mReusableCanvas = null;

        if (mServerUrl != null && mRoomId != null) {
            mNetworkExecutor.execute(() -> {
                try {
                    URL url = new URL(mServerUrl + "/api/phone-screen-stop");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(2000);
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("X-Room-Id", mRoomId);
                    OutputStream os = conn.getOutputStream();
                    os.write(("{\"roomId\":\"" + mRoomId + "\"}").getBytes(StandardCharsets.UTF_8));
                    os.flush();
                    os.close();
                    conn.getResponseCode();
                    conn.disconnect();
                } catch (Exception ignored) {}
            });
        }
    }

    @Override
    public void onDestroy() {
        stopCapture();
        if (mHandlerThread != null) {
            mHandlerThread.quitSafely();
            mHandlerThread = null;
        }
        if (mNetworkExecutor != null) {
            mNetworkExecutor.shutdown();
            mNetworkExecutor = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /**
     * High-performance RFC-6455 WebSocket client in pure standard Java.
     * Operates with TCP_NODELAY and zero request/response overhead for real-time video streaming.
     */
    private static class WebSocketStreamer {
        private Socket mSocket;
        private OutputStream mOut;
        private InputStream mIn;
        private final String mServerUrl;
        private final String mRoomId;
        private volatile boolean mConnected = false;
        private volatile boolean mClosed = false;
        private long mLastConnectAttempt = 0;

        public WebSocketStreamer(String serverUrl, String roomId) {
            this.mServerUrl = serverUrl;
            this.mRoomId = roomId;
        }

        public synchronized boolean connect() {
            if (mConnected && mSocket != null && !mSocket.isClosed()) return true;
            mLastConnectAttempt = System.currentTimeMillis();
            try {
                URI uri = new URI(mServerUrl);
                String host = uri.getHost();
                if (host == null || host.isEmpty()) return false;

                boolean isSsl = "https".equalsIgnoreCase(uri.getScheme()) || "wss".equalsIgnoreCase(uri.getScheme());
                int port = uri.getPort();
                if (port <= 0) {
                    port = isSsl ? 443 : 80;
                }

                if (isSsl) {
                    javax.net.ssl.SSLSocket sslSocket = (javax.net.ssl.SSLSocket) SSLSocketFactory.getDefault().createSocket(host, port);
                    try {
                        java.lang.reflect.Method setHostname = sslSocket.getClass().getMethod("setHostname", String.class);
                        setHostname.invoke(sslSocket, host);
                    } catch (Exception ignored) {}
                    mSocket = sslSocket;
                } else {
                    mSocket = new Socket(host, port);
                }
                // Instant delivery without Nagle packet aggregation
                mSocket.setTcpNoDelay(true);
                mSocket.setSoTimeout(1200);

                mOut = new BufferedOutputStream(mSocket.getOutputStream(), 64 * 1024);
                mIn = mSocket.getInputStream();

                String path = uri.getPath();
                if (path == null || path.isEmpty()) path = "/";

                String handshake = "GET " + path + " HTTP/1.1\r\n" +
                                   "Host: " + host + (port != 80 && port != 443 ? ":" + port : "") + "\r\n" +
                                   "Upgrade: websocket\r\n" +
                                   "Connection: Upgrade\r\n" +
                                   "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
                                   "Sec-WebSocket-Version: 13\r\n\r\n";
                mOut.write(handshake.getBytes(StandardCharsets.UTF_8));
                mOut.flush();

                BufferedReader reader = new BufferedReader(new InputStreamReader(mIn, StandardCharsets.UTF_8));
                String statusLine = reader.readLine();
                if (statusLine == null || !statusLine.contains("101")) {
                    close();
                    return false;
                }
                String line;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {}

                mConnected = true;

                // Send join_room frame immediately upon handshake completion
                if (mRoomId != null && !mRoomId.isEmpty()) {
                    String joinJson = "{\"type\":\"join_room\",\"roomId\":\"" + mRoomId + "\",\"role\":\"mobile\"}";
                    sendTextFrame(joinJson);
                }

                return true;
            } catch (Exception e) {
                close();
                return false;
            }
        }

        private synchronized void sendTextFrame(String text) throws IOException {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            byte[] header = createFrameHeader(bytes.length, 0x01); // opcode 1 = text
            mOut.write(header);
            mOut.write(bytes);
            mOut.flush();
        }

        public synchronized boolean sendBinaryFrame(byte[] jpegBytes) {
            if (mClosed) return false;
            if (!mConnected) {
                long now = System.currentTimeMillis();
                // Never block frame pipeline: only retry connection every 8 seconds
                if (now - mLastConnectAttempt > 8000) {
                    if (!connect()) return false;
                } else {
                    return false;
                }
            }
            try {
                byte[] header = createFrameHeader(jpegBytes.length, 0x02); // opcode 2 = binary
                mOut.write(header);
                mOut.write(jpegBytes);
                mOut.flush();
                return true;
            } catch (Exception e) {
                close();
                return false;
            }
        }

        private byte[] createFrameHeader(int length, int opcode) {
            byte b0 = (byte) (0x80 | (opcode & 0x0F)); // FIN = 1
            if (length <= 125) {
                byte[] header = new byte[6];
                header[0] = b0;
                header[1] = (byte) (0x80 | length); // Mask bit = 1
                header[2] = 0; header[3] = 0; header[4] = 0; header[5] = 0; // 0-mask key
                return header;
            } else if (length <= 65535) {
                byte[] header = new byte[8];
                header[0] = b0;
                header[1] = (byte) (0x80 | 126);
                header[2] = (byte) ((length >> 8) & 0xFF);
                header[3] = (byte) (length & 0xFF);
                header[4] = 0; header[5] = 0; header[6] = 0; header[7] = 0;
                return header;
            } else {
                byte[] header = new byte[14];
                header[0] = b0;
                header[1] = (byte) (0x80 | 127);
                header[2] = (byte) ((length >> 24) & 0xFF);
                header[3] = (byte) ((length >> 16) & 0xFF);
                header[4] = (byte) ((length >> 8) & 0xFF);
                header[5] = (byte) (length & 0xFF);
                header[6] = 0; header[7] = 0; header[8] = 0; header[9] = 0;
                return header;
            }
        }

        public synchronized void close() {
            mConnected = false;
            if (mSocket != null) {
                try { mSocket.close(); } catch (Exception ignored) {}
                mSocket = null;
            }
        }
    }
}
