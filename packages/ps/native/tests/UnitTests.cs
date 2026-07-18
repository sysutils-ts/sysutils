using System.IO;
using System.Text.Json;
using Xunit;

namespace SysUtils.Ps.Tests;

public class JsonWriterTests
{
    [Fact]
    public void Write_WithNoFieldFilter_IncludesAllFields()
    {
        var sw = new StringWriter();
        JsonWriter.Write(sw, new ProcessInfo
        {
            Pid = 42,
            Ppid = 1,
            Uid = 1000,
            Name = "node",
            Cmd = "node app.js",
            Path = "/usr/bin/node",
            StartTime = "2026-07-18T18:00:00.0000000+00:00",
            Memory = 1.5,
            Cpu = 0.5,
        }, ProcessField.All);
        var doc = JsonDocument.Parse(sw.ToString());
        Assert.Equal(42, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal(1, doc.RootElement.GetProperty("ppid").GetInt32());
        Assert.Equal(1000, doc.RootElement.GetProperty("uid").GetInt32());
        Assert.Equal("node", doc.RootElement.GetProperty("name").GetString());
        Assert.Equal("node app.js", doc.RootElement.GetProperty("cmd").GetString());
        Assert.Equal("/usr/bin/node", doc.RootElement.GetProperty("path").GetString());
        Assert.Equal("2026-07-18T18:00:00.0000000+00:00", doc.RootElement.GetProperty("startTime").GetString());
        Assert.Equal(1.5, doc.RootElement.GetProperty("memory").GetDouble());
        Assert.Equal(0.5, doc.RootElement.GetProperty("cpu").GetDouble());
    }

    [Fact]
    public void Write_WithFieldFilter_OnlyIncludesRequested()
    {
        var sw = new StringWriter();
        JsonWriter.Write(sw, new ProcessInfo
        {
            Pid = 7,
            Ppid = 2,
            Uid = 1000,
            Name = "bash",
            Cmd = "/bin/bash",
            Path = "/bin/bash",
            StartTime = "2026-07-18T18:00:00.0000000+00:00",
            Memory = 2.0,
            Cpu = 1.0,
        }, ProcessField.Pid | ProcessField.Name);
        var doc = JsonDocument.Parse(sw.ToString());
        Assert.Equal(7, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal("bash", doc.RootElement.GetProperty("name").GetString());
        Assert.False(doc.RootElement.TryGetProperty("ppid", out _));
        Assert.False(doc.RootElement.TryGetProperty("uid", out _));
        Assert.False(doc.RootElement.TryGetProperty("cmd", out _));
        Assert.False(doc.RootElement.TryGetProperty("path", out _));
        Assert.False(doc.RootElement.TryGetProperty("startTime", out _));
        Assert.False(doc.RootElement.TryGetProperty("memory", out _));
        Assert.False(doc.RootElement.TryGetProperty("cpu", out _));
    }

    [Fact]
    public void Write_PreservesNullValues()
    {
        var sw = new StringWriter();
        JsonWriter.Write(sw, new ProcessInfo
        {
            Pid = 1,
            Ppid = 0,
            Uid = -1,
            Name = "x",
            Cmd = null,
            Path = null,
            StartTime = null,
            Memory = -1,
            Cpu = -1,
        }, ProcessField.All);
        var doc = JsonDocument.Parse(sw.ToString());
        Assert.Equal(1, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal(0, doc.RootElement.GetProperty("ppid").GetInt32());
        Assert.True(doc.RootElement.TryGetProperty("uid", out var uid));
        Assert.Equal(JsonValueKind.Null, uid.ValueKind);
        Assert.True(doc.RootElement.TryGetProperty("cmd", out var cmd));
        Assert.Equal(JsonValueKind.Null, cmd.ValueKind);
        Assert.True(doc.RootElement.TryGetProperty("path", out var path));
        Assert.Equal(JsonValueKind.Null, path.ValueKind);
        Assert.True(doc.RootElement.TryGetProperty("startTime", out var startTime));
        Assert.Equal(JsonValueKind.Null, startTime.ValueKind);
        Assert.True(doc.RootElement.TryGetProperty("memory", out var mem));
        Assert.Equal(JsonValueKind.Null, mem.ValueKind);
        Assert.True(doc.RootElement.TryGetProperty("cpu", out var cpu));
        Assert.Equal(JsonValueKind.Null, cpu.ValueKind);
    }
}

public class OptionsTests
{
    [Fact]
    public void Parse_DefaultReturnsAllFields()
    {
        var o = Options.Parse(System.Array.Empty<string>());
        Assert.Equal(ProcessField.All, o.Fields);
    }

    [Fact]
    public void Parse_FieldsAreParsed()
    {
        var o = Options.Parse(new[] { "--fields", "pid,name" });
        Assert.Equal(ProcessField.Pid | ProcessField.Name, o.Fields);
    }

    [Fact]
    public void Parse_UnknownFieldsFallbackToAll()
    {
        var o = Options.Parse(new[] { "--fields", "nonsense" });
        Assert.Equal(ProcessField.All, o.Fields);
    }

    [Fact]
    public void Parse_MapsCmdAndCommandToSameField()
    {
        var o1 = Options.Parse(new[] { "--fields", "cmd" });
        var o2 = Options.Parse(new[] { "--fields", "command" });
        Assert.Equal(ProcessField.Command, o1.Fields);
        Assert.Equal(ProcessField.Command, o2.Fields);
    }
}
