use std::sync::Mutex;
use std::thread::{self, JoinHandle};

use bridge_lib::cli::Config;
use bridge_lib::server::{BindError, Server, ShutdownHandle};
use tauri::{Manager, RunEvent, WebviewWindowBuilder};

/// The in-game viewer's bridge running inside this process, so the planner needs no separate download.
pub(crate) struct BridgeHost {
    shutdown: ShutdownHandle,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl BridgeHost {
    /// Stops the bridge and waits until its ports are free.
    fn stop(&self) {
        self.shutdown.shutdown();
        let thread = self.thread.lock().ok().and_then(|mut slot| slot.take());
        if let Some(thread) = thread {
            let _ = thread.join();
        }
    }
}

/// What starting the bridge came to. A failure is never fatal: the planner still opens and says why the viewer is unavailable.
pub(crate) enum Bridge {
    Running(BridgeHost),
    Failed(String),
}

/// Binds the bridge's ports and serves on a thread named `bridge`.
fn start_bridge(config: &Config) -> Bridge {
    let server = match Server::bind(config) {
        Ok(server) => server,
        Err(err) => return Bridge::Failed(failure_text(&err)),
    };
    let shutdown = server.shutdown_handle();
    let spawned = thread::Builder::new().name("bridge".into()).spawn(move || {
        if let Err(err) = server.run() {
            eprintln!("the in-game viewer's bridge stopped: {err}");
        }
    });
    match spawned {
        Ok(thread) => Bridge::Running(BridgeHost {
            shutdown,
            thread: Mutex::new(Some(thread)),
        }),
        Err(err) => Bridge::Failed(format!("The bridge's thread could not start: {err}.")),
    }
}

/// The text the planner shows when the bridge could not start. The library's own advice names a command-line flag that the app
/// does not have.
fn failure_text(err: &BindError) -> String {
    if err.port_in_use() {
        format!(
            "Port {} is already in use, probably by a standalone bridge or another program.",
            err.port()
        )
    } else {
        err.to_string()
    }
}

/// The script run in the page before any of its own: a plain global the planner reads to know it is in the app. It is a JSON
/// literal, so no text of the error can end the script.
fn init_script(bridge: &Bridge) -> String {
    let value = match bridge {
        Bridge::Running(_) => serde_json::json!({ "bridge": "running" }),
        Bridge::Failed(error) => serde_json::json!({ "bridge": { "error": error } }),
    };
    format!("window.__FACTORIO_PLANNER_DESKTOP__ = {value};")
}

fn handle_exit(app: &tauri::AppHandle, event: RunEvent) {
    if let RunEvent::Exit = event
        && let Some(host) = app.try_state::<BridgeHost>()
    {
        host.stop();
    }
}

/// Starts the desktop app: the window declared in tauri.conf.json, showing the planner built into `dist-desktop/`, and the
/// in-game viewer's bridge on its default ports for as long as the app is open.
///
/// The window is created here rather than from the configuration so that it can carry the bridge's state before the page
/// loads. The planner's Export plan needs no hook: wry's default download handler accepts every download and saves it to the
/// user's downloads folder under its suggested name, on all three webviews.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let bridge = start_bridge(&Config::default());
            if let Bridge::Failed(error) = &bridge {
                eprintln!("the in-game viewer's bridge did not start: {error}");
            }
            let window = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("tauri.conf.json declares no window")?;
            WebviewWindowBuilder::from_config(app.handle(), &window)?
                .initialization_script(init_script(&bridge))
                .build()?;
            if let Bridge::Running(host) = bridge {
                app.manage(host);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Factorio Planner")
        .run(handle_exit);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(bridge_port: u16) -> Config {
        Config {
            bridge_port,
            ..Config::default()
        }
    }

    #[test]
    fn a_free_port_starts_the_bridge_and_stopping_frees_it() {
        let Bridge::Running(host) = start_bridge(&config(0)) else {
            panic!("expected Running")
        };
        host.stop();
        // Stopping twice is harmless.
        host.stop();
    }

    #[test]
    fn a_taken_port_fails_with_the_apps_own_text() {
        let held = Server::bind(&config(0)).expect("bind");
        let port = held.port();
        let Bridge::Failed(text) = start_bridge(&config(port)) else {
            panic!("expected Failed")
        };
        assert!(text.contains(&port.to_string()), "{text}");
        assert!(text.contains("in use"), "{text}");
        assert!(!text.contains("--bridge-port"), "{text}");
    }

    #[test]
    fn the_script_is_a_json_literal_whatever_the_error_says() {
        let error = "quote \" newline \n </script>";
        let script = init_script(&Bridge::Failed(error.to_owned()));
        let prefix = "window.__FACTORIO_PLANNER_DESKTOP__ = ";
        let literal = script
            .strip_prefix(prefix)
            .and_then(|rest| rest.strip_suffix(';'))
            .expect("prefix and semicolon");
        let value: serde_json::Value = serde_json::from_str(literal).expect("JSON");
        assert_eq!(value["bridge"]["error"], error);
    }

    #[test]
    fn a_running_bridge_is_announced() {
        let bridge = start_bridge(&config(0));
        let script = init_script(&bridge);
        assert!(script.contains(r#""bridge":"running""#), "{script}");
        if let Bridge::Running(host) = bridge {
            host.stop();
        }
    }
}
