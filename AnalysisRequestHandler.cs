using System;
using System.Linq;
using Autodesk.Revit.UI;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Threading.Tasks;

namespace RevitActiveQualityMonitor
{
    public class AnalysisRequestHandler : IExternalEventHandler
    {
        private MainWindow _window;
        private readonly ConcurrentQueue<Action<UIApplication>> _actions = new ConcurrentQueue<Action<UIApplication>>();
        public ClashAnalysisTask ActiveClashTask { get; set; }

        public AnalysisRequestHandler(MainWindow window)
        {
            _window = window;
        }

        public void Execute(UIApplication app)
        {
            // 1. Process standard UI actions (high priority)
            while (_actions.TryDequeue(out var action))
            {
                try { 
                    Logger.Info($"Executing UI action: {action.Method.Name}");
                    action(app); 
                }
                catch (Exception ex) { 
                    Logger.Error("UI Action Failed", ex);
                    _window.PostCustomMessage(new { type = "systemError", payload = $"Internal action failed: {ex.Message}" });
                }
            }

            // 2. Process Next Batch of Clash Analysis (if active)
            if (ActiveClashTask != null && !ActiveClashTask.IsFinished)
            {
                try
                {
                    ActiveClashTask.ProcessNextBatch(app.ActiveUIDocument.Document);
                    
                    // Notify UI of progress
                    _window.PostCustomMessage(new { 
                        type = "clashProgress", 
                        payload = new { 
                            processed = ActiveClashTask.TotalProcessedElements, 
                            total = ActiveClashTask.TotalLinkElements,
                            isFinished = ActiveClashTask.IsFinished
                        } 
                    });

                    if (ActiveClashTask.IsFinished)
                    {
                        Logger.Info($"Clash analysis complete: {ActiveClashTask.Report.TotalClashes} results found.");
                        var report = ActiveClashTask.Report;
                        ActiveClashTask = null;
                        _window.PostCustomMessage(new { type = "clashResults", payload = report });
                    }
                    else
                    {
                        _window.RaiseExternalEvent();
                    }
                }
                catch (Exception ex)
                {
                    Logger.Error("Background Clash Failed", ex);
                    ActiveClashTask = null;
                    _window.PostCustomMessage(new { type = "systemError", payload = $"Clash process died: {ex.Message}" });
                }
            }
        }

        public void EnqueueAction(Action<UIApplication> action)
        {
            _actions.Enqueue(action);
            _window.RaiseExternalEvent();
        }

        public string GetName()
        {
            return "Quality Monitor Analysis";
        }

        // --- Helper Methods ---

        public void IsolateElements(UIDocument uidoc, List<long> elementIds)
        {
            Document doc = uidoc.Document;
            if (elementIds == null || elementIds.Count == 0) return;

            if (!(uidoc.ActiveView is View3D view3D))
            {
                TaskDialog.Show("Action Denied", "Please activate a 3D view before isolating elements.");
                return;
            }

            var revitIds = elementIds.Select(id => new ElementId(id)).ToList();

            using (Transaction t = new Transaction(doc, "Isolate Elements"))
            {
                t.Start();

                // Reset any existing temporary isolation so subsequent isolate calls work reliably
                if (view3D.IsInTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate))
                    view3D.DisableTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate);

                view3D.IsolateElementsTemporary(revitIds);

                OverrideGraphicSettings overrides = new OverrideGraphicSettings();
                Color red = new Color(255, 0, 0);
                
                FillPatternElement solidFill = new FilteredElementCollector(doc)
                    .OfClass(typeof(FillPatternElement))
                    .Cast<FillPatternElement>()
                    .FirstOrDefault(f => f.GetFillPattern().IsSolidFill);

                if (solidFill != null)
                {
                    overrides.SetSurfaceForegroundPatternId(solidFill.Id);
                    overrides.SetSurfaceForegroundPatternColor(red);
                    overrides.SetCutForegroundPatternId(solidFill.Id);
                    overrides.SetCutForegroundPatternColor(red);
                }
                
