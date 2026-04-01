# Frontend Development Guide - Revit Active Quality Monitor

The project's frontend is a single-page application (SPA) built with Vanilla JavaScript, HTML5, and CSS3. It is designed for maximum speed and minimal dependencies.

## 1. Core Structure

- **[index.html](file:///c:/_Work/RevitActiveQualityMonitor/ui/index.html)**: The main document. Includes Tab containers for Overview, Rules, Clash, and Analytics.
- **[style.css](file:///c:/_Work/RevitActiveQualityMonitor/ui/style.css)**: Uses CSS Variables for theming and a responsive, card-based grid layout.
- **[script.js](file:///c:/_Work/RevitActiveQualityMonitor/ui/script.js)**: The heart of the application. It handles all UI interactions and state synchronization.

---

## 2. Visualization Engines (Chart.js v4.x)

### **Warnings Treemap (Overview Tab)**
- **Hierarchy (v1.2.7)**: Changed from basic grouping to **`['impact', 'label']`**. This sections the treemap by impact level (**High**, **Low**, **No Impact**, **Other**) before detailing individual warning descriptions.
- **Coloration**: The `backgroundColor` callback must now handle the `impact` property from the grouped hierarchy.
- **Tooltip Wrapping**: Since Revit warnings are long, tooltips have a custom `wrapTooltipText` logic to ensure titles don't truncate.
- **Label Wrapping**: Treemap labels are now wrapped into multiple lines. Small boxes (width < 60px) automatically hide their labels to ensure a premium, clean layout.

### **Chart Lifecycle**
- **Cleanup**: Always call `chartInstance.destroy()` before re-rendering or removing a card to prevent memory leaks in the WebView2 process.

---

## 3. Communication Bridge (WebView2)

To send a command to Revit:
```javascript
sendMessage('actionName', { data: 123 });
```

To receive data from Revit:
```javascript
window.chrome.webview.addEventListener('message', event => {
    const message = JSON.parse(event.data);
});
```

---

## 4. UI Best Practices for this App

- **Micro-interactions**: Use CSS transitions for hover states on `stat-card` and `tm-node` elements.
- **Isolation Lifecycle**: When a treemap node is clicked, the `ids` are stored in the global `currentSelectionIds`. The **Isolate Elements** button then uses this state for the `isolateElements` command.
- **Dark Mode**: Supports `prefers-color-scheme` but defaults to a toggle button on the header. Ensure all custom chart colors are derived from CSS variables.
