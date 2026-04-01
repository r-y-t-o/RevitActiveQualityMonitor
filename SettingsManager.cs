using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;

namespace RevitActiveQualityMonitor
{
    public static class SettingsManager
    {
        private static string SettingsFilePath
        {
            get
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string dir = Path.Combine(appData, "Autodesk", "Revit", "Addins", "2026", "RevitActiveQualityMonitor");
                
                if (!Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                
                return Path.Combine(dir, "rulesets.json");
            }
        }

        public static List<RuleSet> LoadRuleSets()
        {
            if (!File.Exists(SettingsFilePath))
            {
                return new List<RuleSet>();
            }

            try
            {
                string json = File.ReadAllText(SettingsFilePath);
                return JsonConvert.DeserializeObject<List<RuleSet>>(json) ?? new List<RuleSet>();
            }
            catch (Exception ex)
            {
                Logger.Error("Failed to load rule sets from disk", ex);
                return new List<RuleSet>();
            }
        }

        public static void SaveRuleSets(List<RuleSet> ruleSets)
        {
            try
            {
                string path = SettingsFilePath;
                string json = JsonConvert.SerializeObject(ruleSets, Formatting.Indented);
                // L5: Write a backup before overwriting so corrupted saves are recoverable
                if (File.Exists(path))
                    File.Copy(path, Path.ChangeExtension(path, ".bak"), overwrite: true);
                File.WriteAllText(path, json);
            }
            catch (Exception ex)
            {
                Logger.Error("Failed to save rule sets to disk", ex);
            }
        }
    }
}
