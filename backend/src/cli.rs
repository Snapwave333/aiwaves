//! The `aiwaves` command line (CONTRACT §7). Every subcommand except `serve` is an HTTP client
//! of a running server. JSON on stdout; errors as `{"error": …}` on stderr, exit code 1.

use crate::apply;
use crate::model::{Command, Event, Project};
use clap::{Parser, Subcommand};
use serde_json::{Value, json};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

#[derive(Parser, Debug)]
#[command(
    name = "aiwaves",
    version,
    about = "AIWaves: agent-first DAW — server and CLI"
)]
pub struct Cli {
    /// Server to talk to. Default: the running desktop app (its server.json), else
    /// http://127.0.0.1:8787.
    #[arg(long, global = true, env = "AIWAVES_SERVER")]
    pub server: Option<String>,
    /// Token for commands (and the token `serve` accepts).
    #[arg(long, global = true, env = "AIWAVES_TOKEN", hide_env_values = true)]
    pub token: Option<String>,
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Run the HTTP + WebSocket server.
    Serve {
        /// Folder with one subfolder per project (project.json + events.jsonl).
        #[arg(long, default_value = "data")]
        data: PathBuf,
        #[arg(long, default_value = "127.0.0.1:8787")]
        bind: SocketAddr,
        /// Built frontend to serve at / (SPA: unknown paths get index.html).
        #[arg(long = "static")]
        static_dir: Option<PathBuf>,
    },
    /// List projects.
    Projects,
    /// Print a project's current project.json.
    Show { project: String },
    /// Print events as JSON lines.
    Events {
        project: String,
        #[arg(long, default_value_t = 0)]
        since: u64,
    },
    /// Set a value: param, mixer control, bpm/key (verb inferred from the target).
    Set {
        project: String,
        target: String,
        /// Parsed as JSON if it parses, else taken as a string.
        #[arg(allow_hyphen_values = true)]
        value: String,
        #[arg(long)]
        reason: String,
        #[arg(long, env = "AIWAVES_AGENT", default_value = "agent")]
        agent: String,
        /// Any JSON.
        #[arg(long)]
        evidence: Option<String>,
    },
    /// Run any verb.
    Do {
        project: String,
        verb: String,
        target: Option<String>,
        /// Parsed as JSON if it parses, else taken as a string.
        #[arg(long, allow_hyphen_values = true)]
        value: Option<String>,
        #[arg(long)]
        reason: String,
        #[arg(long, env = "AIWAVES_AGENT", default_value = "agent")]
        agent: String,
        /// Any JSON.
        #[arg(long)]
        evidence: Option<String>,
    },
    /// Replay a recorded events.jsonl as commands (for demos).
    ImportEvents {
        project: String,
        file: PathBuf,
        /// Pause between commands.
        #[arg(long, default_value_t = 0)]
        delay_ms: u64,
        /// Final project.json the log belongs to: add events that carry only a name are sent
        /// with the full track/device/clip as it was at that point.
        #[arg(long)]
        snapshot: Option<PathBuf>,
    },
    /// Surge XT synth engine (CONTRACT §9): presets, parameters, renders.
    Synth {
        #[command(subcommand)]
        action: SynthCmd,
    },
}

#[derive(Subcommand, Debug)]
pub enum SynthCmd {
    /// Is the engine available (plugin found, pedalboard installed)?
    Info,
    /// List the presets (engines/surge/presets/*.json).
    Presets,
    /// Surge's parameters (id, name, value, choices or range); --match filters by id or name.
    Params {
        #[arg(long, default_value = "")]
        r#match: String,
    },
    /// Render a preset to a WAV file, optionally overriding settings (KEY=VALUE, repeatable).
    Render {
        preset: String,
        #[arg(long)]
        out: PathBuf,
        #[arg(long = "set", value_name = "KEY=VALUE")]
        set: Vec<String>,
        #[arg(long, default_value_t = 0, allow_hyphen_values = true)]
        transpose: i32,
        #[arg(long)]
        secs: Option<f64>,
    },
    /// Render a project's Surge device as it is now on the server (its params override the preset).
    RenderDevice {
        project: String,
        track: String,
        device: String,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 0, allow_hyphen_values = true)]
        transpose: i32,
    },
}

struct CliError(Value);

impl CliError {
    fn msg(m: impl Into<String>) -> Self {
        CliError(json!({ "error": m.into() }))
    }
}