                overrides.SetProjectionLineColor(red);
                overrides.SetCutLineColor(red);

                foreach (var id in revitIds)
                {
                    try {
                        view3D.SetElementOverrides(id, overrides);
                    } catch { } 
                }
                t.Commit();
            }
            uidoc.Selection.SetElementIds(revitIds);
        }

        public void ResetView(UIDocument uidoc)
        {
            using (Transaction t = new Transaction(uidoc.Document, "Reset View"))
            {
                t.Start();
                uidoc.ActiveView.DisableTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate);
                t.Commit();
            }
        }

        public void CreateClashSectionBox(UIDocument uidoc, string hostIdStr, string linkIdStr, string linkInstIdStr)
        {
            Document doc = uidoc.Document;
            Logger.Info($"Creating Section Box for Host:{hostIdStr} vs Link:{linkIdStr}");

            // Require an active 3D view
            if (!(uidoc.ActiveView is View3D view3D))
            {
                TaskDialog.Show("Action Denied", "Please activate a 3D view before creating a section box.");
                return;
            }

            try
            {
                Element hostEl = doc.GetElement(new ElementId(long.Parse(hostIdStr)));
                ElementId liId = new ElementId(long.Parse(linkInstIdStr));
                RevitLinkInstance li = doc.GetElement(liId) as RevitLinkInstance;
                Document linkDoc = li?.GetLinkDocument();

                // H1: Guard against unloaded linked model
                if (linkDoc == null)
                {
                    TaskDialog.Show("Action Denied", "The linked model is not loaded. Please load the link and try again.");
                    return;
                }

                Element linkEl = linkDoc.GetElement(new ElementId(long.Parse(linkIdStr)));

                // 1. Build combined bounding box (correcting for link transform)
                BoundingBoxXYZ hostBB = hostEl.get_BoundingBox(null);
                BoundingBoxXYZ linkBB = linkEl.get_BoundingBox(null);

                // M5: Guard against elements with no geometry
                if (hostBB == null || linkBB == null)
                {
                    TaskDialog.Show("Action Denied", "One or more selected elements has no geometry — a section box cannot be created.");
                    return;
                }
                Transform trans = li.GetTotalTransform();

                XYZ p1 = trans.OfPoint(linkBB.Min);
                XYZ p2 = trans.OfPoint(linkBB.Max);
                BoundingBoxXYZ transLinkBB = new BoundingBoxXYZ
                {
                    Min = new XYZ(Math.Min(p1.X, p2.X), Math.Min(p1.Y, p2.Y), Math.Min(p1.Z, p2.Z)),
                    Max = new XYZ(Math.Max(p1.X, p2.X), Math.Max(p1.Y, p2.Y), Math.Max(p1.Z, p2.Z))
                };

                XYZ finalMin = new XYZ(Math.Min(hostBB.Min.X, transLinkBB.Min.X) - 2.0, Math.Min(hostBB.Min.Y, transLinkBB.Min.Y) - 2.0, Math.Min(hostBB.Min.Z, transLinkBB.Min.Z) - 2.0);
                XYZ finalMax = new XYZ(Math.Max(hostBB.Max.X, transLinkBB.Max.X) + 2.0, Math.Max(hostBB.Max.Y, transLinkBB.Max.Y) + 2.0, Math.Max(hostBB.Max.Z, transLinkBB.Max.Z) + 2.0);
                BoundingBoxXYZ finalBB = new BoundingBoxXYZ { Min = finalMin, Max = finalMax };

                // 2. Apply section box and colour overrides to the active 3D view
                FillPatternElement solidFill = new FilteredElementCollector(doc)
                    .OfClass(typeof(FillPatternElement))
                    .Cast<FillPatternElement>()
                    .FirstOrDefault(f => f.GetFillPattern().IsSolidFill);

                using (Transaction t = new Transaction(doc, "Clash Section Box"))
                {
                    t.Start();

                    view3D.SetSectionBox(finalBB);

                    // Reset any existing temporary isolation before applying a new one,
                    // otherwise the second (and subsequent) calls produce unreliable results.
                    if (view3D.IsInTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate))
                        view3D.DisableTemporaryViewMode(TemporaryViewMode.TemporaryHideIsolate);

                    // Isolate the host element and link instance — hides all other obstructing elements
                    view3D.IsolateElementsTemporary(new List<ElementId> { hostEl.Id, liId });

                    // Clear any stale colour overrides on the host element from a previous clash
                    view3D.SetElementOverrides(hostEl.Id, new OverrideGraphicSettings());

                    // Host element — red
                    OverrideGraphicSettings hostOver = new OverrideGraphicSettings();
                    hostOver.SetProjectionLineColor(new Color(255, 0, 0));
                    hostOver.SetCutLineColor(new Color(255, 0, 0));
                    if (solidFill != null)
                    {
                        hostOver.SetSurfaceForegroundPatternId(solidFill.Id);
                        hostOver.SetSurfaceForegroundPatternColor(new Color(255, 0, 0));
                        hostOver.SetCutForegroundPatternId(solidFill.Id);
                        hostOver.SetCutForegroundPatternColor(new Color(255, 0, 0));
                    }
                    view3D.SetElementOverrides(hostEl.Id, hostOver);

                    // Note: Revit API does not support per-element graphic overrides on elements
                    // within a linked model from the host document. SetElementOverrides on the
                    // RevitLinkInstance ID only affects the link container, not its geometry.
                    // The linked element is visible via the section box and isolation.

                    t.Commit();
                }

                uidoc.Selection.SetElementIds(new List<ElementId> { hostEl.Id });
            }
            catch (Exception ex)
            {
                Logger.Error("Section Box Creation Failed", ex);
                TaskDialog.Show("Error", $"Could not create section box: {ex.Message}");
            }
        }

        public List<string> GetParametersForCategories(Document doc, List<string> categoriesStr)
        {
            if (categoriesStr == null || categoriesStr.Count == 0) return new List<string>();
            var catFilters = categoriesStr.Select(c => Enum.TryParse(c, out BuiltInCategory bic) ? new ElementCategoryFilter(bic) : null)
                                        .Where(f => f != null).Cast<ElementFilter>().ToList();

            if (catFilters.Count == 0) return new List<string>();
            ElementFilter finalFilter = catFilters.Count == 1 ? catFilters[0] : new LogicalOrFilter(catFilters);

            var paramNames = new HashSet<string>();
            var elements = new FilteredElementCollector(doc).WhereElementIsNotElementType().WherePasses(finalFilter).Take(250);
            foreach (var el in elements)
            {
                foreach (Parameter p in el.Parameters)
                    if (p.Definition != null) paramNames.Add(p.Definition.Name);
            }
            var list = paramNames.ToList();
            list.Sort();
            return list;
        }

        public List<string> GetValuesForParameter(Document doc, List<string> categoriesStr, string parameterName)
        {
            if (categoriesStr == null || string.IsNullOrEmpty(parameterName)) return new List<string>();
            var catFilters = categoriesStr.Select(c => Enum.TryParse(c, out BuiltInCategory bic) ? new ElementCategoryFilter(bic) : null)
                                        .Where(f => f != null).Cast<ElementFilter>().ToList();

            if (catFilters.Count == 0) return new List<string>();
            ElementFilter finalFilter = catFilters.Count == 1 ? catFilters[0] : new LogicalOrFilter(catFilters);

            var uniqueValues = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var elements = new FilteredElementCollector(doc).WhereElementIsNotElementType().WherePasses(finalFilter).Take(10000);
            foreach (var el in elements)
            {
                Parameter p = el.LookupParameter(parameterName);
                if (p != null && p.HasValue)
                {
                    string val = p.AsValueString() ?? p.AsString();
                    if (!string.IsNullOrEmpty(val)) uniqueValues.Add(val);
                }
            }
            var list = uniqueValues.ToList();
            list.Sort();
            return list;
        }
    }
}
