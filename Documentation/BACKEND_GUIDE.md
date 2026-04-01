# Backend Development Guide - Revit Active Quality Monitor

The backend is built as an Autodesk Revit 2026 Add-in using C# and .NET 8.0.

## 1. Engine Architecture

The project is divided into several specialized "Engines" for data processing.

### **[ClashEngine.cs](file:///c:/_Work/RevitActiveQualityMonitor/ClashEngine.cs)**
Handles geometric intersection between host elements and link instances.
- **Link Transforms**: Uses `li.GetTotalTransform()` to accurately map link element geometry into the host's coordinate space.
- **Granular Progress**: In v1.2.5, implemented element-by-element progress reporting via `TotalProcessedElements`.

### **[AnalyticsEngine.cs](file:///c:/_Work/RevitActiveQualityMonitor/AnalyticsEngine.cs)**
Provides a dynamic LINQ-like aggregation layer for any Revit category.
- **`RunAnalytics`**: Groups and aggregates data (Sum, Average, Count) based on user-defined parameters.
- **Unit Conversion**: Automatic conversion of internal Revit units (Feet) to UI-friendly units (Meters/Square Meters) using `UnitUtils`.

### **[RuleEngine.cs](file:///c:/_Work/RevitActiveQualityMonitor/RuleEngine.cs)**
The validation engine for customized quality rules.
- **Filtering**: First level of filtering by BuiltInCategories.
- **Conditions**: Second level of evaluation using operators (Equals, Contains, GreaterThan, etc.).

---

## 2. Infrastructure & IPC

### **[MainWindow.xaml.cs](file:///c:/_Work/RevitActiveQualityMonitor/MainWindow.xaml.cs)**
- **WebView2 Setup**: Initializes the browser control.
- **Message Dispatcher**: The `OnWebViewMessage` handler is the entry point for all UI-to-Revit commands.

### **[AnalysisRequestHandler.cs](file:///c:/_Work/RevitActiveQualityMonitor/AnalysisRequestHandler.cs)**
- **Revit API Thread**: Ensures all work happens on the Revit main thread (required by the API).
- **Background Event Loop**: Uses `RaiseExternalEvent()` to schedule work batches and report progress without locking the Revit UI.

---

## 3. Persistent Settings

**[SettingsManager.cs](file:///c:/_Work/RevitActiveQualityMonitor/SettingsManager.cs)**
- Stores `RuleSet` configurations in `%AppData%/Roaming/RevitActiveQualityMonitor/rules.json`.
- Uses `Newtonsoft.Json` for serialization.

---

## 4. Development Tips
- **Debugging**: Use `Logger.cs` and check Revit's journal.
- **Performance**: Use `FilteredElementCollector` with `WhereElementIsNotElementType()` and `WherePasses()` whenever possible rather than manual LINQ filters to avoid "slow" API calls.
- **Versioning**: Ensure the assembly version in `RevitActiveQualityMonitor.csproj` is updated in parallel with the `index.html` version.
- **Deployment**: Use the `deploy.bat` script to copy the `.addin` manifest and assembly to the Revit Add-ins folder.
