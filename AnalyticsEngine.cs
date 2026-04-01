using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace RevitActiveQualityMonitor
{
    public class AnalyticsEngine
    {
        /// <summary>Returns all instance parameters available on a given category's elements.</summary>
        public static List<string> GetAnalyticsParameters(Document doc, string categoryStr)
        {
            if (!Enum.TryParse(categoryStr, out BuiltInCategory bic))
                return new List<string>();

            var el = new FilteredElementCollector(doc)
                .OfCategory(bic)
                .WhereElementIsNotElementType()
                .FirstOrDefault();

            var names = new HashSet<string> { "Level", "Family Type", "Family Name", "Workset", "Mark" };

            if (el != null)
            {
                foreach (Parameter p in el.Parameters)
                {
                    if (!string.IsNullOrWhiteSpace(p.Definition.Name))
                        names.Add(p.Definition.Name);
                }
                
                // Also check type parameters
                Element type = doc.GetElement(el.GetTypeId());
                if (type != null)
                {
                    foreach (Parameter p in type.Parameters)
                    {
                        if (!string.IsNullOrWhiteSpace(p.Definition.Name))
                            names.Add(p.Definition.Name);
                    }
                }
            }
            return names.OrderBy(n => n).ToList();
        }

        public static AnalyticsResult RunAnalytics(Document doc, AnalyticsRequest req)
        {
            var result = new AnalyticsResult { ChartId = req.ChartId };

            if (!Enum.TryParse(req.Category, out BuiltInCategory bic))
                return result;

            var elements = new FilteredElementCollector(doc)
                .OfCategory(bic)
                .WhereElementIsNotElementType()
                .ToList();

            if (elements.Count == 0) return result;

            // Determine Unit Suffix from first element's value parameter
            result.UnitSuffix = GetUnitSuffix(elements.FirstOrDefault(), req.ValueParameter);

            bool hasGroupBy = !string.IsNullOrWhiteSpace(req.GroupByParameter);

            if (hasGroupBy)
            {
                // Group elements by GroupByParameter value
                var groupings = elements.GroupBy(e => GetParamStringValue(e, req.GroupByParameter) ?? "Unknown")
                                        .OrderBy(g => g.Key)
                                        .ToList();

                result.Labels = groupings.Select(g => g.Key).ToList();

                if (req.AggregateFunction == "Count")
                {
                    var data = groupings.Select(g => (double)g.Count()).ToList();
                    result.Datasets.Add(new AnalyticsDataset { Label = "Count", Data = data });
                    result.TotalMetric = data.Sum();
                }
                else if (req.AggregateFunction == "CountUnique")
                {
                    var data = groupings.Select(g => (double)g.Select(e => GetParamStringValue(e, req.ValueParameter)).Distinct().Count()).ToList();
                    result.Datasets.Add(new AnalyticsDataset { Label = "Unique Count", Data = data });
                    result.TotalMetric = data.Sum();
                }
                else
                {
                    // Numeric Sum/Average: Should be ONE dataset by default for 1D grouping
                    var data = groupings.Select(g => AggregateElements(g.ToList(), req.ValueParameter, req.AggregateFunction)).ToList();
                    result.Datasets.Add(new AnalyticsDataset { Label = req.AggregateFunction, Data = data });
                    
                    // For total metric, we usually want the SUM across all elements for "Sum",
                    // or global average for "Average"
                    result.TotalMetric = AggregateElements(elements, req.ValueParameter, req.AggregateFunction);
                }
            }
            else
            {
                // No group-by: labels = unique values of ValueParameter (if text) or single point
                if (req.AggregateFunction == "CountUnique" || IsTextParameter(elements.FirstOrDefault(), req.ValueParameter))
                {
                    var allGroups = elements
                        .GroupBy(e => GetParamStringValue(e, req.ValueParameter) ?? "Unknown")
                        .OrderByDescending(g => g.Count())
                        .ToList();

                    // L2: Track total before truncation so the UI can warn the user
                    result.TotalUniqueValues = allGroups.Count;

                    var groups = allGroups.Take(15).ToList();

                    result.Labels = groups.Select(g => g.Key).ToList();
                    var data = groups.Select(g => (double)g.Count()).ToList();
                    result.Datasets.Add(new AnalyticsDataset { Label = "Count", Data = data });
                    result.TotalMetric = elements.Count;
                }
                else
                {
                    var totalValue = AggregateElements(elements, req.ValueParameter, req.AggregateFunction);
                    result.Labels = new List<string> { req.Category.Replace("OST_", "") };
                    result.Datasets.Add(new AnalyticsDataset { Label = req.AggregateFunction, Data = new List<double> { totalValue } });
                    result.TotalMetric = totalValue;
                }
            }

            return result;
        }

        private static double AggregateElements(List<Element> elements, string paramName, string func)
        {
            if (elements.Count == 0) return 0;

            switch (func)
            {
                case "Count":
                    return elements.Count;
                case "Sum":
                case "Average":
                {
                    var values = elements
                        .Select(e => GetParamDoubleValue(e, paramName))
                        .Where(v => v.HasValue)
                        .Select(v => v.Value)
                        .ToList();
                    if (values.Count == 0) return 0;
                    return func == "Sum" ? values.Sum() : values.Average();
                }
                default:
                    return elements.Count;
            }
        }

        private static string GetParamStringValue(Element el, string paramName)
        {
            if (paramName == "Level") return el.Document.GetElement(el.LevelId)?.Name ?? "None";
            if (paramName == "Family Type") return el.Document.GetElement(el.GetTypeId())?.Name ?? "Unknown";
            if (paramName == "Family Name") 
            {
                var type = el.Document.GetElement(el.GetTypeId()) as ElementType;
                return type?.FamilyName ?? "Unknown";
            }
            if (paramName == "Workset")
            {
                // M4: Guard against non-workshared documents where GetWorksetTable() may return null
                if (!el.Document.IsWorkshared) return "Not Workshared";
                return el.Document.GetWorksetTable()?.GetWorkset(el.WorksetId)?.Name ?? "None";
            }

            var p = el.LookupParameter(paramName);
            if (p == null) 
            {
                // Check Type parameters
                var type = el.Document.GetElement(el.GetTypeId());
                p = type?.LookupParameter(paramName);
            }
            
            if (p == null) return null;
            if (p.StorageType == StorageType.String) return p.AsString();
            if (p.StorageType == StorageType.ElementId)
            {
                var refEl = el.Document.GetElement(p.AsElementId());
                return refEl?.Name ?? p.AsElementId().ToString();
            }
            if (p.StorageType == StorageType.Double) return Math.Round(p.AsDouble(), 2).ToString();
            if (p.StorageType == StorageType.Integer) return p.AsInteger().ToString();
            return p.AsValueString();
        }

        private static double? GetParamDoubleValue(Element el, string paramName)
        {
            var p = el.LookupParameter(paramName);
            if (p == null)
            {
                var type = el.Document.GetElement(el.GetTypeId());
                p = type?.LookupParameter(paramName);
            }

            if (p == null) return null;
            if (p.StorageType == StorageType.Double)
            {
                try
                {
                    // Return converted internal units
                    return UnitUtils.ConvertFromInternalUnits(p.AsDouble(), p.GetUnitTypeId());
                }
                catch
                {
                    return p.AsDouble();
                }
            }
            if (p.StorageType == StorageType.Integer) return p.AsInteger();
            return null;
        }

        private static string GetUnitSuffix(Element el, string paramName)
        {
            if (el == null) return "";
            var p = el.LookupParameter(paramName);
            if (p == null)
            {
                 var type = el.Document.GetElement(el.GetTypeId());
                 p = type?.LookupParameter(paramName);
            }

            if (p == null) return "";
            
            // Heuristic for units
            string vs = p.AsValueString() ?? "";
            var parts = vs.Split(' ');
            if (parts.Length > 1) return parts.Last();
            
            // Common fallbacks
            if (paramName.Contains("Volume")) return "m³";
            if (paramName.Contains("Area")) return "m²";
            if (paramName.Contains("Length") || paramName.Contains("Width") || paramName.Contains("Height")) return "m";
            
            return "";
        }

        private static bool IsTextParameter(Element el, string paramName)
        {
            if (el == null) return true;
            var p = el.LookupParameter(paramName);
            if (p == null) return true;
            return p.StorageType == StorageType.String || p.StorageType == StorageType.ElementId;
        }
    }

    public class AnalyticsRequest
    {
        public string ChartId { get; set; }
        public string ChartType { get; set; }
        public string Category { get; set; }
        public string ValueParameter { get; set; }
        public string AggregateFunction { get; set; }
        public string GroupByParameter { get; set; }
    }

    public class AnalyticsResult
    {
        public string ChartId { get; set; }
        public List<string> Labels { get; set; } = new List<string>();
        public List<AnalyticsDataset> Datasets { get; set; } = new List<AnalyticsDataset>();
        public double TotalMetric { get; set; }
        public string UnitSuffix { get; set; }
        /// <summary>Total unique values before the top-15 display limit is applied. 0 when no truncation occurred.</summary>
        public int TotalUniqueValues { get; set; }
    }

    public class AnalyticsDataset
    {
        public string Label { get; set; }
        public List<double> Data { get; set; } = new List<double>();
    }
}
