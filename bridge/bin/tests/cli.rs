//! The executable itself: exit codes and messages.

use std::net::{TcpListener, UdpSocket};
use std::process::{Command, Output};

fn bridge(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_factorio-planner-bridge"))
        .args(args)
        .output()
        .expect("run the bridge")
}

#[test]
fn a_taken_tcp_port_fails_with_a_clear_message_and_a_non_zero_exit() {
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port().to_string();
    let output = bridge(&["--bridge-port", &port]);
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.starts_with("error: cannot listen on 127.0.0.1:"), "{stderr}");
    assert!(stderr.contains("TCP") && stderr.contains("--bridge-port"), "{stderr}");
}

#[test]
fn a_taken_udp_port_fails_with_a_clear_message_and_a_non_zero_exit() {
    let taken = UdpSocket::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port().to_string();
    let output = bridge(&["--bridge-port", &port]);
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("UDP") && stderr.contains("--bridge-port"), "{stderr}");
}

#[test]
fn help_and_version_succeed() {
    let help = bridge(&["--help"]);
    assert!(help.status.success());
    let text = String::from_utf8_lossy(&help.stdout);
    assert!(
        text.contains("--game-port") && text.contains("34198") && text.contains("34199"),
        "{text}"
    );
    assert!(text.contains("https://fmonniot.github.io"), "{text}");

    let version = bridge(&["--version"]);
    assert!(version.status.success());
    assert!(String::from_utf8_lossy(&version.stdout).contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn a_bad_flag_is_a_usage_error() {
    let output = bridge(&["--nope"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("unknown option --nope"));
}
