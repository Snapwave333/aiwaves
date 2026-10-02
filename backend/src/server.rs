//! HTTP API (CONTRACT §5) and the live WebSocket (§6).

use crate::model::Command;
use crate::store::{ProjectHandle, Store, StoreError};
use axum::body::{Body, Bytes};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, post};
use serde::Deserialize;
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::error::RecvError;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

pub const DEFAULT_EVENTS_LIMIT: usize = 500;
pub const PING_INTERVAL: Duration = Duration::from_secs(20);
pub const DEV_ORIGINS: &[&str] = &["http://localhost:4200", "http://127.0.0.1:4200"];

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<Store>,
    pub token: Arc<String>,
}

pub struct ApiError(StatusCode, String);

impl ApiError {
    pub fn new(status: StatusCode, msg: impl Into<String>) -> Self {
        ApiError(status, msg.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<StoreError> for ApiError {
    fn from(e: StoreError) -> Self {
        match e {
            StoreError::BadRequest(m) => ApiError(StatusCode::BAD_REQUEST, m),
            StoreError::Io(m) => ApiError(StatusCode::INTERNAL_SERVER_ERROR, m),
        }
    }
}

fn bad_request(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

type ApiResult<T> = Result<T, ApiError>;

impl AppState {
    pub(crate) fn project(&self, id: &str) -> ApiResult<Arc<ProjectHandle>> {
        self.store
            .get(id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, format!("unknown project '{id}'")))
    }
}

pub fn router(state: AppState, static_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/api/health", get(health))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/{id}", get(show_project))
        .route("/api/projects/{id}/state", get(project_state))
        .route("/api/projects/{id}/events", get(project_events))
        .route("/api/projects/{id}/history", get(project_history))
        .route("/api/projects/{id}/audio/{file}", get(project_audio))
        .route("/api/projects/{id}/commands", post(post_command))
        .route("/api/projects/{id}/live", get(live))
        // the agent handoff document, aiwave411.md (CONTRACT §11); writes need the token
        .route("/api/projects/{id}/411", get(get_411).put(put_411))
        .route("/api/projects/{id}/411/append", post(append_411))
        .route("/api/projects/{id}/411/init", post(init_411))
        // cover art: a viewer preference, the only routes a viewer may write to (CONTRACT §10)
        .route(
            "/api/projects/{id}/covers",
            post(crate::covers::new_cover).get(crate::covers::list_covers),
        )
        .route(
            "/api/projects/{id}/covers/saved",
            delete(crate::covers::unsave_cover),
        )
        .route(
            "/api/projects/{id}/covers/{name}",
            get(crate::covers::get_cover),
        )
        .route(
            "/api/projects/{id}/covers/{name}/save",
            post(crate::covers::save_cover),
        )
        .route("/api/{*rest}", any(api_not_found))
        .with_state(state);
    let app = match static_dir {
        Some(dir) => {
            let index = ServeFile::new(dir.join("index.html"));
            api.fallback_service(ServeDir::new(dir).fallback(index))
        }
        None => api,
    };
    let origins: Vec<HeaderValue> = DEV_ORIGINS
        .iter()
        .map(|o| HeaderValue::from_static(o))
        .collect();
    app.layer(
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, header::RANGE])
            .expose_headers([
                header::CONTENT_RANGE,
                header::ACCEPT_RANGES,
                header::CONTENT_LENGTH,
            ]),
    )
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") }))
}

async fn api_not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "no such endpoint".into())
}

async fn list_projects(State(s): State<AppState>) -> Json<Value> {
    Json(json!(s.store.list()))
}

async fn show_project(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(json!(s.project(&id)?.project())))
}

fn query_u64(q: &HashMap<String, String>, key: &str) -> ApiResult<Option<u64>> {
    q.get(key)
        .map(|v| {
            v.parse()
                .map_err(|_| bad_request(format!("{key} must be a non-negative integer")))
        })
        .transpose()
}

