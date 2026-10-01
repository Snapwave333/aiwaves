//! `aiwaves synth …`: the Surge XT engine (engines/surge/surge_engine.py, CONTRACT §9) behind the
//! CLI. The engine is a Python program (Surge XT is a VST3 plugin, loaded through pedalboard); this
//! module runs it and passes its JSON through, so agents use one tool for everything.

use serde_json::Value;
use std::path::PathBuf;
use std::process::Command as Proc;

/// Python interpreter: $AIWAVES_PYTHON, else `python`.
fn python() -> String {
    std::env::var("AIWAVES_PYTHON").unwrap_or_else(|_| "python".into())
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
    let out = Proc::new(python())
        .arg(&engine)
        .args(args)
        .env("PYTHONIOENCODING", "utf-8")
        .output()
        .map_err(|e| serde_json::json!({ "error": format!("cannot run {}: {e}", python()) }))?;
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
