using System;
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

            // Create Ribbon Panel
            RibbonPanel panel = application.CreateRibbonPanel("Quality Monitor");

            string thisAssemblyPath = Assembly.GetExecutingAssembly().Location;
            PushButtonData buttonData = new PushButtonData("cmdShowQualityMonitor",
               "Show Monitor", thisAssemblyPath, "RevitActiveQualityMonitor.Command");

            PushButton pushButton = panel.AddItem(buttonData) as PushButton;
            pushButton.ToolTip = "Show the Quality Monitor Dashboard";

            return Result.Succeeded;
        }

        public Result OnShutdown(UIControlledApplication application)
        {
            return Result.Succeeded;
        }
    }
}
