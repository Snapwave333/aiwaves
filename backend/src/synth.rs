//! `aiwaves synth …`: the Surge XT engine (engines/surge/surge_engine.py, CONTRACT §9) behind the
//! CLI. The engine is a Python program (Surge XT is a VST3 plugin, loaded through pedalboard); this
//! module runs it and passes its JSON through, so agents use one tool for everything.

use serde_json::Value;
use std::path::PathBuf;
use std::process::{Command as Proc, Output, Stdio};
use std::time::{Duration, Instant};

/// Python interpreter: $AIWAVES_PYTHON, else `python`.
pub(crate) fn python() -> String {
    std::env::var("AIWAVES_PYTHON").unwrap_or_else(|_| "python".into())
}

/// How long a render may take before it is stopped ($AIWAVES_SYNTH_TIMEOUT_S, default 120).
fn render_timeout() -> Duration {
    Duration::from_secs(
        std::env::var("AIWAVES_SYNTH_TIMEOUT_S")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(120),
    )
}

/// Run `cmd`, killing it after `timeout`. Ok(output) or Err(message) - shared by the synth engine
/// and the cover-art generator, so neither can hang the server or the CLI.
pub(crate) fn run_with_timeout(mut cmd: Proc, timeout: Duration) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("cannot run {:?}: {e}", cmd.get_program()))?;
    // drain the pipes while waiting, so a chatty child cannot block on a full pipe
    let mut out = child.stdout.take().expect("piped");
    let mut err = child.stderr.take().expect("piped");
    let t_out = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = std::io::Read::read_to_end(&mut out, &mut b);
        b
    });
    let t_err = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = std::io::Read::read_to_end(&mut err, &mut b);
        b
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("stopped after {}s (timeout)", timeout.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(Output {
        status,
        stdout: t_out.join().unwrap_or_default(),
        stderr: t_err.join().unwrap_or_default(),
    })
}

/// The engine script: $AIWAVES_SURGE_ENGINE, else the copy in this repo.
pub fn engine_path() -> PathBuf {
    std::env::var("AIWAVES_SURGE_ENGINE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../engines/surge/surge_engine.py"
            ))
        })
}

/// Run the engine with `args`; Ok(its JSON) or Err(its `{"error": …}`).
pub fn run(args: &[String]) -> Result<Value, Value> {
    let engine = engine_path();
    if !engine.exists() {
        return Err(
            serde_json::json!({ "error": format!("synth engine not found at {}", engine.display()) }),
        );
    }
    let mut cmd = Proc::new(python());
    cmd.arg(&engine).args(args).env("PYTHONIOENCODING", "utf-8");
    let out =
        run_with_timeout(cmd, render_timeout()).map_err(|e| serde_json::json!({ "error": e }))?;
    let parse = |bytes: &[u8]| -> Value {
        let text = String::from_utf8_lossy(bytes);
        serde_json::from_str(text.trim()).unwrap_or_else(|_| Value::String(text.trim().to_string()))
    };
    if out.status.success() {
        Ok(parse(&out.stdout))
    } else {
        let err = parse(&out.stderr);
        Err(if err.get("error").is_some() {
            err
        } else {
            serde_json::json!({ "error": err })
        })
    }
}
