using System;
using System.IO;
using System.Text;

namespace RevitActiveQualityMonitor
{
    public static class Logger
    {
        private static readonly string LogFilePath;
        private static readonly object Lock = new object();

        static Logger()
        {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string logDir = Path.Combine(appData, "Autodesk", "Revit", "Addins", "2026", "RevitActiveQualityMonitor", "logs");
            
            if (!Directory.Exists(logDir))
                Directory.CreateDirectory(logDir);

            LogFilePath = Path.Combine(logDir, "latest_session.log");

            // Clear previous log on startup
            try { File.WriteAllText(LogFilePath, $"--- LOG STARTED AT {DateTime.Now} ---\r\n", Encoding.UTF8); }
            catch { }
        }

        public static void Info(string message) => Write("INFO", message);
        public static void Warning(string message) => Write("WARN", message);
        public static void Error(string message, Exception ex = null)
        {
            string detail = ex != null ? $"{message} | EX: {ex.Message}\n{ex.StackTrace}" : message;
            Write("ERROR", detail);
        }

        private static void Write(string level, string message)
        {
            lock (Lock)
            {
                try
                {
                    string entry = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] [{level}] {message}\r\n";
                    File.AppendAllText(LogFilePath, entry, Encoding.UTF8);
                    System.Diagnostics.Debug.WriteLine(entry);
                }
                catch { }
            }
        }

        public static string GetLogPath() => LogFilePath;
    }
}
