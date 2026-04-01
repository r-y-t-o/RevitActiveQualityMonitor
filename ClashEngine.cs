using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

namespace RevitActiveQualityMonitor
{
    public class ClashEngine
    {
        public class LinkedModelInfo
        {
            public string Id { get; set; }
            public string Name { get; set; }
            public bool IsLoaded { get; set; }
        }

        public static List<object> GetLinkedModels(Document doc)
        {
            var result = new List<LinkedModelInfo>();
            
            // Tier 1: Instances (standard approach in RevitMCP)
            var instances = new FilteredElementCollector(doc)
                .OfClass(typeof(RevitLinkInstance))
                .Cast<RevitLinkInstance>()
                .ToList();

            foreach (var li in instances)
            {
                Document linkDoc = li.GetLinkDocument();
                string name = li.Name;
                if (name.Contains(".rvt")) name = name.Substring(0, name.IndexOf(".rvt") + 4);

                result.Add(new LinkedModelInfo
                {
                    Id = li.Id.ToString(),
                    Name = name,
                    IsLoaded = linkDoc != null
                });
            }

            // Tier 2: Link Types (Fallback for unloaded links)
            var linkTypes = new FilteredElementCollector(doc)
                .OfClass(typeof(RevitLinkType))
                .Cast<RevitLinkType>()
                .ToList();

            foreach (var lt in linkTypes)
            {
                // Avoid duplicates if instance already exists
                if (result.Any(r => r.Name.Contains(lt.Name) || lt.Name.Contains(r.Name))) continue;

                result.Add(new LinkedModelInfo
                {
                    Id = lt.Id.ToString(),
                    Name = lt.Name + " (Type)",
                    IsLoaded = lt.GetLinkedFileStatus() == LinkedFileStatus.Loaded
                });
            }

            // Tier 3: Category search (Exhaustive fallback)
            if (result.Count == 0)
            {
                var catLinks = new FilteredElementCollector(doc)
                    .OfCategory(BuiltInCategory.OST_RvtLinks)
                    .WhereElementIsNotElementType()
                    .ToList();

                foreach (var cl in catLinks)
                {
                    if (result.Any(r => r.Id == cl.Id.ToString())) continue;
                    result.Add(new LinkedModelInfo
                    {
                        Id = cl.Id.ToString(),
                        Name = cl.Name + " (Cat)",
                        IsLoaded = true
                    });
                }
            }

            return result.Cast<object>().ToList();
        }

        public static List<string> GetCommonCategories()
        {
            return new List<string>
            {
                BuiltInCategory.OST_Walls.ToString(),
                BuiltInCategory.OST_PipeCurves.ToString(),
                BuiltInCategory.OST_DuctCurves.ToString(),
                BuiltInCategory.OST_CableTray.ToString(),
                BuiltInCategory.OST_Conduit.ToString(),
                BuiltInCategory.OST_StructuralColumns.ToString(),
                BuiltInCategory.OST_StructuralFraming.ToString(),
                BuiltInCategory.OST_Floors.ToString(),
                BuiltInCategory.OST_MechanicalEquipment.ToString(),
                BuiltInCategory.OST_PlumbingFixtures.ToString()
            };
        }

        /// <summary>
        /// Returns only categories that have actual model elements present in the document.
        /// Two-step: scan elements to find present IDs, then look up proper BIC names via doc.Settings.Categories.
        /// This ensures MEP curve types (pipes, ducts) are always captured correctly.
        /// </summary>
        public static List<string> GetModelCategories(Document doc)
        {
            // Step 1: Collect the set of Category IDs that are actually used in the model
            var presentIds = new HashSet<long>();
            foreach (Element el in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                if (el.Category != null)
                    presentIds.Add(el.Category.Id.Value);
            }

            // Step 2: Walk doc.Settings.Categories (the authoritative list) and return BIC names
            // for any category whose ID is in the present set.
            var result = new List<string>();
            foreach (Category cat in doc.Settings.Categories)
            {
                if (!presentIds.Contains(cat.Id.Value)) continue;
                if (cat.CategoryType != CategoryType.Model) continue;
                try
                {
                    var bic = (BuiltInCategory)(int)cat.Id.Value;
                    string name = bic.ToString();
                    if (name.StartsWith("OST_")) result.Add(name);
                }
                catch { /* skip any category whose ID can't be mapped to a BIC */ }
            }
            return result.OrderBy(c => c).ToList();
        }

        public static List<string> GetLinkCategories(Document doc, string linkInstanceId)
        {
            if (!long.TryParse(linkInstanceId, out long idLong)) return new List<string>();
            
            ElementId id = new ElementId(idLong);
            RevitLinkInstance li = doc.GetElement(id) as RevitLinkInstance;
            if (li == null) return new List<string>();

            Document linkDoc = li.GetLinkDocument();
            if (linkDoc == null) return new List<string>();

            return GetModelCategories(linkDoc);
        }

