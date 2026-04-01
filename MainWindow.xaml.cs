using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.UI;
using Autodesk.Revit.DB;
using Microsoft.Web.WebView2.Core;
using Newtonsoft.Json;

namespace RevitActiveQualityMonitor
{
    public partial class MainWindow : Page, IDockablePaneProvider
    {
        private ExternalEvent _externalEvent;
        private AnalysisRequestHandler _handler;

        public void RaiseExternalEvent() => _externalEvent.Raise();

        public MainWindow()
        {
            InitializeComponent();
            InitializeWebView();
            
            _handler = new AnalysisRequestHandler(this);
            _externalEvent = ExternalEvent.Create(_handler);
        }

        private async void InitializeWebView()
        {
            try
            {
                string userDataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RevitActiveQualityMonitor", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, userDataFolder);
                await webView.EnsureCoreWebView2Async(env);

                string assemblyDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                string uiFolder = Path.Combine(assemblyDirectory, "ui");

                webView.CoreWebView2.SetVirtualHostNameToFolderMapping("qualitymonitor.local", uiFolder, CoreWebView2HostResourceAccessKind.Allow);

                var s = webView.CoreWebView2.Settings;
                s.AreDevToolsEnabled = false;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.IsZoomControlEnabled = false;
                
                webView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
                webView.CoreWebView2.Navigate("https://qualitymonitor.local/index.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show("Failed to initialize WebView2: " + ex.Message);
            }
        }

        private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;

                Logger.Info($"Web Message: {json}");
                var msg = JsonConvert.DeserializeObject<dynamic>(json);
                string action = msg.action;

                if (action == "refresh" || action == "refreshStats")
                {
                    _handler.EnqueueAction(app => {
                        var stats = ModelAnalytics.Analyze(app.ActiveUIDocument.Document);
                        PostCustomMessage(new { type = "updateData", payload = stats });
                    });
                }
                else if (action == "selectElements")
                {
                    string payloadStr = msg.payload.ToString();
                    var p = JsonConvert.DeserializeObject<IdsPayload>(payloadStr);
                    if (p != null && p.ids != null)
                    {
                        _handler.EnqueueAction(app => {
                            var ids = p.ids.Select(id => new Autodesk.Revit.DB.ElementId(long.Parse(id))).ToList();
                            app.ActiveUIDocument.Selection.SetElementIds(ids);
                            app.ActiveUIDocument.ShowElements(ids);
                        });
                    }
                }
                else if (action == "isolate")
                {
                    var ids = JsonConvert.DeserializeObject<List<long>>(msg.payload.ToString());
                    if (ids != null) _handler.EnqueueAction(app => _handler.IsolateElements(app.ActiveUIDocument, ids));
                }
                else if (action == "reset")
                {
                    _handler.EnqueueAction(app => _handler.ResetView(app.ActiveUIDocument));
                }
                else if (action == "createClashSectionBox")
                {
                    var p = JsonConvert.DeserializeObject<SectionBoxRequest>(msg.payload.ToString());
                    if (p != null) _handler.EnqueueAction(app => _handler.CreateClashSectionBox(app.ActiveUIDocument, p.hostId, p.linkId, p.linkInstId));
                }
                else if (action == "openLogs")
                {
                    try { System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{Logger.GetLogPath()}\""); }
                    catch (Exception ex) { Logger.Error("Explorer load failed", ex); }
                }
                else if (action == "runClash")
                {
                    var p = JsonConvert.DeserializeObject<ClashRunRequest>(msg.payload.ToString());
                    if (p?.tests != null) {
                        _handler.ActiveClashTask = new ClashAnalysisTask(p.tests);
                        PostCustomMessage(new { type = "clashRunning", payload = new { total = p.tests.Count } });
                        RaiseExternalEvent();
                    }
                }
                else if (action == "cancelClash")
                {
                    _handler.ActiveClashTask = null;
                    Logger.Info("Clash Analysis Cancelled");
                }
                else if (action == "getLinkedModels")
                {
                    _handler.EnqueueAction(app => {
                        var models = ClashEngine.GetLinkedModels(app.ActiveUIDocument.Document);
                        PostCustomMessage(new { type = "linkedModels", payload = models });
                    });
                }
                else if (action == "getHostCategories")
                {
                    _handler.EnqueueAction(app => {
                        var cats = ClashEngine.GetModelCategories(app.ActiveUIDocument.Document);
                        PostCustomMessage(new { type = "hostCategories", payload = cats });
                    });
                }
                else if (action == "getLinkCategories")
                {
                    var p = JsonConvert.DeserializeAnonymousType(msg.payload.ToString(), new { linkInstanceId = "" });
                    if (p != null) {
                        _handler.EnqueueAction(app => {
                            var cats = ClashEngine.GetLinkCategories(app.ActiveUIDocument.Document, p.linkInstanceId);
                            PostCustomMessage(new { type = "linkCategories", payload = cats });
                        });
                    }
                }
                else if (action == "getClashCategories")
                {
                    PostCustomMessage(new { type = "clashCategories", payload = ClashEngine.GetCommonCategories() });
                }
                else if (action == "saveRules")
                {
                    var rules = JsonConvert.DeserializeObject<List<RuleSet>>(msg.payload.ToString());
                    if (rules != null) SettingsManager.SaveRuleSets(rules);
                }
                else if (action == "getRules")
                {
                    PostCustomMessage(new { type = "ruleSettings", payload = SettingsManager.LoadRuleSets() });
                }
                else if (action == "exportRules")
                {
                    var dlg = new Microsoft.Win32.SaveFileDialog { DefaultExt = ".json", Filter = "JSON|*.json" };
                    if (dlg.ShowDialog() == true) File.WriteAllText(dlg.FileName, msg.payload.ToString());
                }
                else if (action == "importRules")
                {
                    var dlg = new Microsoft.Win32.OpenFileDialog { DefaultExt = ".json", Filter = "JSON|*.json" };
                    if (dlg.ShowDialog() == true) {
                        var imported = JsonConvert.DeserializeObject<List<RuleSet>>(File.ReadAllText(dlg.FileName));
                        if (imported != null) PostCustomMessage(new { type = "ruleSettings", payload = imported });
                    }
                }
                // H2: Export / import clash test configurations
                else if (action == "exportClashConfigs")
                {
                    var dlg = new Microsoft.Win32.SaveFileDialog { DefaultExt = ".json", Filter = "JSON|*.json", FileName = "clash_tests" };
                    if (dlg.ShowDialog() == true) File.WriteAllText(dlg.FileName, msg.payload.ToString());
                }
                else if (action == "importClashConfigs")
                {
                    var dlg = new Microsoft.Win32.OpenFileDialog { DefaultExt = ".json", Filter = "JSON|*.json" };
                    if (dlg.ShowDialog() == true)
                    {
                        var clashJson = File.ReadAllText(dlg.FileName);
                        PostCustomMessage(new { type = "clashConfigsLoaded", payload = clashJson });
                    }
                }
                // M6: Rule check evaluation runs separately from the overview refresh
                else if (action == "runRuleChecks")
                {
                    _handler.EnqueueAction(app => {
                        var ruleSetsData = SettingsManager.LoadRuleSets();
                        var results = (ruleSetsData != null && ruleSetsData.Count > 0)
                            ? RuleEngine.Evaluate(app.ActiveUIDocument.Document, ruleSetsData)
                            : new System.Collections.Generic.List<RuleSetResult>();
                        PostCustomMessage(new { type = "ruleCheckResults", payload = results });
                    });
                }
                else if (action == "runAnalytics")
                {
                    var p = JsonConvert.DeserializeObject<AnalyticsRequest>(msg.payload.ToString());
                    if (p != null) {
                        _handler.EnqueueAction(app => {
                            var report = AnalyticsEngine.RunAnalytics(app.ActiveUIDocument.Document, p);
                            PostCustomMessage(new { type = "analyticsResult", payload = report });
                        });
                    }
                }
                else if (action == "getParameters")
                {
                    var cats = JsonConvert.DeserializeObject<List<string>>(msg.payload.ToString());
                    _handler.EnqueueAction(app => {
                        var parameters = _handler.GetParametersForCategories(app.ActiveUIDocument.Document, cats);
                        PostCustomMessage(new { type = "ruleParameters", payload = parameters });
                    });
                }
                else if (action == "getParameterValues")
                {
                    var p = JsonConvert.DeserializeAnonymousType(msg.payload.ToString(), new { categories = new List<string>(), parameterName = "" });
                    _handler.EnqueueAction(app => {
                        var values = _handler.GetValuesForParameter(app.ActiveUIDocument.Document, p.categories, p.parameterName);
                        PostCustomMessage(new { type = "ruleParameterValues", payload = values });
                    });
                }
                else if (action == "getAnalyticsParameters")
                {
                    var p = JsonConvert.DeserializeAnonymousType(msg.payload.ToString(), new { category = "", chartId = "" });
                    if (p != null) {
                        _handler.EnqueueAction(app => {
                            var parameters = AnalyticsEngine.GetAnalyticsParameters(app.ActiveUIDocument.Document, p.category);
                            PostCustomMessage(new { type = "analyticsParameters", payload = parameters, chartId = p.chartId });
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.Error("Fatal UI Message Error", ex);
                PostCustomMessage(new { type = "systemError", payload = $"Critical error: {ex.Message}" });
            }
        }

        public void PostCustomMessage(object responseObject)
        {
             string json = JsonConvert.SerializeObject(responseObject);
             webView.Dispatcher.Invoke(() => {
                 webView.CoreWebView2.PostWebMessageAsString(json);
             });
        }

        public void SetupDockablePane(DockablePaneProviderData data)
        {
            data.FrameworkElement = this;
            data.InitialState = new DockablePaneState { DockPosition = DockPosition.Right };
        }

        public class IdsPayload { public List<string> ids { get; set; } }
        public class SectionBoxRequest { public string hostId { get; set; } public string linkId { get; set; } public string linkInstId { get; set; } }
        public class ClashRunRequest { public List<ClashTestConfig> tests { get; set; } }
    }
}
