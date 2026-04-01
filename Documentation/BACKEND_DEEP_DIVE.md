# Backend Logic Deep Dive - Revit Active Quality Monitor

The Revit C# backend (~5,000 LOC total) manages data extraction, geometric coordination, and rule validation. This document explains the core engine logic.

## 1. ModelAnalytics: High-Performance CSV Parsing (v1.2.7)

In v1.2.7, a custom **`ParseCsv`** method was implemented in `ModelAnalytics.cs` to resolve bugs with Revit's multi-line warning descriptions and escaped quotes in `Warning Category.csv`.

### Key Features:
- **Quote-Aware Parsing**: Correctly identifies when a newline character is *inside* a quoted field (common in Revit's technical warnings) versus when it ends a record.
- **Escaped Quote Handling**: Handles the standard CSV escaping for double quotes (`""` -> `"`).
- **Impact Classification**: The logic now reliably matches warnings using "Equals" or "Contains" criteria, enabling the Red/Amber/Green treemap in the frontend.

---

## 2. AnalysisRequestHandler: The UI-to-API Bridge

Revit's API is strictly single-threaded. **`AnalysisRequestHandler.cs`** implements `IExternalEventHandler`, which is the only way a WebView2 (Chrome) process can safely interact with the Revit model.

- **Batching**: Large tasks are divided into smaller chunks (e.g., 100 elements) per event cycle.
- **Micro-Delays**: The handler uses `RaiseExternalEvent()` between batches, providing a few milliseconds for Revit to process its internal UI events (panning, zooming).

---

## 3. ClashEngine: Geometric Coordination

The **`ClashEngine.cs`** uses a state machine for coordination runs.

### Link Transforms
Link coordinates must be mapped into the host project's space.
```csharp
Transform linkTransform = li.GetTotalTransform();
// Elements from LinkDoc need this transform applied to their geometry
```

### Granular Progress Reporting
To avoid the progress bar jumping, the engine pre-calculates the `TotalLinkElements` across all selected categories. `TotalProcessedElements` is incremented after every individual element check.

---

## 4. AnalyticsEngine: BIM Data Aggregation

The **`AnalyticsEngine.cs`** utilizes **Reflection** and **LINQ** to provide a generic reporting layer.

- **Category Mapping**: Maps category strings back to `BuiltInCategory` enums.
- **Unit Conversion**: Automatic conversion of internal Revit units (Feet) to UI-friendly units (Meters/Square Meters) using `UnitUtils`.

---

## 5. Persistence: SettingsManager

**`SettingsManager.cs`** handles the serialization of user-defined rules.
- **Location**: `%AppData%/Roaming/RevitActiveQualityMonitor/rules.json`.
- **Format**: Standard JSON (using `Newtonsoft.Json`).