type CliResult<T> = Result<T, CliError>;

/// JSON if it parses, else the raw string.
pub fn parse_value(s: &str) -> Value {
    serde_json::from_str(s).unwrap_or_else(|_| Value::String(s.to_string()))
}

fn parse_json(s: Option<&str>, what: &str) -> CliResult<Value> {
    match s {
        None => Ok(Value::Null),
        Some(s) => serde_json::from_str(s)
            .map_err(|e| CliError::msg(format!("{what} is not valid JSON: {e}"))),
    }
}

struct Client {
    http: reqwest::Client,
    base: String,
    token: Option<String>,
}

impl Client {
    async fn send(&self, req: reqwest::RequestBuilder) -> CliResult<Value> {
        let res = req
            .send()
            .await
            .map_err(|e| CliError::msg(format!("cannot reach {}: {e}", self.base)))?;
        let status = res.status();
        let text = res.text().await.map_err(|e| CliError::msg(e.to_string()))?;
        let body: Value = serde_json::from_str(&text).unwrap_or(Value::String(text));
        if status.is_success() {
            return Ok(body);
        }
        let error = body.get("error").cloned().unwrap_or(body);
        Err(CliError(
            json!({ "error": error, "status": status.as_u16() }),
        ))
    }

    async fn get(&self, path: &str) -> CliResult<Value> {
        self.send(self.http.get(format!("{}{path}", self.base)))
            .await
    }

    async fn command(&self, project: &str, cmd: &Command) -> CliResult<Value> {
        let token = self
            .token
            .as_deref()
            .ok_or_else(|| CliError::msg("no token: pass --token or set AIWAVES_TOKEN"))?;
        let url = format!("{}/api/projects/{project}/commands", self.base);
        self.send(self.http.post(url).bearer_auth(token).json(cmd))
            .await
    }
}

fn print_pretty(v: &Value) -> CliResult<()> {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
    Ok(())
}

pub async fn run(cli: Cli) -> ExitCode {
    match run_inner(cli).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(CliError(e)) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

/// Where the desktop app says its server is: `server.json` (`{"url", "token"}`) in the app's data
/// folder ($AIWAVES_APP_DIR, else %APPDATA%/AIWaves on Windows, ~/.config/AIWaves elsewhere).
fn desktop_server() -> Option<(String, Option<String>)> {
    let dir = std::env::var_os("AIWAVES_APP_DIR")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("AIWaves")))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/AIWaves")))?;
    let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("server.json")).ok()?).ok()?;
    let url = v.get("url")?.as_str()?;
    if !(url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:")) {
        return None; // only ever a local server
    }
    let token = v.get("token").and_then(Value::as_str).map(String::from);
    Some((url.to_string(), token))
}

async fn run_inner(cli: Cli) -> CliResult<()> {
    let found = if cli.server.is_none() && !matches!(cli.cmd, Cmd::Serve { .. }) {
        desktop_server()
    } else {
        None
    };
    let base = cli
        .server
        .clone()
        .or_else(|| found.as_ref().map(|(u, _)| u.clone()))
        .unwrap_or_else(|| "http://127.0.0.1:8787".into());
    let token = cli
        .token
        .clone()
        .or_else(|| found.and_then(|(_, t)| t))
        .filter(|t| !t.trim().is_empty());
    let client = Client {
        http: reqwest::Client::new(),
        base: base.trim_end_matches('/').to_string(),
        token,
    };
    match cli.cmd {
        Cmd::Serve {
            data,
            bind,
            static_dir,
        } => crate::server::serve(data, bind, static_dir, cli.token)
            .await
            .map_err(CliError::msg),
        Cmd::Projects => print_pretty(&client.get("/api/projects").await?),
        Cmd::Show { project } => {
            print_pretty(&client.get(&format!("/api/projects/{project}")).await?)
        }
        Cmd::Events { project, mut since } => loop {
            let page = client
                .get(&format!(
                    "/api/projects/{project}/events?since={since}&limit=500"
                ))
                .await?;
            let events = page.as_array().cloned().unwrap_or_default();
            for e in &events {
                println!("{e}");
            }
            match events.last().and_then(|e| e["seq"].as_u64()) {
                Some(last) if events.len() == 500 => since = last,
                _ => return Ok(()),
            }
        },
        Cmd::Set {
            project,
            target,
            value,
            reason,
            agent,
            evidence,
        } => {
            let verb = apply::verb_for_target(&target).ok_or_else(|| {
                CliError::msg(format!(
                    "unknown target '{target}' (use `aiwaves do {project} <verb> <target>` for other verbs)"
                ))
            })?;
            let cmd = Command {
                agent: Some(agent),
                verb: verb.into(),
                target: Some(target),
                value: parse_value(&value),
                reason,
                evidence: parse_json(evidence.as_deref(), "--evidence")?,
            };
            print_pretty(&client.command(&project, &cmd).await?)
        }
        Cmd::Do {
            project,
            verb,
            target,
            value,
            reason,
            agent,
            evidence,
        } => {
            let cmd = Command {
                agent: Some(agent),
                verb,
                target,
                value: value.as_deref().map_or(Value::Null, parse_value),
                reason,
                evidence: parse_json(evidence.as_deref(), "--evidence")?,
            };
            print_pretty(&client.command(&project, &cmd).await?)
        }
        Cmd::ImportEvents {
            project,
            file,
            delay_ms,
            snapshot,
        } => import_events(&client, &project, file, delay_ms, snapshot).await,
        Cmd::Synth { action } => synth(&client, action).await,
    }
}