async fn project_state(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let h = s.project(&id)?;
    let project = match query_u64(&q, "at")? {
        Some(at) => h.state_at(at)?,
        None => h.project(),
    };
    Ok(Json(json!(project)))
}

async fn project_events(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult<Json<Value>> {
    let h = s.project(&id)?;
    let since = query_u64(&q, "since")?.unwrap_or(0);
    let limit = query_u64(&q, "limit")?.map_or(DEFAULT_EVENTS_LIMIT, |l| l as usize);
    Ok(Json(json!(h.events_since(since, limit))))
}

async fn project_history(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    Ok(Json(s.project(&id)?.history()))
}

/// A plain file name inside the project's `audio/` folder: no separators, no `..`, no drive
/// letters, no hidden files.
fn safe_audio_name(file: &str) -> bool {
    !file.is_empty()
        && !file.starts_with('.')
        && !file.contains(['/', '\\', ':', '\0'])
        && !file.contains("..")
}

async fn project_audio(
    State(s): State<AppState>,
    Path((id, file)): Path<(String, String)>,
    req: Request,
) -> ApiResult<Response> {
    let h = s.project(&id)?;
    if !safe_audio_name(&file) {
        return Err(bad_request("invalid audio file name"));
    }
    let not_found = || ApiError(StatusCode::NOT_FOUND, format!("no audio file '{file}'"));
    let dir = h.audio_dir().canonicalize().map_err(|_| not_found())?;
    let path = dir.join(&file).canonicalize().map_err(|_| not_found())?;
    if !path.starts_with(&dir) || !path.is_file() {
        return Err(not_found());
    }
    let res = ServeFile::new(path)
        .oneshot(req)
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(res.map(Body::new))
}

/// Compares in time that depends only on the lengths, not on where the bytes differ.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(diff) == 0
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .is_some_and(|t| constant_time_eq(t.trim().as_bytes(), token.as_bytes()))
}

async fn post_command(
    State(s): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<Value>)> {
    if !authorized(&headers, &s.token) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "missing or wrong token (Authorization: Bearer <AIWAVES_TOKEN>)".into(),
        ));
    }
    let h = s.project(&id)?;
    let cmd: Command = serde_json::from_slice(&body)
        .map_err(|e| bad_request(format!("invalid command JSON: {e}")))?;
    let event = tokio::task::spawn_blocking(move || h.execute(cmd))
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))??;
    let version = event.seq;
    Ok((
        StatusCode::CREATED,
        Json(json!({ "event": event, "version": version })),
    ))
}

// --- aiwave411.md -------------------------------------------------------------------------------

#[derive(Deserialize)]
struct DocWrite {
    text: String,
    #[serde(default)]
    reason: String,
    #[serde(default)]
    agent: Option<String>,
}

#[derive(Deserialize, Default)]
struct DocInit {
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    agent: Option<String>,
}

fn need_token(headers: &HeaderMap, s: &AppState) -> ApiResult<()> {
    if authorized(headers, &s.token) {
        Ok(())
    } else {
        Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "missing or wrong token (Authorization: Bearer <AIWAVES_TOKEN>)".into(),
        ))
    }
}

