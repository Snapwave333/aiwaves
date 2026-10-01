//! Cover art (CONTRACT §10): a new generative cover per playthrough, unless one is saved.
//! Covers are a viewer preference, not song state: they live in `<project>/covers/` and never
//! touch `project.json` or the event log, so these routes need no token. Generation runs
//! `engines/art/cover_art.py` (Python + Pillow) with a timeout.

use crate::server::{ApiError, AppState};
use axum::Json;
use axum::body::Body;
use axum::extract::{Path, Query, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};
use std::path::{Path as FsPath, PathBuf};
use std::process::Command as Proc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;
use tower::ServiceExt;
use tower_http::services::ServeFile;

/// Cover operations are rare; one lock keeps `saved.json` and pruning race-free.
static COVERS_LOCK: Mutex<()> = Mutex::const_new(());
const GENERATE_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_KEEP: usize = 30;

/// How many unsaved covers to keep ($AIWAVES_COVERS_KEEP, default 30).
fn keep() -> usize {
    std::env::var("AIWAVES_COVERS_KEEP")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&n| n >= 1)
        .unwrap_or(DEFAULT_KEEP)
}

/// The generator script: $AIWAVES_ART_ENGINE, else the copy in this repo.
fn engine_path() -> PathBuf {
    std::env::var("AIWAVES_ART_ENGINE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../engines/art/cover_art.py"
            ))
        })
}

/// `cover-<digits/letters/hyphens>.png`, 1-64 characters in the middle: nothing else is served.
pub fn valid_name(name: &str) -> bool {
    let Some(mid) = name
        .strip_prefix("cover-")
        .and_then(|r| r.strip_suffix(".png"))
    else {
        return false;
    };
    (1..=64).contains(&mid.len())
        && mid
            .bytes()
            .all(|b| b.is_ascii_digit() || b.is_ascii_lowercase() || b == b'-')
}

fn unavailable(msg: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, msg)
}

fn io_err(e: impl std::fmt::Display) -> ApiError {
    ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

fn meta_path(dir: &FsPath, name: &str) -> PathBuf {
    dir.join(name.replace(".png", ".json"))
}

fn saved_name(dir: &FsPath) -> Option<String> {
    let v: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("saved.json")).ok()?).ok()?;
    v["name"]
        .as_str()
        .filter(|n| valid_name(n) && dir.join(n).is_file())
        .map(str::to_string)
}

/// A cover as the API returns it.
fn cover_json(id: &str, dir: &FsPath, name: &str, saved: Option<&str>) -> Value {
    let meta: Value = std::fs::read_to_string(meta_path(dir, name))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(json!({}));
    json!({
        "name": name,
        "url": format!("/api/projects/{id}/covers/{name}"),
        "seed": meta["seed"],
        "palette": meta.get("palette").cloned().unwrap_or(json!([])),
        "created": meta["created"],
        "saved": saved == Some(name),
    })
}

/// Every cover, newest first (by the timestamp in its name).
fn all_covers(dir: &FsPath) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| valid_name(n))
                .collect()
        })
        .unwrap_or_default();
    names.sort_by(|a, b| b.cmp(a));
    names
}

/// Run the generator with a timeout; Ok(its JSON) or Err(message).
fn generate(project_json: &FsPath, out: &FsPath, seed: u32) -> Result<Value, String> {
    let engine = engine_path();
    if !engine.exists() {
        return Err(format!("cover engine not found at {}", engine.display()));
    }
    let mut cmd = Proc::new(crate::synth::python());
    cmd.arg(&engine)
        .arg(project_json)
        .arg("--out")
        .arg(out)
        .arg("--seed")
        .arg(seed.to_string())
        .env("PYTHONIOENCODING", "utf-8");
    let out = crate::synth::run_with_timeout(cmd, GENERATE_TIMEOUT)
        .map_err(|e| format!("cover generation: {e}"))?;
    let text = |b: &[u8]| String::from_utf8_lossy(b).trim().to_string();
    if !out.status.success() {
        let err: Value = serde_json::from_str(&text(&out.stderr))
            .unwrap_or(json!({ "error": text(&out.stderr) }));
        return Err(err["error"]
            .as_str()
            .unwrap_or("cover generation failed")
            .to_string());
    }
    serde_json::from_str(&text(&out.stdout)).map_err(|e| format!("cover engine output: {e}"))
}

#[derive(serde::Deserialize, Default)]
pub struct NewCoverQuery {
    fresh: Option<String>,
}

