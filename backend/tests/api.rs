//! End-to-end tests against a real server on a temp copy of `fixtures/longing`
//! (the real fixtures are never touched).

use aiwaves::server::{AppState, router};
use aiwaves::store::{ProjectHandle, Store};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tempfile::TempDir;
use tokio_tungstenite::tungstenite::Message;

/// The fixture's last event seq: the demo keeps growing with the song, so tests count it.
fn last() -> u64 {
    std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/longing/events.jsonl"
    ))
    .unwrap()
    .lines()
    .filter(|l| !l.trim().is_empty())
    .count() as u64
}

/// The fixture's project.json as JSON (counts in tests come from here: the demo grows with the song).
fn fixture_project() -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/longing/project.json"
        ))
        .unwrap(),
    )
    .unwrap()
}

/// The fixture's latest `version.tag` (what a new event is stamped with).
fn last_version() -> String {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/longing/events.jsonl"
    ))
    .unwrap();
    text.lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .rfind(|e| e["verb"] == "version.tag")
        .map(|e| e["to"].as_str().unwrap().to_string())
        .unwrap()
}

const TOKEN: &str = "test-token";
const FB: &str = "tracks.zither.devices.echo.params.feedback";

struct Server {
    base: String,
    dir: TempDir,
    http: reqwest::Client,
}

/// A small audio file with known bytes, so Range responses can be checked exactly.
fn dummy_audio() -> Vec<u8> {
    (0..4096u32).map(|i| (i % 251) as u8).collect()
}

fn copy_fixture(to: &Path) {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/longing");
    let dst = to.join("longing");
    std::fs::create_dir_all(dst.join("audio")).unwrap();
    for f in ["project.json", "events.jsonl", "history.json"] {
        std::fs::copy(src.join(f), dst.join(f)).unwrap();
    }
    // The real master.wav (~35 MB, not in git) is not needed: a dummy stands in for it.
    std::fs::write(dst.join("audio/master.wav"), dummy_audio()).unwrap();
}

async fn start() -> Server {
    let dir = tempfile::tempdir().unwrap();
    copy_fixture(dir.path());
    let state = AppState {
        store: Arc::new(Store::load(dir.path()).unwrap()),
        token: Arc::new(TOKEN.into()),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });
    Server {
        base,
        dir,
        http: reqwest::Client::new(),
    }
}

impl Server {
    fn project_dir(&self) -> PathBuf {
        self.dir.path().join("longing")
    }

