# Revit Active Quality Monitor

A Revit 2026 dockable-pane plugin that provides real-time quality monitoring, clash detection, rule-based checks, and analytics for your active Revit model.

## Features

- **Model Overview** — live stats on warnings, views, worksets, linked models, and more
- **Clash Detection** — run customisable clash tests between host and linked model categories, visualise results, create section boxes at clash locations
- **Rule Checks** — define parameter-based rule sets (e.g. "all Doors must have a Fire Rating") and evaluate them on demand; import/export rule configurations
- **Analytics** — chart element counts and parameter distributions by category using bar, pie, and treemap visualisations
- **Light / Dark theme** — toggle and persisted across sessions

## Requirements

| Requirement | Version |
|---|---|
| Autodesk Revit | 2026 |
| Windows | 10 or later (64-bit) |
| WebView2 Runtime | Evergreen (ships with Edge / Windows 11) |

> **WebView2** is usually already installed on Windows 10/11 machines that have Microsoft Edge. If the panel fails to load, download the [Evergreen WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

## Installation

### Option A — PowerShell installer (recommended)

1. Download the latest `RevitActiveQualityMonitor-v*.zip` from the [Releases](../../releases) page.
2. Extract the ZIP.
3. Right-click `Install.ps1` → **Run with PowerShell**.
4. Restart Revit 2026.
5. The **Quality Monitor** panel appears under **Add-ins → Quality Monitor → Open Panel**.

### Option B — Manual

1. Download and extract the ZIP as above.
2. Copy the `RevitActiveQualityMonitor\` folder to:
   ```
   %AppData%\Autodesk\Revit\Addins\2026\
   ```
   The result should be `%AppData%\Autodesk\Revit\Addins\2026\RevitActiveQualityMonitor\`.
3. Copy `RevitActiveQualityMonitor.addin` to:
   ```
   %AppData%\Autodesk\Revit\Addins\2026\
   ```
4. Restart Revit 2026.

## Uninstallation

Run `Uninstall.ps1` from the extracted ZIP, or manually delete:
- `%AppData%\Autodesk\Revit\Addins\2026\RevitActiveQualityMonitor\`
- `%AppData%\Autodesk\Revit\Addins\2026\RevitActiveQualityMonitor.addin`

## Building from Source

**Prerequisites:** .NET 8 SDK, Revit 2026 installed at the default path.

```bash
git clone https://github.com/<your-username>/RevitActiveQualityMonitor.git
cd RevitActiveQualityMonitor
dotnet build -c Release
```

Output is placed in `bin\Release\`.

To build and deploy directly to your local Revit 2026 addins folder:

```bat
deploy.bat
```

## Project Structure

```
RevitActiveQualityMonitor/
├── App.cs                         # IExternalApplication entry point
├── Command.cs                     # Ribbon button command
├── MainWindow.xaml(.cs)           # Dockable pane host + JS bridge
├── AnalysisRequestHandler.cs      # IExternalEventHandler (Revit thread work)
├── ModelAnalytics.cs              # Overview stats collector
├── ClashEngine.cs                 # Clash detection logic
├── RuleEngine.cs                  # Rule evaluation engine
├── AnalyticsEngine.cs             # Parameter analytics
├── SettingsManager.cs             # Rule persistence (rulesets.json)
├── Logger.cs                      # File logger
├── ui/
│   ├── index.html                 # Single-page app shell
│   ├── script.js                  # All UI logic
│   └── style.css                  # Theming (CSS variables)
├── Resources/                     # Icons / images
└── RevitActiveQualityMonitor.addin
```

## Release Workflow

Releases are automated via GitHub Actions. Pushing a tag in the form `v*` (e.g. `v1.3.8`) triggers:

1. `dotnet build -c Release`
2. Packaging into `RevitActiveQualityMonitor-v<tag>.zip`
3. A draft GitHub Release with the ZIP attached

## License

MIT — see [LICENSE](LICENSE) for details.