        public static ClashReport RunClash(Document doc, List<ClashTestConfig> tests, Action<int, int> progressCallback = null)
        {
            var report = new ClashReport();
            if (tests == null || tests.Count == 0) return report;

            // Pre-calculate total elements across all tests for global progress
            int totalLinkElements = 0;
            foreach (var test in tests)
            {
                if (!Enum.TryParse(test.LinkCategory, out BuiltInCategory linkBic)) continue;
                if (!long.TryParse(test.LinkInstanceId, out long linkIdLong)) continue;
                var li = doc.GetElement(new ElementId(linkIdLong)) as RevitLinkInstance;
                var linkDoc = li?.GetLinkDocument();
                if (linkDoc != null)
                {
                    totalLinkElements += new FilteredElementCollector(linkDoc).OfCategory(linkBic).WhereElementIsNotElementType().GetElementCount();
                }
            }

            int totalProcessed = 0;
            foreach (var test in tests)
            {
                try
                {
                    int currentStart = 0;
                    bool testDone = false;
                    var testResult = new ClashTestResult
                    {
                        TestName = test.TestName ?? $"{test.HostCategory} vs {test.LinkCategory}",
                        LinkInstanceId = test.LinkInstanceId,
                        Clashes = new List<ClashResult>()
                    };

                    while (!testDone)
                    {
                        var batchResults = FindClashes(doc, test, out int processed, out testDone, currentStart, 100);
                        testResult.Clashes.AddRange(batchResults);
                        testResult.ClashCount += batchResults.Count;
                        
                        totalProcessed += processed;
                        currentStart += processed;

                        progressCallback?.Invoke(totalProcessed, totalLinkElements);
                    }

                    report.IndividualTestResults.Add(testResult);
                    report.TotalClashes += testResult.ClashCount;

                    foreach (var c in testResult.Clashes)
                    {
                        string key = $"{c.Category1} → {c.Category2}";
                        if (!report.ClashesByCategory.ContainsKey(key))
                            report.ClashesByCategory[key] = 0;
                        report.ClashesByCategory[key]++;

                        if (long.TryParse(c.ElementId1, out long id) && !report.HostElementIdsInvolved.Contains(id))
                            report.HostElementIdsInvolved.Add(id);
                    }
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"Error running clash test {test.TestName}: {ex.Message}");
                }
            }
            return report;
        }

