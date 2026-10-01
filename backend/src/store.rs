//! Projects on disk (CONTRACT §2) and the per-project command pipeline:
//! validate → apply → append to `events.jsonl` → rewrite `project.json` → broadcast.

use crate::apply::{self, ApplyError};
use crate::model::{Command, Event, Project, ProjectSummary};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::SystemTime;
use tokio::sync::broadcast;

#[derive(Debug)]
pub enum StoreError {
    /// The command was rejected; nothing changed (HTTP 400).
    BadRequest(String),
    /// Disk failure (HTTP 500).
    Io(String),
}

impl From<ApplyError> for StoreError {
    fn from(e: ApplyError) -> Self {
        StoreError::BadRequest(e.0)
    }
}

struct Inner {
    project: Project,
    events: Vec<Event>,
    /// `to` of the latest `version.tag`: the song version new events belong to.
    song_version: Option<String>,
}

pub struct ProjectHandle {
    pub id: String,
    dir: PathBuf,
    inner: Mutex<Inner>,
    tx: broadcast::Sender<Event>,
}

fn read_events(path: &Path) -> Result<Vec<Event>, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let mut events: Vec<Event> = Vec::new();
    for (n, line) in text.lines().enumerate() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        let e: Event = serde_json::from_str(line)
            .map_err(|err| format!("{} line {}: {err}", path.display(), n + 1))?;
        let expected = events.last().map_or(1, |p| p.seq + 1);
        if e.seq != expected {
            return Err(format!(
                "{} line {}: seq {} (expected {expected}; seq must increase by 1 from 1)",
                path.display(),
                n + 1,
                e.seq
            ));
        }
        events.push(e);
    }
    Ok(events)
}

/// Writes `bytes` to `path` via a temp file in the same folder and a rename.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)
}

impl ProjectHandle {
    /// Loads `<dir>/project.json` + `<dir>/events.jsonl`. If `project.json` is older than the
    /// log (a crash between the two writes), the missing events are re-applied.
    pub fn load(dir: &Path) -> Result<Self, String> {
        let id = dir
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .ok_or_else(|| format!("{}: not a project folder", dir.display()))?;
        let pj = dir.join("project.json");
        let text = fs::read_to_string(&pj).map_err(|e| format!("{}: {e}", pj.display()))?;
        let mut project: Project = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|e| format!("{}: {e}", pj.display()))?;
        project.id = id.clone();
        let events = read_events(&dir.join("events.jsonl"))?;
        let saved = project.version;
        for e in events.iter().filter(|e| e.seq > saved) {
            project = apply::apply(&project, e).map_err(|err| {
                format!("{}: replaying event {} failed: {err}", pj.display(), e.seq)
            })?;
        }
        let song_version = events
            .iter()
            .rev()
            .find(|e| e.verb == "version.tag")
            .and_then(|e| e.to.as_str().map(String::from));
        let (tx, _) = broadcast::channel(1024);
        Ok(ProjectHandle {
            id,
            dir: dir.to_path_buf(),
            inner: Mutex::new(Inner {
                project,
                events,
                song_version,
            }),
            tx,
        })
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn project(&self) -> Project {
        self.lock().project.clone()
    }

    pub fn summary(&self) -> ProjectSummary {
        ProjectSummary::from(&self.lock().project)
    }

    pub fn last_seq(&self) -> u64 {
        self.lock().events.last().map_or(0, |e| e.seq)
    }

    /// Events with `seq > since`, ascending, at most `limit`.
    pub fn events_since(&self, since: u64, limit: usize) -> Vec<Event> {
        let g = self.lock();
        let start = g.events.partition_point(|e| e.seq <= since);
        g.events[start..].iter().take(limit).cloned().collect()
    }

    /// The project right after event `at` (CONTRACT §5 `state?at=`).
    pub fn state_at(&self, at: u64) -> Result<Project, StoreError> {
        let g = self.lock();
        let last = g.events.last().map_or(0, |e| e.seq);
        if at > last {
            return Err(StoreError::BadRequest(format!(
                "at={at} is after the last event ({last})"
            )));
        }
        Ok(apply::state_at(&g.project, &g.events, at))
    }

