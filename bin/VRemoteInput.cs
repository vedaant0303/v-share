using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class VRemoteInput {
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);

    private const int MOUSEEVENTF_LEFTDOWN = 0x02;
    private const int MOUSEEVENTF_LEFTUP = 0x04;
    private const int MOUSEEVENTF_RIGHTDOWN = 0x08;
    private const int MOUSEEVENTF_RIGHTUP = 0x10;
    private const int MOUSEEVENTF_WHEEL = 0x0800;

    public static void Main(string[] args) {
        Console.WriteLine("V-REMOTE-READY");
        string line;
        while ((line = Console.ReadLine()) != null) {
            try {
                string[] parts = line.Trim().Split(' ');
                if (parts.Length == 0) continue;
                string cmd = parts[0];

                if (cmd == "move" && parts.Length >= 3) {
                    int x = int.Parse(parts[1]);
                    int y = int.Parse(parts[2]);
                    Cursor.Position = new Point(x, y);
                } else if (cmd == "click") {
                    string btn = parts.Length > 1 ? parts[1] : "left";
                    if (parts.Length >= 4) {
                        int x = int.Parse(parts[2]);
                        int y = int.Parse(parts[3]);
                        Cursor.Position = new Point(x, y);
                    }
                    if (btn == "left") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        System.Threading.Thread.Sleep(25);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                        System.Threading.Thread.Sleep(25);
                        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    } else if (btn == "double") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        System.Threading.Thread.Sleep(25);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                        System.Threading.Thread.Sleep(50);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        System.Threading.Thread.Sleep(25);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }
                } else if (cmd == "down") {
                    string btn = parts.Length > 1 ? parts[1] : "left";
                    if (parts.Length >= 4) {
                        int x = int.Parse(parts[2]);
                        int y = int.Parse(parts[3]);
                        Cursor.Position = new Point(x, y);
                    }
                    if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                    } else {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                    }
                } else if (cmd == "up") {
                    string btn = parts.Length > 1 ? parts[1] : "left";
                    if (parts.Length >= 4) {
                        int x = int.Parse(parts[2]);
                        int y = int.Parse(parts[3]);
                        Cursor.Position = new Point(x, y);
                    }
                    if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    } else {
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }
                } else if (cmd == "scroll" && parts.Length >= 2) {
                    int delta = int.Parse(parts[1]);
                    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);
                } else if (cmd == "key" && parts.Length >= 2) {
                    string keyString = line.Substring(4);
                    SendKeys.SendWait(keyString);
                } else if (cmd == "screen") {
                    Rectangle bounds = Screen.PrimaryScreen.Bounds;
                    Console.WriteLine("SCREEN " + bounds.Width + " " + bounds.Height);
                } else if (cmd == "capture" && parts.Length >= 2) {
                    string outPath = parts[1];
                    Rectangle bounds = Screen.PrimaryScreen.Bounds;
                    using (Bitmap bmp = new Bitmap(bounds.Width, bounds.Height)) {
                        using (Graphics g = Graphics.FromImage(bmp)) {
                            g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                        }
                        bmp.Save(outPath, ImageFormat.Jpeg);
                    }
                    Console.WriteLine("CAPTURED " + outPath);
                } else if (cmd == "exit") {
                    break;
                }
            } catch (Exception ex) {
                Console.WriteLine("ERR: " + ex.Message);
            }
        }
    }
}
