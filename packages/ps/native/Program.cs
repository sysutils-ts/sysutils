using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace SysUtils.Ps;

[Flags]
internal enum ProcessField
{
    Pid = 1,
    Ppid = 2,
    Name = 4,
    Command = 8,
    Memory = 16,
    Cpu = 32,
    Uid = 64,
    Path = 128,
    StartTime = 256,
    All = Pid | Ppid | Name | Command | Memory | Cpu | Uid | Path | StartTime,
}

internal struct ProcessInfo
{
    public int Pid;
    public int Ppid;
    public int Uid;          // -1 means null
    public string? Name;
    public string? Cmd;
    public string? Path;
    public string? StartTime;  // ISO 8601 or null
    public double Memory;    // percent of total memory, -1 means null
    public double Cpu;       // percent of one CPU, -1 means null
}

internal readonly struct Options
{
    public ProcessField Fields { get; }
    public Options(ProcessField fields) => Fields = fields;

    public static Options Parse(string[] args)
    {
        ProcessField fields = 0;
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--fields" && i + 1 < args.Length)
            {
                fields = ParseFields(args[++i]);
            }
        }
        return new Options(fields == 0 ? ProcessField.All : fields);
    }

    private static ProcessField ParseFields(string value)
    {
        ProcessField result = 0;
        var span = value.AsSpan();
        while (!span.IsEmpty)
        {
            var idx = span.IndexOf(',');
            var part = idx < 0 ? span : span.Slice(0, idx);
            var trimmed = part.Trim();
            if (trimmed.SequenceEqual("pid".AsSpan())) result |= ProcessField.Pid;
            else if (trimmed.SequenceEqual("ppid".AsSpan())) result |= ProcessField.Ppid;
            else if (trimmed.SequenceEqual("name".AsSpan())) result |= ProcessField.Name;
            else if (trimmed.SequenceEqual("cmd".AsSpan()) || trimmed.SequenceEqual("command".AsSpan())) result |= ProcessField.Command;
            else if (trimmed.SequenceEqual("memory".AsSpan())) result |= ProcessField.Memory;
            else if (trimmed.SequenceEqual("cpu".AsSpan())) result |= ProcessField.Cpu;
            else if (trimmed.SequenceEqual("uid".AsSpan())) result |= ProcessField.Uid;
            else if (trimmed.SequenceEqual("path".AsSpan())) result |= ProcessField.Path;
            else if (trimmed.SequenceEqual("startTime".AsSpan())) result |= ProcessField.StartTime;
            span = idx < 0 ? ReadOnlySpan<char>.Empty : span.Slice(idx + 1);
        }
        return result == 0 ? ProcessField.All : result;
    }
}

#if !TEST && !NODEAPI
public static class Program
{
    public static int Main(string[] args)
    {
        try
        {
            var opts = Options.Parse(args);
            var writer = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = false };

            if (OperatingSystem.IsWindows())
                WindowsReader.Write(writer, opts.Fields);
            else if (OperatingSystem.IsLinux())
                LinuxReader.Write(writer, opts.Fields);
            else if (OperatingSystem.IsMacOS())
                MacReader.Write(writer, opts.Fields);
            else
                throw new PlatformNotSupportedException();

            writer.Flush();
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("ps: " + ex.Message);
            return 1;
        }
    }
}
#endif

