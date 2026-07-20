using System;
using System.IO;
using System.Linq;
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
        }, ProcessFields.All);
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
        }, ProcessFields.Pid | ProcessFields.Name);
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
    public void Write_IncludesUserWhenSet()
    {
        var sw = new StringWriter();
        JsonWriter.Write(sw, new ProcessInfo
        {
            Pid = 1,
            Uid = 1000,
            User = "alice",
            Name = "node",
        }, ProcessFields.All);
        var doc = JsonDocument.Parse(sw.ToString());
        Assert.Equal("alice", doc.RootElement.GetProperty("user").GetString());
        Assert.Equal(1000, doc.RootElement.GetProperty("uid").GetInt32());
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
        }, ProcessFields.All);
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

public class PsModuleTests
{
    [Fact]
    public void ListProcesses_EmptyFields_ReturnsDefaultProcessSet()
    {
        var json = PsModule.ListProcesses("");
        Assert.False(string.IsNullOrWhiteSpace(json));
        var lines = json.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
        Assert.True(lines.Length > 0, "Expected at least one process");
        foreach (var line in lines)
        {
            using var doc = JsonDocument.Parse(line);
            Assert.True(doc.RootElement.TryGetProperty("pid", out _));
            Assert.True(doc.RootElement.TryGetProperty("ppid", out _));
            Assert.True(doc.RootElement.TryGetProperty("name", out _));
        }
    }

    [Fact]
    public void ListProcesses_FieldFilter_ReturnsOnlyRequestedFields()
    {
        var json = PsModule.ListProcesses("pid,name");
        Assert.False(string.IsNullOrWhiteSpace(json));
        var lines = json.Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries);
        Assert.True(lines.Length > 0, "Expected at least one process");
        foreach (var line in lines)
        {
            using var doc = JsonDocument.Parse(line);
            var properties = doc.RootElement.EnumerateObject().Select(p => p.Name).ToHashSet();
            Assert.Equal(new[] { "pid", "name" }.ToHashSet(), properties);
        }
    }
}

public class OptionsTests
{
    [Fact]
    public void Parse_DefaultReturnsAllFields()
    {
        var o = Options.Parse(System.Array.Empty<string>());
        Assert.Equal(ProcessFields.All, o.Fields);
    }

    [Fact]
    public void Parse_FieldsAreParsed()
    {
        var o = Options.Parse(new[] { "--fields", "pid,name" });
        Assert.Equal(ProcessFields.Pid | ProcessFields.Name, o.Fields);
    }

    [Fact]
    public void Parse_UnknownFieldsThrows()
    {
        Assert.Throws<ArgumentException>(() => Options.Parse(new[] { "--fields", "nonsense" }));
    }

    [Fact]
    public void Parse_AcceptsMixedCase()
    {
        var o = Options.Parse(new[] { "--fields", "Pid,Name,CPU" });
        Assert.Equal(ProcessFields.Pid | ProcessFields.Name | ProcessFields.Cpu, o.Fields);
    }

    [Fact]
    public void Parse_MapsCmdAndCommandToSameField()
    {
        var o1 = Options.Parse(new[] { "--fields", "cmd" });
        var o2 = Options.Parse(new[] { "--fields", "command" });
        Assert.Equal(ProcessFields.Command, o1.Fields);
        Assert.Equal(ProcessFields.Command, o2.Fields);
    }
}
