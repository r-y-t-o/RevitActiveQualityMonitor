# Architectural Overview - Revit Active Quality Monitor

The Revit Active Quality Monitor is a high-performance BIM validation tool. It utilizes a **Hybrid UI** architecture (WPF + WebView2) to provide a modern, responsive user experience without locking the Revit main thread during heavy calculations.

## 1. System Components

### **The Hybrid UI (Frontend)**
- **Technologies**: Vanilla JavaScript (ES6+), HTML5, CSS3, Chart.js.
- **Environment**: Hosted inside a Microsoft WebView2 container within a Revit Dockable Pane.
- **Responsibility**: User interaction, data visualization (Treemaps, Doughnut charts), rule building, and reporting.

### **The Revit Engine (Backend)**
- **Technologies**: C#, .NET 8.0, Revit API.
- **Responsibility**: Model data extraction, geometric coordination (clash detection), rule evaluation, and Revit UI synchronization (isolation, zooming).

---

## 2. Communication Bridge (IPC)

Data flows between the Frontend (JavaScript) and Backend (C#) via the WebView2 `WebMessage` system.

### **UI -> Revit (Commands)**
1. JavaScript calls `window.chrome.webview.postMessage(jsonString)`.
2. `MainWindow.xaml.cs` receives the message and deserializes it.
3. If Revit API access is needed, it triggers an `IExternalEventHandler` (`AnalysisRequestHandler.cs`).

### **Revit -> UI (Responses & Progress)**
1. C# serializes response data into JSON.
2. `MainWindow.xaml.cs` calls `webView.CoreWebView2.PostWebMessageAsJson(jsonString)`.
3. JavaScript listens for the `message` event to update the UI.

---

## 3. High-Performance Strategy

To prevent Revit from "freezing" during long operations (like checking 10,000 links for clashes), the system uses **Batch Processing**:

- **AnalysisRequestHandler**: Breaks large tasks into smaller "batches" (e.g., 100 elements at a time).
- **Background Event Loop**: Between batches, the handler returns control to Revit for a few milliseconds (`RaiseExternalEvent()`). This allows Revit's internal UI to remain responsive to panning/zooming while the analysis continues.

---

## 4. Key Deployment Artifacts

- **`.addin` Manifest**: Directs Revit to load the assembly on startup.
- **`RevitActiveQualityMonitor.dll`**: The compiled C# logic.
- **`ui/` Folder**: Contains the HTML/JS/CSS assets bundled with the plugin.
- **`Resources/` Folder**: Contains the `Warning Category.csv` impact matrix.
