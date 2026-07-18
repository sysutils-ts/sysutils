use std::collections::BTreeSet;
use std::io::Write;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
};

fn write_quoted_u16(out: &mut dyn Write, chars: &[u16]) -> Result<(), std::io::Error> {
    out.write_all(b"\"")?;
    for &c in chars {
        if c == b'\\' as u16 {
            out.write_all(b"\\\\")?;
        } else if c == b'\"' as u16 {
            out.write_all(b"\\\"")?;
        } else if c < 0x20 {
            write!(out, "\\u{:04x}", c)?;
        } else if c < 0x80 {
            out.write_all(&[c as u8])?;
        } else {
            let ch = char::from_u32(c as u32).unwrap_or('\u{FFFD}');
            let mut buf = [0u8; 4];
            out.write_all(ch.encode_utf8(&mut buf).as_bytes())?;
        }
    }
    out.write_all(b"\"")
}

pub fn write_snapshot_processes(
    fields: Option<&BTreeSet<String>>,
    out: &mut dyn Write,
) -> Result<(), String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            .map_err(|e| format!("CreateToolhelp32Snapshot failed: {e}"))?;

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let has = |name: &str| fields.map_or(true, |f| f.contains(name));
        let want_name = has("name");
        let want_ppid = has("ppid");

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                write!(out, "{{\"pid\":{}", entry.th32ProcessID)
                    .map_err(|e| e.to_string())?;

                if want_ppid && entry.th32ParentProcessID != 0 {
                    write!(out, ",\"ppid\":{}", entry.th32ParentProcessID)
                        .map_err(|e| e.to_string())?;
                }

                if want_name {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(260);
                    out.write_all(b",\"name\":").map_err(|e| e.to_string())?;
                    write_quoted_u16(out, &entry.szExeFile[..len])
                        .map_err(|e| e.to_string())?;
                }

                writeln!(out, "}}").map_err(|e| e.to_string())?;

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
        Ok(())
    }
}
