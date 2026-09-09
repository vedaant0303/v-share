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

    // --- Keyboard Control ---
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    // --- BitBlt Screen Capture (works in background sessions) ---
    [DllImport("user32.dll")]
    static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")]
    static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")]
    static extern IntPtr CreateDC(string d, string dev, string o, IntPtr p);
    [DllImport("gdi32.dll")]
    static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")]
    static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);
    [DllImport("gdi32.dll")]
    static extern IntPtr SelectObject(IntPtr hdc, IntPtr hObject);
    [DllImport("gdi32.dll", SetLastError = true)]
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
    const int CAPTUREBLT = 0x40000000;

    // Capture thread state
    static volatile bool capturing = false;
    static Thread captureThread = null;
    static int captureFps = 10;
    static int captureQuality = 35;
    static readonly object consoleLock = new object();

    static Bitmap CaptureScreenBitBlt() {
        int screenW = GetSystemMetrics(SM_CXSCREEN);
        int screenH = GetSystemMetrics(SM_CYSCREEN);
        if (screenW <= 0) screenW = 1920;
        if (screenH <= 0) screenH = 1080;

        IntPtr hDC = GetDC(IntPtr.Zero);
        IntPtr hMemDC = CreateCompatibleDC(hDC);
        IntPtr hBmp = CreateCompatibleBitmap(hDC, screenW, screenH);
        IntPtr hOld = SelectObject(hMemDC, hBmp);
        BitBlt(hMemDC, 0, 0, screenW, screenH, hDC, 0, 0, SRCCOPY | CAPTUREBLT);
        SelectObject(hMemDC, hOld);

        int targetW = screenW;
        int targetH = screenH;
        if (targetW > 1280) {
            targetH = (int)((double)screenH * 1280.0 / screenW);
            targetW = 1280;
        }

        Bitmap result = new Bitmap(targetW, targetH, PixelFormat.Format24bppRgb);
        using (Bitmap raw = Image.FromHbitmap(hBmp)) {
            using (Graphics g = Graphics.FromImage(result)) {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBilinear;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                g.DrawImage(raw, new Rectangle(0, 0, targetW, targetH), 0, 0, raw.Width, raw.Height, GraphicsUnit.Pixel);

                // Draw cursor indicator on captured frame
                try {
                    Point cur = Cursor.Position;
                    int curX = (int)((double)cur.X * targetW / screenW);
                    int curY = (int)((double)cur.Y * targetH / screenH);
                    using (SolidBrush cursorBrush = new SolidBrush(Color.FromArgb(230, 239, 68, 68))) {
                        g.FillEllipse(cursorBrush, curX - 4, curY - 4, 8, 8);
                    }
                    using (Pen cursorBorder = new Pen(Color.White, 1.5f)) {
                        g.DrawEllipse(cursorBorder, curX - 4, curY - 4, 8, 8);
                    }
                } catch {}
            }
        }

        DeleteObject(hBmp);
        DeleteDC(hMemDC);
        ReleaseDC(IntPtr.Zero, hDC);
        return result;
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

                } else if (cmd == "shortcut" && parts.Length >= 2) {
                    string sc = parts[1].ToLower();
                    if (sc == "win+d" || sc == "desktop") {
                        keybd_event(0x5B, 0, 0, 0); // LWin down
                        keybd_event(0x44, 0, 0, 0); // D down
                        keybd_event(0x44, 0, 2, 0); // D up
                        keybd_event(0x5B, 0, 2, 0); // LWin up
                    } else if (sc == "win" || sc == "start") {
                        keybd_event(0x5B, 0, 0, 0); // LWin down
                        keybd_event(0x5B, 0, 2, 0); // LWin up
                    } else if (sc == "taskmgr" || sc == "ctrl+shift+esc") {
                        keybd_event(0x11, 0, 0, 0); // Ctrl
                        keybd_event(0x10, 0, 0, 0); // Shift
                        keybd_event(0x1B, 0, 0, 0); // Esc
                        keybd_event(0x1B, 0, 2, 0);
                        keybd_event(0x10, 0, 2, 0);
                        keybd_event(0x11, 0, 2, 0);
                    }

                } else if (cmd == "screen") {
                    int w = GetSystemMetrics(SM_CXSCREEN);
                    int h = GetSystemMetrics(SM_CYSCREEN);
                    lock (consoleLock) {
                        Console.WriteLine("SCREEN " + w + " " + h);
                        Console.Out.Flush();
                    }

                } else if (cmd == "test") {
                    int w = GetSystemMetrics(SM_CXSCREEN);
                    int h = GetSystemMetrics(SM_CYSCREEN);
                    lock (consoleLock) {
                        Console.WriteLine("DIAG: Screen size = " + w + "x" + h);
                        try {
                            IntPtr hdcDisp = CreateDC("DISPLAY", null, null, IntPtr.Zero);
                            Console.WriteLine("  hdcDisp = " + hdcDisp);
                            IntPtr memDC = CreateCompatibleDC(hdcDisp);
                            Console.WriteLine("  memDC = " + memDC);
                            IntPtr hBmp = CreateCompatibleBitmap(hdcDisp, w, h);
                            Console.WriteLine("  hBmp = " + hBmp);
                            IntPtr old = SelectObject(memDC, hBmp);
                            Console.WriteLine("  old = " + old);
                            bool ok = BitBlt(memDC, 0, 0, w, h, hdcDisp, 0, 0, 0x00CC0020);
                            int err = Marshal.GetLastWin32Error();
                            Console.WriteLine("  BitBlt ok=" + ok + " err=" + err);
                            SelectObject(memDC, old);
                            DeleteObject(hBmp);
                            DeleteDC(memDC);
                            DeleteDC(hdcDisp);
                        } catch (Exception ex) {
                            Console.WriteLine("  EX: " + ex);
                        }

                        // Method B: GetDesktopWindow DC
                        try {
                            IntPtr hDesk = GetDesktopWindow();
                            Console.WriteLine("  hDesk = " + hDesk);
                            IntPtr hdcDesk = GetDC(hDesk);
                            Console.WriteLine("  hdcDesk = " + hdcDesk);
                            IntPtr memDC = CreateCompatibleDC(hdcDesk);
                            Console.WriteLine("  memDC = " + memDC);
                            IntPtr hBmp = CreateCompatibleBitmap(hdcDesk, w, h);
                            Console.WriteLine("  hBmp = " + hBmp);
                            IntPtr old = SelectObject(memDC, hBmp);
                            bool ok = BitBlt(memDC, 0, 0, w, h, hdcDesk, 0, 0, 0x00CC0020);
                            int err = Marshal.GetLastWin32Error();
                            Console.WriteLine("  BitBlt B ok=" + ok + " err=" + err);
                            SelectObject(memDC, old);
                            using (Bitmap b = Image.FromHbitmap(hBmp)) {
                                using (Bitmap c = new Bitmap(b)) {
                                    c.Save("diag_desk.jpg", ImageFormat.Jpeg);
                                    Console.WriteLine("DIAG-DESK: ok=" + ok + " size=" + new FileInfo("diag_desk.jpg").Length + " px=" + c.GetPixel(w/2, h/2));
                                }
                            }
                            DeleteObject(hBmp);
                            DeleteDC(memDC);
                            ReleaseDC(hDesk, hdcDesk);
                        } catch (Exception ex) {
                            Console.WriteLine("DIAG-DESK-ERR: " + ex.Message);
                        }
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
