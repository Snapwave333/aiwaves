//! The pure state machine of CONTRACT §4: `apply` (strict, validates), `unapply` (lenient,
//! uses an event's `from`), `state_at`, plus `current_value` (the `from` of a new event).

use crate::model::{Chord, Clip, Device, Event, Param, Project, Section, Track};
use serde::de::DeserializeOwned;
use serde_json::{Map, Number, Value, json};
use std::fmt;

pub const VERBS: &[&str] = &[
    "param.set",
    "mixer.set",
    "device.add",
    "device.remove",
    "device.enable",
    "track.add",
    "track.remove",
    "track.rename",
    "clip.add",
    "clip.move",
    "clip.remove",
    "section.set",
    "chord.set",
    "song.set",
    "render.done",
    "note",
    "version.tag",
    "doc.update",
];

/// Ranges for controls that have no min/max in the project file (see CONTRACT_NOTES.md).
pub const VOLUME_DB_RANGE: (f64, f64) = (-96.0, 6.0);
pub const PAN_RANGE: (f64, f64) = (-1.0, 1.0);
pub const BPM_RANGE: (f64, f64) = (20.0, 999.0);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyError(pub String);

impl fmt::Display for ApplyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ApplyError {}

type Result<T> = std::result::Result<T, ApplyError>;

fn err<T>(msg: impl Into<String>) -> Result<T> {
    Err(ApplyError(msg.into()))
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum MixerField<'a> {
    Volume,
    Pan,
    Mute,
    Solo,
    Send(&'a str),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Path<'a> {
    Song(&'a str),
    Track(&'a str),
    Mixer(&'a str, MixerField<'a>),
    Device(&'a str, &'a str),
    Param(&'a str, &'a str, &'a str),
    Clip(&'a str, &'a str),
    Section(&'a str),
    Chord(u64),
}

fn parse_path(target: &str) -> Option<Path<'_>> {
    if target == "bpm" || target == "key" {
        return Some(Path::Song(target));
    }
    if let Some(name) = target.strip_prefix("sections.") {
        return (!name.is_empty()).then_some(Path::Section(name));
    }
    if let Some(bar) = target.strip_prefix("chords.") {
        return bar.parse().ok().map(Path::Chord);
    }
    let parts: Vec<&str> = target.split('.').collect();
    if parts.iter().any(|s| s.is_empty()) {
        return None;
    }
    Some(match parts.as_slice() {
        ["tracks", t] => Path::Track(t),
        ["tracks", t, "mixer", "volume_db"] => Path::Mixer(t, MixerField::Volume),
        ["tracks", t, "mixer", "pan"] => Path::Mixer(t, MixerField::Pan),
        ["tracks", t, "mixer", "mute"] => Path::Mixer(t, MixerField::Mute),
        ["tracks", t, "mixer", "solo"] => Path::Mixer(t, MixerField::Solo),
        ["tracks", t, "mixer", "sends", r] => Path::Mixer(t, MixerField::Send(r)),
        ["tracks", t, "devices", d] => Path::Device(t, d),
        ["tracks", t, "devices", d, "params", q] => Path::Param(t, d, q),
        ["tracks", t, "clips", c] => Path::Clip(t, c),
        _ => return None,
    })
}

/// The set-style verb for a target, used by `aiwaves set`.
pub fn verb_for_target(target: &str) -> Option<&'static str> {
    Some(match parse_path(target)? {
        Path::Param(..) => "param.set",
        Path::Mixer(..) => "mixer.set",
        Path::Song(_) => "song.set",
        Path::Device(..) => "device.enable",
        Path::Track(_) => "track.rename",
        Path::Clip(..) => "clip.move",
        Path::Section(_) => "section.set",
        Path::Chord(_) => "chord.set",
    })
}

/// Which target shape a verb needs, for error messages.
fn expected_shape(verb: &str) -> &'static str {
    match verb {
        "param.set" => "tracks.<track>.devices.<device>.params.<param>",
        "mixer.set" => "tracks.<track>.mixer.volume_db|pan|mute|solo|sends.<return>",
        "song.set" => "bpm | key",
        "device.add" | "device.remove" | "device.enable" => "tracks.<track>.devices.<device>",
        "track.add" | "track.remove" | "track.rename" => "tracks.<track>",
        "clip.add" | "clip.move" | "clip.remove" => "tracks.<track>.clips.<clip>",
        "section.set" => "sections.<name>",
        "chord.set" => "chords.<bar>",
        _ => "any",
    }
}

fn shape_matches(verb: &str, path: &Path) -> bool {
    matches!(
        (verb, path),
        ("param.set", Path::Param(..))
            | ("mixer.set", Path::Mixer(..))
            | ("song.set", Path::Song(_))
            | (
                "device.add" | "device.remove" | "device.enable",
                Path::Device(..)
            )
            | (
                "track.add" | "track.remove" | "track.rename",
                Path::Track(_)
            )
            | ("clip.add" | "clip.move" | "clip.remove", Path::Clip(..))
            | ("section.set", Path::Section(_))
            | ("chord.set", Path::Chord(_))
    )
}

// ---------------------------------------------------------------- lookups

fn track_index(p: &Project, t: &str) -> Option<usize> {
    p.tracks.iter().position(|x| x.id == t)
}

fn track_mut<'p>(p: &'p mut Project, t: &str) -> Result<&'p mut Track> {
    match p.tracks.iter_mut().find(|x| x.id == t) {
        Some(x) => Ok(x),
        None => err(format!("unknown track '{t}'")),
    }
}

fn device_mut<'p>(p: &'p mut Project, t: &str, d: &str) -> Result<&'p mut Device> {
    let track = track_mut(p, t)?;
    match track.devices.iter_mut().find(|x| x.id == d) {
        Some(x) => Ok(x),
        None => err(format!("unknown device '{d}' on track '{t}'")),
    }
}

