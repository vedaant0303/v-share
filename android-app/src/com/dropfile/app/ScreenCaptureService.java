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
import android.graphics.PixelFormat;
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

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

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

        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) return;

        mMediaProjection = mpm.getMediaProjection(resultCode, resultData);
        if (mMediaProjection == null) return;

        // In Android 14 (API 34), registering callback is mandatory before createVirtualDisplay
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

        // Downscale for lightning-fast 20 FPS streaming with zero lag
        int width = metrics.widthPixels;
        int height = metrics.heightPixels;
        int targetWidth = 400; // 400px width yields ~15-20 KB JPEG frames
        int targetHeight = (int) ((float) height / width * targetWidth);
        if (targetWidth % 2 != 0) targetWidth--;
        if (targetHeight % 2 != 0) targetHeight--;

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
                // Throttle to ~18 FPS (55 ms)
                if (now - mLastFrameTime < 55) {
                    return;
                }
                mLastFrameTime = now;

                Image.Plane[] planes = image.getPlanes();
                if (planes == null || planes.length == 0) return;

                ByteBuffer buffer = planes[0].getBuffer();
                int pixelStride = planes[0].getPixelStride();
                int rowStride = planes[0].getRowStride();
                int rowPadding = rowStride - pixelStride * finalW;

                Bitmap bitmap = Bitmap.createBitmap(finalW + rowPadding / pixelStride, finalH, Bitmap.Config.ARGB_8888);
                bitmap.copyPixelsFromBuffer(buffer);

                Bitmap cleanBitmap;
                if (rowPadding != 0) {
                    cleanBitmap = Bitmap.createBitmap(bitmap, 0, 0, finalW, finalH);
                    bitmap.recycle();
                } else {
                    cleanBitmap = bitmap;
                }

                mBaos.reset();
                cleanBitmap.compress(Bitmap.CompressFormat.JPEG, 45, mBaos);
                cleanBitmap.recycle();
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

    private final byte[] mDiscardBuffer = new byte[128];
    private final ByteArrayOutputStream mBaos = new ByteArrayOutputStream(32 * 1024);

    private void sendFrameToPc(final byte[] jpegBytes) {
        if (mServerUrl == null || mServerUrl.isEmpty()) return;
        if (!mIsSending.compareAndSet(false, true)) {
            // Drop frame immediately if previous one is still in transit (ZERO BUFFERING)
            return;
        }

        final String targetRoom = (mRoomId != null) ? mRoomId : "";

        mNetworkExecutor.execute(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(mServerUrl + "/api/phone-screen-frame");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setDoOutput(true);
                conn.setConnectTimeout(1500);
                conn.setReadTimeout(1500);
                conn.setRequestProperty("Content-Type", "image/jpeg");
                conn.setRequestProperty("Connection", "keep-alive");
                conn.setRequestProperty("X-Room-Id", targetRoom);
                conn.setFixedLengthStreamingMode(jpegBytes.length);

                OutputStream os = conn.getOutputStream();
                os.write(jpegBytes);
                os.flush();
                os.close();

                // Consume input stream so HttpURLConnection keeps socket alive in connection pool
                java.io.InputStream is = conn.getInputStream();
                while (is.read(mDiscardBuffer) != -1) {}
                is.close();
            } catch (Exception ignored) {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored2) {}
                }
            } finally {
                // DO NOT disconnect on success: keeps TCP/TLS connection open for instant transmission
                mIsSending.set(false);
            }
        });
    }

    private void stopCapture() {
        mIsRunning = false;
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
                    os.write(("{\"roomId\":\"" + mRoomId + "\"}").getBytes());
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
}