internal static class JsonWriter
{
    public static void Write(TextWriter w, in ProcessInfo p, ProcessField fields)
    {
        if (fields == 0) fields = ProcessField.All;
        w.Write('{');
        var first = true;

        if ((fields & ProcessField.Pid) != 0)
        {
            WriteKey(w, "pid", ref first);
            w.Write(p.Pid);
        }
        if ((fields & ProcessField.Ppid) != 0)
        {
            WriteKey(w, "ppid", ref first);
            w.Write(p.Ppid);
        }
        if ((fields & ProcessField.Uid) != 0)
        {
            WriteKey(w, "uid", ref first);
            if (p.Uid >= 0) w.Write(p.Uid); else w.Write("null");
        }
        if ((fields & ProcessField.Name) != 0)
        {
            WriteKey(w, "name", ref first);
            WriteString(w, p.Name);
        }
        if ((fields & ProcessField.Command) != 0)
        {
            WriteKey(w, "cmd", ref first);
            WriteString(w, p.Cmd);
        }
        if ((fields & ProcessField.Path) != 0)
        {
            WriteKey(w, "path", ref first);
            WriteString(w, p.Path);
        }
        if ((fields & ProcessField.StartTime) != 0)
        {
            WriteKey(w, "startTime", ref first);
            WriteString(w, p.StartTime);
        }
        if ((fields & ProcessField.Memory) != 0)
        {
            WriteKey(w, "memory", ref first);
            if (p.Memory >= 0) w.Write(p.Memory.ToString(System.Globalization.CultureInfo.InvariantCulture)); else w.Write("null");
        }
        if ((fields & ProcessField.Cpu) != 0)
        {
            WriteKey(w, "cpu", ref first);
            if (p.Cpu >= 0) w.Write(p.Cpu.ToString(System.Globalization.CultureInfo.InvariantCulture)); else w.Write("null");
        }

        w.WriteLine('}');
    }

    private static void WriteKey(TextWriter w, string name, ref bool first)
    {
        if (!first) w.Write(',');
        w.Write('"');
        w.Write(name);
        w.Write("\":");
        first = false;
    }

    private static void WriteString(TextWriter w, string? value)
    {
        if (value == null)
        {
            w.Write("null");
            return;
        }
        w.Write('"');
        foreach (var c in value)
        {
            if (c == '"') w.Write("\\\"");
            else if (c == '\\') w.Write("\\\\");
            else if (c == '\b') w.Write("\\b");
            else if (c == '\f') w.Write("\\f");
            else if (c == '\n') w.Write("\\n");
            else if (c == '\r') w.Write("\\r");
            else if (c == '\t') w.Write("\\t");
            else if (c < 0x20) w.Write($"\\u{(int)c:x4}");
            else w.Write(c);
        }
        w.Write('"');
    }
}

internal static class WindowsReader
{
    private const int SystemProcessInformation = 5;
    private const int STATUS_INFO_LENGTH_MISMATCH = -1073741820;

    [DllImport("ntdll.dll")]
    private static extern int NtQuerySystemInformation(
        int SystemInformationClass,
        IntPtr SystemInformation,
        int SystemInformationLength,
        out int ReturnLength);

    public static void Write(TextWriter writer, ProcessField fields)
    {
        var size = 512 * 1024;
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            while (true)
            {
                var status = NtQuerySystemInformation(SystemProcessInformation, buffer, size, out _);
                if (status >= 0) break;
                if (status == STATUS_INFO_LENGTH_MISMATCH)
                {
                    size *= 2;
                    Marshal.FreeHGlobal(buffer);
                    buffer = Marshal.AllocHGlobal(size);
                    continue;
                }
                throw new InvalidOperationException($"NtQuerySystemInformation failed: 0x{status & 0xFFFFFFFF:X8}");
            }

            var ptrSize = IntPtr.Size;
            var imageNameOffset = 56;
            var imageNameBufferOffset = imageNameOffset + ptrSize;
            var basePriorityOffset = imageNameOffset + (ptrSize == 8 ? 16 : 8);
            var pidOffset = basePriorityOffset + ptrSize;
            var ppidOffset = pidOffset + ptrSize;

            var p = buffer;
            while (true)
            {
                var next = (uint)Marshal.ReadInt32(p);
                var pid = (int)Marshal.ReadIntPtr(IntPtr.Add(p, pidOffset)).ToInt64();
                var ppid = (int)Marshal.ReadIntPtr(IntPtr.Add(p, ppidOffset)).ToInt64();

                string? name = null;
                var nameBuffer = Marshal.ReadIntPtr(IntPtr.Add(p, imageNameBufferOffset));
                if (nameBuffer != IntPtr.Zero)
                {
                    var len = (ushort)Marshal.ReadInt16(IntPtr.Add(p, imageNameOffset));
                    if (len > 0)
                        name = Marshal.PtrToStringUni(nameBuffer, len / 2);
                }

                if (pid != 0)
                {
                    var info = new ProcessInfo
                    {
                        Pid = pid,
                        Ppid = ppid,
                        Uid = -1,
                        Name = name,
                        Cmd = null,
                        Path = null,
                        StartTime = null,
                        Memory = -1,
                        Cpu = -1,
                    };
                    JsonWriter.Write(writer, info, fields);
                }

                if (next == 0) break;
                p = IntPtr.Add(p, (int)next);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }
}

internal static class LinuxReader
{
    private const int _SC_CLK_TCK = 2;
    private const int PATH_MAX = 4096;

