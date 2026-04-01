using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using Autodesk.Revit.DB;

namespace RevitActiveQualityMonitor
{
    public class ModelAnalytics
    {
        public static ModelStats Analyze(Document doc)
        {
            ModelStats stats = new ModelStats();

            // Load Warning Categories CSV
            var rules = LoadWarningRules();

            // 1. Warnings and Classification
            IList<FailureMessage> warnings = doc.GetWarnings();
            var warningGroups = warnings
                .GroupBy(w => w.GetDescriptionText())
                .Select(g => new WarningStat 
                { 
                    Description = g.Key, 
                    Count = g.Count(),
                    Impact = ClassifyWarning(g.Key, rules),
                    ElementIds = g.SelectMany(w => w.GetFailingElements()).Select(id => id.Value).Distinct().ToList()
                })
                .ToList();
            
            stats.Warnings = warningGroups;

            // 2. Duplicates — categorised by element category using deduplicated element IDs
            // L3: DuplicatesReceived (raw warning reference count) was never used by the UI and
            //     was less accurate than the per-category totals, so it has been removed.
            var duplicateElements = new List<ElementId>();
            foreach(var w in warnings.Where(w => w.GetDescriptionText().Contains("identical instances")))
            {
                duplicateElements.AddRange(w.GetFailingElements());
            }
            
            var dupesByCategory = new Dictionary<string, DuplicateStat>();
            foreach(var eid in duplicateElements)
            {
                Element el = doc.GetElement(eid);
                if (el != null && el.Category != null)
                {
                    string catName = el.Category.Name;
                    if (!dupesByCategory.ContainsKey(catName)) 
                    {
                        dupesByCategory[catName] = new DuplicateStat();
                    }
                    dupesByCategory[catName].Count++;
                    dupesByCategory[catName].ElementIds.Add(eid.Value);
                }
            }
            stats.DuplicatesByCategory = dupesByCategory;


            // 3. CAD Imports / Links
            var imports = new FilteredElementCollector(doc)
                .OfClass(typeof(ImportInstance))
                .Cast<ImportInstance>()
                .ToList();
            
            stats.CadImportsCount = imports.Count(i => !i.IsLinked);
            stats.CadLinksCount = imports.Count(i => i.IsLinked);


            // 4. File Size
            if (!string.IsNullOrEmpty(doc.PathName) && File.Exists(doc.PathName))
            {
                FileInfo fi = new FileInfo(doc.PathName);
                stats.FileSizeMB = Math.Round(fi.Length / 1024.0 / 1024.0, 2);
            }
            else
            {
                stats.FileSizeMB = 0;
            }

            // 5. In-Place Families
            var familyInstances = new FilteredElementCollector(doc)
                .OfClass(typeof(FamilyInstance))
                .Cast<FamilyInstance>()
                .Where(fi => fi.Symbol != null && fi.Symbol.Family != null && fi.Symbol.Family.IsInPlace)
                .ToList();
            stats.InPlaceFamiliesCount = familyInstances.Count;
            stats.InPlaceFamilyIds = familyInstances.Select(f => f.Id.Value).ToList();


            // 6. Views without Templates
            var views = new FilteredElementCollector(doc)
                .OfClass(typeof(View))
                .Cast<View>()
                .Where(v => !v.IsTemplate && v.ViewTemplateId == ElementId.InvalidElementId && v.CanHaveViewTemplate())
                .ToList();
            stats.UntemplatedViewsCount = views.Count;

            // 8. Generic Models
            var genericModels = new FilteredElementCollector(doc)
                .WhereElementIsNotElementType()
                .OfCategory(BuiltInCategory.OST_GenericModel)
                .ToElements();
                
            stats.GenericModelsCount = genericModels.Count;
            stats.GenericModelIds = genericModels.Select(e => e.Id.Value).ToList();

            // 9. Unpinned Links
            var revitLinks = new FilteredElementCollector(doc)
                .WhereElementIsNotElementType()
                .OfClass(typeof(RevitLinkInstance))
                .Cast<RevitLinkInstance>()
                .ToList();
            
            stats.UnpinnedLinksCount = revitLinks.Count(l => !l.Pinned);


            // 10. Groups
            var groups = new FilteredElementCollector(doc)
                .OfClass(typeof(Group))
                .ToElements();
            stats.GroupsCount = groups.Count;
            stats.GroupIds = groups.Select(e => e.Id.Value).ToList();

            // 7. Purgeable Elements (Revit 2024+ API)
            try
            {
                var unusedIds = doc.GetUnusedElements(new HashSet<ElementId>());
                stats.PurgeableCount = unusedIds.Count.ToString();
            }
            catch (Exception)
            {
                stats.PurgeableCount = "Not available";
            }

            // Rule Checks are evaluated separately via the 'runRuleChecks' action (M6) so that
            // the expensive per-rule FilteredElementCollector queries don't block every overview refresh.

            return stats;
        }
        private static List<WarningRule> LoadWarningRules()
        {
            var rules = new List<WarningRule>();
            try
            {
                string assemblyPath = Assembly.GetExecutingAssembly().Location;
                string csvPath = Path.Combine(Path.GetDirectoryName(assemblyPath), "Resources", "Warning Category.csv");
                
                if (!File.Exists(csvPath))
                {
                   string projRoot = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(assemblyPath), @"..\..\..\"));
                   csvPath = Path.Combine(projRoot, "Resources", "Warning Category.csv");
                }

                if (File.Exists(csvPath))
                {
                    string csvContent = File.ReadAllText(csvPath);
                    var records = ParseCsv(csvContent);

                    // Skip header
                    foreach (var record in records.Skip(1))
                    {
                        if (record.Count >= 3 && !string.IsNullOrWhiteSpace(record[1]))
                        {
                            rules.Add(new WarningRule 
                            { 
                                Text = record[0], 
                                Impact = record[1], 
                                Condition = record[2] 
                            });
                        }
                    }
                }
            }
            catch (Exception) { }
            return rules;
        }

