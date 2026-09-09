using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class VRemoteInput {
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool LockWorkStation();

    // Mouse constants
    private const int MOUSEEVENTF_LEFTDOWN   = 0x0002;
    private const int MOUSEEVENTF_LEFTUP     = 0x0004;
    private const int MOUSEEVENTF_RIGHTDOWN  = 0x0008;
    private const int MOUSEEVENTF_RIGHTUP    = 0x0010;
    private const int MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const int MOUSEEVENTF_MIDDLEUP   = 0x0040;
    private const int MOUSEEVENTF_WHEEL      = 0x0800;

    // Keyboard constants
    private const uint KEYEVENTF_KEYUP       = 0x0002;
    private const byte VK_LWIN               = 0x5B;
    private const byte VK_VOLUME_MUTE        = 0xAD;
    private const byte VK_VOLUME_DOWN        = 0xAE;
    private const byte VK_VOLUME_UP          = 0xAF;
    private const byte VK_MEDIA_PLAY_PAUSE   = 0xB3;

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
                } else if (cmd == "click") {
                    string btn = parts.Length > 1 ? parts[1].ToLowerInvariant() : "left";
                    if (btn == "left") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    } else if (btn == "middle") {
                        mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0);
                    } else if (btn == "double") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }
                } else if (cmd == "down") {
                    string btn = parts.Length > 1 ? parts[1].ToLowerInvariant() : "left";
                    if (btn == "left") mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    else if (btn == "right") mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                } else if (cmd == "up") {
                    string btn = parts.Length > 1 ? parts[1].ToLowerInvariant() : "left";
                    if (btn == "left") mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    else if (btn == "right") mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                } else if (cmd == "scroll" && parts.Length >= 2) {
                    int delta = int.Parse(parts[1]);
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);
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
                } else if (cmd == "screen") {
                    Rectangle bounds = Screen.PrimaryScreen.Bounds;
                    Console.WriteLine("SCREEN " + bounds.Width + " " + bounds.Height);
                } else if (cmd == "exit") {
                    break;
                }
            } catch (Exception ex) {
                Console.WriteLine("ERR: " + ex.Message);
            }
        }
    }
}