    [DllImport("libc", SetLastError = true)]
    private static extern long sysconf(int name);

    [DllImport("libc", SetLastError = true)]
    private static extern long readlink(string pathname, byte[] buf, long bufsize);

    public static void Write(TextWriter writer, ProcessField fields)
    {
        var pageSize = (double)Environment.SystemPageSize;
        var ticks = (double)GetClockTicks();
        var uptime = ParseUptime(File.ReadAllBytes("/proc/uptime"));
        var bootTime = ParseBtime(File.ReadAllBytes("/proc/stat"));
        var totalMem = ParseMemTotal(File.ReadAllBytes("/proc/meminfo"));

        var dirs = Directory.GetDirectories("/proc");
        foreach (var dir in dirs)
        {
            var name = Path.GetFileName(dir);
            if (!int.TryParse(name, out var pid)) continue;
            try { WriteOne(writer, pid, dir, pageSize, ticks, uptime, bootTime, totalMem, fields); }
            catch { /* skip processes that disappear */ }
        }
    }

    private static long GetClockTicks()
    {
        try
        {
            var t = sysconf(_SC_CLK_TCK);
            if (t > 0) return t;
        }
        catch { }
        return 100;
    }

    private static double ParseUptime(ReadOnlySpan<byte> data)
    {
        var i = 0;
        return TryParseDouble(data, ref i, out var value) ? value : 0;
    }

    private static long ParseBtime(ReadOnlySpan<byte> data)
    {
        var idx = data.IndexOf("btime "u8);
        if (idx >= 0)
        {
            var i = idx + "btime "u8.Length;
            if (TryParseLong(data, ref i, out var value)) return value;
        }
        return 0;
    }

    private static double ParseMemTotal(ReadOnlySpan<byte> data)
    {
        var idx = data.IndexOf("MemTotal:"u8);
        if (idx >= 0)
        {
            var i = idx + "MemTotal:"u8.Length;
            while (i < data.Length && data[i] == ' ') i++;
            if (TryParseLong(data, ref i, out var kb)) return kb * 1024.0;
        }
        return 1;
    }

    private static void WriteOne(TextWriter writer, int pid, string dir, double pageSize, double ticks, double uptime, long bootTime, double totalMem, ProcessField fields)
    {
        var wantsName = (fields & ProcessField.Name) != 0 || fields == 0;
        var wantsCmd = (fields & ProcessField.Command) != 0 || fields == 0;
        var wantsPath = (fields & ProcessField.Path) != 0 || fields == 0;
        var wantsUid = (fields & ProcessField.Uid) != 0 || fields == 0;
        var wantsPpid = (fields & ProcessField.Ppid) != 0 || fields == 0;
        var wantsMemory = (fields & ProcessField.Memory) != 0 || fields == 0;
        var wantsCpu = (fields & ProcessField.Cpu) != 0 || fields == 0;
        var wantsStartTime = (fields & ProcessField.StartTime) != 0 || fields == 0;

        string? comm = null;
        if (wantsName || wantsCmd)
        {
            comm = DecodeUtf8Trim(File.ReadAllBytes(Path.Combine(dir, "comm")));
        }

        var path = string.Empty;
        if (wantsName || wantsPath)
        {
            var rawPath = ReadExeLink(Path.Combine(dir, "exe"));
            if (!string.IsNullOrEmpty(rawPath))
            {
                if (rawPath.EndsWith(" (deleted)"))
                    rawPath = rawPath[..^" (deleted)".Length];
                path = rawPath;
            }
        }

        var cmd = string.Empty;
        if (wantsCmd)
        {
            cmd = DecodeCmdline(File.ReadAllBytes(Path.Combine(dir, "cmdline"))) ?? string.Empty;
        }

        int uid = -1;
        if (wantsUid)
        {
            uid = ParseStatusUid(File.ReadAllBytes(Path.Combine(dir, "status")));
        }

        StatInfo stat = default;
        var statOk = false;
        if (wantsPpid || wantsMemory || wantsCpu || wantsStartTime)
        {
            statOk = TryParseStat(File.ReadAllBytes(Path.Combine(dir, "stat")), out stat);
        }

        string? name = null;
        if (wantsName)
        {
            if (!string.IsNullOrEmpty(path))
                name = Path.GetFileName(path);
            if (string.IsNullOrEmpty(name))
                name = comm;
        }

        double memory = -1;
        if (statOk && wantsMemory)
        {
            memory = stat.Rss * pageSize / totalMem * 100.0;
        }

        double cpu = -1;
        if (statOk && wantsCpu)
        {
            var processAge = uptime - stat.StartTime / ticks;
            if (processAge > 0)
            {
                var totalTime = (stat.Utime + stat.Stime) / ticks;
                cpu = totalTime / processAge * 100.0;
            }
        }

        string? startTime = null;
        if (statOk && wantsStartTime)
        {
            var epoch = bootTime + stat.StartTime / ticks;
            startTime = DateTimeOffset.FromUnixTimeSeconds((long)epoch).ToString("o");
        }

        var info = new ProcessInfo
        {
            Pid = pid,
            Ppid = statOk ? stat.Ppid : 0,
            Uid = uid,
            Name = name,
            Cmd = cmd,
            Path = path,
            StartTime = startTime,
            Memory = memory,
            Cpu = cpu,
        };
        JsonWriter.Write(writer, info, fields);
    }

