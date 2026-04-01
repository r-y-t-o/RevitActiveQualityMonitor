# script.js Deep Dive - Revit Active Quality Monitor

The `script.js` file (~2,500 LOC) is the core logic engine of the Quality Monitor's frontend. This document explains the most complex sections.

## 1. Global State Management

The frontend maintains several key state variables that must be synchronized correctly.

- **`currentSelectionIds`**: An array of element IDs currently selected via a chart or treemap node. This is the source of truth for the **Isolate Elements** and **Zoom** buttons.
- **`warningsTreemap`**: The Chart.js instance for the warnings distribution.
- **`ruleSets`**: The current list of rules and datasets (clash types, categories) loaded from the backend.

---

## 2. Warnings Treemap: Hierarchical Grouping

The warnings treemap utilizes the **`chartjs-chart-treemap`** plugin.

```javascript
// Groups section in datasets
groups: ['impact', 'label'],
```

### Key Considerations:
- **Hierarchical Layout**: By grouping by `'impact'` first, the treemap automatically sections nodes into Red, Amber, Green, and Indigo areas.
- **Data Access**: In the `backgroundColor` and `tooltip` callbacks, use `ctx.raw?._data?.impact` to access the original item properties after the grouping process.
- **Click Recognition**: The `onClick` handler uses `getElementsAtEventForMode(evt, 'nearest', ...)` to reliably identify which warning box was clicked.

---

## 3. The Communication Bridge (`sendMessage`)

All communication to Revit is handled via a standardized JSON packet.

```javascript
function sendMessage(type, payload = {}) {
    if (window.chrome && window.chrome.webview) {
        const message = JSON.stringify({ type, payload });
        window.chrome.webview.postMessage(message);
    }
}
```

### Critical Commands:
- **`runWarningsAnalysis`**: Updates the overview tab.
- **`isolateElements`**: Highlights/Isolates elements in the active Revit 3D view.
- **`runClashDetection`**: Triggers the geometric engine in C#.

---

## 4. UI Rendering Logic

### **Doughnut Charts (Rule Checks)**
- **Reusability**: `renderRuleSetChart` is a generic component used for all rule results.
- **Cleanup**: The application maintains a `ruleCharts` array to track instances. These are destroyed before each refresh to prevent performance degradation.

### **Metric Updates**
- **Overview Stat Cards**: Updated via `updateMetricCards(stats)`. Each card targets a specific element ID (e.g., `file-size`, `generic-models`).
- **Formatting**: numerical values are formatted using `toLocaleString()` for professional presentation.