fn param_mut<'p>(p: &'p mut Project, t: &str, d: &str, q: &str) -> Result<&'p mut Param> {
    let device = device_mut(p, t, d)?;
    match device.params.iter_mut().find(|x| x.id == q) {
        Some(x) => Ok(x),
        None => err(format!("unknown param '{q}' on device '{t}.{d}'")),
    }
}

fn clip_mut<'p>(p: &'p mut Project, t: &str, c: &str) -> Result<&'p mut Clip> {
    let track = track_mut(p, t)?;
    match track.clips.iter_mut().find(|x| x.id == c) {
        Some(x) => Ok(x),
        None => err(format!("unknown clip '{c}' on track '{t}'")),
    }
}

// ---------------------------------------------------------------- value helpers

fn number(v: &Value, what: &str) -> Result<Number> {
    match v {
        Value::Number(n) => Ok(n.clone()),
        _ => err(format!("{what}: value must be a number, got {v}")),
    }
}

fn number_in(v: &Value, what: &str, (min, max): (f64, f64)) -> Result<Number> {
    let n = number(v, what)?;
    let x = n.as_f64().unwrap_or(f64::NAN);
    if !(min..=max).contains(&x) {
        return err(format!("{what}: value {n} is outside [{min}, {max}]"));
    }
    Ok(n)
}

fn boolean(v: &Value, what: &str) -> Result<bool> {
    v.as_bool().map_or_else(
        || err(format!("{what}: value must be true or false, got {v}")),
        Ok,
    )
}

fn text(v: &Value, what: &str) -> Result<String> {
    match v.as_str().map(str::trim) {
        Some(s) if !s.is_empty() => Ok(s.to_string()),
        _ => err(format!("{what}: value must be a non-empty string, got {v}")),
    }
}

fn f(n: &Number) -> f64 {
    n.as_f64().unwrap_or(0.0)
}

/// `display` of a param after its value changed: the number, then the unit.
pub fn display(value: &Number, unit: &str) -> String {
    if unit.is_empty() {
        value.to_string()
    } else {
        format!("{value} {unit}")
    }
}