        private static List<List<string>> ParseCsv(string content)
        {
            var results = new List<List<string>>();
            var currentRecord = new List<string>();
            var currentValue = new StringBuilder();
            bool inQuotes = false;

            for (int i = 0; i < content.Length; i++)
            {
                char c = content[i];

                if (inQuotes)
                {
                    if (c == '"')
                    {
                        // Check for escaped double quotes
                        if (i + 1 < content.Length && content[i + 1] == '"')
                        {
                            currentValue.Append('"');
                            i++;
                        }
                        else
                        {
                            inQuotes = false;
                        }
                    }
                    else
                    {
                        currentValue.Append(c);
                    }
                }
                else
                {
                    if (c == '"')
                    {
                        inQuotes = true;
                    }
                    else if (c == ',')
                    {
                        currentRecord.Add(currentValue.ToString().Trim());
                        currentValue.Clear();
                    }
                    else if (c == '\n' || c == '\r')
                    {
                        // CRLF handling
                        bool isCRLF = (c == '\r' && i + 1 < content.Length && content[i + 1] == '\n');
                        
                        currentRecord.Add(currentValue.ToString().Trim());
                        currentValue.Clear();

                        if (currentRecord.Any(v => !string.IsNullOrWhiteSpace(v)))
                        {
                            results.Add(currentRecord);
                        }
                        currentRecord = new List<string>();

                        if (isCRLF) i++;
                    }
                    else
                    {
                        currentValue.Append(c);
                    }
                }
            }

            // Final record if anything remains
            if (currentValue.Length > 0 || currentRecord.Count > 0)
            {
                currentRecord.Add(currentValue.ToString().Trim());
                if (currentRecord.Any(v => !string.IsNullOrWhiteSpace(v)))
                {
                    results.Add(currentRecord);
                }
            }

            return results;
        }



        private static string ClassifyWarning(string description, List<WarningRule> rules)
        {
            // First check for exact matches
            var exactMatch = rules.FirstOrDefault(r => r.Condition.Equals("Equals", StringComparison.OrdinalIgnoreCase) && 
                                                       description.Equals(r.Text, StringComparison.OrdinalIgnoreCase));
            if (exactMatch != null && !string.IsNullOrEmpty(exactMatch.Impact))
                return exactMatch.Impact;

            // Then check for contains
            var containsMatch = rules.FirstOrDefault(r => r.Condition.Equals("Contains", StringComparison.OrdinalIgnoreCase) && 
                                                          description.IndexOf(r.Text, StringComparison.OrdinalIgnoreCase) >= 0);
            if (containsMatch != null && !string.IsNullOrEmpty(containsMatch.Impact))
                return containsMatch.Impact;

            return "Unclassified";
        }
    }

    public class ModelStats
    {
        public List<WarningStat> Warnings { get; set; } = new List<WarningStat>();
        public Dictionary<string, DuplicateStat> DuplicatesByCategory { get; set; } = new Dictionary<string, DuplicateStat>();
        public int CadImportsCount { get; set; }
        public int CadLinksCount { get; set; }
        public double FileSizeMB { get; set; }
        public int InPlaceFamiliesCount { get; set; }
        public int UntemplatedViewsCount { get; set; }
        public string PurgeableCount { get; set; }
        public int GenericModelsCount { get; set; }
        public int UnpinnedLinksCount { get; set; }
        public int GroupsCount { get; set; }

        public List<long> GenericModelIds { get; set; } = new List<long>();
        public List<long> InPlaceFamilyIds { get; set; } = new List<long>();
        public List<long> GroupIds { get; set; } = new List<long>();
        public List<RuleSetResult> RuleResults { get; set; } = new List<RuleSetResult>();
    }

    public class DuplicateStat
    {
        public int Count { get; set; }
        public List<long> ElementIds { get; set; } = new List<long>();
    }

    public class WarningRule
    {
        public string Text { get; set; }
        public string Impact { get; set; }
        public string Condition { get; set; }
    }

    public class WarningStat
    {
        public string Description { get; set; }
        public int Count { get; set; }
        public string Impact { get; set; }
        public List<long> ElementIds { get; set; } = new List<long>();
    }
    
    // Helper to check if view can have template (skip internal views, browser organization etc)
    public static class ViewExtension
    {
         public static bool CanHaveViewTemplate(this View view)
         {
             // L6: Extended to include all view types that Revit allows view templates on
             return view.ViewType == ViewType.FloorPlan ||
                    view.ViewType == ViewType.CeilingPlan ||
                    view.ViewType == ViewType.Elevation ||
                    view.ViewType == ViewType.ThreeD ||
                    view.ViewType == ViewType.Section ||
                    view.ViewType == ViewType.Detail ||
                    view.ViewType == ViewType.DraftingView ||
                    view.ViewType == ViewType.Legend;
         }
    }
}
