//! AIWaves backend: the project model, the pure `apply`/`unapply` state machine, on-disk
//! projects, the HTTP/WebSocket server and the CLI. See `docs/CONTRACT.md`.

pub mod apply;
pub mod cli;
pub mod model;
pub mod server;
pub mod store;

pub use apply::{ApplyError, apply, state_at, unapply};
pub use model::{Command, Event, Project};
