using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;

namespace SysUtils.Ps;

record ProcessInfo(
    int Pid,
    int Ppid,
    string Name,
    string? Command,
    long? Memory,
    float? Cpu
);

class Program
{
    static void Main(string[] args)
    {
        var requestedFields = ParseFields(args);

        var processes = Process.GetProcesses()
            .Select(p => new ProcessInfo(
                p.Id,
                GetParentId(p),
                p.ProcessName,
                p.MainModule?.FileName,
                p.WorkingSet64,
                null // CPU is not read by default to keep it fast.
            ));

        foreach (var process in processes)
        {
            var output = ApplyFieldFilter(process, requestedFields);
            Console.WriteLine(JsonSerializer.Serialize(output));
        }
    }

    static HashSet<string>? ParseFields(string[] args)
    {
        var index = Array.IndexOf(args, "--fields");
        if (index < 0 || index + 1 >= args.Length) return null;
        return args[index + 1].Split(',').Select(f => f.ToLowerInvariant()).ToHashSet();
    }

    static int GetParentId(Process process)
    {
        try
        {
            // Reading ParentId from WMI is slow; this is a placeholder for a
            // faster native implementation (NtQueryInformationProcess or
            // P/Invoke CreateToolhelp32Snapshot).
            return 0;
        }
        catch
        {
            return 0;
        }
    }

    static ProcessInfo ApplyFieldFilter(ProcessInfo info, HashSet<string>? fields)
    {
        if (fields is null) return info;
        return info with
        {
            Command = fields.Contains("command") ? info.Command : null,
            Memory = fields.Contains("memory") ? info.Memory : null,
            Cpu = fields.Contains("cpu") ? info.Cpu : null,
        };
    }
}