    private static string? ReadExeLink(string pathname)
    {
        var buf = new byte[PATH_MAX];
        try
        {
            var len = readlink(pathname, buf, buf.Length);
            if (len > 0)
            {
                var s = Encoding.UTF8.GetString(buf, 0, (int)len);
                return s;
            }
        }
        catch { }
        return null;
    }

    private static int ParseStatusUid(ReadOnlySpan<byte> data)
    {
        var idx = data.IndexOf("Uid:"u8);
        if (idx < 0) return -1;
        var i = idx + "Uid:"u8.Length;
        while (i < data.Length && (data[i] == ' ' || data[i] == '\t')) i++;
        if (TryParseInt(data, ref i, out var value)) return value;
        return -1;
    }

    private static bool TryParseStat(ReadOnlySpan<byte> data, out StatInfo info)
    {
        info = default;
        var rpar = data.LastIndexOf((byte)')');
        if (rpar < 0 || rpar + 1 >= data.Length) return false;

        var i = rpar + 1;
        if (i < data.Length && data[i] == ')') i++;
        while (i < data.Length && data[i] == ' ') i++;

        // skip state char
        if (i < data.Length && data[i] >= 'A' && data[i] <= 'Z') i++;
        while (i < data.Length && data[i] == ' ') i++;

        // ppid
        if (!TryParseInt(data, ref i, out info.Ppid)) return false;

        // skip pgrp, session, tty_nr, tpgid, flags, minflt, cminflt, majflt, cmajflt
        for (var k = 0; k < 9; k++)
            if (!TryParseLong(data, ref i, out _)) return false;

        if (!TryParseLong(data, ref i, out info.Utime)) return false;
        if (!TryParseLong(data, ref i, out info.Stime)) return false;

        // skip cutime, cstime, priority
        for (var k = 0; k < 3; k++)
            if (!TryParseLong(data, ref i, out _)) return false;

        // skip nice
        if (!TryParseLong(data, ref i, out _)) return false;

        // skip num_threads, itrealvalue
        for (var k = 0; k < 2; k++)
            if (!TryParseLong(data, ref i, out _)) return false;

        if (!TryParseLong(data, ref i, out info.StartTime)) return false;

        // skip vsize
        if (!TryParseLong(data, ref i, out _)) return false;

        if (!TryParseLong(data, ref i, out info.Rss)) return false;

        return true;
    }

    private static bool TryParseInt(ReadOnlySpan<byte> data, ref int i, out int value)
    {
        value = 0;
        if (!TryParseLong(data, ref i, out var l)) return false;
        value = (int)l;
        return true;
    }

