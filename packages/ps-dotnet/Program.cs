using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace SysUtils.Ps;

public static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            var opts = Options.Parse(args);
            IEnumerable<ProcessRecord> processes = RuntimeInformation.IsOSPlatform(OSPlatform.Linux)
                ? LinuxProcReader.Read()
                : RuntimeInformation.IsOSPlatform(OSPlatform.OSX)
                    ? MacProcReader.Read()
                    : RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
                        ? WindowsProcReader.Read()
                        : throw new PlatformNotSupportedException();

            using var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = false };
            foreach (var p in processes)
            {
                if (p == null) continue;
                var obj = p.ToJson(opts.Fields);
                stdout.WriteLine(obj);
            }
            stdout.Flush();
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"ps: {ex.Message}");
            return 1;
        }
    }
}

internal sealed class Options
{
    public HashSet<string>? Fields { get; private set; }

    public static Options Parse(string[] args)
    {
        var o = new Options();
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--fields" && i + 1 < args.Length)
            {
                o.Fields = new HashSet<string>(args[++i].Split(',', StringSplitOptions.RemoveEmptyEntries),
                    StringComparer.OrdinalIgnoreCase);
            }
        }
        return o;
    }
}

internal sealed class ProcessRecord
{
    public int Pid { get; set; }
    public int Ppid { get; set; }
    public string? Name { get; set; }
    public string? Command { get; set; }
    public long? Memory { get; set; }
    public double? Cpu { get; set; }

    public string ToJson(HashSet<string>? fields)
    {
        bool Has(string f) => fields == null || fields.Contains(f);

        static void AppendString(StringBuilder sb, string? value)
        {
            if (value == null)
            {
                sb.Append("null");
                return;
            }
            sb.Append('"');
            for (var i = 0; i < value.Length; i++)
            {
                var c = value[i];
                if (c == '"') sb.Append("\\\"");
                else if (c == '\\') sb.Append("\\\\");
                else if (c == '\b') sb.Append("\\b");
                else if (c == '\f') sb.Append("\\f");
                else if (c == '\n') sb.Append("\\n");
                else if (c == '\r') sb.Append("\\r");
                else if (c == '\t') sb.Append("\\t");
                else if (c < 0x20) sb.Append($"\\u{(int)c:x4}");
                else if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                {
                    sb.Append(c).Append(value[++i]);
                }
                else
                {
                    sb.Append(c);
                }
            }
            sb.Append('"');
        }

        var sb = new StringBuilder(128);
        sb.Append('{');
        bool first = true;

        if (Has("pid"))
        {
            sb.Append("\"pid\":").Append(Pid);
            first = false;
        }

        if (Has("ppid"))
        {
            if (!first) sb.Append(',');
            sb.Append("\"ppid\":").Append(Ppid);
            first = false;
        }

        if (Has("name"))
        {
            if (!first) sb.Append(',');
            sb.Append("\"name\":");
            AppendString(sb, Name);
            first = false;
        }

        if (Has("command"))
        {
            if (!first) sb.Append(',');
            sb.Append("\"command\":");
            AppendString(sb, Command);
            first = false;
        }

        if (Has("memory"))
        {
            if (!first) sb.Append(',');
            sb.Append("\"memory\":");
            if (Memory.HasValue) sb.Append(Memory.Value);
            else sb.Append("null");
            first = false;
        }

        if (Has("cpu"))
        {
            if (!first) sb.Append(',');
            sb.Append("\"cpu\":");
            if (Cpu.HasValue) sb.Append(Cpu.Value);
            else sb.Append("null");
            first = false;
        }

        sb.Append('}');
        return sb.ToString();
    }
}

internal static class LinuxProcReader
{
    public static IEnumerable<ProcessRecord> Read()
    {
        var procs = new List<ProcessRecord>();
        foreach (var dir in Directory.EnumerateDirectories("/proc"))
        {
            var name = Path.GetFileName(dir);
            if (!int.TryParse(name, out var pid)) continue;
            ProcessRecord? rec;
            try { rec = ReadOne(pid, dir); }
            catch { continue; }
            if (rec != null) procs.Add(rec);
        }
        return procs;
    }

    private static ProcessRecord ReadOne(int pid, string dir)
    {
        string? comm = null;
        string? cmdline = null;
        long? rss = null;
        double? cpu = null;

        var statPath = Path.Combine(dir, "stat");
        int ppid = 0;
        if (File.Exists(statPath))
        {
            var stat = File.ReadAllText(statPath);
            var rpar = stat.LastIndexOf(')');
            if (rpar > 0)
            {
                var after = stat.Substring(rpar + 2);
                var parts = after.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2 && int.TryParse(parts[1], out var p)) ppid = p;
            }
        }

        var commPath = Path.Combine(dir, "comm");
        if (File.Exists(commPath))
        {
            comm = File.ReadAllText(commPath).Trim();
        }

