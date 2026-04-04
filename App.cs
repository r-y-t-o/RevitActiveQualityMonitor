using System;
using System.IO;
using System.Reflection;
using Autodesk.Revit.UI;
using Autodesk.Revit.DB;
using System.Windows.Media.Imaging;

namespace RevitActiveQualityMonitor
{
    public class App : IExternalApplication
    {
        public static DockablePaneId PaneId = new DockablePaneId(new Guid("D7C5D1F6-4E2A-4B9C-9D0E-8F3A6B4C1E5D"));

        public Result OnStartup(UIControlledApplication application)
        {
            // Register Dockable Pane
            try
            {
                MainWindow page = new MainWindow();
                application.RegisterDockablePane(PaneId, "Quality Monitor", page as IDockablePaneProvider);
            }
            catch (Exception ex)
            {
                TaskDialog.Show("Error", "Failed to register dockable pane: " + ex.Message);
                return Result.Failed;
            }

            // Create dedicated ribbon tab
            const string tabName = "Design Automation Hub";
            try { application.CreateRibbonTab(tabName); } catch { /* already exists */ }

            // Create panel on that tab
            RibbonPanel panel = application.CreateRibbonPanel(tabName, "Quality Monitor");

            string assemblyPath = Assembly.GetExecutingAssembly().Location;
            string resourcesDir = Path.Combine(Path.GetDirectoryName(assemblyPath), "Resources");

            PushButtonData buttonData = new PushButtonData(
                "cmdShowQualityMonitor", "Quality\nMonitor", assemblyPath, "RevitActiveQualityMonitor.Command");

            PushButton pushButton = panel.AddItem(buttonData) as PushButton;
            pushButton.ToolTip = "Open the Quality Monitor dashboard";

            // Load icons from the Resources folder (copied alongside the DLL)
            string icon32Path = Path.Combine(resourcesDir, "icon_32.png");
            string icon16Path = Path.Combine(resourcesDir, "icon_16.png");

            if (File.Exists(icon32Path))
                pushButton.LargeImage = LoadImage(icon32Path);

            if (File.Exists(icon16Path))
                pushButton.Image = LoadImage(icon16Path);

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            return Result.Succeeded;
        }

        private static BitmapImage LoadImage(string path)
        {
            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.UriSource = new Uri(path, UriKind.Absolute);
            image.EndInit();
            return image;
        }
    }
}
