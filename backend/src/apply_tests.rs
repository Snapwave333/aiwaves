use super::*;

fn project() -> Project {
    serde_json::from_value(json!({
        "schema": "aiwaves/project@1", "id": "t", "title": "T", "artist": "",
        "bpm": 80.0, "time_signature": [4, 4], "key": "A minor", "length_bars": 16, "version": 0,
        "sections": [{ "name": "intro", "start_bar": 0, "end_bar": 8 }],
        "chords": [{ "bar": 0, "name": "Am" }],
        "audio": { "master": "audio/master.wav", "duration_s": 10.0, "peaks": [] },
        "tracks": [
            { "id": "zither", "name": "Zither", "kind": "instrument", "color": "#fff",
              "mixer": { "volume_db": 0.0, "pan": 0.0, "mute": false, "solo": false, "sends": { "hall": -12.0 } },
              "devices": [{ "id": "echo", "type": "delay", "name": "Tape echo", "enabled": true,
                            "params": [{ "id": "feedback", "name": "Feedback", "value": 0.5,
                                         "min": 0, "max": 1, "unit": "", "display": "0.5" }] },
                          { "id": "hall", "type": "reverb", "name": "Hall", "enabled": true, "params": [] }],
              "clips": [{ "id": "z1", "name": "Z1", "start_bar": 0.0, "length_bars": 4.0, "color": null, "notes": null }] },
            { "id": "master", "name": "Master", "kind": "master", "color": null,
              "mixer": { "volume_db": 0.0, "pan": 0.0, "mute": false, "solo": false, "sends": {} },
              "devices": [], "clips": [] }
        ]
    }))
    .unwrap()
}

fn ev(seq: u64, verb: &str, target: Option<&str>, to: Value) -> Event {
    Event {
        seq,
        ts: "2026-09-30T00:00:00Z".into(),
        agent: "test".into(),
        verb: verb.into(),
        target: target.map(String::from),
        from: Value::Null,
        to,
        reason: "because".into(),
        evidence: Value::Null,
        version: None,
    }
}

/// Builds the event the server would: `from` read from the current state.
fn cmd(p: &Project, seq: u64, verb: &str, target: Option<&str>, to: Value) -> Event {
    let mut e = ev(seq, verb, target, to);
    e.from = current_value(p, verb, target);
    e
}

const FB: &str = "tracks.zither.devices.echo.params.feedback";

fn feedback(p: &Project) -> f64 {
    f(&p.tracks[0].devices[0].params[0].value)
}

fn rejects(verb: &str, target: Option<&str>, to: Value) -> String {
    let p = project();
    apply(&p, &ev(1, verb, target, to))
        .expect_err("should be rejected")
        .0
}

#[test]
fn param_set_applies_and_bumps_version() {
    let p = apply(&project(), &ev(7, "param.set", Some(FB), json!(0.62))).unwrap();
    assert_eq!(feedback(&p), 0.62);
    assert_eq!(p.tracks[0].devices[0].params[0].display, "0.62");
    assert_eq!(p.version, 7);
}

#[test]
fn param_set_rejects_out_of_range_instead_of_clamping() {
    let p = project();
    for v in [json!(1.01), json!(-0.1), json!("0.5"), json!(true)] {
        assert!(apply(&p, &ev(1, "param.set", Some(FB), v)).is_err());
    }
    assert!(rejects("param.set", Some(FB), json!(1.5)).contains("outside [0, 1]"));
    assert!(
        apply(&p, &ev(1, "param.set", Some(FB), json!(1))).is_ok(),
        "max is inclusive"
    );
}

#[test]
fn unknown_targets_are_rejected() {
    for t in [
        "tracks.nope.devices.echo.params.feedback",
        "tracks.zither.devices.nope.params.feedback",
        "tracks.zither.devices.echo.params.nope",
        "tracks.zither.devices.echo",
        "tracks..devices.echo.params.feedback",
        "foo",
    ] {
        let msg = rejects("param.set", Some(t), json!(0.5));
        assert!(msg.contains("unknown"), "{t}: {msg}");
    }
    assert!(rejects("param.set", None, json!(0.5)).contains("needs a target"));
    assert!(
        rejects("mixer.set", Some("tracks.zither.mixer.gain"), json!(0)).contains("unknown target")
    );
    assert!(
        rejects(
            "mixer.set",
            Some("tracks.zither.mixer.sends.nope"),
            json!(-6)
        )
        .contains("unknown send")
    );
    assert!(rejects("song.set", Some("title"), json!("x")).contains("unknown target"));
}