        var cmdlinePath = Path.Combine(dir, "cmdline");
        if (File.Exists(cmdlinePath))
        {
            var raw = File.ReadAllBytes(cmdlinePath);
            if (raw.Length > 0)
            {
                cmdline = raw.Length > 4096 ? Encoding.UTF8.GetString(raw, 0, 4096) : Encoding.UTF8.GetString(raw);
                cmdline = cmdline.Replace('\0', ' ').Trim();
            }
        }

        var statmPath = Path.Combine(dir, "statm");
        if (File.Exists(statmPath))
        {
            var parts = File.ReadAllText(statmPath).Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length >= 2 && long.TryParse(parts[1], out var residentPages))
            {
                rss = residentPages * Environment.SystemPageSize;
            }
        }

        return new ProcessRecord
        {
            Pid = pid,
            Ppid = ppid,
            Name = comm,
            Command = cmdline,
            Memory = rss,
            Cpu = cpu,
        };
    }
}

internal static class MacProcReader
{
    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_listpids(uint type, uint typeinfo, IntPtr buffer, int buffersize);

    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_pidinfo(int pid, int flavor, ulong arg, IntPtr buffer, int buffersize);

    private const int PROC_PIDT_SHORTBSDINFO = 4;
    private const int PROC_PIDT_SHORTBSDINFO_SIZE = 12;

    [StructLayout(LayoutKind.Sequential)]
    private struct BSDInfo
    {
        public uint pbsi_flags;
        public uint pbsi_status;
        public int pbsi_pid;
        public int pbsi_ppid;
        public int pbsi_uid;
        public int pbsi_gid;
    }

    public static IEnumerable<ProcessRecord> Read()
    {
        var results = new List<ProcessRecord>();
        var seenPids = new HashSet<int>();

        const int INITIAL_BUFFER_SIZE = 4096;
        const int MAX_BUFFER_SIZE = 8 * 1024 * 1024;
        var bufSize = INITIAL_BUFFER_SIZE;
        IntPtr buf = Marshal.AllocHGlobal(bufSize);
        try
        {
            int bytesUsed;
            var pids = new List<int>();
            while (true)
            {
                bytesUsed = proc_listpids(1, 0, buf, bufSize);
                if (bytesUsed <= 0) break;

                if (bytesUsed == bufSize)
                {
                    var newSize = Math.Min(bufSize * 2, MAX_BUFFER_SIZE);
                    if (newSize == bufSize) break;
                    Marshal.FreeHGlobal(buf);
                    buf = Marshal.AllocHGlobal(newSize);
                    bufSize = newSize;
                    continue;
                }

                var total = bytesUsed;
                for (var offset = 0; offset + 4 <= total; offset += 4)
                {
                    var pid = Marshal.ReadInt32(buf, offset);
                    if (pid <= 0) break;
                    if (seenPids.Add(pid)) pids.Add(pid);
                }
                break;
            }

            var bsdBuf = Marshal.AllocHGlobal(PROC_PIDT_SHORTBSDINFO_SIZE);
            try
            {
                foreach (var pid in pids)
                {
                    var len = proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0, bsdBuf, PROC_PIDT_SHORTBSDINFO_SIZE);
                    if (len != PROC_PIDT_SHORTBSDINFO_SIZE) continue;
                    var info = Marshal.PtrToStructure<BSDInfo>(bsdBuf);
                    results.Add(new ProcessRecord
                    {
                        Pid = info.pbsi_pid,
                        Ppid = info.pbsi_ppid,
                        Name = null,
                        Command = null,
                        Memory = null,
                        Cpu = null,
                    });
                }
            }
            finally
            {
                Marshal.FreeHGlobal(bsdBuf);
            }

            return results;
        }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
    }
}

internal static class WindowsProcReader
{
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32First(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32Next(IntPtr hSnapshot, ref PROCESSENTRY32 lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("ntdll.dll")]
    private static extern int NtQueryInformationProcess(
        IntPtr processHandle,
        int processInformationClass,
        out int processInformation,
        int processInformationLength,
        out int returnLength);

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private const int ProcessBasicInformation = 0;

    public static IEnumerable<ProcessRecord> Read()
    {
        var snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == new IntPtr(-1))
        {
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        var results = new List<ProcessRecord>();
        try
        {
            var entry = new PROCESSENTRY32 { dwSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<PROCESSENTRY32>() };
            if (!Process32First(snap, ref entry)) return results;

            do
            {
                var ppid = (int)entry.th32ParentProcessID;
                results.Add(new ProcessRecord
                {
                    Pid = (int)entry.th32ProcessID,
                    Ppid = ppid,
                    Name = entry.szExeFile,
                    Command = null,
                    Memory = null,
                    Cpu = null,
                });
            } while (Process32Next(snap, ref entry));
        }
        finally
        {
            CloseHandle(snap);
        }
        return results;
    }
}