    private static bool TryParseLong(ReadOnlySpan<byte> data, ref int i, out long value)
    {
        value = 0;
        while (i < data.Length && data[i] == ' ') i++;
        if (i >= data.Length) return false;

        var sign = 1L;
        if (data[i] == '-') { sign = -1; i++; }
        else if (data[i] == '+') i++;

        var start = i;
        while (i < data.Length && data[i] >= '0' && data[i] <= '9')
        {
            value = value * 10 + (data[i] - '0');
            i++;
        }
        if (i == start) return false;
        value *= sign;
        return true;
    }

    private static bool TryParseDouble(ReadOnlySpan<byte> data, ref int i, out double value)
    {
        value = 0;
        while (i < data.Length && data[i] == ' ') i++;
        if (i >= data.Length) return false;

        var sign = 1.0;
        if (data[i] == '-') { sign = -1; i++; }
        else if (data[i] == '+') i++;

        var start = i;
        long whole = 0;
        while (i < data.Length && data[i] >= '0' && data[i] <= '9')
        {
            whole = whole * 10 + (data[i] - '0');
            i++;
        }

        double frac = 0;
        var fracDiv = 1.0;
        if (i < data.Length && data[i] == '.')
        {
            i++;
            while (i < data.Length && data[i] >= '0' && data[i] <= '9')
            {
                frac = frac * 10 + (data[i] - '0');
                fracDiv *= 10;
                i++;
            }
        }

        if (i == start && fracDiv == 1.0) return false;
        value = sign * (whole + frac / fracDiv);
        return true;
    }

    private static string? DecodeUtf8Trim(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0) return null;
        var s = Encoding.UTF8.GetString(data);
        return s.Trim('\n', '\r', '\t', ' ');
    }

    private static string? DecodeCmdline(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0) return null;
        var s = Encoding.UTF8.GetString(data);
        s = s.Replace('\0', ' ').Trim();
        return string.IsNullOrEmpty(s) ? null : s;
    }

    private struct StatInfo
    {
        public int Ppid;
        public long Utime;
        public long Stime;
        public long StartTime;
        public long Rss;
    }
}

internal static class MacReader
{
    private const int PROC_PIDT_SHORTBSDINFO = 4;
    private const int BSDInfoSize = 24; // 6 x 32-bit fields

    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_listpids(uint type, uint typeinfo, IntPtr buffer, int buffersize);

    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_pidinfo(int pid, int flavor, ulong arg, IntPtr buffer, int buffersize);

    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_pidpath(int pid, IntPtr buffer, uint buffersize);

    public static void Write(TextWriter writer, ProcessField fields)
    {
        var size = 4096;
        var pids = Marshal.AllocHGlobal(size);
        int used;
        try
        {
            while (true)
            {
                used = proc_listpids(1, 0, pids, size);
                if (used < 0) throw new InvalidOperationException("proc_listpids failed");
                if (used < size) break;
                size *= 2;
                Marshal.FreeHGlobal(pids);
                pids = Marshal.AllocHGlobal(size);
            }

            var count = used / 4;
            var info = Marshal.AllocHGlobal(BSDInfoSize);
            var pathBuf = Marshal.AllocHGlobal(4096);
            try
            {
                for (var i = 0; i < count; i++)
                {
                    var pid = Marshal.ReadInt32(pids, i * 4);
                    if (pid <= 0) continue;

                    var len = proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0, info, BSDInfoSize);
                    if (len != BSDInfoSize) continue;

                    var ppid = Marshal.ReadInt32(info, 12); // pbsi_ppid offset

                    string? path = null;
                    string? name = null;
                    if ((fields & ProcessField.Name) != 0 || (fields & ProcessField.Path) != 0 || fields == 0)
                    {
                        if (proc_pidpath(pid, pathBuf, 4096) > 0)
                        {
                            path = Marshal.PtrToStringAnsi(pathBuf);
                            if ((fields & ProcessField.Name) != 0 || fields == 0)
                                name = Path.GetFileName(path);
                        }
                    }

                    var p = new ProcessInfo
                    {
                        Pid = pid,
                        Ppid = ppid,
                        Uid = -1,
                        Name = name,
                        Cmd = null,
                        Path = path,
                        StartTime = null,
                        Memory = -1,
                        Cpu = -1,
                    };
                    JsonWriter.Write(writer, p, fields);
                }
            }
            finally
            {
                Marshal.FreeHGlobal(info);
                Marshal.FreeHGlobal(pathBuf);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(pids);
        }
    }
}
