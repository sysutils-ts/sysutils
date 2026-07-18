using Microsoft.JavaScript.NodeApi;
using System;
using System.IO;

namespace SysUtils.Ps;

[JSExport]
public static class PsModule
{
    [JSExport]
    public static string ListProcesses(string fields)
    {
        var opts = Options.Parse(new[] { "--fields", fields ?? string.Empty });
        using var writer = new StringWriter();

        if (OperatingSystem.IsWindows())
            WindowsReader.Write(writer, opts.Fields);
        else if (OperatingSystem.IsLinux())
            LinuxReader.Write(writer, opts.Fields);
        else if (OperatingSystem.IsMacOS())
            MacReader.Write(writer, opts.Fields);
        else
            throw new PlatformNotSupportedException();

        return writer.ToString();
    }
}