    async fn get(&self, path: &str) -> (u16, Value) {
        let res = self
            .http
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    async fn post(&self, body: Value, token: Option<&str>) -> (u16, Value) {
        let mut req = self
            .http
            .post(format!("{}/api/projects/longing/commands", self.base))
            .json(&body);
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let res = req.send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    fn log_lines(&self) -> Vec<Value> {
        std::fs::read_to_string(self.project_dir().join("events.jsonl"))
            .unwrap()
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    fn project_on_disk(&self) -> Value {
        serde_json::from_str(
            &std::fs::read_to_string(self.project_dir().join("project.json")).unwrap(),
        )
        .unwrap()
    }
}

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn next_json(ws: &mut Ws) -> Value {
    let msg = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("no WebSocket message within 5 s")
        .unwrap()
        .unwrap();
    match msg {
        Message::Text(t) => serde_json::from_str(&t).unwrap(),
        other => panic!("unexpected frame {other:?}"),
    }
}

fn param(project: &Value, track: &str, device: &str, id: &str) -> Value {
    let t = project["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == track)
        .unwrap();
    let d = t["devices"]
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["id"] == device)
        .unwrap();
    d["params"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == id)
        .unwrap()["value"]
        .clone()
}

fn set_feedback(value: Value, reason: &str) -> Value {
    json!({ "agent": "claude", "verb": "param.set", "target": FB, "value": value, "reason": reason })
}

#[tokio::test]
async fn health_and_project_list() {
    let s = start().await;
    let (status, health) = s.get("/api/health").await;
    assert_eq!(status, 200);
    assert_eq!(
        health,
        json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })
    );
    let (status, list) = s.get("/api/projects").await;
    assert_eq!(status, 200);
    assert_eq!(
        list,
        json!([{ "id": "longing", "title": "Longing", "bpm": 80.0, "key": "A minor", "version": last(), "length_bars": 65 }])
    );
}

#[tokio::test]
async fn get_project_and_unknown_project() {
    let s = start().await;
    let (status, p) = s.get("/api/projects/longing").await;
    assert_eq!(status, 200);
    assert_eq!(p["schema"], "aiwaves/project@1");
    assert_eq!(p["version"], last());
    let fixture = fixture_project();
    assert_eq!(
        p["tracks"].as_array().unwrap().len(),
        fixture["tracks"].as_array().unwrap().len()
    );
    let devices: usize = p["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["devices"].as_array().unwrap().len())
        .sum();
    let want: usize = fixture["tracks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["devices"].as_array().unwrap().len())
        .sum();
    assert_eq!(devices, want);
    assert_eq!(s.get("/api/projects/nope").await.0, 404);
    assert_eq!(s.get("/api/nope").await.0, 404);
}

#[tokio::test]
async fn events_since_and_limit() {
    let s = start().await;
    let (_, all) = s.get("/api/projects/longing/events").await;
    assert_eq!(all.as_array().unwrap().len(), last() as usize);
    let (_, tail) = s
        .get(&format!(
            "/api/projects/longing/events?since={}",
            last() - 2
        ))
        .await;
    let seqs: Vec<u64> = tail
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, [last() - 1, last()]);
    let (_, page) = s.get("/api/projects/longing/events?since=10&limit=3").await;
    let seqs: Vec<u64> = page
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, [11, 12, 13]);
    assert_eq!(s.get("/api/projects/longing/events?since=-1").await.0, 400);
}

#[tokio::test]
async fn history_endpoint() {
    let s = start().await;
    let (status, h) = s.get("/api/projects/longing/history").await;
    assert_eq!(status, 200);
    // the endpoint returns the fixture's history.json as-is (the song keeps getting new versions)
    let fixture: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/longing/history.json"
        ))
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        h["changelog"][0]["version"],
        fixture["changelog"][0]["version"]
    );
    assert!(h["changelog"].as_array().is_some_and(|c| !c.is_empty()));
}

