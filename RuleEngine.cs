using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace RevitActiveQualityMonitor
{
    public class RuleEngine
    {
        public static List<RuleSetResult> Evaluate(Document doc, List<RuleSet> ruleSets)
        {
            var results = new List<RuleSetResult>();

            foreach (var rs in ruleSets)
            {
                if (!rs.IsActive) continue;

                var rsResult = new RuleSetResult { RuleSetId = rs.Id, RuleSetName = rs.Name };
                
                // Track total unique elements evaluated across all rules in this set
                var totalEvaluatedElementIds = new HashSet<long>();

                foreach(var rule in rs.Rules)
                {
                    if (!rule.IsActive) continue;

                    var ruleResult = new RuleResult { RuleId = rule.Id, RuleName = rule.Name };
                    
                    // 1. Gather elements based on THIS rule's filters
                    FilteredElementCollector collector = new FilteredElementCollector(doc).WhereElementIsNotElementType();
                    
                    bool hasValidFilter = false;
                    if (rule.Filters != null && rule.Filters.Count > 0)
                    {
                        var catFilters = new List<ElementFilter>();
                        foreach (var filter in rule.Filters)
                        {
                            if (Enum.TryParse(filter.Category, out BuiltInCategory bic))
                            {
                                catFilters.Add(new ElementCategoryFilter(bic));
                            }
                        }
                        if (catFilters.Count > 0)
                        {
                            hasValidFilter = true;
                            if (catFilters.Count == 1) {
                                collector.WherePasses(catFilters[0]);
                            } else {
                                LogicalOrFilter orFilter = new LogicalOrFilter(catFilters);
                                collector.WherePasses(orFilter);
                            }
                        }
                    }

                    // M1: Skip rules with no valid category filters to prevent scanning the entire model
                    if (!hasValidFilter)
                    {
                        Logger.Info($"Rule '{rule.Name}' skipped — no valid category filters defined.");
                        continue;
                    }

                    var elementsToEvaluate = collector.ToList();

                    foreach (var el in elementsToEvaluate)
                    {
                        totalEvaluatedElementIds.Add(el.Id.Value);
                        bool passed = EvaluateRuleOnElement(el, rule);

                        if (passed)
                        {
                            // Inverted logic: elements that meet the condition are deemed to have failed (e.g. they match the error profile)
                            ruleResult.FailedCount++;
                            ruleResult.FailedElementIds.Add(el.Id.Value);
                        }
                        else
                        {
                            ruleResult.PassedCount++;
                            ruleResult.PassedElementIds.Add(el.Id.Value);
                        }
                    }

                    rsResult.RuleResults.Add(ruleResult);
                }

                rsResult.TotalElementsEvaluated = totalEvaluatedElementIds.Count;
                results.Add(rsResult);
            }

            return results;
        }

        private static bool EvaluateRuleOnElement(Element el, RuleConfig rule)
        {
            if (rule.Conditions == null || rule.Conditions.Count == 0) return true;

            bool finalResult = true;
            
            for (int i = 0; i < rule.Conditions.Count; i++)
            {
                var cond = rule.Conditions[i];
                bool condResult = EvaluateConditionOnElement(el, cond);

                if (i == 0)
                {
                    finalResult = condResult;
                }
                else
                {
                    if (cond.LogicalLink?.ToUpper() == "OR")
                    {
                        finalResult = finalResult || condResult;
                    }
                    else
                    {
                        finalResult = finalResult && condResult;
                    }
                }
            }
            return finalResult;
        }

        private static bool EvaluateConditionOnElement(Element el, RuleCondition cond)
        {
            // M2: Guard against conditions saved with no parameter name selected
            if (string.IsNullOrEmpty(cond.ParameterName)) return false;

            Parameter p = el.LookupParameter(cond.ParameterName);
            
            if (cond.Operator == RuleOperator.Exists)
            {
                return p != null && p.HasValue;
            }

            if (p == null || !p.HasValue) return false;

            string stringValue = p.AsValueString() ?? p.AsString() ?? "";
            
            switch (cond.Operator)
            {
                case RuleOperator.Equals:
                    if (cond.TargetValues != null && cond.TargetValues.Count > 0)
                    {
                        return cond.TargetValues.Any(tv => stringValue.Equals(tv, StringComparison.OrdinalIgnoreCase));
                    }
                    return false;
                case RuleOperator.NotEquals:
                    if (cond.TargetValues != null && cond.TargetValues.Count > 0)
                    {
                        return !cond.TargetValues.Any(tv => stringValue.Equals(tv, StringComparison.OrdinalIgnoreCase));
                    }
                    return false;
                case RuleOperator.Contains:
                    if (cond.TargetValues != null && cond.TargetValues.Count > 0)
                    {
                        return cond.TargetValues.Any(tv => stringValue.IndexOf(tv, StringComparison.OrdinalIgnoreCase) >= 0);
                    }
                    return false;
                case RuleOperator.RegexMatch:
                    if (cond.TargetValues != null && cond.TargetValues.Count > 0)
                    {
                        try { return Regex.IsMatch(stringValue, cond.TargetValues[0]); }
                        catch { return false; }
                    }
                    return false;
                case RuleOperator.GreaterThan:
                case RuleOperator.LessThan:
                case RuleOperator.GreaterThanOrEqual:
                case RuleOperator.LessThanOrEqual:
                    if (cond.TargetValues != null && cond.TargetValues.Count > 0)
                    {
                        return EvaluateNumeric(p, cond.Operator, cond.TargetValues[0]);
                    }
                    return false;
                default:
                    return false;
            }
        }

        private static bool EvaluateNumeric(Parameter p, RuleOperator op, string targetValueStr)
        {
            if (!double.TryParse(targetValueStr, out double targetValue)) return false;

            double elementValue = 0;
            if (p.StorageType == StorageType.Double)
            {
                elementValue = p.AsDouble(); 
            }
            else if (p.StorageType == StorageType.Integer)
            {
                elementValue = p.AsInteger();
            }
            else
            {
                string strVal = p.AsValueString() ?? p.AsString();
                if (!double.TryParse(strVal, out elementValue)) return false;
            }

            switch (op)
            {
                case RuleOperator.GreaterThan: return elementValue > targetValue;
                case RuleOperator.LessThan: return elementValue < targetValue;
                case RuleOperator.GreaterThanOrEqual: return elementValue >= targetValue;
                case RuleOperator.LessThanOrEqual: return elementValue <= targetValue;
                default: return false;
            }
        }
    }

    // --- Configuration Models (Deserialized from UI JSON) ---

    public class RuleSet
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Name { get; set; }
        public string Description { get; set; }
        public bool IsActive { get; set; } = true;
        public List<RuleConfig> Rules { get; set; } = new List<RuleConfig>();
    }

    public class RuleFilter
    {
        public string Category { get; set; } // e.g., "OST_Doors"
    }

    public class RuleConfig
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string Name { get; set; }
        public bool IsActive { get; set; } = true;
        public List<RuleFilter> Filters { get; set; } = new List<RuleFilter>();
        public List<RuleCondition> Conditions { get; set; } = new List<RuleCondition>();
    }

    public class RuleCondition
    {
        public string Id { get; set; } = Guid.NewGuid().ToString();
        public string ParameterName { get; set; }
        
        [JsonConverter(typeof(StringEnumConverter))]
        public RuleOperator Operator { get; set; }
        
        public List<string> TargetValues { get; set; } = new List<string>();
        
        public string LogicalLink { get; set; } = "AND";
    }

    public enum RuleOperator
    {
        Exists,
        Equals,
        NotEquals,
        Contains,
        RegexMatch,
        GreaterThan,
        LessThan,
        GreaterThanOrEqual,
        LessThanOrEqual
    }

    // --- Result Models (Serialized to UI JSON) ---

    public class RuleSetResult
    {
        public string RuleSetId { get; set; }
        public string RuleSetName { get; set; }
        public int TotalElementsEvaluated { get; set; }
        public List<RuleResult> RuleResults { get; set; } = new List<RuleResult>();
    }

    public class RuleResult
    {
        public string RuleId { get; set; }
        public string RuleName { get; set; }
        public int PassedCount { get; set; }
        public int FailedCount { get; set; }
        public List<long> PassedElementIds { get; set; } = new List<long>();
        public List<long> FailedElementIds { get; set; } = new List<long>();
    }
}
