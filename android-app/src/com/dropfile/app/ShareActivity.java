package com.dropfile.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;

public class ShareActivity extends Activity {
    private static final String PREFS_NAME = "DropFilePrefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String DEFAULT_URL = "http://192.168.0.101:4000";

    private TextView shareStatus;
    private TextView shareFileName;
    private String serverUrl;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_share);

        shareStatus = findViewById(R.id.shareStatus);
        shareFileName = findViewById(R.id.shareFileName);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        serverUrl = prefs.getString(KEY_SERVER_URL, DEFAULT_URL);

        handleIncomingShare(getIntent());
    }

    private void handleIncomingShare(Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) {
                uploadSingleUri(uri);
            } else {
                Toast.makeText(this, "No file found to share", Toast.LENGTH_SHORT).show();
                finish();
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> uris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (uris != null && !uris.isEmpty()) {
                uploadMultipleUris(uris);
            } else {
                Toast.makeText(this, "No files found to share", Toast.LENGTH_SHORT).show();
                finish();
            }
        } else {
            finish();
        }
    }

    private void uploadSingleUri(Uri uri) {
        String fileName = queryFileName(uri);
        shareFileName.setText(fileName);
        shareStatus.setText("Uploading to PC...");

        new Thread(() -> {
            boolean success = uploadFileStream(uri, fileName);
            new Handler(Looper.getMainLooper()).post(() -> {
                if (success) {
                    Toast.makeText(ShareActivity.this, "Uploaded to PC: " + fileName, Toast.LENGTH_LONG).show();
                } else {
                    Toast.makeText(ShareActivity.this, "Failed to send to PC. Check Wi-Fi connection.", Toast.LENGTH_LONG).show();
                }
                finish();
            });
        }).start();
    }

    private void uploadMultipleUris(ArrayList<Uri> uris) {
        shareStatus.setText("Uploading " + uris.size() + " files to PC...");
        shareFileName.setText("Batch Transfer");

        new Thread(() -> {
            int successCount = 0;
            for (Uri uri : uris) {
                String fileName = queryFileName(uri);
                if (uploadFileStream(uri, fileName)) {
                    successCount++;
                }
            }
            final int finalSuccess = successCount;
            new Handler(Looper.getMainLooper()).post(() -> {
                Toast.makeText(ShareActivity.this, finalSuccess + " of " + uris.size() + " files sent to PC!", Toast.LENGTH_LONG).show();
                finish();
            });
        }).start();
    }

    private boolean uploadFileStream(Uri uri, String fileName) {
        HttpURLConnection conn = null;
        try {
            String boundary = "----DropFileAndroidBoundary" + System.currentTimeMillis();
            URL url = new URL(serverUrl + "/api/upload");
            conn = (HttpURLConnection) url.openConnection();
            conn.setDoOutput(true);
            conn.setDoInput(true);
            conn.setUseCaches(false);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Connection", "Keep-Alive");
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
            conn.setChunkedStreamingMode(4096);

            OutputStream out = conn.getOutputStream();

            String header = "--" + boundary + "\r\n"
                    + "Content-Disposition: form-data; name=\"files\"; filename=\"" + fileName + "\"\r\n"
                    + "Content-Type: application/octet-stream\r\n\r\n";
            out.write(header.getBytes("UTF-8"));

            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) return false;

            byte[] buffer = new byte[8192];
            int bytesRead;
            while ((bytesRead = in.read(buffer)) != -1) {
                out.write(buffer, 0, bytesRead);
            }
            in.close();

            String footer = "\r\n--" + boundary + "--\r\n";
            out.write(footer.getBytes("UTF-8"));
            out.flush();
            out.close();

            int responseCode = conn.getResponseCode();
            return responseCode == 200;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String queryFileName(Uri uri) {
        String name = null;
        if ("content".equals(uri.getScheme())) {
            Cursor cursor = null;
            try {
                cursor = getContentResolver().query(uri, null, null, null, null);
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex >= 0) {
                        name = cursor.getString(nameIndex);
                    }
                }
            } catch (Exception e) {
                // Ignore
            } finally {
                if (cursor != null) cursor.close();
            }
        }
        if (name == null) {
            name = uri.getLastPathSegment();
        }
        if (name == null || name.isEmpty()) {
            name = "document_" + System.currentTimeMillis();
        }
        return name;
    }
}