#[tokio::test]
async fn command_is_applied_persisted_and_broadcast() {
    let s = start().await;
    let ws_url = format!(
        "{}/api/projects/longing/live",
        s.base.replace("http://", "ws://")
    );
    let (mut ws, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    let hello = next_json(&mut ws).await;
    assert_eq!(hello["type"], "hello");
    assert_eq!(hello["last_seq"], last());
    assert_eq!(hello["project"]["id"], "longing");

    // Anything a viewer sends is ignored.
    use futures_util::SinkExt;
    ws.send(Message::Text(
        set_feedback(json!(0.1), "viewer").to_string().into(),
    ))
    .await
    .unwrap();

    let (status, body) = s
        .post(
            set_feedback(json!(0.7), "the echoes should hang longer"),
            Some(TOKEN),
        )
        .await;
    assert_eq!(status, 201, "{body}");
    assert_eq!(body["version"], last() + 1);
    let event = &body["event"];
    assert_eq!(event["seq"], last() + 1);
    assert_eq!(event["verb"], "param.set");
    assert_eq!(event["from"], 0.62);
    assert_eq!(event["to"], 0.7);
    assert_eq!(event["agent"], "claude");
    assert_eq!(
        event["version"],
        last_version(),
        "a new event belongs to the fixture's latest version"
    );
    assert!(event["ts"].as_str().unwrap().ends_with('Z'));

    let log = s.log_lines();
    assert_eq!(log.len(), last() as usize + 1);
    assert_eq!(&log[last() as usize], event);
    let disk = s.project_on_disk();
    assert_eq!(disk["version"], last() + 1);
    assert_eq!(param(&disk, "zither", "echo", "feedback"), 0.7);

    let pushed = next_json(&mut ws).await;
    assert_eq!(pushed, json!({ "type": "event", "event": event }));

    let (_, p) = s.get("/api/projects/longing").await;
    assert_eq!(param(&p, "zither", "echo", "feedback"), 0.7);

    // A restart reads back exactly what was written.
    let reloaded = ProjectHandle::load(&s.project_dir()).unwrap();
    assert_eq!(reloaded.last_seq(), last() + 1);
    assert_eq!(serde_json::to_value(reloaded.project()).unwrap(), disk);
}

#[tokio::test]
async fn commands_need_the_token() {
    let s = start().await;
    for token in [None, Some("wrong"), Some("test-toke"), Some("")] {
        let (status, body) = s.post(set_feedback(json!(0.7), "x"), token).await;
        assert_eq!(status, 401, "{token:?}");
        assert!(body["error"].is_string());
    }
    assert_eq!(s.log_lines().len(), last() as usize);
}

#[tokio::test]
async fn invalid_commands_are_400_and_change_nothing() {
    let s = start().await;
    let before = s.project_on_disk();
    let cases = [
        (set_feedback(json!(1.5), "too much"), "outside"),
        (set_feedback(json!(-0.5), "too little"), "outside"),
        (
            json!({ "verb": "param.set", "target": "tracks.zither.devices.nope.params.feedback", "value": 0.5, "reason": "r" }),
            "unknown device",
        ),
        (
            json!({ "verb": "param.set", "target": "tracks.x", "value": 0.5, "reason": "r" }),
            "unknown target",
        ),
        (set_feedback(json!(0.5), ""), "reason"),
        (set_feedback(json!(0.5), "  "), "reason"),
        (
            json!({ "verb": "param.wiggle", "target": FB, "value": 0.5, "reason": "r" }),
            "unknown verb",
        ),
        (json!({ "target": FB }), "invalid command JSON"),
    ];
    for (body, needle) in cases {
        let (status, res) = s.post(body.clone(), Some(TOKEN)).await;
        assert_eq!(status, 400, "{body}");
        assert!(
            res["error"].as_str().unwrap().contains(needle),
            "{body}: {res}"
        );
    }
    assert_eq!(s.log_lines().len(), last() as usize);
    assert_eq!(s.project_on_disk(), before);
    let (status, _) = s.post(set_feedback(json!(0.5), "fine"), Some(TOKEN)).await;
    assert_eq!(status, 201);
    assert_eq!(
        s.log_lines().last().unwrap()["seq"],
        last() + 1,
        "no gaps after rejected commands"
    );
}

#[tokio::test]
async fn post_to_unknown_project_is_404() {
    let s = start().await;
    let res = s
        .http
        .post(format!("{}/api/projects/nope/commands", s.base))
        .bearer_auth(TOKEN)
        .json(&set_feedback(json!(0.5), "r"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 404);
}

#[tokio::test]
async fn audio_supports_range_requests() {
    let s = start().await;
    let url = format!("{}/api/projects/longing/audio/master.wav", s.base);
    let full = s.http.get(&url).send().await.unwrap();
    assert_eq!(full.status().as_u16(), 200);
    assert_eq!(full.bytes().await.unwrap().to_vec(), dummy_audio());

    let res = s
        .http
        .get(&url)
        .header("Range", "bytes=100-199")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 206);
    assert_eq!(res.headers()["content-range"], "bytes 100-199/4096");
    assert_eq!(
        res.bytes().await.unwrap().to_vec(),
        dummy_audio()[100..200].to_vec()
    );

    let missing = s.http.get(format!("{url}.nope")).send().await.unwrap();
    assert_eq!(missing.status().as_u16(), 404);
}

#[tokio::test]
async fn audio_blocks_path_traversal() {
    let s = start().await;
    for file in [
        "..%2Fproject.json",
        "..%5Cproject.json",
        "%2E%2E%2Fevents.jsonl",
        "..",
        "C%3A%5CWindows%5Cwin.ini",
        "%2Fetc%2Fpasswd",
        "%5C%5Cserver%5Cshare",
        ".hidden",
    ] {
        let res = s
            .http
            .get(format!("{}/api/projects/longing/audio/{file}", s.base))
            .send()
            .await
            .unwrap();
        let status = res.status().as_u16();
        let body = res.text().await.unwrap();
        assert!(status == 400 || status == 404, "{file}: {status}");
        assert!(
            !body.contains("aiwaves/project@1") && !body.contains("\"seq\""),
            "{file} leaked"
        );
    }
}

#[tokio::test]
async fn state_at_returns_old_values() {
    let s = start().await;
    let (_, at37) = s.get("/api/projects/longing/state?at=37").await;
    assert_eq!(at37["version"], 37);
    assert_eq!(param(&at37, "zither", "echo", "feedback"), 0.0);

    s.post(set_feedback(json!(0.9), "more"), Some(TOKEN)).await;
    let (_, at42) = s
        .get(&format!("/api/projects/longing/state?at={}", last()))
        .await;
    assert_eq!(param(&at42, "zither", "echo", "feedback"), 0.62);
    let (_, now) = s.get("/api/projects/longing/state").await;
    assert_eq!(param(&now, "zither", "echo", "feedback"), 0.9);

    let (_, zero) = s.get("/api/projects/longing/state?at=0").await;
    assert_eq!(
        (zero["key"].clone(), zero["bpm"].clone()),
        (json!("D Phrygian"), json!(140))
    );
    assert_eq!(s.get("/api/projects/longing/state?at=99").await.0, 400);
    assert_eq!(s.get("/api/projects/longing/state?at=x").await.0, 400);
}

fn cli(s: &Server, args: &[&str]) -> std::process::Output {
    std::process::Command::new(env!("CARGO_BIN_EXE_aiwaves"))
        .args(args)
        .env("AIWAVES_SERVER", &s.base)
        .env("AIWAVES_TOKEN", TOKEN)
        .output()
        .unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn cli_set_do_events_and_errors() {
    let s = start().await;
    let (out, out2, out3, bad, events) = tokio::task::block_in_place(|| {
        (
            cli(
                &s,
                &[
                    "set",
                    "longing",
                    "tracks.drums.mixer.volume_db",
                    "-4.5",
                    "--reason",
                    "drums sit back",
                ],
            ),
            cli(
                &s,
                &[
                    "set",
                    "longing",
                    "key",
                    "A dorian",
                    "--reason",
                    "brighter sixth",
                    "--agent",
                    "gpt",
                ],
            ),
            cli(
                &s,
                &[
                    "do",
                    "longing",
                    "note",
                    "--value",
                    "{\"ok\":1}",
                    "--reason",
                    "checkpoint",
                ],
            ),
            cli(&s, &["set", "longing", FB, "2", "--reason", "too much"]),
            cli(&s, &["events", "longing", "--since", &last().to_string()]),
        )
    });
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let res: Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        (res["event"]["verb"].clone(), res["event"]["to"].clone()),
        (json!("mixer.set"), json!(-4.5))
    );
    let res2: Value = serde_json::from_slice(&out2.stdout).unwrap();
    assert_eq!(
        (res2["event"]["to"].clone(), res2["event"]["agent"].clone()),
        (json!("A dorian"), json!("gpt"))
    );
    let res3: Value = serde_json::from_slice(&out3.stdout).unwrap();
    assert_eq!(res3["event"]["to"], json!({ "ok": 1 }));

    assert!(!bad.status.success());
    let err: Value = serde_json::from_slice(&bad.stderr).unwrap();
    assert_eq!(err["status"], 400);
    assert!(err["error"].as_str().unwrap().contains("outside"));

    let lines: Vec<Value> = String::from_utf8(events.stdout)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(
        lines
            .iter()
            .map(|e| e["seq"].as_u64().unwrap())
            .collect::<Vec<_>>(),
        [last() + 1, last() + 2, last() + 3]
    );
}

/// The demo flow from the README: reset a copy to seq 0, then replay the recorded log.
#[tokio::test(flavor = "multi_thread")]
async fn cli_import_events_replays_the_fixture_log() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/longing");
    let s0 = start().await;
    let (_, zero) = s0.get("/api/projects/longing/state?at=0").await;

    let dir = tempfile::tempdir().unwrap();
    copy_fixture(dir.path());
    let pdir = dir.path().join("longing");
    std::fs::write(
        pdir.join("project.json"),
        serde_json::to_vec_pretty(&zero).unwrap(),
    )
    .unwrap();
    std::fs::write(pdir.join("events.jsonl"), "").unwrap();
    let state = AppState {
        store: Arc::new(Store::load(dir.path()).unwrap()),
        token: Arc::new(TOKEN.into()),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, router(state, None)).await.unwrap() });
    let s = Server {
        base,
        dir,
        http: reqwest::Client::new(),
    };

    let events_file = fixture.join("events.jsonl");
    let snapshot = fixture.join("project.json");
    let out = tokio::task::block_in_place(|| {
        cli(
            &s,
            &[
                "import-events",
                "longing",
                events_file.to_str().unwrap(),
                "--snapshot",
                snapshot.to_str().unwrap(),
                "--delay-ms",
                "1",
            ],
        )
    });
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        String::from_utf8(out.stdout).unwrap().lines().count(),
        last() as usize
    );
    let (_, p) = s.get("/api/projects/longing").await;
    let (_, original) = s0.get("/api/projects/longing").await;
    assert_eq!(p["version"], last());
    let ids = |p: &Value| {
        p["tracks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["id"].clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(&p), ids(&original));
    assert_eq!(param(&p, "zither", "echo", "feedback"), 0.62);
    assert_eq!(p["key"], "A minor");

    // Without --snapshot the name-only track.add events can't rebuild devices: it stops with an error.
    let again = tokio::task::block_in_place(|| {
        cli(
            &s,
            &["import-events", "longing", events_file.to_str().unwrap()],
        )
    });
    assert!(!again.status.success());
    let err: Value = serde_json::from_slice(&again.stderr).unwrap();
    assert_eq!(err["status"], 400);
    assert!(err["imported_seq"].is_u64());
}

#[tokio::test]
async fn static_frontend_with_spa_fallback_and_cors() {
    let data = tempfile::tempdir().unwrap();
    copy_fixture(data.path());
    let web = tempfile::tempdir().unwrap();
    std::fs::write(web.path().join("index.html"), "<app-root></app-root>").unwrap();
    std::fs::write(web.path().join("main.js"), "console.log(1)").unwrap();
    let state = AppState {
        store: Arc::new(Store::load(data.path()).unwrap()),
        token: Arc::new(TOKEN.into()),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let app = router(state, Some(web.path().to_path_buf()));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let http = reqwest::Client::new();
    let get = |path: &str| http.get(format!("{base}{path}")).send();

    for path in ["/", "/projects/longing/mixer"] {
        let res = get(path).await.unwrap();
        assert_eq!(res.status().as_u16(), 200, "{path}");
        assert_eq!(res.text().await.unwrap(), "<app-root></app-root>", "{path}");
    }
    assert_eq!(
        get("/main.js").await.unwrap().text().await.unwrap(),
        "console.log(1)"
    );
    let api = get("/api/nope").await.unwrap();
    assert_eq!(api.status().as_u16(), 404);
    assert_eq!(
        api.json::<Value>().await.unwrap()["error"],
        "no such endpoint"
    );

    let preflight = http
        .request(
            reqwest::Method::OPTIONS,
            format!("{base}/api/projects/longing/commands"),
        )
        .header("Origin", "http://localhost:4200")
        .header("Access-Control-Request-Method", "POST")
        .header(
            "Access-Control-Request-Headers",
            "authorization,content-type",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(
        preflight.headers()["access-control-allow-origin"],
        "http://localhost:4200"
    );
    let other = get("/api/health").await.unwrap();
    assert!(
        other.headers().get("access-control-allow-origin").is_none(),
        "no Origin, no CORS header"
    );
}

/// The synth engine is reachable through the CLI. Listing presets needs only the engine script
/// (no plugin); a render is tried only when Surge XT is installed on this machine.
#[test]
fn synth_presets_and_errors() {
    let bin = env!("CARGO_BIN_EXE_aiwaves");
    let out = std::process::Command::new(bin)
        .args(["synth", "presets"])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let presets: Vec<Value> = serde_json::from_slice(&out.stdout).unwrap();
    let names: Vec<_> = presets
        .iter()
        .map(|p| p["name"].as_str().unwrap())
        .collect();
    for want in ["braam", "impact", "sub_drop", "whoosh_up"] {
        assert!(names.contains(&want), "missing preset {want}");
    }
    let bad = std::process::Command::new(bin)
        .args(["synth", "render", "no-such-preset", "--out", "x.wav"])
        .output()
        .unwrap();
    assert!(!bad.status.success());
    let err: Value = serde_json::from_slice(&bad.stderr).unwrap();
    assert!(err["error"].as_str().unwrap().contains("unknown preset"));
}

/// Is Python + Pillow here? (cover tests need the real generator; skipped otherwise)
fn pillow_available() -> bool {
    std::process::Command::new(std::env::var("AIWAVES_PYTHON").unwrap_or_else(|_| "python".into()))
        .args(["-c", "import PIL"])
        .output()
        .is_ok_and(|o| o.status.success())
}

/// CONTRACT §10: a new cover per playthrough, the saved one while saved, pruning, and no token
/// needed - but nothing outside the covers folder can be read or written.
#[tokio::test]
async fn covers_playthroughs_saving_and_pruning() {
    if !pillow_available() {
        eprintln!("skipped: Python + Pillow not available");
        return;
    }
    // SAFETY of the env var: only this test reads AIWAVES_COVERS_KEEP
    unsafe { std::env::set_var("AIWAVES_COVERS_KEEP", "2") };
    let s = start().await;
    let http = reqwest::Client::new();
    let url = |p: &str| format!("{}/api/projects/longing/covers{p}", s.base);
    let post = |p: String| http.post(p).send();
    let first = post(url("")).await.unwrap();
    assert_eq!(
        first.status().as_u16(),
        201,
        "a playthrough makes a new cover"
    );
    let first: Value = first.json().await.unwrap();
    let name = first["name"].as_str().unwrap().to_string();
    assert!(first["palette"].as_array().is_some_and(|p| !p.is_empty()));
    let png = http
        .get(format!("{}{}", s.base, first["url"].as_str().unwrap()))
        .send()
        .await
        .unwrap();
    assert_eq!(png.status().as_u16(), 200);
    assert_eq!(&png.bytes().await.unwrap()[..8], b"\x89PNG\r\n\x1a\n");
    let second: Value = post(url("")).await.unwrap().json().await.unwrap();
    assert_ne!(
        second["name"], first["name"],
        "every playthrough gets its own cover"
    );
    // save the first: from now on it comes back instead of a new one
    let saved: Value = post(url(&format!("/{name}/save")))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(saved["saved"], true);
    let again = post(url("")).await.unwrap();
    assert_eq!(again.status().as_u16(), 200);
    assert_eq!(again.json::<Value>().await.unwrap()["name"], name.as_str());
    let fresh = post(url("?fresh=1")).await.unwrap();
    assert_eq!(
        fresh.status().as_u16(),
        201,
        "?fresh=1 still makes a new one"
    );
    // pruning keeps the newest 2 unsaved + the saved one
    let list = s.get("/api/projects/longing/covers").await.1;
    assert_eq!(list["saved"]["name"], name.as_str());
    assert_eq!(list["recent"].as_array().unwrap().len(), 3);
    // unsave: new covers again
    let del = http.delete(url("/saved")).send().await.unwrap();
    assert_eq!(del.status().as_u16(), 204);
    assert_eq!(post(url("")).await.unwrap().status().as_u16(), 201);
    // hostile names never reach the filesystem
    for bad in [
        "cover-..%2F..%2Fproject.json",
        "project.json",
        "cover-A.png",
    ] {
        let r = http.get(url(&format!("/{bad}"))).send().await.unwrap();
        assert!(
            matches!(r.status().as_u16(), 400 | 404),
            "{bad} -> {}",
            r.status()
        );
    }
    assert_eq!(
        post(url("/cover-1-2.png/save"))
            .await
            .unwrap()
            .status()
            .as_u16(),
        404
    );
    // covers never touch the song
    assert_eq!(s.log_lines().len(), last() as usize);
}
