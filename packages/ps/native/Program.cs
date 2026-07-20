using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.CompilerServices;
using System.Text;

namespace SysUtils.Ps;

[Flags]
internal enum ProcessFields
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
    public ProcessFields Fields { get; }
    public Options(ProcessFields fields) => Fields = fields;

    public static Options Parse(string[] args)
    {
        ProcessFields fields = 0;
        var i = 0;
        while (i < args.Length) // nosemgrep
        {
            if (args[i] == "--fields")
            {
                if (i + 1 >= args.Length)
                {
                    throw new ArgumentException("Missing value for --fields.");
                }

                fields |= ParseFields(args[i + 1]);
                i += 2;
            }
            else
            {
                i++;
            }
        }
        return new Options(fields == 0 ? ProcessFields.All : fields);
    }

    private static ProcessFields ParseFields(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Fields argument is empty.");
        }

        ProcessFields result = 0;
        var span = value.AsSpan();
        while (!span.IsEmpty)
        {
            var idx = span.IndexOf(',');
            var part = idx < 0 ? span : span.Slice(0, idx);
            var token = part.Trim().ToString();
            if (string.IsNullOrEmpty(token))
            {
                throw new ArgumentException("Empty field token.");
            }

            result |= token.ToLowerInvariant() switch
            {
                "pid" => ProcessFields.Pid,
                "ppid" => ProcessFields.Ppid,
                "name" => ProcessFields.Name,
                "cmd" or "command" => ProcessFields.Command,
                "memory" => ProcessFields.Memory,
                "cpu" => ProcessFields.Cpu,
                "uid" => ProcessFields.Uid,
                "path" => ProcessFields.Path,
                "starttime" or "start" or "startTime" => ProcessFields.StartTime,
                _ => throw new ArgumentException($"Unknown field: {token}")
            };

            span = idx < 0 ? ReadOnlySpan<char>.Empty : span.Slice(idx + 1);
        }
        return result;
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

            ProcessWriter.Write(writer, opts.Fields);

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

internal static class ProcessWriter
{
    public static void Write(TextWriter writer, ProcessFields fields)
    {
        ArgumentNullException.ThrowIfNull(writer); // nosemgrep

        if (OperatingSystem.IsWindows())
        {
            WindowsReader.Write(writer, fields);
        }
        else if (OperatingSystem.IsLinux())
        {
            LinuxReader.Write(writer, fields);
        }
        else if (OperatingSystem.IsMacOS())
        {
            MacReader.Write(writer, fields);
        }
        else
        {
            throw new PlatformNotSupportedException();
        }
    }
}

internal sealed class JsonWriter
{
    private readonly TextWriter _writer;

    public JsonWriter(TextWriter writer)
    {
        if (writer is null)
        {
            throw new ArgumentNullException(nameof(writer));
        }
        _writer = writer;
    }

    public static void Write(TextWriter writer, ProcessInfo p, ProcessFields fields)
    {
        if (writer is null)
        {
            throw new ArgumentNullException(nameof(writer));
        }
        new JsonWriter(writer).Write(p, fields); // nosemgrep
    }

    public void Write(ProcessInfo p, ProcessFields fields)
    {
        fields = EnsureFields(fields); // nosemgrep

        _writer.Write('{');
        var first = true;

        WriteNumericFields(fields, ref first, p);
        WriteStringFields(fields, ref first, p); // nosemgrep

        _writer.WriteLine('}');
    }

    private static ProcessFields EnsureFields(ProcessFields fields)
    {
        return fields == 0 ? ProcessFields.All : fields;
    }

    private void WriteNumericFields(ProcessFields fields, ref bool first, ProcessInfo p)
    {
        if ((fields & ProcessFields.Pid) != 0)
        {
            WritePid(ref first, p); // nosemgrep
        }

        if ((fields & ProcessFields.Ppid) != 0)
        {
            WritePpid(ref first, p); // nosemgrep
        }

        if ((fields & ProcessFields.Uid) != 0)
        {
            WriteUid(ref first, p); // nosemgrep
        }

        if ((fields & ProcessFields.Memory) != 0)
        {
            WriteMemory(ref first, p); // nosemgrep
        }

        if ((fields & ProcessFields.Cpu) != 0)
        {
            WriteCpu(ref first, p); // nosemgrep
        }
    }

