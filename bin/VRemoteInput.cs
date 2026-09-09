using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class VRemoteInput {
    // --- DPI Awareness ---
    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    // --- Mouse Events & Cursor Control ---
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
    const int MOUSEEVENTF_LEFTDOWN = 0x02;
    const int MOUSEEVENTF_LEFTUP = 0x04;
    const int MOUSEEVENTF_RIGHTDOWN = 0x08;
    const int MOUSEEVENTF_RIGHTUP = 0x10;
    const int MOUSEEVENTF_WHEEL = 0x0800;

    // --- BitBlt Screen Capture (works in background sessions) ---
    [DllImport("user32.dll")]
    static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")]
    static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")]
    static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")]
    static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);
    [DllImport("gdi32.dll")]
    static extern IntPtr SelectObject(IntPtr hdc, IntPtr hObject);
    [DllImport("gdi32.dll")]
    static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest,
        IntPtr hdcSrc, int xSrc, int ySrc, int rop);
    [DllImport("gdi32.dll")]
    static extern bool DeleteObject(IntPtr hObject);
    [DllImport("gdi32.dll")]
    static extern bool DeleteDC(IntPtr hdc);
    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);
    const int SM_CXSCREEN = 0;
    const int SM_CYSCREEN = 1;
    const int SRCCOPY = 0x00CC0020;

    // Capture thread state
    static volatile bool capturing = false;
    static Thread captureThread = null;
    static int captureFps = 10;
    static int captureQuality = 35;
    static readonly object consoleLock = new object();

    static Bitmap CaptureScreenBitBlt() {
        int w = GetSystemMetrics(SM_CXSCREEN);
        int h = GetSystemMetrics(SM_CYSCREEN);
        IntPtr hDesktop = GetDesktopWindow();
        IntPtr hDC = GetWindowDC(hDesktop);
        IntPtr hMemDC = CreateCompatibleDC(hDC);
        IntPtr hBmp = CreateCompatibleBitmap(hDC, w, h);
        IntPtr hOld = SelectObject(hMemDC, hBmp);
        BitBlt(hMemDC, 0, 0, w, h, hDC, 0, 0, SRCCOPY);
        SelectObject(hMemDC, hOld);

        Bitmap bmp = Image.FromHbitmap(hBmp);

        DeleteObject(hBmp);
        DeleteDC(hMemDC);
        ReleaseDC(hDesktop, hDC);
        return bmp;
    }

    static void CaptureLoop() {
        ImageCodecInfo jpegCodec = null;
        foreach (var codec in ImageCodecInfo.GetImageEncoders()) {
            if (codec.MimeType == "image/jpeg") { jpegCodec = codec; break; }
        }
        var encParams = new EncoderParameters(1);

        while (capturing) {
            try {
                encParams.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)captureQuality);
                using (Bitmap bmp = CaptureScreenBitBlt()) {
                    using (MemoryStream ms = new MemoryStream()) {
                        if (jpegCodec != null) {
                            bmp.Save(ms, jpegCodec, encParams);
                        } else {
                            bmp.Save(ms, ImageFormat.Jpeg);
                        }
                        string b64 = Convert.ToBase64String(ms.ToArray());
                        lock (consoleLock) {
                            Console.WriteLine("FRAME " + b64);
                            Console.Out.Flush();
                        }
                    }
                }
            } catch (Exception ex) {
                lock (consoleLock) {
                    Console.WriteLine("CAPTURE-ERR: " + ex.Message);
                    Console.Out.Flush();
                }
            }
            Thread.Sleep(1000 / Math.Max(captureFps, 1));
        }
        lock (consoleLock) {
            Console.WriteLine("CAPTURE-STOPPED");
            Console.Out.Flush();
        }
    }

    public static void Main(string[] args) {
        // Enable true DPI awareness for 100% accurate coordinate mapping on scaled Windows displays
        try {
            SetProcessDPIAware();
        } catch {}

        Console.WriteLine("V-REMOTE-READY");
        Console.Out.Flush();

        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                line = line.Trim();
                if (line.Length == 0) continue;
                string[] parts = line.Split(' ');
                string cmd = parts[0].ToLower();

                if (cmd == "move" && parts.Length >= 3) {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    SetCursorPos(x, y);
                    Cursor.Position = new Point(x, y);

                } else if (cmd == "click") {
                    string btn = parts.Length > 1 ? parts[1] : "left";
                    if (parts.Length >= 4) {
                        int x = int.Parse(parts[2]);
                        int y = int.Parse(parts[3]);
                        SetCursorPos(x, y);
                        Cursor.Position = new Point(x, y);
                    }
                    if (btn == "left") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(30);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(30);
                        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    } else if (btn == "double") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(20);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                        Thread.Sleep(60);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(20);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }

                } else if (cmd == "down") {
                    string btn = parts.Length > 1 ? parts[1] : "left";
                    if (parts.Length >= 4) {
                        int x = int.Parse(parts[2]);
                        int y = int.Parse(parts[3]);
                        SetCursorPos(x, y);
                        Cursor.Position = new Point(x, y);
                    }
                    mouse_event(btn == "right" ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);

                } else if (cmd == "up") {
                    string btn = parts.Length > 1 ? parts[1] : "left";
                    if (parts.Length >= 4) {
                        int x = int.Parse(parts[2]);
                        int y = int.Parse(parts[3]);
                        SetCursorPos(x, y);
                        Cursor.Position = new Point(x, y);
                    }
                    mouse_event(btn == "right" ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);

                } else if (cmd == "scroll" && parts.Length >= 2) {
                    int delta = int.Parse(parts[1]);
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);

                } else if (cmd == "key" && parts.Length >= 2) {
                    string keyString = line.Substring(4);
                    SendKeys.SendWait(keyString);

                } else if (cmd == "screen") {
                    int w = GetSystemMetrics(SM_CXSCREEN);
                    int h = GetSystemMetrics(SM_CYSCREEN);
                    lock (consoleLock) {
                        Console.WriteLine("SCREEN " + w + " " + h);
                        Console.Out.Flush();
                    }

                } else if (cmd == "capture") {
                    if (parts.Length >= 2 && parts[1].ToLower() == "start") {
                        if (!capturing) {
                            captureFps = parts.Length >= 3 ? int.Parse(parts[2]) : 10;
                            captureQuality = parts.Length >= 4 ? int.Parse(parts[3]) : 35;
                            capturing = true;
                            captureThread = new Thread(CaptureLoop);
                            captureThread.IsBackground = true;
                            captureThread.Start();
                            lock (consoleLock) {
                                Console.WriteLine("CAPTURE-STARTED fps=" + captureFps + " quality=" + captureQuality);
                                Console.Out.Flush();
                            }
                        }
                    } else if (parts.Length >= 2 && parts[1].ToLower() == "stop") {
                        capturing = false;
                        if (captureThread != null) {
                            captureThread.Join(3000);
                            captureThread = null;
                        }
                    } else if (parts.Length >= 2) {
                        string outPath = parts[1];
                        using (Bitmap bmp = CaptureScreenBitBlt()) {
                            bmp.Save(outPath, ImageFormat.Jpeg);
                        }
                        lock (consoleLock) {
                            Console.WriteLine("CAPTURED " + outPath);
                            Console.Out.Flush();
                        }
                    }

                } else if (cmd == "exit") {
                    capturing = false;
                    break;
                }

            } catch (Exception ex) {
                lock (consoleLock) {
                    Console.WriteLine("ERR: " + ex.Message);
                    Console.Out.Flush();
                }
            }
        }
        capturing = false;
    }
}
