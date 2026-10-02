//! aiwave411.md (CONTRACT §11): each project's agent handoff document, in the spirit of a
//! CLAUDE.md. Agents read it before they work on a song or a sound design and keep it current;
//! humans read it in the workspace. Every write is a `doc.update` event carrying a summary of the
//! new text (never the text itself), so viewers see the document change live and the event log
//! stays small.

use crate::model::{Command, Event};
use crate::store::{ProjectHandle, StoreError};
use serde_json::{Value, json};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::SystemTime;

pub const FILE: &str = "aiwave411.md";
/// A handoff note, not a novel: writes above this are refused.
pub const MAX_BYTES: usize = 256 * 1024;

/// The document as the API returns it.
pub fn read(h: &ProjectHandle) -> Value {
    let path = path(h);
    match fs::read_to_string(&path) {
        Ok(text) => {
            let updated = fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .map(|t| humantime::format_rfc3339_seconds(t).to_string());
            json!({ "exists": true, "file": FILE, "text": text, "updated": updated, "summary": summary(&text) })
        }
        Err(_) => json!({ "exists": false, "file": FILE, "text": "", "updated": null }),
    }
}

/// Replaces the document and logs a `doc.update` event (the summary of the new text).
pub fn write(
    h: &ProjectHandle,
    text: &str,
    agent: Option<String>,
    reason: String,
    how: &str,
) -> Result<Event, StoreError> {
    if text.len() > MAX_BYTES {
        return Err(StoreError::BadRequest(format!(
            "{FILE} is limited to {MAX_BYTES} bytes ({} given)",
            text.len()
        )));
    }
    if reason.trim().is_empty() {
        return Err(StoreError::BadRequest("a reason is required".into()));
    }
    let path = path(h);
    let tmp = path.with_extension("md.tmp");
    let io = |e: std::io::Error| StoreError::Io(format!("{}: {e}", path.display()));
    {
        let mut f = fs::File::create(&tmp).map_err(io)?;
        f.write_all(text.as_bytes()).map_err(io)?;
        f.sync_all().map_err(io)?;
    }
    fs::rename(&tmp, &path).map_err(io)?;
    h.execute(Command {
        agent,
        verb: "doc.update".into(),
        target: Some(FILE.into()),
        value: json!({ "how": how, "summary": summary(text) }),
        reason,
        evidence: Value::Null,
    })
}

/// Appends a block (separated by a blank line) and logs it like a write.
pub fn append(
    h: &ProjectHandle,
    block: &str,
    agent: Option<String>,
    reason: String,
) -> Result<Event, StoreError> {
    let current = fs::read_to_string(path(h)).unwrap_or_default();
    let sep = if current.is_empty() || current.ends_with("\n\n") {
        ""
    } else if current.ends_with('\n') {
        "\n"
    } else {
        "\n\n"
    };
    let text = format!("{current}{sep}{}\n", block.trim_end());
    write(h, &text, agent, reason, "append")
}

/// Lines, bytes, the headings and a short fingerprint: what a `doc.update` event records.
pub fn summary(text: &str) -> Value {
    let headings: Vec<&str> = text
        .lines()
        .filter(|l| l.starts_with("## "))
        .map(|l| l.trim_start_matches("## ").trim())
        .collect();
    json!({
        "lines": text.lines().count(),
        "bytes": text.len(),
        "headings": headings,
        "fingerprint": format!("{:016x}", fnv1a(text.as_bytes())),
    })
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

fn path(h: &ProjectHandle) -> PathBuf {
    h.dir().join(FILE)
}

/// A starting document made from the project itself: what it is, its form, its tracks, its
/// latest version; the sections agents fill in are named and left short.
pub fn template(project: &Value, history: &Value) -> String {
    let s = |v: &Value| v.as_str().unwrap_or("").to_string();
    let title = s(&project["title"]);
    let mut out = format!(
        "# aiwave411: {title}\n\n\
         > The handoff for agents working on this project (like a CLAUDE.md). Read it before you\n\
         > change anything; keep it current with `aiwaves 411 append` / `aiwaves 411 set`. Every\n\
         > update shows up live in the AIWaves workspace.\n\n\
         ## What this is\n\n\
         **{title}** by {artist}. {bpm} BPM, {key}, {bars} bars.\n",
        artist = s(&project["artist"]),
        bpm = project["bpm"],
        key = s(&project["key"]),
        bars = project["length_bars"],
    );
    if let Some(latest) = history["changelog"].as_array().and_then(|c| c.first()) {
        out += &format!(
            "Current version: **v{}** ({}): {}.\n",
            s(&latest["version"]),
            s(&latest["date"]),
            s(&latest["title"])
        );
    }
    out += "\n## Form\n\n| Section | Bars |\n|---|---|\n";
    for sec in project["sections"].as_array().into_iter().flatten() {
        out += &format!(
            "| {} | {}–{} |\n",
            s(&sec["name"]),
            sec["start_bar"],
            sec["end_bar"]
        );
    }
    out += "\n## Tracks and devices\n\n";
    for t in project["tracks"].as_array().into_iter().flatten() {
        let devices: Vec<String> = t["devices"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|d| s(&d["name"]))
            .collect();
        out += &format!(
            "- **{}** ({}): {}\n",
            s(&t["name"]),
            s(&t["kind"]),
            if devices.is_empty() { "no devices".into() } else { devices.join(", ") }
        );
    }
    out += "\n## How it is made\n\n- Renderer / sources: (where the music is made, how to render)\n\
             - Export to AIWaves: (the command)\n\n\
             ## Rules that must hold\n\n- (what the human asked for; licences; things never to change)\n\n\
             ## Where it stands, what is next\n\n- \n\n\
             ## Log\n\n";
    let stamp = humantime::format_rfc3339_seconds(SystemTime::now()).to_string();
    out += &format!("- {}: created from the project.\n", &stamp[..10]);
    out
}