    private void WriteStringFields(ProcessFields fields, ref bool first, ProcessInfo p)
    {
        if ((fields & ProcessFields.Name) != 0)
        {
            WriteName(ref first, p);
        }

        if ((fields & ProcessFields.Command) != 0)
        {
            WriteCommand(ref first, p);
        }

        if ((fields & ProcessFields.Path) != 0)
        {
            WritePath(ref first, p); // nosemgrep
        }

        if ((fields & ProcessFields.StartTime) != 0)
        {
            WriteStartTime(ref first, p); // nosemgrep
        }
    }

    private void WriteField(string key, ref bool first)
    {
        if (!first)
        {
            _writer.Write(',');
        }

        _writer.Write('"');
        _writer.Write(key); // nosemgrep
        _writer.Write("\":");
        first = false;
    }

    private void WritePid(ref bool first, ProcessInfo p)
    {
        WriteField("pid", ref first);
        _writer.Write(p.Pid); // nosemgrep
    }

    private void WritePpid(ref bool first, ProcessInfo p)
    {
        WriteField("ppid", ref first);
        _writer.Write(p.Ppid); // nosemgrep
    }

    private void WriteUid(ref bool first, ProcessInfo p)
    {
        WriteField("uid", ref first);
        if (p.Uid >= 0) // nosemgrep
        {
            _writer.Write(p.Uid); // nosemgrep
        }
        else
        {
            _writer.Write("null");
        }
    }

    private void WriteName(ref bool first, ProcessInfo p)
    {
        WriteField("name", ref first);
        WriteString(p.Name); // nosemgrep
    }

    private void WriteCommand(ref bool first, ProcessInfo p)
    {
        WriteField("cmd", ref first);
        WriteString(p.Cmd); // nosemgrep
    }

    private void WritePath(ref bool first, ProcessInfo p)
    {
        WriteField("path", ref first);
        WriteString(p.Path); // nosemgrep
    }

    private void WriteStartTime(ref bool first, ProcessInfo p)
    {
        WriteField("startTime", ref first);
        WriteString(p.StartTime); // nosemgrep
    }

    private void WriteMemory(ref bool first, ProcessInfo p)
    {
        WriteField("memory", ref first);
        if (p.Memory >= 0) // nosemgrep
        {
            _writer.Write(p.Memory.ToString(System.Globalization.CultureInfo.InvariantCulture)); // nosemgrep
        }
        else
        {
            _writer.Write("null");
        }
    }

    private void WriteCpu(ref bool first, ProcessInfo p)
    {
        WriteField("cpu", ref first);
        if (p.Cpu >= 0) // nosemgrep
        {
            _writer.Write(p.Cpu.ToString(System.Globalization.CultureInfo.InvariantCulture)); // nosemgrep
        }
        else
        {
            _writer.Write("null");
        }
    }

    private void WriteString(string? value)
    {
        if (value == null)
        {
            _writer.Write("null");
            return;
        }
        _writer.Write('"');
        var i = 0;
        while (i < value.Length)
        {
            i = WriteEscapedChar(value, i);
        }
        _writer.Write('"');
    }

