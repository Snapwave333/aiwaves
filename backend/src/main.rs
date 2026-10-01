use aiwaves::cli::{Cli, run};
use clap::Parser;
use clap::error::ErrorKind;
use std::process::ExitCode;

#[tokio::main]
async fn main() -> ExitCode {
    match Cli::try_parse() {
        Ok(cli) => run(cli).await,
        Err(e) if matches!(e.kind(), ErrorKind::DisplayHelp | ErrorKind::DisplayVersion) => {
            e.exit()
        }
        Err(e) => {
            eprintln!("{}", serde_json::json!({ "error": e.to_string().trim() }));
            ExitCode::from(2)
        }
    }
}
