//! The bridge's executable: reads the command line and runs the server. All logic is in `bridge-lib`.

use std::process::ExitCode;

use bridge_lib::cli::{self, Command};
use bridge_lib::server::Server;

fn main() -> ExitCode {
    match cli::parse_args(std::env::args().skip(1)) {
        Ok(Command::Help) => {
            print!("{}", cli::usage());
            ExitCode::SUCCESS
        }
        Ok(Command::Version) => {
            println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(Command::Run(config)) => {
            let server = match Server::bind(&config) {
                Ok(server) => server,
                Err(e) => {
                    eprintln!("error: {e}");
                    return ExitCode::FAILURE;
                }
            };
            eprintln!("{}", server.banner());
            match server.run() {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("error: {e}");
                    ExitCode::FAILURE
                }
            }
        }
        Err(message) => {
            eprintln!("error: {message}\n\n{}", cli::usage());
            ExitCode::from(2)
        }
    }
}