    private int WriteEscapedChar(string value, int i)
    {
        var c = value[i];
        if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1])) // nosemgrep
        {
            WriteSurrogatePair(c, value[i + 1]);
            return i + 2;
        }
        WriteSimpleEscape(c);
        return i + 1;
    }

    private void WriteSurrogatePair(char high, char low)
    {
        var codePoint = char.ConvertToUtf32(high, low); // nosemgrep
        if (codePoint < 0x20)
        {
            _writer.Write($"\\u{codePoint:x4}");
        }
        else if (codePoint < 0x10000)
        {
            _writer.Write((char)codePoint);
        }
        else
        {
            // surrogate pair written as two \u escapes is safe for all decoders
            _writer.Write($"\\u{(0xD800 + ((codePoint - 0x10000) >> 10)):x4}");
            _writer.Write($"\\u{(0xDC00 + ((codePoint - 0x10000) & 0x3FF)):x4}");
        }
    }

    private void WriteSimpleEscape(char c)
    {
        if (c == '"')
        {
            _writer.Write("\\\"");
        }
        else if (c == '\\')
        {
            _writer.Write("\\\\");
        }
        else if (c == '\b')
        {
            _writer.Write("\\b");
        }
        else if (c == '\f')
        {
            _writer.Write("\\f");
        }
        else if (c == '\n')
        {
            _writer.Write("\\n");
        }
        else if (c == '\r')
        {
            _writer.Write("\\r");
        }
        else if (c == '\t')
        {
            _writer.Write("\\t");
        }
        else if (c < 0x20)
        {
            _writer.Write($"\\u{(int)c:x4}");
        }
        else
        {
            _writer.Write(c); // nosemgrep
        }
    }
}

internal static class NativeHelpers
{
    public static IntPtr GrowBuffer(IntPtr buffer, ref int size, int maxSize, string context)
    {
        if (size >= maxSize)
        {
            throw new InvalidOperationException($"{context} buffer exceeded maximum size.");
        }

        var newSize = size > maxSize / 2 ? maxSize : size * 2;
        var newBuffer = Marshal.AllocHGlobal(newSize);
        Marshal.FreeHGlobal(buffer);
        size = newSize;
        return newBuffer;
    }

    public static void WriteProcessInfo(TextWriter writer, ProcessFields fields, int pid, int ppid, string? name = null, string? path = null)
    {
        var info = new ProcessInfo
        {
            Pid = pid,
            Ppid = ppid,
            Uid = -1,
            Name = name ?? string.Empty,
            Cmd = null,
            Path = path,
            StartTime = null,
            Memory = -1,
            Cpu = -1,
        };
        JsonWriter.Write(writer, info, fields);
    }
}

internal static class WindowsReader
{
    private const int SystemProcessInformationClass = 5;
    private const int STATUS_INFO_LENGTH_MISMATCH = -1073741820;
    private const int MaxBufferSize = 128 * 1024 * 1024;

    [DllImport("ntdll.dll")]
    private static extern int NtQuerySystemInformation(
        int SystemInformationClass,
        IntPtr SystemInformation,
        int SystemInformationLength,
        out int ReturnLength);

    [StructLayout(LayoutKind.Sequential)]
    private struct UnicodeString
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SystemProcessInformation
    {
        public uint NextEntryOffset;
        public uint NumberOfThreads;
        public long WorkingSetPrivateSize;
        public uint HardFaultCount;
        public uint NumberOfThreadsHighWatermark;
        public ulong CycleTime;
        public long CreateTime;
        public long UserTime;
        public long KernelTime;
        public UnicodeString ImageName;
        public int BasePriority;
        public IntPtr UniqueProcessId;
        public IntPtr InheritedFromUniqueProcessId;
    }

