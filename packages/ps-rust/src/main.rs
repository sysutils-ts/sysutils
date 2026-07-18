use serde::Serialize;
use std::collections::BTreeSet;
use std::env;
use std::ffi::OsString;
use std::io::{self, BufWriter, Write};
use std::process::ExitCode;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[cfg(windows)]
mod windows_fast;

const FIELDS: &[&str] = &["pid", "ppid", "name", "command", "memory", "cpu"];

#[derive(Serialize)]
struct ProcessInfo {
    pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    ppid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cpu: Option<f32>,
}

fn parse_fields(args: &[String]) -> Option<BTreeSet<String>> {
    let pos = args.iter().position(|a| a == "--fields")?;
    let value = args.get(pos + 1)?;
    let set: BTreeSet<String> = value
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    Some(set)
}

fn has_field(fields: Option<&BTreeSet<String>>, name: &str) -> bool {
    fields.map_or(true, |f| f.contains(name))
}

fn build_process_info(
    fields: Option<&BTreeSet<String>>,
    pid: u32,
    ppid: Option<u32>,
    name: Option<String>,
    command: Option<String>,
    memory: Option<u64>,
    cpu: Option<f32>,
) -> ProcessInfo {
    ProcessInfo {
        pid,
        ppid: if has_field(fields, "ppid") { ppid } else { None },
        name: if has_field(fields, "name") { name } else { None },
        command: if has_field(fields, "command") { command } else { None },
        memory: if has_field(fields, "memory") { memory } else { None },
        cpu: if has_field(fields, "cpu") { cpu } else { None },
    }
}

fn process_info(
    pid: &Pid,
    process: &sysinfo::Process,
    fields: Option<&BTreeSet<String>>,
) -> ProcessInfo {
    let ppid = process.parent().map(|p| p.as_u32());
    let name = Some(process.name().to_string_lossy().into_owned());
    let command = join_cmd(process.cmd());
    let memory = Some(process.memory());
    let cpu = Some(process.cpu_usage());
    build_process_info(fields, pid.as_u32(), ppid, name, command, memory, cpu)
}

fn join_cmd(argv: &[OsString]) -> Option<String> {
    if argv.is_empty() {
        return None;
    }
    let mut parts = argv.iter().map(|s| s.to_string_lossy());
    let first = parts.next()?.into_owned();
    let total = argv.iter().map(|s| s.len()).sum::<usize>() + argv.len().saturating_sub(1);
    let mut out = String::with_capacity(total);
    out.push_str(&first);
    for part in parts {
        out.push(' ');
        out.push_str(&part);
    }
    Some(out)
}

fn refresh_kind(fields: Option<&BTreeSet<String>>) -> ProcessRefreshKind {
    let mut kind = ProcessRefreshKind::nothing()
        .with_environ(UpdateKind::Never)
        .with_root(UpdateKind::Never)
        .with_cwd(UpdateKind::Never);

    if has_field(fields, "command") {
        kind = kind.with_cmd(UpdateKind::OnlyIfNotSet);
    } else {
        kind = kind.with_cmd(UpdateKind::Never);
    }
    if has_field(fields, "memory") {
        kind = kind.with_memory();
    } else {
        kind = kind.without_memory();
    }
    if has_field(fields, "cpu") {
        kind = kind.with_cpu();
    } else {
        kind = kind.without_cpu();
    }
    kind
}

#[cfg(windows)]
fn can_use_snapshot(fields: Option<&BTreeSet<String>>) -> bool {
    // The ToolHelp snapshot gives us pid/ppid/name without opening every process.
    if fields.is_none() {
        return false;
    }
    fields
        .unwrap()
        .iter()
        .all(|f| matches!(f.as_str(), "pid" | "ppid" | "name"))
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn can_use_snapshot(_fields: Option<&BTreeSet<String>>) -> bool {
    false
}

fn collect_with_sysinfo(fields: Option<&BTreeSet<String>>) -> Result<Vec<ProcessInfo>, String> {
    let refresh = refresh_kind(fields);
    let mut sys = System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_processes(refresh),
    );
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh);

    let mut processes: Vec<(&Pid, &sysinfo::Process)> = sys.processes().iter().collect();
    processes.sort_by_key(|(pid, _)| pid.as_u32());

    Ok(processes
        .into_iter()
        .map(|(pid, process)| process_info(pid, process, fields))
        .collect())
}

fn write_processes(processes: &[ProcessInfo]) -> Result<(), String> {
    let stdout = io::stdout().lock();
    let mut out = BufWriter::with_capacity(16 * 1024, stdout);

    for info in processes {
        serde_json::to_writer(&mut out, info).map_err(|e| e.to_string())?;
        out.write_all(b"\n").map_err(|e| e.to_string())?;
    }

    out.flush().map_err(|e| e.to_string())?;
    if processes.is_empty() {
        eprintln!("no processes found");
    }
    Ok(())
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let fields = parse_fields(&args);

    for requested in fields.iter().flat_map(|f| f.iter()) {
        if !FIELDS.contains(&requested.as_str()) {
            return Err(format!("unknown field: {requested}"));
        }
    }

    #[cfg(windows)]
    if can_use_snapshot(fields.as_ref()) {
        let stdout = io::stdout().lock();
        let mut out = BufWriter::with_capacity(16 * 1024, stdout);
        windows_fast::write_snapshot_processes(fields.as_ref(), &mut out)?;
        out.flush().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let processes = collect_with_sysinfo(fields.as_ref())?;
    write_processes(&processes)
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("ps: {err}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn empty_args() -> Vec<String> {
        Vec::new()
    }

    #[test]
    fn parse_fields_parses_comma_separated_list() {
        let args = vec!["--fields".into(), "pid,name,command".into()];
        let fields = parse_fields(&args).expect("fields");
        assert!(fields.contains("pid"));
        assert!(fields.contains("name"));
        assert!(fields.contains("command"));
        assert!(!fields.contains("memory"));
    }

    #[test]
    fn parse_fields_trims_whitespace_and_empties() {
        let args = vec!["--fields".into(), " pid , , name ,".into()];
        let fields = parse_fields(&args).expect("fields");
        assert_eq!(fields.len(), 2);
        assert!(fields.contains("pid"));
        assert!(fields.contains("name"));
    }

    #[test]
    fn parse_fields_absent_returns_none() {
        let args = empty_args();
        assert!(parse_fields(&args).is_none());
    }

    #[test]
    fn parse_fields_missing_value_returns_none() {
        let args = vec!["--fields".into()];
        assert!(parse_fields(&args).is_none());
    }

    #[test]
    fn join_cmd_returns_none_for_empty_argv() {
        let argv: Vec<OsString> = Vec::new();
        assert!(join_cmd(&argv).is_none());
    }

    #[test]
    fn join_cmd_joins_single_arg() {
        let argv = vec![OsString::from("ls")];
        assert_eq!(join_cmd(&argv).as_deref(), Some("ls"));
    }

    #[test]
    fn join_cmd_joins_multiple_args_with_spaces() {
        let argv = vec![
            OsString::from("ps"),
            OsString::from("-ef"),
            OsString::from("|"),
            OsString::from("grep"),
        ];
        assert_eq!(join_cmd(&argv).as_deref(), Some("ps -ef | grep"));
    }
}
