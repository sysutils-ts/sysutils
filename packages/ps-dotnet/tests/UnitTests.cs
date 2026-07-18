using System.Collections.Generic;
using System.Text.Json;
using Xunit;

namespace SysUtils.Ps.Tests;

public class ProcessRecordTests
{
    [Fact]
    public void ToJson_WithNoFields_IncludesAllFields()
    {
        var r = new ProcessRecord
        {
            Pid = 42,
            Ppid = 1,
            Name = "node",
            Command = "node app.js",
            Memory = 1024,
            Cpu = 0.5,
        };
        var json = r.ToJson(null);
        var doc = JsonDocument.Parse(json);
        Assert.Equal(42, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal(1, doc.RootElement.GetProperty("ppid").GetInt32());
        Assert.Equal("node", doc.RootElement.GetProperty("name").GetString());
        Assert.Equal("node app.js", doc.RootElement.GetProperty("command").GetString());
        Assert.Equal(1024, doc.RootElement.GetProperty("memory").GetInt64());
        Assert.Equal(0.5, doc.RootElement.GetProperty("cpu").GetDouble());
    }

    [Fact]
    public void ToJson_WithFields_OnlyIncludesRequested()
    {
        var r = new ProcessRecord
        {
            Pid = 7,
            Ppid = 2,
            Name = "bash",
            Command = "/bin/bash",
            Memory = 2048,
            Cpu = 1.0,
        };
        var fields = new HashSet<string>(System.StringComparer.OrdinalIgnoreCase) { "pid", "name" };
        var json = r.ToJson(fields);
        var doc = JsonDocument.Parse(json);
        Assert.Equal(7, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal("bash", doc.RootElement.GetProperty("name").GetString());
        Assert.False(doc.RootElement.TryGetProperty("ppid", out _));
        Assert.False(doc.RootElement.TryGetProperty("command", out _));
        Assert.False(doc.RootElement.TryGetProperty("memory", out _));
        Assert.False(doc.RootElement.TryGetProperty("cpu", out _));
    }

    [Fact]
    public void ToJson_PreservesNullValues()
    {
        var r = new ProcessRecord { Pid = 1, Ppid = 0, Name = "x", Command = null, Memory = null, Cpu = null };
        var json = r.ToJson(null);
        var doc = JsonDocument.Parse(json);
        Assert.Equal(1, doc.RootElement.GetProperty("pid").GetInt32());
        Assert.Equal(0, doc.RootElement.GetProperty("ppid").GetInt32());
        Assert.True(doc.RootElement.TryGetProperty("command", out var cmd));
        Assert.Equal(System.Text.Json.JsonValueKind.Null, cmd.ValueKind);
    }
}

public class OptionsTests
{
    [Fact]
    public void Parse_DefaultHasNoFields()
    {
        var o = Options.Parse(System.Array.Empty<string>());
        Assert.Null(o.Fields);
    }

    [Fact]
    public void Parse_FieldsAreParsed()
    {
        var o = Options.Parse(new[] { "--fields", "pid,name" });
        Assert.NotNull(o.Fields);
        Assert.Contains("pid", o.Fields);
        Assert.Contains("name", o.Fields);
        Assert.DoesNotContain("ppid", o.Fields);
    }
}