async fn synth(client: &Client, action: SynthCmd) -> CliResult<()> {
    let s = |x: &str| x.to_string();
    let args: Vec<String> = match action {
        SynthCmd::Info => vec![s("info")],
        SynthCmd::Presets => vec![s("presets")],
        SynthCmd::Params { r#match } => vec![s("params"), s("--match"), r#match],
        SynthCmd::Render {
            preset,
            out,
            set,
            transpose,
            secs,
        } => {
            let mut a = vec![s("render"), preset, s("--out"), out.display().to_string()];
            for kv in set {
                a.push(s("--set"));
                a.push(kv);
            }
            a.push(format!("--transpose={transpose}"));
            if let Some(secs) = secs {
                a.push(format!("--secs={secs}"));
            }
            a
        }
        SynthCmd::RenderDevice {
            project,
            track,
            device,
            out,
            transpose,
        } => {
            // the device as it is right now, including every knob agents have turned
            let p = client.get(&format!("/api/projects/{project}")).await?;
            let tmp =
                std::env::temp_dir().join(format!("aiwaves-{project}-{}.json", std::process::id()));
            std::fs::write(&tmp, p.to_string()).map_err(|e| CliError::msg(e.to_string()))?;
            vec![
                s("render-device"),
                tmp.display().to_string(),
                track,
                device,
                s("--out"),
                out.display().to_string(),
                format!("--transpose={transpose}"),
            ]
        }
    };
    let res = tokio::task::spawn_blocking(move || crate::synth::run(&args))
        .await
        .map_err(|e| CliError::msg(e.to_string()))?;
    match res {
        Ok(v) => print_pretty(&v),
        Err(e) => Err(CliError(e)),
    }
}

fn read_file(path: &PathBuf) -> CliResult<String> {
    std::fs::read_to_string(path).map_err(|e| CliError::msg(format!("{}: {e}", path.display())))
}

async fn import_events(
    client: &Client,
    project: &str,
    file: PathBuf,
    delay_ms: u64,
    snapshot: Option<PathBuf>,
) -> CliResult<()> {
    let mut events = Vec::new();
    for (n, line) in read_file(&file)?.lines().enumerate() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        let e: Event = serde_json::from_str(line)
            .map_err(|err| CliError::msg(format!("{} line {}: {err}", file.display(), n + 1)))?;
        events.push(e);
    }
    if let Some(path) = snapshot {
        let text = read_file(&path)?;
        let final_project: Project = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|e| CliError::msg(format!("{}: {e}", path.display())))?;
        events = apply::enrich_for_replay(&final_project, &events);
    }
    for (i, e) in events.into_iter().enumerate() {
        if i > 0 && delay_ms > 0 {
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }
        let seq = e.seq;
        let cmd = Command {
            agent: Some(e.agent),
            verb: e.verb,
            target: e.target,
            value: e.to,
            reason: e.reason,
            evidence: e.evidence,
        };
        let res = client
            .command(project, &cmd)
            .await
            .map_err(|CliError(mut err)| {
                err["imported_seq"] = json!(seq);
                CliError(err)
            })?;
        println!("{}", res["event"]);
    }
    Ok(())
}