/// The handoff document: `{exists, file, text, updated, summary}`.
async fn get_411(State(s): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let h = s.project(&id)?;
    Ok(Json(crate::handoff::read(&h)))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> ApiResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn doc_body<T: serde::de::DeserializeOwned>(body: &Bytes) -> ApiResult<T> {
    serde_json::from_slice(body).map_err(|e| bad_request(format!("invalid JSON: {e}")))
}

async fn put_411(
    State(s): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    need_token(&headers, &s)?;
    let h = s.project(&id)?;
    let w: DocWrite = doc_body(&body)?;
    let event = blocking(move || crate::handoff::write(&h, &w.text, w.agent, w.reason, "set")).await??;
    Ok(Json(json!({ "event": event })))
}

async fn append_411(
    State(s): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<Json<Value>> {
    need_token(&headers, &s)?;
    let h = s.project(&id)?;
    let w: DocWrite = doc_body(&body)?;
    let event = blocking(move || crate::handoff::append(&h, &w.text, w.agent, w.reason)).await??;
    Ok(Json(json!({ "event": event })))
}

/// Creates the document from the project (409 if it exists: use PUT to replace it).
async fn init_411(
    State(s): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> ApiResult<(StatusCode, Json<Value>)> {
    need_token(&headers, &s)?;
    let h = s.project(&id)?;
    let w: DocInit = if body.is_empty() { DocInit::default() } else { doc_body(&body)? };
    if crate::handoff::read(&h)["exists"] == json!(true) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            format!("{} exists already (replace it with PUT /411)", crate::handoff::FILE),
        ));
    }
    let project = serde_json::to_value(h.project()).unwrap_or(Value::Null);
    let text = crate::handoff::template(&project, &h.history());
    let reason = w.reason.unwrap_or_else(|| "created from the project".into());
    let event = blocking(move || crate::handoff::write(&h, &text, w.agent, reason, "init")).await??;
    Ok((StatusCode::CREATED, Json(json!({ "event": event }))))
}

async fn live(
    State(s): State<AppState>,
    Path(id): Path<String>,
    ws: WebSocketUpgrade,
) -> ApiResult<Response> {
    let h = s.project(&id)?;
    Ok(ws.on_upgrade(move |socket| live_session(socket, h)))
}

/// Server → client only. Anything the client sends is read and dropped. A viewer that falls
/// too far behind is disconnected; it reconnects and catches up with `GET /events?since=`.
async fn live_session(socket: WebSocket, h: Arc<ProjectHandle>) {
    let (project, last_seq, mut events) = h.subscribe();
    let (mut tx, mut rx) = socket.split();
    let send = |v: Value| Message::Text(v.to_string().into());
    let hello = json!({ "type": "hello", "project": project, "last_seq": last_seq });
    if tx.send(send(hello)).await.is_err() {
        return;
    }
    let mut ping =
        tokio::time::interval_at(tokio::time::Instant::now() + PING_INTERVAL, PING_INTERVAL);
    loop {
        let out = tokio::select! {
            incoming = rx.next() => match incoming {
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => continue,
            },
            ev = events.recv() => match ev {
                Ok(event) => json!({ "type": "event", "event": event }),
                Err(RecvError::Lagged(_)) | Err(RecvError::Closed) => break,
            },
            _ = ping.tick() => json!({ "type": "ping" }),
        };
        if tx.send(send(out)).await.is_err() {
            break;
        }
    }
    let _ = tx.close().await;
}

fn generate_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("OS random number generator");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `aiwaves serve`: load projects, pick the token, listen until the process is stopped.
pub async fn serve(
    data: PathBuf,
    bind: SocketAddr,
    static_dir: Option<PathBuf>,
    token: Option<String>,
) -> Result<(), String> {
    let store = Store::load(&data)?;
    if let Some(dir) = &static_dir
        && !dir.join("index.html").is_file()
    {
        return Err(format!("--static {}: no index.html there", dir.display()));
    }
    let token = match token.filter(|t| !t.trim().is_empty()) {
        Some(t) => t.trim().to_string(),
        None => {
            let t = generate_token();
            eprintln!("AIWAVES_TOKEN={t}  (generated; set AIWAVES_TOKEN to choose your own)");
            t
        }
    };
    let ids: Vec<String> = store.list().into_iter().map(|p| p.id).collect();
    let state = AppState {
        store: Arc::new(store),
        token: Arc::new(token),
    };
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|e| format!("cannot bind {bind}: {e}"))?;
    eprintln!(
        "aiwaves {} listening on http://{} (projects: {})",
        env!("CARGO_PKG_VERSION"),
        listener.local_addr().map_err(|e| e.to_string())?,
        if ids.is_empty() {
            "none".into()
        } else {
            ids.join(", ")
        }
    );
    axum::serve(listener, router(state, static_dir))
        .await
        .map_err(|e| e.to_string())
}
