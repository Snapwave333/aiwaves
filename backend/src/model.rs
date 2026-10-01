//! Data types of CONTRACT §3 (Project) and §4 (Event).
//!
//! Every object keeps unknown keys in `extra`, so a `project.json` written by a newer tool
//! survives a round trip through this backend unchanged.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::collections::BTreeMap;

pub const SCHEMA: &str = "aiwaves/project@1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub schema: String,
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub artist: String,
    pub bpm: Number,
    #[serde(default = "default_time_signature")]
    pub time_signature: Vec<u32>,
    pub key: String,
    pub length_bars: Number,
    #[serde(default)]
    pub version: u64,
    #[serde(default)]
    pub sections: Vec<Section>,
    #[serde(default)]
    pub chords: Vec<Chord>,
    #[serde(default)]
    pub audio: Audio,
    #[serde(default)]
    pub tracks: Vec<Track>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_time_signature() -> Vec<u32> {
    vec![4, 4]
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Section {
    pub name: String,
    pub start_bar: Number,
    pub end_bar: Number,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Chord {
    pub bar: u64,
    pub name: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Audio {
    pub master: String,
    #[serde(default)]
    pub duration_s: Option<Number>,
    #[serde(default)]
    pub peaks: Vec<Number>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Audio {
    fn default() -> Self {
        Audio {
            master: "audio/master.wav".into(),
            duration_s: None,
            peaks: Vec::new(),
            extra: Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub name: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub mixer: Mixer,
    #[serde(default)]
    pub devices: Vec<Device>,
    #[serde(default)]
    pub clips: Vec<Clip>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_kind() -> String {
    "audio".into()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mixer {
    pub volume_db: Number,
    pub pan: Number,
    pub mute: bool,
    pub solo: bool,
    #[serde(default)]
    pub sends: BTreeMap<String, Number>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Mixer {
    fn default() -> Self {
        Mixer {
            volume_db: Number::from(0),
            pan: Number::from(0),
            mute: false,
            solo: false,
            sends: BTreeMap::new(),
            extra: Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Device {
    pub id: String,
    #[serde(rename = "type", default = "default_device_type")]
    pub kind: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub params: Vec<Param>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_device_type() -> String {
    "generic".into()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Param {
    pub id: String,
    pub name: String,
    pub value: Number,
    pub min: Number,
    pub max: Number,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub display: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    pub id: String,
    pub name: String,
    pub start_bar: Number,
    pub length_bars: Number,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub notes: Option<Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// One line of `events.jsonl`, and what the WebSocket pushes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub seq: u64,
    pub ts: String,
    pub agent: String,
    pub verb: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub from: Value,
    #[serde(default)]
    pub to: Value,
    pub reason: String,
    #[serde(default)]
    pub evidence: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Body of `POST /api/projects/{id}/commands`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Command {
    #[serde(default)]
    pub agent: Option<String>,
    pub verb: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub evidence: Value,
}

/// Summary row of `GET /api/projects`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: String,
    pub title: String,
    pub bpm: Number,
    pub key: String,
    pub version: u64,
    pub length_bars: Number,
}

impl From<&Project> for ProjectSummary {
    fn from(p: &Project) -> Self {
        ProjectSummary {
            id: p.id.clone(),
            title: p.title.clone(),
            bpm: p.bpm.clone(),
            key: p.key.clone(),
            version: p.version,
            length_bars: p.length_bars.clone(),
        }
    }
}