    public static void Write(TextWriter writer, ProcessFields fields)
    {
        var size = 512 * 1024;
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            while (true)
            {
                var status = NtQuerySystemInformation(SystemProcessInformationClass, buffer, size, out var returnLength);
                if (status >= 0)
                {
                    WriteEntries(writer, fields, buffer, returnLength); // nosemgrep
                    break;
                }
                if (status == STATUS_INFO_LENGTH_MISMATCH)
                {
                    buffer = NativeHelpers.GrowBuffer(buffer, ref size, MaxBufferSize, "Process information");
                    continue;
                }
                throw new InvalidOperationException($"NtQuerySystemInformation failed: 0x{status & 0xFFFFFFFF:X8}");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static void WriteEntries(TextWriter writer, ProcessFields fields, IntPtr buffer, int returnLength)
    {
        var managedBuffer = new byte[returnLength];
        Marshal.Copy(buffer, managedBuffer, 0, returnLength); // nosemgrep
        var span = managedBuffer.AsSpan();
        var offset = 0;
        var entrySize = Unsafe.SizeOf<SystemProcessInformation>();
        while (offset + entrySize <= returnLength)
        {
            var p = MemoryMarshal.AsRef<SystemProcessInformation>(span.Slice(offset));
            var pid = p.UniqueProcessId.ToInt32();
            var ppid = p.InheritedFromUniqueProcessId.ToInt32();

            string? name = null;
            if (p.ImageName.Buffer != IntPtr.Zero && p.ImageName.Length > 0)
            {
                name = Marshal.PtrToStringUni(p.ImageName.Buffer, p.ImageName.Length / 2);
            }

            if (pid != 0)
            {
                NativeHelpers.WriteProcessInfo(writer, fields, pid, ppid, name);
            }

            if (p.NextEntryOffset == 0)
            {
                break;
            }

            offset += (int)p.NextEntryOffset;
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

    private readonly record struct LinuxContext(double PageSize, double Ticks, double Uptime, long BootTime, double TotalMem);
    private readonly record struct ProcData(string? Comm, string? Path, string? Cmd, int Uid, StatInfo Stat, bool StatOk);

    public static void Write(TextWriter writer, ProcessFields fields)
    {
        var pageSize = (double)Environment.SystemPageSize;
        var ticks = (double)GetClockTicks();
        var uptime = ParseUptime(File.ReadAllBytes("/proc/uptime"));
        var bootTime = ParseBtime(File.ReadAllBytes("/proc/stat"));
        var totalMem = ParseMemTotal(File.ReadAllBytes("/proc/meminfo"));
        var ctx = new LinuxContext(pageSize, ticks, uptime, bootTime, totalMem);

        foreach (var dir in Directory.EnumerateDirectories("/proc"))
        {
            var name = Path.GetFileName(dir);
            if (!int.TryParse(name, out var pid))
            {
                continue;
            }

            try
            {
                WriteOne(writer, pid, dir, ctx, fields); // nosemgrep
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // skip processes that disappear or are inaccessible
                Trace.WriteLine($"Skipping {dir}: {ex}");
            }
        }
    }

    private static long GetClockTicks()
    {
        try
        {
            var t = sysconf(_SC_CLK_TCK);
            if (t > 0)
            {
                return t;
            }
        }
        catch (Exception ex)
        {
            Trace.WriteLine($"sysconf failed: {ex}");
        }
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
            if (TryParseLong(data, ref i, out var value))
            {
                return value;
            }
        }
        return 0;
    }

    private static double ParseMemTotal(ReadOnlySpan<byte> data)
    {
        var idx = data.IndexOf("MemTotal:"u8);
        if (idx >= 0)
        {
            var i = idx + "MemTotal:"u8.Length;
            while (i < data.Length && data[i] == ' ') // nosemgrep
            {
                i++;
            }

            if (TryParseLong(data, ref i, out var kb))
            {
                return kb * 1024.0;
            }
        }
        return 1;
    }

    private static byte[]? ReadProcFile(string dir, string file)
    {
        try
        {
            return File.ReadAllBytes(Path.Combine(dir, file)); // nosemgrep
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Trace.WriteLine($"Cannot read {dir}/{file}: {ex}");
            return null;
        }
    }

    private static void WriteOne(TextWriter writer, int pid, string dir, in LinuxContext ctx, ProcessFields fields)
    {
        var data = ReadProcessData(dir, fields); // nosemgrep
        var info = new ProcessInfo
        {
            Pid = pid,
            Ppid = data.StatOk ? data.Stat.Ppid : 0,
            Uid = data.Uid,
            Name = BuildName(data.Path, data.Comm, fields),
            Cmd = data.Cmd,
            Path = data.Path,
            StartTime = ComputeStartTime(data.StatOk, data.Stat, ctx, fields),
            Memory = ComputeMemory(data.StatOk, data.Stat, ctx, fields),
            Cpu = ComputeCpu(data.StatOk, data.Stat, ctx, fields),
        };
        JsonWriter.Write(writer, info, fields);
    }

    private static ProcData ReadProcessData(string dir, ProcessFields fields)
    {
        return new ProcData( // nosemgrep
            ReadComm(dir, fields),
            ReadPath(dir, fields),
            ReadCmd(dir, fields),
            ReadUid(dir, fields),
            ReadStat(dir, fields, out var statOk),
            statOk);
    }

    private static string? ReadComm(string dir, ProcessFields fields)
    {
        if ((fields & ProcessFields.Name) == 0 && fields != 0)
        {
            return null;
        }

        var commBytes = ReadProcFile(dir, "comm");
        return commBytes != null ? DecodeUtf8Trim(commBytes) : null;
    }

    private static string? ReadPath(string dir, ProcessFields fields)
    {
        if ((fields & ProcessFields.Name) == 0 && (fields & ProcessFields.Path) == 0 && fields != 0)
        {
            return null;
        }

        var rawPath = ReadExeLink(Path.Combine(dir, "exe"));
        if (string.IsNullOrEmpty(rawPath))
        {
            return null;
        }

        if (rawPath.EndsWith(" (deleted)"))
        {
            rawPath = rawPath[..^" (deleted)".Length];
        }

        return rawPath;
    }

    private static string? ReadCmd(string dir, ProcessFields fields)
    {
        if ((fields & ProcessFields.Command) == 0 && fields != 0)
        {
            return null;
        }

        var cmdBytes = ReadProcFile(dir, "cmdline");
        if (cmdBytes == null)
        {
            return string.Empty;
        }

        return DecodeCmdline(cmdBytes) ?? string.Empty;
    }

    private static int ReadUid(string dir, ProcessFields fields)
    {
        if ((fields & ProcessFields.Uid) == 0 && fields != 0)
        {
            return -1;
        }

        var statusBytes = ReadProcFile(dir, "status");
        if (statusBytes == null)
        {
            return -1;
        }

        return ParseStatusUid(statusBytes);
    }

    private static StatInfo ReadStat(string dir, ProcessFields fields, out bool ok)
    {
        ok = false;
        if (((fields & (ProcessFields.Ppid | ProcessFields.Memory | ProcessFields.Cpu | ProcessFields.StartTime)) == 0) && fields != 0)
        {
            return default;
        }

        var statBytes = ReadProcFile(dir, "stat");
        if (statBytes == null || !TryParseStat(statBytes, out var stat))
        {
            return default;
        }

        ok = true;
        return stat;
    }

    private static string? BuildName(string? path, string? comm, ProcessFields fields)
    {
        if ((fields & ProcessFields.Name) == 0 && fields != 0)
        {
            return null;
        }

        if (!string.IsNullOrEmpty(path))
        {
            var name = Path.GetFileName(path);
            if (!string.IsNullOrEmpty(name))
            {
                return name;
            }
        }
        return comm ?? string.Empty;
    }

    private static double ComputeMemory(bool statOk, StatInfo stat, in LinuxContext ctx, ProcessFields fields)
    {
        if (!statOk || ((fields & ProcessFields.Memory) == 0 && fields != 0))
        {
            return -1;
        }

        return stat.Rss * ctx.PageSize / ctx.TotalMem * 100.0;
    }

    private static double ComputeCpu(bool statOk, StatInfo stat, in LinuxContext ctx, ProcessFields fields)
    {
        if (!statOk || ((fields & ProcessFields.Cpu) == 0 && fields != 0))
        {
            return -1;
        }

        var processAge = ctx.Uptime - stat.StartTime / ctx.Ticks;
        if (processAge <= 0)
        {
            return -1;
        }

        var totalTime = (stat.Utime + stat.Stime) / ctx.Ticks;
        return totalTime / processAge * 100.0;
    }

    private static string? ComputeStartTime(bool statOk, StatInfo stat, in LinuxContext ctx, ProcessFields fields)
    {
        if (!statOk || ((fields & ProcessFields.StartTime) == 0 && fields != 0))
        {
            return null;
        }

        var epoch = ctx.BootTime + stat.StartTime / ctx.Ticks;
        if (epoch < long.MinValue || epoch > long.MaxValue)
        {
            return null;
        }

        return DateTimeOffset.FromUnixTimeSeconds((long)epoch).ToString("o");
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
        catch (Exception ex)
        {
            Trace.WriteLine($"readlink failed for {pathname}: {ex}");
        }
        return null;
    }

    private static int ParseStatusUid(ReadOnlySpan<byte> data)
    {
        var idx = data.IndexOf("Uid:"u8);
        if (idx < 0)
        {
            return -1;
        }

        var i = idx + "Uid:"u8.Length;
        while (i < data.Length && (data[i] == ' ' || data[i] == '\t'))
        {
            i++;
        }

        if (TryParseInt(data, ref i, out var value))
        {
            return value;
        }

        return -1;
    }

    private static bool TryParseStat(ReadOnlySpan<byte> data, out StatInfo info)
    {
        info = default;
        var rpar = data.LastIndexOf((byte)')');
        if (rpar < 0 || rpar + 1 >= data.Length)
        {
            return false;
        }

        var i = rpar + 1;
        if (i < data.Length && data[i] == ')')
        {
            i++;
        }

        while (i < data.Length && data[i] == ' ')
        {
            i++;
        }

        if (!SkipState(data, ref i))
        {
            return false;
        }

        if (!TryParseInt(data, ref i, out info.Ppid))
        {
            return false;
        }

        // skip pgrp, session, tty_nr, tpgid, flags, minflt, cminflt, majflt, cmajflt
        if (!SkipLongs(data, ref i, 9))
        {
            return false;
        }

        if (!TryParseLong(data, ref i, out info.Utime))
        {
            return false;
        }

        if (!TryParseLong(data, ref i, out info.Stime))
        {
            return false;
        }

        // skip cutime, cstime, priority
        if (!SkipLongs(data, ref i, 3))
        {
            return false;
        }

        // skip nice
        if (!SkipLongs(data, ref i, 1))
        {
            return false;
        }

        // skip num_threads, itrealvalue
        if (!SkipLongs(data, ref i, 2))
        {
            return false;
        }

        if (!TryParseLong(data, ref i, out info.StartTime))
        {
            return false;
        }

        // skip vsize
        if (!SkipLongs(data, ref i, 1))
        {
            return false;
        }

        if (!TryParseLong(data, ref i, out info.Rss))
        {
            return false;
        }

        return true;
    }

    private static bool SkipState(ReadOnlySpan<byte> data, ref int i)
    {
        if (i >= data.Length)
        {
            return false;
        }

        i++;
        while (i < data.Length && data[i] == ' ')
        {
            i++;
        }

        return true;
    }

    private static bool SkipLongs(ReadOnlySpan<byte> data, ref int i, int count)
    {
        for (var k = 0; k < count; k++)
        {
            if (!TryParseLong(data, ref i, out _))
            {
                return false;
            }
        }
        return true;
    }

    private static bool TryParseInt(ReadOnlySpan<byte> data, ref int i, out int value)
    {
        value = 0;
        if (!TryParseLong(data, ref i, out var l))
        {
            return false;
        }

        if (l > int.MaxValue || l < int.MinValue)
        {
            return false;
        }

        value = (int)l;
        return true;
    }

    private static bool TryParseLong(ReadOnlySpan<byte> data, ref int i, out long value)
    {
        value = 0;
        while (i < data.Length && data[i] == ' ')
        {
            i++;
        }

        if (i >= data.Length)
        {
            return false;
        }

        var sign = 1L;
        if (data[i] == '-') { sign = -1; i++; }
        else if (data[i] == '+')
        {
            i++;
        }

        var start = i;
        long acc = 0;
        while (i < data.Length && data[i] >= '0' && data[i] <= '9')
        {
            var digit = data[i] - '0';
            if (acc > (long.MaxValue - digit) / 10)
            {
                return false; // overflow
            }

            acc = acc * 10 + digit;
            i++;
        }

        if (i == start)
        {
            return false;
        }

        value = sign * acc;
        return true;
    }

    private static bool TryParseDouble(ReadOnlySpan<byte> data, ref int i, out double value)
    {
        value = 0;
        while (i < data.Length && data[i] == ' ')
        {
            i++;
        }

        if (i >= data.Length)
        {
            return false;
        }

        var sign = 1.0;
        if (data[i] == '-') { sign = -1; i++; }
        else if (data[i] == '+')
        {
            i++;
        }

        var start = i;
        long whole = 0;
        var hasDigits = false;
        while (i < data.Length && data[i] >= '0' && data[i] <= '9')
        {
            whole = whole * 10 + (data[i] - '0');
            i++;
            hasDigits = true;
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
                hasDigits = true;
            }
        }

        if (!hasDigits)
        {
            return false;
        }

        value = sign * (whole + frac / fracDiv);
        return true;
    }

    private static string? DecodeUtf8Trim(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0)
        {
            return null;
        }

        var s = Encoding.UTF8.GetString(data);
        return s.Trim('\n', '\r', '\t', ' ');
    }

    private static string? DecodeCmdline(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0)
        {
            return null;
        }

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
    private const int PROC_PIDT_SHORTBSDINFO = 13;
    private const int MaxBufferSize = 128 * 1024 * 1024;
    private const int ProcBsdShortInfoSize = 64;

    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_listpids(uint type, uint typeinfo, IntPtr buffer, int buffersize);

    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_pidinfo(int pid, int flavor, ulong arg, IntPtr buffer, int buffersize);

    [DllImport("libSystem.dylib", SetLastError = true)]
    private static extern int proc_pidpath(int pid, IntPtr buffer, uint buffersize);

    public static void Write(TextWriter writer, ProcessFields fields)
    {
        var size = 4096;
        var pids = Marshal.AllocHGlobal(size);
        int used;
        try
        {
            while (true)
            {
                used = proc_listpids(1, 0, pids, size);
                if (used < 0)
                {
                    throw new InvalidOperationException("proc_listpids failed");
                }

                if (used < size)
                {
                    break;
                }

                pids = NativeHelpers.GrowBuffer(pids, ref size, MaxBufferSize, "PID");
            }

            var info = Marshal.AllocHGlobal(ProcBsdShortInfoSize);
            var pathBuf = Marshal.AllocHGlobal(4096);
            try
            {
                WritePids(writer, fields, pids, used, info, pathBuf);
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

    private static void WritePids(TextWriter writer, ProcessFields fields, IntPtr pids, int used, IntPtr info, IntPtr pathBuf)
    {
        var count = used / 4;
        for (var i = 0; i < count; i++)
        {
            var pid = Marshal.ReadInt32(pids, i * 4);
            if (pid <= 0)
            {
                continue;
            }

            var len = proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0, info, ProcBsdShortInfoSize);
            if (len != ProcBsdShortInfoSize)
            {
                continue;
            }

            var ppid = Marshal.ReadInt32(info, 4);
            var (name, path) = GetNameAndPath(fields, pid, pathBuf);
            NativeHelpers.WriteProcessInfo(writer, fields, pid, ppid, name, path);
        }
    }

    private static (string? Name, string? Path) GetNameAndPath(ProcessFields fields, int pid, IntPtr pathBuf)
    {
        if (((fields & ProcessFields.Name) == 0) && ((fields & ProcessFields.Path) == 0) && (fields != 0))
        {
            return (null, null);
        }

        if (proc_pidpath(pid, pathBuf, 4096) <= 0)
        {
            return (null, null);
        }

        var path = Marshal.PtrToStringAnsi(pathBuf);
        if (string.IsNullOrEmpty(path))
        {
            return (null, null);
        }

        var name = ((fields & ProcessFields.Name) != 0 || fields == 0) ? Path.GetFileName(path) : null;
        return (name, path);
    }
}