/// Builds a track / device / clip from a command value: a name string, or a (partial) object.
/// An optional `"index"` key says where to insert it; the id always comes from the target.
fn build<T: DeserializeOwned>(
    id: &str,
    value: &Value,
    defaults: &[(&str, Value)],
) -> Result<(T, Option<usize>)> {
    let mut map = match value {
        Value::String(name) if !name.trim().is_empty() => {
            Map::from_iter([("name".to_string(), Value::String(name.clone()))])
        }
        Value::Object(m) => m.clone(),
        Value::Null => Map::new(),
        _ => return err(format!("value must be a name or an object, got {value}")),
    };
    let index = map
        .remove("index")
        .and_then(|v| v.as_u64())
        .map(|i| i as usize);
    map.insert("id".into(), Value::String(id.into()));
    map.entry("name")
        .or_insert_with(|| Value::String(id.into()));
    for (k, v) in defaults {
        map.entry(*k).or_insert_with(|| v.clone());
    }
    match serde_json::from_value(Value::Object(map)) {
        Ok(obj) => Ok((obj, index)),
        Err(e) => err(format!("invalid object for '{id}': {e}")),
    }
}

fn insert_at<T>(items: &mut Vec<T>, index: Option<usize>, default: usize, item: T) {
    let i = index.unwrap_or(default).min(items.len());
    items.insert(i, item);
}

/// The object at a target plus its position, as stored in `from` of a remove event.
fn with_index<T: serde::Serialize>(item: &T, index: usize) -> Value {
    let mut v = serde_json::to_value(item).unwrap_or(Value::Null);
    if let Value::Object(m) = &mut v {
        m.insert("index".into(), json!(index));
    }
    v
}

fn track_default_index(p: &Project) -> usize {
    p.tracks
        .iter()
        .position(|t| t.kind == "master")
        .unwrap_or(p.tracks.len())
}

fn sort_sections(p: &mut Project) {
    p.sections
        .sort_by(|a, b| f(&a.start_bar).total_cmp(&f(&b.start_bar)));
}

fn upsert_chord(p: &mut Project, bar: u64, name: String) {
    match p.chords.iter_mut().find(|c| c.bar == bar) {
        Some(c) => c.name = name,
        None => {
            p.chords.push(Chord {
                bar,
                name,
                extra: Map::new(),
            });
            p.chords.sort_by_key(|c| c.bar);
        }
    }
}

// ---------------------------------------------------------------- apply

/// Applies one event to a project (CONTRACT §4). Strict: an unknown verb or target, a value of
/// the wrong type or outside its range, or an empty reason is an error and nothing changes.
/// On success the returned project has `version = event.seq`.
pub fn apply(project: &Project, event: &Event) -> Result<Project> {
    let verb = event.verb.as_str();
    if event.reason.trim().is_empty() {
        return err("reason must not be empty");
    }
    if !VERBS.contains(&verb) {
        return err(format!("unknown verb '{verb}'"));
    }
    let mut p = project.clone();
    let to = &event.to;
    match verb {
        // notes and handoff-document updates (aiwave411.md) leave the project as it is
        "note" | "doc.update" => {}
        "version.tag" => {
            text(to, "version.tag")?;
        }
        "render.done" => apply_render(&mut p, to)?,
        _ => {
            let Some(target) = event.target.as_deref() else {
                return err(format!("{verb} needs a target ({})", expected_shape(verb)));
            };
            let path = parse_path(target)
                .filter(|path| shape_matches(verb, path))
                .ok_or_else(|| {
                    ApplyError(format!(
                        "unknown target '{target}' for {verb} (expected {})",
                        expected_shape(verb)
                    ))
                })?;
            apply_path(&mut p, verb, path, to)?;
        }
    }
    p.version = event.seq;
    Ok(p)
}

