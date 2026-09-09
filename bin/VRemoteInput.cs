using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class VRemoteInput {
    // Win32 SendInput Structures
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public MOUSEKEYBDHARDWAREINPUT mkhi;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct MOUSEKEYBDHARDWAREINPUT {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool LockWorkStation();

    // Input Types
    private const uint INPUT_MOUSE = 0;
    private const uint INPUT_KEYBOARD = 1;

    // Mouse Flags
    private const uint MOUSEEVENTF_MOVE       = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP     = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
    private const uint MOUSEEVENTF_WHEEL      = 0x0800;
    private const uint MOUSEEVENTF_ABSOLUTE   = 0x8000;

    // Keyboard constants
    private const uint KEYEVENTF_KEYUP       = 0x0002;
    private const byte VK_LWIN               = 0x5B;
    private const byte VK_VOLUME_MUTE        = 0xAD;
    private const byte VK_VOLUME_DOWN        = 0xAE;
    private const byte VK_VOLUME_UP          = 0xAF;

    // Background Unattended Screen Capture State
    private static volatile bool isCapturing = false;
    private static System.Threading.Thread captureThread = null;
    private static int captureFps = 20;
    private static int captureQuality = 60;
    private static int targetWidth = 1280;
    private static int targetHeight = 720;

    private static void SendMouseInput(uint flags, int x, int y, uint data = 0) {
        Rectangle bounds = Screen.PrimaryScreen.Bounds;
        int screenW = Math.Max(bounds.Width, 1);
        int screenH = Math.Max(bounds.Height, 1);
        int normX = (int)((x * 65535.0) / screenW);
        int normY = (int)((y * 65535.0) / screenH);

        INPUT[] inputs = new INPUT[1];
        inputs[0].type = INPUT_MOUSE;
        inputs[0].mkhi.mi.dx = normX;
        inputs[0].mkhi.mi.dy = normY;
        inputs[0].mkhi.mi.mouseData = data;
        inputs[0].mkhi.mi.dwFlags = flags | MOUSEEVENTF_ABSOLUTE;
        inputs[0].mkhi.mi.time = 0;
        inputs[0].mkhi.mi.dwExtraInfo = IntPtr.Zero;

        SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
    }

    private static ImageCodecInfo GetJpegEncoder() {
        ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
        foreach (ImageCodecInfo codec in codecs) {
            if (codec.FormatID == ImageFormat.Jpeg.Guid) return codec;
        }
        return null;
    }

    private static void StartCapture(int fps, int quality) {
        if (isCapturing) return;
        captureFps = Math.Max(5, Math.Min(fps, 30));
        captureQuality = Math.Max(20, Math.Min(quality, 85));
        isCapturing = true;

        captureThread = new System.Threading.Thread(CaptureLoop);
        captureThread.IsBackground = true;
        captureThread.Start();
        Console.WriteLine("CAPTURE-STARTED " + captureFps);
    }

    private static void StopCapture() {
        isCapturing = false;
        if (captureThread != null) {
            try { captureThread.Join(400); } catch {}
            captureThread = null;
        }
        Console.WriteLine("CAPTURE-STOPPED");
    }

    private static void CaptureLoop() {
        ImageCodecInfo jpgEncoder = GetJpegEncoder();
        EncoderParameters encoderParams = new EncoderParameters(1);
        encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, (long)captureQuality);

        Rectangle bounds = Screen.PrimaryScreen.Bounds;
        int origW = bounds.Width;
        int origH = bounds.Height;

        float scale = Math.Min((float)targetWidth / origW, (float)targetHeight / origH);
        int outW = (int)(origW * scale);
        int outH = (int)(origH * scale);

        using (Bitmap screenBmp = new Bitmap(origW, origH, PixelFormat.Format24bppRgb))
        using (Graphics gScreen = Graphics.FromImage(screenBmp))
        using (Bitmap scaledBmp = new Bitmap(outW, outH, PixelFormat.Format24bppRgb))
        using (Graphics gScaled = Graphics.FromImage(scaledBmp))
        using (MemoryStream ms = new MemoryStream()) {
            gScaled.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
            int sleepMs = 1000 / captureFps;

            while (isCapturing) {
                try {
                    gScreen.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);

                    try {
                        Point curPos = Cursor.Position;
                        gScreen.FillEllipse(Brushes.Red, curPos.X - 3, curPos.Y - 3, 7, 7);
                    } catch {}

                    gScaled.DrawImage(screenBmp, 0, 0, outW, outH);

                    ms.SetLength(0);
                    scaledBmp.Save(ms, jpgEncoder, encoderParams);
                    byte[] bytes = ms.ToArray();
                    string b64 = Convert.ToBase64String(bytes);

                    Console.WriteLine("FRAME " + b64);
                } catch (Exception ex) {
                    Console.WriteLine("ERR CAP: " + ex.Message);
                }

                System.Threading.Thread.Sleep(sleepMs);
            }
        }
    }

    public static void Main(string[] args) {
        Console.WriteLine("V-REMOTE-READY");
        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                string trimmed = line.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;

                string[] parts = trimmed.Split(' ');
                string cmd = parts[0].ToLowerInvariant();

                if (cmd == "move" && parts.Length >= 3) {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    Cursor.Position = new Point(x, y);
                    SendMouseInput(MOUSEEVENTF_MOVE, x, y);
                } else if (cmd == "click") {
                    string btn = parts.Length > 1 ? parts[1].ToLowerInvariant() : "left";
                    int x = Cursor.Position.X;
                    int y = Cursor.Position.Y;
                    if (parts.Length >= 4) {
                        x = int.Parse(parts[2]);
                        y = int.Parse(parts[3]);
                        Cursor.Position = new Point(x, y);
                    }
                    SendMouseInput(MOUSEEVENTF_MOVE, x, y);
                    System.Threading.Thread.Sleep(10);

                    if (btn == "left") {
                        SendMouseInput(MOUSEEVENTF_LEFTDOWN, x, y);
                        System.Threading.Thread.Sleep(25);
                        SendMouseInput(MOUSEEVENTF_LEFTUP, x, y);
                    } else if (btn == "right") {
                        SendMouseInput(MOUSEEVENTF_RIGHTDOWN, x, y);
                        System.Threading.Thread.Sleep(25);
                        SendMouseInput(MOUSEEVENTF_RIGHTUP, x, y);
                    } else if (btn == "middle") {
                        SendMouseInput(MOUSEEVENTF_MIDDLEDOWN, x, y);
                        System.Threading.Thread.Sleep(25);
                        SendMouseInput(MOUSEEVENTF_MIDDLEUP, x, y);
                    } else if (btn == "double") {
                        SendMouseInput(MOUSEEVENTF_LEFTDOWN, x, y);
                        System.Threading.Thread.Sleep(20);
                        SendMouseInput(MOUSEEVENTF_LEFTUP, x, y);
                        System.Threading.Thread.Sleep(60);
                        SendMouseInput(MOUSEEVENTF_LEFTDOWN, x, y);
                        System.Threading.Thread.Sleep(20);
                        SendMouseInput(MOUSEEVENTF_LEFTUP, x, y);
                    }
                } else if (cmd == "down") {
                    string btn = parts.Length > 1 ? parts[1].ToLowerInvariant() : "left";
                    int x = Cursor.Position.X;
                    int y = Cursor.Position.Y;
                    if (parts.Length >= 4) {
                        x = int.Parse(parts[2]);
                        y = int.Parse(parts[3]);
                        Cursor.Position = new Point(x, y);
                    }
                    SendMouseInput(MOUSEEVENTF_MOVE, x, y);
                    if (btn == "left") SendMouseInput(MOUSEEVENTF_LEFTDOWN, x, y);
                    else if (btn == "right") SendMouseInput(MOUSEEVENTF_RIGHTDOWN, x, y);
                } else if (cmd == "up") {
                    string btn = parts.Length > 1 ? parts[1].ToLowerInvariant() : "left";
                    int x = Cursor.Position.X;
                    int y = Cursor.Position.Y;
                    if (parts.Length >= 4) {
                        x = int.Parse(parts[2]);
                        y = int.Parse(parts[3]);
                        Cursor.Position = new Point(x, y);
                    }
                    SendMouseInput(MOUSEEVENTF_MOVE, x, y);
                    if (btn == "left") SendMouseInput(MOUSEEVENTF_LEFTUP, x, y);
                    else if (btn == "right") SendMouseInput(MOUSEEVENTF_RIGHTUP, x, y);
                } else if (cmd == "scroll" && parts.Length >= 2) {
                    int delta = int.Parse(parts[1]);
                    int x = Cursor.Position.X;
                    int y = Cursor.Position.Y;
                    SendMouseInput(MOUSEEVENTF_WHEEL, x, y, (uint)delta);
                } else if (cmd == "key" && parts.Length >= 2) {
                    string keyPayload = trimmed.Substring(4);
                    SendKeys.SendWait(keyPayload);
                } else if (cmd == "shortcut" && parts.Length >= 2) {
                    string action = parts[1].ToLowerInvariant();
                    if (action == "win") {
                        keybd_event(VK_LWIN, 0, 0, 0);
                        keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, 0);
                    } else if (action == "lock") {
                        LockWorkStation();
                    } else if (action == "explorer") {
                        Process.Start("explorer.exe");
                    } else if (action == "taskmgr") {
                        Process.Start("taskmgr.exe");
                    } else if (action == "volup") {
                        keybd_event(VK_VOLUME_UP, 0, 0, 0);
                        keybd_event(VK_VOLUME_UP, 0, KEYEVENTF_KEYUP, 0);
                    } else if (action == "voldown") {
                        keybd_event(VK_VOLUME_DOWN, 0, 0, 0);
                        keybd_event(VK_VOLUME_DOWN, 0, KEYEVENTF_KEYUP, 0);
                    } else if (action == "volmute") {
                        keybd_event(VK_VOLUME_MUTE, 0, 0, 0);
                        keybd_event(VK_VOLUME_MUTE, 0, KEYEVENTF_KEYUP, 0);
                    }
                } else if (cmd == "capture") {
                    if (parts.Length >= 2 && parts[1].ToLowerInvariant() == "start") {
                        int fps = parts.Length >= 3 ? int.Parse(parts[2]) : 20;
                        int quality = parts.Length >= 4 ? int.Parse(parts[3]) : 60;
                        StartCapture(fps, quality);
                    } else {
                        StopCapture();
                    }
                } else if (cmd == "screen") {
                    Rectangle bounds = Screen.PrimaryScreen.Bounds;
                    Console.WriteLine("SCREEN " + bounds.Width + " " + bounds.Height);
                } else if (cmd == "exit") {
                    StopCapture();
                    break;
                }
            } catch (Exception ex) {
                Console.WriteLine("ERR: " + ex.Message);
            }
        }
    }
}