#[test]
fn empty_reason_and_unknown_verb_are_rejected() {
    let p = project();
    for reason in ["", "   "] {
        let mut e = ev(1, "param.set", Some(FB), json!(0.5));
        e.reason = reason.into();
        assert_eq!(apply(&p, &e).unwrap_err().0, "reason must not be empty");
    }
    assert!(rejects("param.explode", Some(FB), json!(0.5)).contains("unknown verb"));
}

#[test]
fn mixer_song_device_track_clip_setters() {
    let mut p = project();
    let steps = [
        ev(
            1,
            "mixer.set",
            Some("tracks.zither.mixer.volume_db"),
            json!(-3.0),
        ),
        ev(
            2,
            "mixer.set",
            Some("tracks.zither.mixer.pan"),
            json!(-0.25),
        ),
        ev(
            3,
            "mixer.set",
            Some("tracks.zither.mixer.mute"),
            json!(true),
        ),
        ev(
            4,
            "mixer.set",
            Some("tracks.zither.mixer.sends.hall"),
            json!(-6),
        ),
        ev(5, "song.set", Some("bpm"), json!(84)),
        ev(6, "song.set", Some("key"), json!("D Phrygian")),
        ev(
            7,
            "device.enable",
            Some("tracks.zither.devices.echo"),
            json!(false),
        ),
        ev(8, "track.rename", Some("tracks.zither"), json!("Dan tranh")),
        ev(9, "clip.move", Some("tracks.zither.clips.z1"), json!(2.5)),
        ev(
            10,
            "render.done",
            None,
            json!({ "audio": "audio/v2.wav", "duration_s": 12.5 }),
        ),
        ev(11, "note", None, json!("just saying")),
        ev(12, "version.tag", None, json!("1.0")),
    ];
    for e in &steps {
        p = apply(&p, e).unwrap_or_else(|err| panic!("seq {}: {err}", e.seq));
    }
    let t = &p.tracks[0];
    assert_eq!(
        (f(&t.mixer.volume_db), f(&t.mixer.pan), t.mixer.mute),
        (-3.0, -0.25, true)
    );
    assert_eq!(f(&t.mixer.sends["hall"]), -6.0);
    assert_eq!((f(&p.bpm), p.key.as_str()), (84.0, "D Phrygian"));
    assert!(!t.devices[0].enabled);
    assert_eq!(t.name, "Dan tranh");
    assert_eq!(f(&t.clips[0].start_bar), 2.5);
    assert_eq!(p.audio.master, "audio/v2.wav");
    assert_eq!(p.version, 12);

    assert!(rejects("mixer.set", Some("tracks.zither.mixer.pan"), json!(1.5)).contains("outside"));
    assert!(
        rejects("mixer.set", Some("tracks.zither.mixer.volume_db"), json!(7)).contains("outside")
    );
    assert!(
        rejects("mixer.set", Some("tracks.zither.mixer.mute"), json!(1)).contains("true or false")
    );
    assert!(rejects("song.set", Some("bpm"), json!(5)).contains("outside"));
    assert!(rejects("clip.move", Some("tracks.zither.clips.z1"), json!(-1)).contains("outside"));
    assert!(rejects("track.rename", Some("tracks.zither"), json!("")).contains("non-empty"));
}

/// Applies each command (with `from` captured like the server does), then checks that
/// `state_at` reproduces every intermediate state from the last one.
fn round_trip(commands: &[(&str, Option<&str>, Value)]) -> Vec<Project> {
    let mut states = vec![project()];
    let mut log = Vec::new();
    for (i, (verb, target, to)) in commands.iter().enumerate() {
        let cur = states.last().unwrap();
        let e = cmd(cur, i as u64 + 1, verb, *target, to.clone());
        let next = apply(cur, &e).unwrap_or_else(|err| panic!("{verb}: {err}"));
        states.push(next);
        log.push(e);
    }
    let last = states.last().unwrap();
    for (i, expected) in states.iter().enumerate() {
        let mut expected = expected.clone();
        expected.version = i as u64;
        assert_eq!(state_at(last, &log, i as u64), expected, "state_at({i})");
    }
    states
}