fn apply_render(p: &mut Project, to: &Value) -> Result<()> {
    let (audio, rest) = match to {
        Value::String(s) => (s.clone(), None),
        Value::Object(m) => (
            text(m.get("audio").unwrap_or(&Value::Null), "render.done audio")?,
            Some(m),
        ),
        _ => return err(r#"render.done: value must be {"audio": path, "duration_s": n}"#),
    };
    if audio.trim().is_empty() {
        return err("render.done: audio path must not be empty");
    }
    p.audio.master = audio;
    if let Some(m) = rest {
        if let Some(d) = m.get("duration_s") {
            p.audio.duration_s = Some(number_in(d, "render.done duration_s", (0.0, f64::MAX))?);
        }
        if let Some(peaks) = m.get("peaks") {
            p.audio.peaks = serde_json::from_value(peaks.clone())
                .map_err(|_| ApplyError("render.done: peaks must be an array of numbers".into()))?;
        }
    }
    Ok(())
}

fn apply_path(p: &mut Project, verb: &str, path: Path, to: &Value) -> Result<()> {
    match (verb, path) {
        ("param.set", Path::Param(t, d, q)) => {
            let param = param_mut(p, t, d, q)?;
            let what = format!("tracks.{t}.devices.{d}.params.{q}");
            let n = number_in(to, &what, (f(&param.min), f(&param.max)))?;
            param.display = display(&n, &param.unit);
            param.value = n;
        }
        ("mixer.set", Path::Mixer(t, field)) => {
            if let MixerField::Send(r) = field {
                let is_return = p.tracks.iter().any(|x| x.id == r && x.kind == "return");
                let known = track_mut(p, t)?.mixer.sends.contains_key(r);
                if !known && !is_return {
                    return err(format!(
                        "unknown send '{r}' on track '{t}' (no return track '{r}')"
                    ));
                }
            }
            let mixer = &mut track_mut(p, t)?.mixer;
            match field {
                MixerField::Volume => {
                    mixer.volume_db = number_in(to, "volume_db", VOLUME_DB_RANGE)?
                }
                MixerField::Pan => mixer.pan = number_in(to, "pan", PAN_RANGE)?,
                MixerField::Mute => mixer.mute = boolean(to, "mute")?,
                MixerField::Solo => mixer.solo = boolean(to, "solo")?,
                MixerField::Send(r) => {
                    let n = number_in(to, &format!("sends.{r}"), VOLUME_DB_RANGE)?;
                    mixer.sends.insert(r.to_string(), n);
                }
            }
        }
        ("song.set", Path::Song(field)) => {
            if field == "bpm" {
                p.bpm = number_in(to, "bpm", BPM_RANGE)?;
            } else {
                p.key = text(to, "key")?;
            }
        }
        ("device.enable", Path::Device(t, d)) => {
            device_mut(p, t, d)?.enabled = boolean(to, "device.enable")?;
        }
        ("track.rename", Path::Track(t)) => {
            track_mut(p, t)?.name = text(to, "track.rename")?;
        }
        ("clip.move", Path::Clip(t, c)) => {
            let n = number_in(to, "clip.move start_bar", (0.0, f64::MAX))?;
            clip_mut(p, t, c)?.start_bar = n;
        }
        ("track.add", Path::Track(t)) => {
            if track_index(p, t).is_some() {
                return err(format!("track '{t}' already exists"));
            }
            let (track, index): (Track, _) = build(t, to, &[])?;
            let default = track_default_index(p);
            insert_at(&mut p.tracks, index, default, track);
        }
        ("track.remove", Path::Track(t)) => {
            let i = track_index(p, t).ok_or_else(|| ApplyError(format!("unknown track '{t}'")))?;
            p.tracks.remove(i);
        }
        ("device.add", Path::Device(t, d)) => {
            let track = track_mut(p, t)?;
            if track.devices.iter().any(|x| x.id == d) {
                return err(format!("device '{d}' already exists on track '{t}'"));
            }
            let (device, index): (Device, _) = build(d, to, &[])?;
            let default = track.devices.len();
            insert_at(&mut track.devices, index, default, device);
        }
        ("device.remove", Path::Device(t, d)) => {
            let track = track_mut(p, t)?;
            let i = track.devices.iter().position(|x| x.id == d);
            let i = i.ok_or_else(|| ApplyError(format!("unknown device '{d}' on track '{t}'")))?;
            track.devices.remove(i);
        }
        ("clip.add", Path::Clip(t, c)) => {
            let track = track_mut(p, t)?;
            if track.clips.iter().any(|x| x.id == c) {
                return err(format!("clip '{c}' already exists on track '{t}'"));
            }
            let defaults = [("start_bar", json!(0)), ("length_bars", json!(1))];
            let (clip, index): (Clip, _) = build(c, to, &defaults)?;
            if f(&clip.start_bar) < 0.0 || f(&clip.length_bars) <= 0.0 {
                return err("clip.add: start_bar must be >= 0 and length_bars > 0");
            }
            let default = track.clips.len();
            insert_at(&mut track.clips, index, default, clip);
        }
        ("clip.remove", Path::Clip(t, c)) => {
            let track = track_mut(p, t)?;
            let i = track.clips.iter().position(|x| x.id == c);
            let i = i.ok_or_else(|| ApplyError(format!("unknown clip '{c}' on track '{t}'")))?;
            track.clips.remove(i);
        }
        ("section.set", Path::Section(name)) => {
            let existing = p.sections.iter().position(|s| s.name == name);
            if to.is_null() {
                let i = existing.ok_or_else(|| ApplyError(format!("unknown section '{name}'")))?;
                p.sections.remove(i);
                return Ok(());
            }
            let get = |k: &str| {
                number_in(
                    to.get(k).unwrap_or(&Value::Null),
                    &format!("section {k}"),
                    (0.0, f64::MAX),
                )
            };
            let (start, end) = (get("start_bar")?, get("end_bar")?);
            if f(&end) <= f(&start) {
                return err("section.set: end_bar must be greater than start_bar");
            }
            match existing {
                Some(i) => {
                    p.sections[i].start_bar = start;
                    p.sections[i].end_bar = end;
                }
                None => p.sections.push(Section {
                    name: name.to_string(),
                    start_bar: start,
                    end_bar: end,
                    extra: Map::new(),
                }),
            }
            sort_sections(p);
        }
        ("chord.set", Path::Chord(bar)) => {
            if to.is_null() {
                let i = p.chords.iter().position(|c| c.bar == bar);
                let i = i.ok_or_else(|| ApplyError(format!("no chord at bar {bar}")))?;
                p.chords.remove(i);
            } else {
                upsert_chord(p, bar, text(to, "chord.set")?);
            }
        }
        _ => unreachable!("shape_matches guarantees the verb/path pairs above"),
    }
    Ok(())
}

// ---------------------------------------------------------------- from

/// The current value at a target: what becomes `from` of a new event. Removals capture the
/// whole object plus its `"index"`, so they can be un-applied. `Null` when nothing is there.
pub fn current_value(p: &Project, verb: &str, target: Option<&str>) -> Value {
    if verb == "render.done" {
        return json!({ "audio": p.audio.master, "duration_s": p.audio.duration_s });
    }
    let Some(path) = target.and_then(parse_path) else {
        return Value::Null;
    };
    let track = |t: &str| {
        p.tracks
            .iter()
            .position(|x| x.id == t)
            .map(|i| (i, &p.tracks[i]))
    };
    let found = match (verb, path) {
        ("param.set", Path::Param(t, d, q)) => track(t)
            .and_then(|(_, tr)| tr.devices.iter().find(|x| x.id == d))
            .and_then(|dev| dev.params.iter().find(|x| x.id == q))
            .map(|x| Value::Number(x.value.clone())),
        ("mixer.set", Path::Mixer(t, field)) => track(t).and_then(|(_, tr)| {
            let m = &tr.mixer;
            match field {
                MixerField::Volume => Some(Value::Number(m.volume_db.clone())),
                MixerField::Pan => Some(Value::Number(m.pan.clone())),
                MixerField::Mute => Some(Value::Bool(m.mute)),
                MixerField::Solo => Some(Value::Bool(m.solo)),
                MixerField::Send(r) => m.sends.get(r).cloned().map(Value::Number),
            }
        }),
        ("song.set", Path::Song("bpm")) => Some(Value::Number(p.bpm.clone())),
        ("song.set", Path::Song(_)) => Some(Value::String(p.key.clone())),
        ("device.enable", Path::Device(t, d)) => track(t)
            .and_then(|(_, tr)| tr.devices.iter().find(|x| x.id == d))
            .map(|x| Value::Bool(x.enabled)),
        ("track.rename", Path::Track(t)) => track(t).map(|(_, tr)| Value::String(tr.name.clone())),
        ("clip.move", Path::Clip(t, c)) => track(t)
            .and_then(|(_, tr)| tr.clips.iter().find(|x| x.id == c))
            .map(|x| Value::Number(x.start_bar.clone())),
        ("track.remove" | "track.add", Path::Track(t)) => track(t).map(|(i, tr)| with_index(tr, i)),
        ("device.remove" | "device.add", Path::Device(t, d)) => track(t).and_then(|(_, tr)| {
            let i = tr.devices.iter().position(|x| x.id == d)?;
            Some(with_index(&tr.devices[i], i))
        }),
        ("clip.remove" | "clip.add", Path::Clip(t, c)) => track(t).and_then(|(_, tr)| {
            let i = tr.clips.iter().position(|x| x.id == c)?;
            Some(with_index(&tr.clips[i], i))
        }),
        ("section.set", Path::Section(name)) => p
            .sections
            .iter()
            .find(|s| s.name == name)
            .map(|s| serde_json::to_value(s).unwrap_or(Value::Null)),
        ("chord.set", Path::Chord(bar)) => p
            .chords
            .iter()
            .find(|c| c.bar == bar)
            .map(|c| Value::String(c.name.clone())),
        _ => None,
    };
    found.unwrap_or(Value::Null)
}

// ---------------------------------------------------------------- unapply

/// Reverses one event using its `from`. Lenient: whatever can't be undone that way (missing
/// `from`, target no longer present) is skipped, never an error.
pub fn unapply(project: &Project, event: &Event) -> Project {
    let mut p = project.clone();
    unapply_in_place(&mut p, event);
    p
}

fn unapply_in_place(p: &mut Project, e: &Event) -> Option<()> {
    let from = &e.from;
    if e.verb == "render.done" {
        let m = from.as_object()?;
        if let Some(a) = m.get("audio").and_then(Value::as_str) {
            p.audio.master = a.to_string();
        }
        if let Some(d) = m.get("duration_s") {
            p.audio.duration_s = d.as_number().cloned();
        }
        return Some(());
    }
    let path = parse_path(e.target.as_deref()?)?;
    match (e.verb.as_str(), path) {
        ("param.set", Path::Param(t, d, q)) => {
            let param = param_mut(p, t, d, q).ok()?;
            let n = from.as_number()?.clone();
            param.display = display(&n, &param.unit);
            param.value = n;
        }
        ("mixer.set", Path::Mixer(t, field)) => {
            let m = &mut track_mut(p, t).ok()?.mixer;
            match field {
                MixerField::Volume => m.volume_db = from.as_number()?.clone(),
                MixerField::Pan => m.pan = from.as_number()?.clone(),
                MixerField::Mute => m.mute = from.as_bool()?,
                MixerField::Solo => m.solo = from.as_bool()?,
                MixerField::Send(r) => match from.as_number() {
                    Some(n) => {
                        m.sends.insert(r.to_string(), n.clone());
                    }
                    None => {
                        m.sends.remove(r);
                    }
                },
            }
        }
        ("song.set", Path::Song("bpm")) => p.bpm = from.as_number()?.clone(),
        ("song.set", Path::Song(_)) => p.key = from.as_str()?.to_string(),
        ("device.enable", Path::Device(t, d)) => {
            device_mut(p, t, d).ok()?.enabled = from.as_bool()?
        }
        ("track.rename", Path::Track(t)) => track_mut(p, t).ok()?.name = from.as_str()?.to_string(),
        ("clip.move", Path::Clip(t, c)) => {
            clip_mut(p, t, c).ok()?.start_bar = from.as_number()?.clone()
        }
        ("track.add", Path::Track(t)) => {
            let i = track_index(p, t)?;
            p.tracks.remove(i);
        }
        ("track.remove", Path::Track(t)) => {
            if track_index(p, t).is_none() && !from.is_null() {
                let (track, index): (Track, _) = build(t, from, &[]).ok()?;
                let default = track_default_index(p);
                insert_at(&mut p.tracks, index, default, track);
            }
        }
        ("device.add", Path::Device(t, d)) => {
            let track = track_mut(p, t).ok()?;
            let i = track.devices.iter().position(|x| x.id == d)?;
            track.devices.remove(i);
        }
        ("device.remove", Path::Device(t, d)) => {
            let track = track_mut(p, t).ok()?;
            if !from.is_null() && !track.devices.iter().any(|x| x.id == d) {
                let (device, index): (Device, _) = build(d, from, &[]).ok()?;
                let default = track.devices.len();
                insert_at(&mut track.devices, index, default, device);
            }
        }
        ("clip.add", Path::Clip(t, c)) => {
            let track = track_mut(p, t).ok()?;
            let i = track.clips.iter().position(|x| x.id == c)?;
            track.clips.remove(i);
        }
        ("clip.remove", Path::Clip(t, c)) => {
            let track = track_mut(p, t).ok()?;
            if !from.is_null() && !track.clips.iter().any(|x| x.id == c) {
                let defaults = [("start_bar", json!(0)), ("length_bars", json!(1))];
                let (clip, index): (Clip, _) = build(c, from, &defaults).ok()?;
                let default = track.clips.len();
                insert_at(&mut track.clips, index, default, clip);
            }
        }
        ("section.set", Path::Section(name)) => {
            p.sections.retain(|s| s.name != name);
            if !from.is_null() {
                let mut section: Section = serde_json::from_value(from.clone()).ok()?;
                section.name = name.to_string();
                p.sections.push(section);
                sort_sections(p);
            }
        }
        ("chord.set", Path::Chord(bar)) => match from.as_str() {
            Some(name) => upsert_chord(p, bar, name.to_string()),
            None => p.chords.retain(|c| c.bar != bar),
        },
        _ => {}
    }
    Some(())
}

/// The project as it was right after event `at`: un-applies every event with `seq > at`,
/// newest first. `events` must be the log that produced `current`.
pub fn state_at(current: &Project, events: &[Event], at: u64) -> Project {
    let mut p = current.clone();
    for e in events.iter().rev().take_while(|e| e.seq > at) {
        unapply_in_place(&mut p, e);
    }
    p.version = at;
    p
}

/// Prepares a recorded log for replay onto `state_at(final, events, 0)`: add events whose `to`
/// is only a name get the full object (with `"index"`) as it was right after that event, taken
/// from `final_project`, so the replay rebuilds devices, params and clips too.
pub fn enrich_for_replay(final_project: &Project, events: &[Event]) -> Vec<Event> {
    let mut out = events.to_vec();
    let mut state = final_project.clone();
    for e in out.iter_mut().rev() {
        if matches!(e.verb.as_str(), "track.add" | "device.add" | "clip.add") && !e.to.is_object() {
            let full = current_value(&state, &e.verb, e.target.as_deref());
            if full.is_object() {
                e.to = full;
            }
        }
        unapply_in_place(&mut state, e);
    }
    out
}

#[cfg(test)]
#[path = "apply_tests.rs"]
mod tests;
