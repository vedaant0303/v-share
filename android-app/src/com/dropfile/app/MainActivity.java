package com.dropfile.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String PREFS_NAME = "DropFilePrefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String DEFAULT_URL = "https://v-share-o68m.onrender.com";
    private static final int REQUEST_PICK_FILE = 1001;
    private static final int REQUEST_FILE_CHOOSER = 1002;
    private static final int REQUEST_CAMERA_PERMISSION = 1003;
    private android.webkit.PermissionRequest mPendingPermissionRequest;

    private EditText ipInput;
    private TextView statusText;
    private SharedPreferences prefs;

    private View settingsScrollView;
    private View webContainer;
    private WebView webView;
    private ValueCallback<Uri[]> mUploadMessage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Check & request Camera permission for QR scanning
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{android.Manifest.permission.CAMERA}, REQUEST_CAMERA_PERMISSION);
        }

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        // Views
        settingsScrollView = findViewById(R.id.settingsScrollView);
        webContainer = findViewById(R.id.webContainer);
        webView = findViewById(R.id.webView);

        ipInput = findViewById(R.id.ipInput);
        statusText = findViewById(R.id.statusText);
        Button saveBtn = findViewById(R.id.saveBtn);
        Button pickFileBtn = findViewById(R.id.pickFileBtn);
        Button openWebBtn = findViewById(R.id.openWebBtn);
        Button btnSettingsFromWeb = findViewById(R.id.btnSettingsFromWeb);

        String savedUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_URL);
        if (savedUrl == null || savedUrl.contains("192.168.") || savedUrl.contains(":4000")) {
            savedUrl = DEFAULT_URL;
            prefs.edit().putString(KEY_SERVER_URL, DEFAULT_URL).apply();
        }
        ipInput.setText(savedUrl);

        // Setup In-App WebView
        setupWebView();

        // Listeners
        saveBtn.setOnClickListener(v -> testAndSaveServerUrl(true));

        openWebBtn.setOnClickListener(v -> {
            String currentUrl = getCleanUrl();
            showInAppDashboard(currentUrl);
        });

        btnSettingsFromWeb.setOnClickListener(v -> showSettingsView());

        pickFileBtn.setOnClickListener(v -> {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.setType("*/*");
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(Intent.createChooser(intent, "Select File to Drop"), REQUEST_PICK_FILE);
        });

        // Test connection on startup
        testConnectionSilently(savedUrl);
    }

    private void setupWebView() {
        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(true);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setMediaPlaybackRequiresUserGesture(false);

        // JavaScript Bridge for 100% Reliable Native Downloads & File Opening
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void downloadFile(String downloadUrl, String filename, String mimeType) {
                runOnUiThread(() -> {
                    String fullUrl = resolveFullUrl(downloadUrl);
                    triggerNativeDownload(fullUrl, filename, mimeType);
                });
            }

            @JavascriptInterface
            public void openExternal(String url, String mimeType) {
                runOnUiThread(() -> {
                    String fullUrl = resolveFullUrl(url);
                    openInDefaultApp(fullUrl, mimeType);
                });
            }

            @JavascriptInterface
            public void setLandscape(boolean enable) {
                runOnUiThread(() -> {
                    View webHeader = findViewById(R.id.webHeader);
                    if (enable) {
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                        if (webHeader != null) webHeader.setVisibility(View.GONE);
                        getWindow().getDecorView().setSystemUiVisibility(
                            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        );
                    } else {
                        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                        if (webHeader != null) webHeader.setVisibility(View.VISIBLE);
                        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
                    }
                });
            }
        }, "AndroidHost");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // If it is a download URL, route directly to DownloadManager
                if (url.contains("/download/")) {
                    triggerNativeDownload(url, null, null);
                    return true;
                }

                // If it is a document preview (PDF/Word/etc.), open in user's default app
                if (url.contains("/preview/")) {
                    String lower = url.toLowerCase();
                    if (lower.contains(".pdf")) {
                        openInDefaultApp(url, "application/pdf");
                        return true;
                    } else if (lower.contains(".doc") || lower.contains(".docx")) {
                        openInDefaultApp(url, "application/msword");
                        return true;
                    }
                }

                // Keep all other dashboard pages inside this WebView
                if (url.contains(":4000")) {
                    view.loadUrl(url);
                    return true;
                }

                // External links open via intent
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                } catch (Exception e) {
                    return false;
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final android.webkit.PermissionRequest request) {
                runOnUiThread(() -> {
                    if (checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.getResources());
                    } else {
                        mPendingPermissionRequest = request;
                        requestPermissions(new String[]{android.Manifest.permission.CAMERA}, REQUEST_CAMERA_PERMISSION);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (mUploadMessage != null) {
                    mUploadMessage.onReceiveValue(null);
                }
                mUploadMessage = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try {
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                } catch (Exception e) {
                    mUploadMessage = null;
                    return false;
                }
                return true;
            }
        });

        // Fallback Native DownloadManager Listener
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                triggerNativeDownload(url, null, mimeType);
            }
        });
    }

    private String resolveFullUrl(String pathOrUrl) {
        if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
            return pathOrUrl;
        }
        String baseUrl = getCleanUrl();
        if (!pathOrUrl.startsWith("/")) {
            pathOrUrl = "/" + pathOrUrl;
        }
        return baseUrl + pathOrUrl;
    }

    private void triggerNativeDownload(String url, String fileName, String mimeType) {
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            if (mimeType != null && !mimeType.isEmpty()) {
                request.setMimeType(mimeType);
            }

            if (fileName == null || fileName.isEmpty()) {
                fileName = URLUtil.guessFileName(url, null, mimeType);
            }
            request.setTitle(fileName);
            request.setDescription("V-Share: Receiving file from PC...");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(request);
                Toast.makeText(MainActivity.this, "📥 Downloading " + fileName + " to phone Downloads...", Toast.LENGTH_SHORT).show();
            }
        } catch (Exception e) {
            Toast.makeText(MainActivity.this, "Download error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void openInDefaultApp(String url, String mimeType) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            if (mimeType != null && !mimeType.isEmpty()) {
                intent.setDataAndType(Uri.parse(url), mimeType);
            } else {
                intent.setData(Uri.parse(url));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (Exception e) {
            try {
                Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(browserIntent);
            } catch (Exception ex) {
                Toast.makeText(this, "No app found to open file: " + ex.getMessage(), Toast.LENGTH_SHORT).show();
            }
        }
    }

    private String getCleanUrl() {
        String urlStr = ipInput.getText().toString().trim();
        if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
            urlStr = "http://" + urlStr;
        }
        while (urlStr.endsWith("/")) {
            urlStr = urlStr.substring(0, urlStr.length() - 1);
        }
        return urlStr;
    }

    private void showInAppDashboard(String serverUrl) {
        String mobileUrl = serverUrl + "/mobile";
        webView.loadUrl(mobileUrl);
        settingsScrollView.setVisibility(View.GONE);
        webContainer.setVisibility(View.VISIBLE);
    }

    private void showSettingsView() {
        webContainer.setVisibility(View.GONE);
        settingsScrollView.setVisibility(View.VISIBLE);
    }

    private void testAndSaveServerUrl(boolean openOnSuccess) {
        final String finalUrl = getCleanUrl();
        statusText.setText("Connecting to " + finalUrl + "...");
        statusText.setTextColor(0xFF00F2FE);

        new Thread(() -> {
            boolean success = pingServer(finalUrl);
            new Handler(Looper.getMainLooper()).post(() -> {
                if (success) {
                    prefs.edit().putString(KEY_SERVER_URL, finalUrl).apply();
                    statusText.setText("🟢 Connected to PC successfully!");
                    statusText.setTextColor(0xFF34D399);
                    Toast.makeText(this, "Connected to PC!", Toast.LENGTH_SHORT).show();
                    if (openOnSuccess) {
                        showInAppDashboard(finalUrl);
                    }
                } else {
                    statusText.setText("🔴 Cannot reach PC. Check Wi-Fi connection!");
                    statusText.setTextColor(0xFFEF4444);
                }
            });
        }).start();
    }

    private void testConnectionSilently(String urlStr) {
        new Thread(() -> {
            boolean success = pingServer(urlStr);
            new Handler(Looper.getMainLooper()).post(() -> {
                if (success) {
                    statusText.setText("🟢 Connected to PC (" + urlStr + ")");
                    statusText.setTextColor(0xFF34D399);
                    showInAppDashboard(urlStr);
                } else {
                    statusText.setText("⚪ Enter PC Wi-Fi IP and tap Save");
                    statusText.setTextColor(0xFF9CA3AF);
                    showSettingsView();
                }
            });
        }).start();
    }

    private boolean pingServer(String serverUrl) {
        try {
            URL url = new URL(serverUrl + "/api/info");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(3000);
            conn.setReadTimeout(3000);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            conn.disconnect();
            return code == 200;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onBackPressed() {
        View webHeader = findViewById(R.id.webHeader);
        if (webHeader != null && webHeader.getVisibility() == View.GONE) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            webHeader.setVisibility(View.VISIBLE);
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            webView.evaluateJavascript("if (typeof closeRemoteDesktop === 'function') closeRemoteDesktop();", null);
            return;
        }
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        if (webContainer != null && webContainer.getVisibility() == View.VISIBLE) {
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                showSettingsView();
            }
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        // File picker for WebView
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (mUploadMessage != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getData() != null) {
                        result = new Uri[]{ data.getData() };
                    } else if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        result = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            result[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    }
                }
                mUploadMessage.onReceiveValue(result);
                mUploadMessage = null;
            }
            return;
        }

        // Direct pick & send to PC
        if (requestCode == REQUEST_PICK_FILE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                Intent shareIntent = new Intent(this, ShareActivity.class);
                shareIntent.setAction(Intent.ACTION_SEND);
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                startActivity(shareIntent);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_CAMERA_PERMISSION) {
            if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                if (mPendingPermissionRequest != null) {
                    mPendingPermissionRequest.grant(mPendingPermissionRequest.getResources());
                    mPendingPermissionRequest = null;
                }
            } else {
                if (mPendingPermissionRequest != null) {
                    mPendingPermissionRequest.deny();
                    mPendingPermissionRequest = null;
                }
                Toast.makeText(this, "Camera permission needed for QR scan", Toast.LENGTH_SHORT).show();
            }
        }
    }
}