#[test]
fn setters_un_apply_to_their_from_values() {
    round_trip(&[
        ("param.set", Some(FB), json!(0.9)),
        ("param.set", Some(FB), json!(0.1)),
        (
            "mixer.set",
            Some("tracks.zither.mixer.volume_db"),
            json!(-3),
        ),
        ("mixer.set", Some("tracks.zither.mixer.solo"), json!(true)),
        ("song.set", Some("bpm"), json!(90)),
        ("song.set", Some("key"), json!("E minor")),
        (
            "device.enable",
            Some("tracks.zither.devices.echo"),
            json!(false),
        ),
        ("track.rename", Some("tracks.zither"), json!("Dan tranh")),
        ("clip.move", Some("tracks.zither.clips.z1"), json!(3)),
        (
            "render.done",
            None,
            json!({ "audio": "audio/v2.wav", "duration_s": 3.0 }),
        ),
    ]);
}

#[test]
fn structural_verbs_round_trip_and_keep_positions() {
    let states = round_trip(&[
        ("track.add", Some("tracks.pad"), json!("Pad")),
        (
            "track.add",
            Some("tracks.lead"),
            json!({ "name": "Lead", "kind": "instrument", "index": 0 }),
        ),
        (
            "device.add",
            Some("tracks.pad.devices.verb"),
            json!({ "type": "reverb", "name": "Verb",
                    "params": [{ "id": "mix", "name": "Mix", "value": 0.3, "min": 0, "max": 1 }] }),
        ),
        (
            "device.remove",
            Some("tracks.zither.devices.echo"),
            Value::Null,
        ),
        (
            "clip.add",
            Some("tracks.pad.clips.p1"),
            json!({ "name": "P1", "start_bar": 4, "length_bars": 8 }),
        ),
        ("clip.remove", Some("tracks.zither.clips.z1"), Value::Null),
        ("track.remove", Some("tracks.zither"), Value::Null),
        (
            "section.set",
            Some("sections.drop"),
            json!({ "start_bar": 8, "end_bar": 16 }),
        ),
        (
            "section.set",
            Some("sections.intro"),
            json!({ "start_bar": 0, "end_bar": 4 }),
        ),
        ("section.set", Some("sections.intro"), Value::Null),
        ("chord.set", Some("chords.4"), json!("F")),
        ("chord.set", Some("chords.0"), json!("A")),
        ("chord.set", Some("chords.0"), Value::Null),
    ]);
    let ids = |p: &Project| p.tracks.iter().map(|t| t.id.clone()).collect::<Vec<_>>();
    assert_eq!(
        ids(&states[1]),
        ["zither", "pad", "master"],
        "new tracks go before master"
    );
    assert_eq!(
        ids(&states[2]),
        ["lead", "zither", "pad", "master"],
        "index is honoured"
    );
    assert_eq!(
        states[3].tracks[2].devices[0].params[0].value,
        Number::from_f64(0.3).unwrap()
    );
    let last = states.last().unwrap();
    assert_eq!(ids(last), ["lead", "pad", "master"]);
    assert_eq!(
        last.sections
            .iter()
            .map(|s| s.name.as_str())
            .collect::<Vec<_>>(),
        ["drop"]
    );
    assert_eq!(
        last.chords
            .iter()
            .map(|c| (c.bar, c.name.as_str()))
            .collect::<Vec<_>>(),
        [(4, "F")]
    );
}

