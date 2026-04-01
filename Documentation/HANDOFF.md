# Project Handoff Documentation - Revit Active Quality Monitor (v1.2.7)

This document is the primary entry point for any developer or AI agent taking over the Revit Active Quality Monitor project. It provides a strategic overview, maintenance history, and pointers to deep-dive technical guides.

---

## 1. Project Mission & Context
The Revit Active Quality Monitor is a high-fidelity BIM quality assurance tool designed for Revit 2026. It provides **active feedback** (clash detection, rule validation, analytics) through a modern hybrid UI that remains responsive during heavy data-heavy calculations.

---

## 2. Latest Updates (v1.2.7)

### **Robust CSV Warning Matrix**
- **Issue**: Naive C# parsing was failing on multi-line Revit warning descriptions.
- **Fix**: Implemented a custom, quote-aware CSV parser in `ModelAnalytics.cs` that preserves multi-line fields and handles escaped quotes.
- **Result**: Warnings like "Grid is slightly off axis" are now correctly categorized as **High Impact (Red)**.

### **Enhanced Warnings Treemap**
- **Hierarchy**: Grouped by `['impact', 'label']` for better organization and color-coding consistency.
- **Tooltips**: Custom line-wrapping logic added to the tooltip title to show full warning descriptions.
- **Isolation**: Fixed the `onClick` handler to correctly access the `ids` from the hierarchical data nodes.
- **Labels**: Added automatic wrapping and auto-hiding for small boxes to maintain a premium look.

---

## 3. Comprehensive Technical Guides (v1.2.7 Location)

To navigate the 10,000+ line codebase, use the following guides in the `Documentation/` folder:

- **[ARCHITECTURAL_OVERVIEW.md](file:///c:/_Work/RevitActiveQualityMonitor/Documentation/ARCHITECTURAL_OVERVIEW.md)**: The map of the WPF -> WebView2 -> C# API bridge.
- **[SCRIPT_JS_DEEP_DIVE.md](file:///c:/_Work/RevitActiveQualityMonitor/Documentation/SCRIPT_JS_DEEP_DIVE.md)**: A detailed map of the 2,400+ line UI brain.
- **[BACKEND_DEEP_DIVE.md](file:///c:/_Work/RevitActiveQualityMonitor/Documentation/BACKEND_DEEP_DIVE.md)**: Technical detail on the C# engines, geometric coordination, and CSV parsing.

---

## 4. Maintenance History & Known Regressions

- **Treemap Color Drift**: Always use `ctx.raw?._data?.impact` for color lookups.
- **Version Synchronization**: Ensure that `ui/index.html` and `RevitActiveQualityMonitor.csproj` version tags are incremented in parallel for every deployment.

---

## 5. Standard Deployment Workflow

1.  Modify `ui/` files or `.cs` engines.
2.  Increment version in `index.html` AND `RevitActiveQualityMonitor.csproj`.
3.  Run **`deploy.bat`** (it builds the project AND syncs UI files).
4.  **Restart Revit 2026** to initialize the new manifest and assembly.