        public static List<ClashResult> FindClashes(Document doc, ClashTestConfig config, out int processedCount, out bool isDone, int startElementIdx = 0, int batchSize = -1)
        {
            var results = new List<ClashResult>();
            processedCount = 0;
            isDone = true;

            if (!Enum.TryParse(config.HostCategory, out BuiltInCategory hostBic)) return results;
            if (!Enum.TryParse(config.LinkCategory, out BuiltInCategory linkBic)) return results;
            if (!long.TryParse(config.LinkInstanceId, out long linkIdLong)) return results;
            RevitLinkInstance li = doc.GetElement(new ElementId(linkIdLong)) as RevitLinkInstance;
            if (li == null) return results;

            Document linkDoc = li.GetLinkDocument();
            if (linkDoc == null) return results;

            var linkElements = new FilteredElementCollector(linkDoc)
                .OfCategory(linkBic)
                .WhereElementIsNotElementType()
                .ToList();

            int endIdx = batchSize == -1 ? linkElements.Count : Math.Min(startElementIdx + batchSize, linkElements.Count);
            
            for (int i = startElementIdx; i < endIdx; i++)
            {
                var linkEl = linkElements[i];
                processedCount++;

                var clashingHosts = new FilteredElementCollector(doc)
                    .OfCategory(hostBic)
                    .WhereElementIsNotElementType()
                    .WherePasses(new ElementIntersectsElementFilter(linkEl))
                    .ToElementIds();

                foreach (var hostId in clashingHosts)
                {
                    var hostEl = doc.GetElement(hostId);
                    string levelName = "No Level";
                    if (hostEl.LevelId != ElementId.InvalidElementId)
                        levelName = doc.GetElement(hostEl.LevelId)?.Name ?? "No Level";
                    else if (hostEl.Parameters.Cast<Parameter>().FirstOrDefault(p => p.Definition.Name == "Level")?.AsValueString() is string lv)
                        levelName = lv;

                    results.Add(new ClashResult
                    {
                        ElementId1 = hostEl.Id.ToString(),
                        ElementName1 = hostEl.Name,
                        Category1 = hostEl.Category?.Name ?? "Unknown",
                        ElementId2 = linkEl.Id.ToString(),
                        ElementName2 = linkEl.Name,
                        Category2 = linkEl.Category?.Name ?? "Unknown",
                        LinkName = li.Name,
                        LevelName = levelName
                    });
                }
            }

            isDone = endIdx >= linkElements.Count;
            return results;
        }

    }

    public class ClashAnalysisTask
    {
        public List<ClashTestConfig> Tests { get; set; }
        public ClashReport Report { get; set; } = new ClashReport();
        public int CurrentTestIndex { get; set; } = 0;
        public int CurrentElementIndex { get; set; } = 0;
        public bool IsFinished { get; set; } = false;
        public int BatchSize { get; set; } = 100; // Increased for performance, but small enough for responsiveness

        public int TotalLinkElements { get; private set; } = 0;
        public int TotalProcessedElements { get; private set; } = 0;
        private bool _initialized = false;

        public ClashAnalysisTask(List<ClashTestConfig> tests)
        {
            Tests = tests;
        }

        private void Initialize(Document doc)
        {
            TotalLinkElements = 0;
            foreach (var test in Tests)
            {
                if (!Enum.TryParse(test.LinkCategory, out BuiltInCategory linkBic)) continue;
                if (!long.TryParse(test.LinkInstanceId, out long linkIdLong)) continue;
                var li = doc.GetElement(new ElementId(linkIdLong)) as RevitLinkInstance;
                var linkDoc = li?.GetLinkDocument();
                if (linkDoc != null)
                {
                    TotalLinkElements += new FilteredElementCollector(linkDoc).OfCategory(linkBic).WhereElementIsNotElementType().GetElementCount();
                }
            }
            _initialized = true;
        }

        public void ProcessNextBatch(Document doc)
        {
            if (!_initialized) Initialize(doc);

            if (CurrentTestIndex >= Tests.Count)
            {
                IsFinished = true;
                return;
            }

            var test = Tests[CurrentTestIndex];
            string testTitle = test.TestName ?? $"{test.HostCategory} vs {test.LinkCategory}";
            var results = ClashEngine.FindClashes(doc, test, out int processed, out bool testDone, CurrentElementIndex, BatchSize);

            // Merge results into the report
            var testResult = Report.IndividualTestResults.FirstOrDefault(r => r.TestName == testTitle);
            if (testResult == null)
            {
                testResult = new ClashTestResult { TestName = testTitle, LinkInstanceId = test.LinkInstanceId, Clashes = new List<ClashResult>() };
                Report.IndividualTestResults.Add(testResult);
            }

            testResult.Clashes.AddRange(results);
            testResult.ClashCount += results.Count;
            Report.TotalClashes += results.Count;

            foreach (var c in results)
            {
                string key = $"{c.Category1} → {c.Category2}";
                if (!Report.ClashesByCategory.ContainsKey(key)) Report.ClashesByCategory[key] = 0;
                Report.ClashesByCategory[key]++;

                if (long.TryParse(c.ElementId1, out long id) && !Report.HostElementIdsInvolved.Contains(id))
                    Report.HostElementIdsInvolved.Add(id);
            }

            CurrentElementIndex += processed;
            TotalProcessedElements += processed;

            if (testDone)
            {
                CurrentTestIndex++;
                CurrentElementIndex = 0;
            }

            if (CurrentTestIndex >= Tests.Count)
                IsFinished = true;
        }
    }

    public class ClashTestConfig
    {
        public string TestName { get; set; }
        [JsonProperty("hostCat")]
        public string HostCategory { get; set; }
        [JsonProperty("linkInstanceId")]
        public string LinkInstanceId { get; set; }
        [JsonProperty("linkInstanceName")]
        public string LinkInstanceName { get; set; }
        [JsonProperty("linkCat")]
        public string LinkCategory { get; set; }
    }

    public class ClashReport
    {
        public int TotalClashes { get; set; } = 0;
        public Dictionary<string, int> ClashesByCategory { get; set; } = new Dictionary<string, int>();
        public List<ClashTestResult> IndividualTestResults { get; set; } = new List<ClashTestResult>();
        public List<long> HostElementIdsInvolved { get; set; } = new List<long>();
    }

    public class ClashTestResult
    {
        public string TestName { get; set; }
        public string LinkInstanceId { get; set; }
        public int ClashCount { get; set; }
        public List<ClashResult> Clashes { get; set; }
    }

    public class ClashResult
    {
        public string ElementId1 { get; set; }
        public string ElementName1 { get; set; }
        public string Category1 { get; set; }
        public string ElementId2 { get; set; }
        public string ElementName2 { get; set; }
        public string Category2 { get; set; }
        public string LinkName { get; set; }
        public string LevelName { get; set; }
    }
}