    /// A consistent snapshot for a new live viewer: the current project, its last seq, and a
    /// receiver that yields exactly the events after that seq.
    pub fn subscribe(&self) -> (Project, u64, broadcast::Receiver<Event>) {
        let g = self.lock();
        let rx = self.tx.subscribe();
        let last = g.events.last().map_or(0, |e| e.seq);
        (g.project.clone(), last, rx)
    }

    pub fn audio_dir(&self) -> PathBuf {
        self.dir.join("audio")
    }

    /// Generated cover art (a viewer preference, CONTRACT §10).
    pub fn covers_dir(&self) -> PathBuf {
        self.dir.join("covers")
    }

    pub fn history(&self) -> Value {
        fs::read_to_string(self.dir.join("history.json"))
            .ok()
            .and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_else(|| json!({ "changelog": [], "commits": [], "branch": null }))
    }

    /// Runs one command. Commands on a project are serialized by the lock, so seq has no gaps.
    pub fn execute(&self, cmd: Command) -> Result<Event, StoreError> {
        let mut g = self.lock();
        let verb = cmd.verb.trim().to_string();
        let target = cmd.target.filter(|t| !t.trim().is_empty());
        let from = if verb == "version.tag" {
            g.song_version.clone().map_or(Value::Null, Value::String)
        } else {
            apply::current_value(&g.project, &verb, target.as_deref())
        };
        let version = if verb == "version.tag" {
            cmd.value.as_str().map(String::from)
        } else {
            g.song_version.clone()
        };
        let event = Event {
            seq: g.events.last().map_or(0, |e| e.seq) + 1,
            ts: humantime::format_rfc3339_seconds(SystemTime::now()).to_string(),
            agent: cmd
                .agent
                .filter(|a| !a.trim().is_empty())
                .unwrap_or_else(|| "agent".into()),
            verb,
            target,
            from,
            to: cmd.value,
            reason: cmd.reason,
            evidence: cmd.evidence,
            version,
        };
        let next = apply::apply(&g.project, &event)?;

        let line = serde_json::to_string(&event).map_err(|e| StoreError::Io(e.to_string()))?;
        let log = self.dir.join("events.jsonl");
        let append = || -> std::io::Result<()> {
            let mut f = OpenOptions::new().create(true).append(true).open(&log)?;
            f.write_all(format!("{line}\n").as_bytes())?;
            f.flush()?;
            f.sync_data()
        };
        append().map_err(|e| StoreError::Io(format!("{}: {e}", log.display())))?;

        // The event is durable from here on: it is applied even if project.json can't be
        // rewritten now (the next write, or the next load, catches up from the log).
        let pretty = serde_json::to_vec_pretty(&next).map_err(|e| StoreError::Io(e.to_string()))?;
        if let Err(e) = write_atomic(&self.dir.join("project.json"), &pretty) {
            eprintln!(
                "{}",
                json!({ "warning": format!("{}: project.json not rewritten: {e}", self.id) })
            );
        }
        if event.verb == "version.tag" {
            g.song_version = event.version.clone();
        }
        g.project = next;
        g.events.push(event.clone());
        let _ = self.tx.send(event.clone());
        Ok(event)
    }
}

/// All projects under a data folder: every subfolder that has a `project.json`.
pub struct Store {
    projects: BTreeMap<String, Arc<ProjectHandle>>,
}

impl Store {
    pub fn load(data_dir: &Path) -> Result<Store, String> {
        let entries =
            fs::read_dir(data_dir).map_err(|e| format!("--data {}: {e}", data_dir.display()))?;
        let mut projects = BTreeMap::new();
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.join("project.json").is_file() {
                continue;
            }
            match ProjectHandle::load(&dir) {
                Ok(h) => {
                    projects.insert(h.id.clone(), Arc::new(h));
                }
                Err(e) => eprintln!("{}", json!({ "warning": format!("skipping project: {e}") })),
            }
        }
        Ok(Store { projects })
    }

    pub fn get(&self, id: &str) -> Option<Arc<ProjectHandle>> {
        self.projects.get(id).cloned()
    }

    pub fn list(&self) -> Vec<ProjectSummary> {
        self.projects.values().map(|h| h.summary()).collect()
    }
}
