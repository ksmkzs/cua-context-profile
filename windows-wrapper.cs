// Built locally with the Windows .NET Framework compiler. No vendor code.
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

class ProfileLauncher {
    static string Digest(string path) {
        using (var sha = SHA256.Create())
        using (var file = File.OpenRead(path))
            return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant();
    }
    // CommandLineToArgvW-compatible quoting, including trailing backslashes.
    static string Quote(string value) {
        var b = new StringBuilder("\""); int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { b.Append('\\', slashes * 2 + 1); b.Append(c); }
            else { b.Append('\\', slashes); b.Append(c); }
            slashes = 0;
        }
        b.Append('\\', slashes * 2); b.Append('"'); return b.ToString();
    }
    static int Main(string[] args) {
        try {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            var m = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                File.ReadAllText(Path.Combine(root, "manifest.json")));
            string runtime = (string)m["original_node_repl"];
            // Store app versions have different installation paths. The desktop
            // host supplies its current Node path, whose sibling is the stock REPL.
            // This also works after the original Store package has been removed.
            string nodeHint = Environment.GetEnvironmentVariable("NODE_REPL_NODE_PATH");
            if (!String.IsNullOrEmpty(nodeHint)) {
                string sibling = Path.Combine(Path.GetDirectoryName(nodeHint), "node_repl.exe");
                if (File.Exists(sibling) && !String.Equals(Path.GetFullPath(sibling),
                    Path.Combine(root, "node-repl.exe"), StringComparison.OrdinalIgnoreCase)) runtime = sibling;
            }
            var command = new StringBuilder();
            foreach (string arg in args) { if (command.Length > 0) command.Append(' '); command.Append(Quote(arg)); }
            var start = new ProcessStartInfo(runtime, command.ToString());
            start.UseShellExecute = false;
            // Inherit stdin/stdout/stderr and the host's policy/IPC environment.
            if (!String.IsNullOrEmpty(Environment.GetEnvironmentVariable("CUA_REPL_ENABLED_SURFACES"))) {
                bool valid = true;
                try {
                    var hashes = (Dictionary<string, object>)m["sha256"];
                    foreach (var entry in hashes) {
                        if (Digest(Path.Combine((string)m["upstream_root"], entry.Key)) != (string)entry.Value) { valid = false; break; }
                    }
                    if (m.ContainsKey("runtime_manifest_sha256") && Digest(Path.Combine(
                        Path.GetDirectoryName(runtime), "..", "manifest.json")) != (string)m["runtime_manifest_sha256"]) valid = false;
                } catch (IOException) { valid = false; }
                  catch (UnauthorizedAccessException) { valid = false; }
                if (valid) {
                    string previous = Environment.GetEnvironmentVariable("NODE_REPL_NODE_MODULE_DIRS");
                    start.EnvironmentVariables["NODE_REPL_NODE_MODULE_DIRS"] = Path.Combine(root, "node_modules") +
                        (String.IsNullOrEmpty(previous) ? "" : Path.PathSeparator + previous);
                } else Console.Error.WriteLine("CUA documentation overlay disabled: upstream changed; using stock runtime.");
            }
            using (var process = Process.Start(start)) { process.WaitForExit(); return process.ExitCode; }
        } catch (Exception e) {
            Console.Error.WriteLine("CUA profile launcher: " + e.GetType().Name + ": " + e.Message);
            return 1;
        }
    }
}