/// POST /covers: a playthrough starts. The saved cover if there is one (200), else a new one (201).
pub async fn new_cover(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<NewCoverQuery>,
) -> Result<Response, ApiError> {
    let h = s.project(&id)?;
    let dir = h.covers_dir();
    let _guard = COVERS_LOCK.lock().await;
    std::fs::create_dir_all(&dir).map_err(io_err)?;
    let fresh = q.fresh.as_deref().is_some_and(|v| v != "0" && v != "false");
    let saved = saved_name(&dir);
    if let (Some(name), false) = (&saved, fresh) {
        return Ok((
            StatusCode::OK,
            Json(cover_json(&id, &dir, name, saved.as_deref())),
        )
            .into_response());
    }
    let mut b = [0u8; 4];
    getrandom::fill(&mut b).map_err(io_err)?;
    let seed = u32::from_le_bytes(b) & 0x7fff_ffff;
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io_err)?
        .as_millis();
    let name = format!("cover-{ms}-{seed}.png");
    let project_json = dir.join(".project-for-cover.json");
    std::fs::write(
        &project_json,
        serde_json::to_vec(&h.project()).map_err(io_err)?,
    )
    .map_err(io_err)?;
    let out = dir.join(&name);
    let result = {
        let (pj, out) = (project_json.clone(), out.clone());
        tokio::task::spawn_blocking(move || generate(&pj, &out, seed))
            .await
            .map_err(io_err)?
    };
    let _ = std::fs::remove_file(&project_json);
    let made = result.map_err(unavailable)?;
    let created = humantime::format_rfc3339_seconds(SystemTime::now()).to_string();
    let meta = json!({ "seed": seed, "palette": made["palette"], "created": created });
    std::fs::write(meta_path(&dir, &name), meta.to_string()).map_err(io_err)?;
    // keep the newest N unsaved covers
    for old in all_covers(&dir)
        .into_iter()
        .filter(|n| Some(n) != saved.as_ref())
        .skip(keep())
    {
        let _ = std::fs::remove_file(dir.join(&old));
        let _ = std::fs::remove_file(meta_path(&dir, &old));
    }
    Ok((
        StatusCode::CREATED,
        Json(cover_json(&id, &dir, &name, saved.as_deref())),
    )
        .into_response())
}

/// GET /covers: the saved cover and the recent ones.
pub async fn list_covers(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let dir = s.project(&id)?.covers_dir();
    let saved = saved_name(&dir);
    let recent: Vec<Value> = all_covers(&dir)
        .iter()
        .map(|n| cover_json(&id, &dir, n, saved.as_deref()))
        .collect();
    Ok(Json(json!({
        "saved": saved.as_deref().map(|n| cover_json(&id, &dir, n, Some(n))),
        "recent": recent,
    })))
}

/// GET /covers/{name}: the PNG.
pub async fn get_cover(
    State(s): State<AppState>,
    Path((id, name)): Path<(String, String)>,
    req: Request,
) -> Result<Response, ApiError> {
    let dir = s.project(&id)?.covers_dir();
    if !valid_name(&name) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid cover name"));
    }
    let path = dir.join(&name);
    if !path.is_file() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            format!("no cover '{name}'"),
        ));
    }
    let res = ServeFile::new(path).oneshot(req).await.map_err(io_err)?;
    Ok(res.map(Body::new))
}

/// POST /covers/{name}/save: this cover from now on, every playthrough.
pub async fn save_cover(
    State(s): State<AppState>,
    Path((id, name)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let dir = s.project(&id)?.covers_dir();
    if !valid_name(&name) {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid cover name"));
    }
    let _guard = COVERS_LOCK.lock().await;
    if !dir.join(&name).is_file() {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            format!("no cover '{name}'"),
        ));
    }
    std::fs::write(dir.join("saved.json"), json!({ "name": name }).to_string()).map_err(io_err)?;
    Ok(Json(cover_json(&id, &dir, &name, Some(&name))))
}

/// DELETE /covers/saved: back to a new cover every playthrough.
pub async fn unsave_cover(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let dir = s.project(&id)?.covers_dir();
    let _guard = COVERS_LOCK.lock().await;
    match std::fs::remove_file(dir.join("saved.json")) {
        Ok(()) => Ok(StatusCode::NO_CONTENT),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err(io_err(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::valid_name;

    #[test]
    fn cover_names() {
        assert!(valid_name("cover-1790822372004-123.png"));
        for bad in [
            "cover-.png",
            "cover-../x.png",
            "cover-A.png",
            "x.png",
            "cover-1.png.exe",
            "cover-1/2.png",
            "",
        ] {
            assert!(!valid_name(bad), "{bad}");
        }
        assert!(!valid_name(&format!("cover-{}.png", "1".repeat(65))));
    }
}
