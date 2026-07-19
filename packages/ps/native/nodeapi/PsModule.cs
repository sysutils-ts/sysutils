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
        var opts = string.IsNullOrEmpty(fields)
            ? Options.Parse(Array.Empty<string>())
            : Options.Parse(new[] { "--fields", fields });
        using var writer = new StringWriter();
        ProcessWriter.Write(writer, opts.Fields);
        return writer.ToString();
    }
}
