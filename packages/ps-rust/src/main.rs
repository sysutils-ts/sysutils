use serde::Serialize;
use std::env;
use std::io::{self, Write};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

#[derive(Serialize)]
struct ProcessInfo {
    pid: u32,
    ppid: u32,
    name: String,
    command: Option<String>,
    memory: Option<u64>,
    cpu: Option<f32>,
}

fn main() {
    let fields: Option<Vec<String>> = env::args()
        .position(|a| a == "--fields")
        .and_then(|i| env::args().nth(i + 1))
        .map(|s| s.split(',').map(String::from).collect());

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );

    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::everything(),
    );

    let mut out = io::BufWriter::new(io::stdout());

    for (pid, process) in sys.processes() {
        let mut info = ProcessInfo {
            pid: pid.as_u32(),
            ppid: process.parent().map(|p| p.as_u32()).unwrap_or(0),
            name: process.name().to_string_lossy().into_owned(),
            command: process.cmd().first().map(|s| s.to_string_lossy().into_owned()),
            memory: process.memory_bytes(),
            cpu: process.cpu_usage(),
        };

        if let Some(ref f) = fields {
            info = filter_fields(info, f);
        }

        serde_json::to_writer(&mut out, &info).unwrap();
        out.write_all(b"\n").unwrap();
    }

    out.flush().unwrap();
}

fn filter_fields(mut info: ProcessInfo, fields: &[String]) -> ProcessInfo {
    if !fields.contains(&"command".to_string()) {
        info.command = None;
    }
    if !fields.contains(&"memory".to_string()) {
        info.memory = None;
    }
    if !fields.contains(&"cpu".to_string()) {
        info.cpu = None;
    }
    info
}