#[test]
fn structural_verbs_validate() {
    assert!(rejects("track.add", Some("tracks.zither"), json!("Again")).contains("already exists"));
    assert!(rejects("track.remove", Some("tracks.nope"), Value::Null).contains("unknown track"));
    assert!(
        rejects("device.add", Some("tracks.zither.devices.echo"), json!("x"))
            .contains("already exists")
    );
    assert!(
        rejects(
            "clip.add",
            Some("tracks.zither.clips.n"),
            json!({ "length_bars": 0 })
        )
        .contains("length_bars")
    );
    assert!(
        rejects(
            "section.set",
            Some("sections.x"),
            json!({ "start_bar": 4, "end_bar": 2 })
        )
        .contains("end_bar")
    );
    assert!(rejects("chord.set", Some("chords.x"), json!("Am")).contains("unknown target"));
    assert!(rejects("version.tag", None, Value::Null).contains("non-empty string"));
    assert!(rejects("render.done", None, json!(3)).contains("render.done"));
}

#[test]
fn unapply_skips_what_it_cannot_undo() {
    let p = project();
    let mut e = ev(1, "param.set", Some(FB), json!(0.9));
    assert_eq!(unapply(&p, &e), p, "from is null");
    e.target = Some("tracks.gone.devices.echo.params.feedback".into());
    e.from = json!(0.2);
    assert_eq!(unapply(&p, &e), p, "target no longer exists");
    let mut rm = ev(1, "track.remove", Some("tracks.flute"), Value::Null);
    rm.from = json!("Flute");
    let back = unapply(&p, &rm);
    assert_eq!(
        back.tracks[1].name, "Flute",
        "a name-only from restores a bare track before master"
    );
}

#[test]
fn verb_for_target_infers_set_verbs() {
    assert_eq!(verb_for_target(FB), Some("param.set"));
    assert_eq!(
        verb_for_target("tracks.drums.mixer.volume_db"),
        Some("mixer.set")
    );
    assert_eq!(verb_for_target("bpm"), Some("song.set"));
    assert_eq!(verb_for_target("nonsense"), None);
}

fn fixture() -> (Project, Vec<Event>) {
    let p = serde_json::from_str(include_str!("../../fixtures/longing/project.json")).unwrap();
    let events = include_str!("../../fixtures/longing/events.jsonl")
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    (p, events)
}

fn param(p: &Project, path: &str) -> Value {
    current_value(p, "param.set", Some(path))
}

#[test]
fn fixture_state_at_returns_old_values() {
    let (p, events) = fixture();
    assert_eq!(state_at(&p, &events, 42), p);
    assert_eq!(param(&state_at(&p, &events, 38), FB), json!(0.62));
    assert_eq!(param(&state_at(&p, &events, 37), FB), json!(0.0));
    let zero = state_at(&p, &events, 0);
    assert_eq!(
        (zero.key.as_str(), f(&zero.bpm), zero.version),
        ("D Phrygian", 140.0, 0)
    );
    let ids: Vec<_> = zero.tracks.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["drums", "flute", "master"]);
}

/// Numbers compared as f64 (80 == 80.0); `display` ignored (it is regenerated on change).
fn normalized(p: &Project) -> Value {
    fn walk(v: Value) -> Value {
        match v {
            Value::Number(n) => json!(n.as_f64()),
            Value::Array(a) => Value::Array(a.into_iter().map(walk).collect()),
            Value::Object(m) => Value::Object(
                m.into_iter()
                    .filter(|(k, _)| k != "display")
                    .map(|(k, v)| (k, walk(v)))
                    .collect(),
            ),
            v => v,
        }
    }
    walk(serde_json::to_value(p).unwrap())
}

#[test]
fn fixture_log_replays_from_zero_to_the_final_project() {
    let (fin, events) = fixture();
    let mut p = state_at(&fin, &events, 0);
    for mut e in enrich_for_replay(&fin, &events) {
        e.from = current_value(&p, &e.verb, e.target.as_deref());
        p = apply(&p, &e).unwrap_or_else(|err| panic!("replaying seq {}: {err}", e.seq));
    }
    // The log is authoritative: where project.json disagrees with a logged set, the log wins.
    let mut expected = fin.clone();
    for e in events
        .iter()
        .filter(|e| e.verb.ends_with(".set") || e.verb == "device.enable")
    {
        expected = apply(&expected, e).unwrap();
    }
    expected.version = fin.version;
    assert_eq!(normalized(&p), normalized(&expected));
}
