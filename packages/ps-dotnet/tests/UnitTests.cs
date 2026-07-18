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
            Name = "node",
            Command = "node app.js",
            Memory = 1024,
            Cpu = 0.5,
        }, ProcessField.All);
        var doc = JsonDocument.Parse(sw.ToString());
        Assert.Equal(42, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal(1, doc.RootElement.GetProperty("ppid").GetInt32());
        Assert.Equal("node", doc.RootElement.GetProperty("name").GetString());
        Assert.Equal("node app.js", doc.RootElement.GetProperty("command").GetString());
        Assert.Equal(1024, doc.RootElement.GetProperty("memory").GetInt64());
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
            Name = "bash",
            Command = "/bin/bash",
            Memory = 2048,
            Cpu = 1.0,
        }, ProcessField.Pid | ProcessField.Name);
        var doc = JsonDocument.Parse(sw.ToString());
        Assert.Equal(7, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal("bash", doc.RootElement.GetProperty("name").GetString());
        Assert.False(doc.RootElement.TryGetProperty("ppid", out _));
        Assert.False(doc.RootElement.TryGetProperty("command", out _));
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
            Name = "x",
            Command = null,
            Memory = -1,
            Cpu = -1,
        }, ProcessField.All);
        var doc = JsonDocument.Parse(sw.ToString());
        Assert.Equal(1, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal(0, doc.RootElement.GetProperty("ppid").GetInt32());
        Assert.True(doc.RootElement.TryGetProperty("command", out var cmd));
        Assert.Equal(JsonValueKind.Null, cmd.ValueKind);
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
}
