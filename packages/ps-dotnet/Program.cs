using System;
using System.IO;
using System.Runtime.InteropServices;

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
    All = Pid | Ppid | Name | Command | Memory | Cpu,
}

internal struct ProcessInfo
{
    public int Pid;
    public int Ppid;
    public string? Name;
    public string? Command;
    public long Memory;  // -1 means null
    public double Cpu;   // -1 means null
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
            else if (trimmed.SequenceEqual("command".AsSpan())) result |= ProcessField.Command;
            else if (trimmed.SequenceEqual("memory".AsSpan())) result |= ProcessField.Memory;
            else if (trimmed.SequenceEqual("cpu".AsSpan())) result |= ProcessField.Cpu;
            span = idx < 0 ? ReadOnlySpan<char>.Empty : span.Slice(idx + 1);
        }
        return result == 0 ? ProcessField.All : result;
    }
}

#if !TEST
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
        if ((fields & ProcessField.Name) != 0)
        {
            WriteKey(w, "name", ref first);
            WriteString(w, p.Name);
        }
        if ((fields & ProcessField.Command) != 0)
        {
            WriteKey(w, "command", ref first);
            WriteString(w, p.Command);
        }
        if ((fields & ProcessField.Memory) != 0)
        {
            WriteKey(w, "memory", ref first);
            if (p.Memory >= 0) w.Write(p.Memory); else w.Write("null");
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
                    var info = new ProcessInfo { Pid = pid, Ppid = ppid, Name = name, Command = null, Memory = -1, Cpu = -1 };
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
    public static void Write(TextWriter writer, ProcessField fields)
    {
        var pageSize = Environment.SystemPageSize;
        var dirs = Directory.GetDirectories("/proc");
        foreach (var dir in dirs)
        {
            var name = Path.GetFileName(dir);
            if (!int.TryParse(name, out var pid)) continue;
            try { WriteOne(writer, pid, dir, pageSize, fields); }
            catch { /* skip processes that disappear */ }
        }
    }

    private static void WriteOne(TextWriter writer, int pid, string dir, long pageSize, ProcessField fields)
    {
        var wantsPpid = (fields & ProcessField.Ppid) != 0 || fields == 0;
        var wantsName = (fields & ProcessField.Name) != 0 || fields == 0;
        var wantsCommand = (fields & ProcessField.Command) != 0 || fields == 0;
        var wantsMemory = (fields & ProcessField.Memory) != 0 || fields == 0;

        var ppid = 0;
        string? name = null;
        string? command = null;
        var memory = -1L;

        if (wantsPpid)
        {
            var stat = File.ReadAllBytes(Path.Combine(dir, "stat"));
            ppid = ParsePpid(stat);
        }

        if (wantsName || wantsCommand)
        {
            var comm = File.ReadAllBytes(Path.Combine(dir, "comm"));
            name = DecodeUtf8Trim(comm);
        }

        if (wantsCommand)
        {
            var cmdline = File.ReadAllBytes(Path.Combine(dir, "cmdline"));
            command = DecodeCmdline(cmdline);
        }

        if (wantsMemory)
        {
            var statm = File.ReadAllBytes(Path.Combine(dir, "statm"));
            var resident = ParseStatmSecond(statm);
            if (resident >= 0) memory = resident * pageSize;
        }

        var info = new ProcessInfo
        {
            Pid = pid,
            Ppid = ppid,
            Name = wantsName ? name : null,
            Command = command,
            Memory = memory,
            Cpu = -1,
        };
        JsonWriter.Write(writer, info, fields);
    }

    private static int ParsePpid(ReadOnlySpan<byte> data)
    {
        var rpar = -1;
        for (var j = data.Length - 1; j >= 0; j--)
        {
            if (data[j] == (byte)')') { rpar = j; break; }
        }
        if (rpar < 0 || rpar + 4 >= data.Length) return 0;

        var i = rpar + 1;
        if (i < data.Length && data[i] == (byte)' ') i++;
        if (i < data.Length) i++; // skip state char
        if (i < data.Length && data[i] == (byte)' ') i++;

        var sign = 1;
        if (i < data.Length && data[i] == (byte)'-') { sign = -1; i++; }

        var value = 0;
        while (i < data.Length && data[i] >= (byte)'0' && data[i] <= (byte)'9')
        {
            value = value * 10 + (data[i] - (byte)'0');
            i++;
        }
        return value * sign;
    }

    private static long ParseStatmSecond(ReadOnlySpan<byte> data)
    {
        var i = 0;
        while (i < data.Length && data[i] == (byte)' ') i++;
        while (i < data.Length && data[i] >= (byte)'0' && data[i] <= (byte)'9') i++;
        while (i < data.Length && data[i] == (byte)' ') i++;

        var value = 0L;
        while (i < data.Length && data[i] >= (byte)'0' && data[i] <= (byte)'9')
        {
            value = value * 10 + (data[i] - (byte)'0');
            i++;
        }
        return value;
    }

    private static string DecodeUtf8Trim(ReadOnlySpan<byte> data)
    {
        var s = System.Text.Encoding.UTF8.GetString(data);
        return s.Trim('\n', '\r', '\t', ' ');
    }

    private static string? DecodeCmdline(ReadOnlySpan<byte> data)
    {
        if (data.Length == 0) return null;
        var s = System.Text.Encoding.UTF8.GetString(data);
        s = s.Replace('\0', ' ').Trim();
        return string.IsNullOrEmpty(s) ? null : s;
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

                    string? name = null;
                    if ((fields & ProcessField.Name) != 0 || fields == 0)
                    {
                        if (proc_pidpath(pid, pathBuf, 4096) > 0)
                        {
                            var path = Marshal.PtrToStringAnsi(pathBuf);
                            name = Path.GetFileName(path);
                        }
                    }

                    var p = new ProcessInfo { Pid = pid, Ppid = ppid, Name = name, Command = null, Memory = -1, Cpu = -1 };
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
