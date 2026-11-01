//! The command line: flags, their defaults and the text of `--help`.
//!
//! Hand-written on purpose: four flags do not justify an argument-parsing dependency.

/// The game's UDP port by default (protocol.md, Ports).
pub const DEFAULT_GAME_PORT: u16 = 34198;
/// The bridge's port by default, for both its WebSocket (TCP) and its UDP socket.
pub const DEFAULT_BRIDGE_PORT: u16 = 34199;

/// Origins allowed by default: the deployed planner (GitHub Pages) and the Vite dev server.
pub const DEFAULT_ORIGINS: [&str; 3] = [
    "https://fmonniot.github.io",
    "http://localhost:4000",
    "http://127.0.0.1:4000",
];

/// What the server runs with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    /// The UDP port the game listens on (`--enable-lua-udp`).
    pub game_port: u16,
    /// The one port of the bridge: WebSocket (TCP) and its own UDP socket. `0` picks a free one (tests).
    pub bridge_port: u16,
    /// Web origins allowed to open the WebSocket, as browsers send them: scheme, host and port, no path.
    pub origins: Vec<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            game_port: DEFAULT_GAME_PORT,
            bridge_port: DEFAULT_BRIDGE_PORT,
            origins: DEFAULT_ORIGINS.iter().map(|o| (*o).to_owned()).collect(),
        }
    }
}

/// What the command line asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Run the bridge.
    Run(Config),
    /// Print the usage text.
    Help,
    /// Print the version.
    Version,
}

/// The text of `--help`.
#[must_use]
pub fn usage() -> String {
    let defaults = Config::default();
    format!(
        "factorio-planner-bridge {version}

Carries the planner's snapshots from the browser to the Factorio mod. Listens on 127.0.0.1 only.

USAGE:
    factorio-planner-bridge [OPTIONS]

OPTIONS:
    --game-port <PORT>     UDP port of the game (--enable-lua-udp)  [default: {game}]
    --bridge-port <PORT>   The bridge's own port, for the planner's WebSocket (TCP) and the mod's
                           UDP replies; the mod's setting must match  [default: {bridge}]
    --origin <ORIGIN>      A web origin allowed to connect, e.g. http://localhost:4000. Repeat the
                           flag for several. Replaces the defaults:
                           {origins}
    -h, --help             Print this help
    -V, --version          Print the version
",
        version = env!("CARGO_PKG_VERSION"),
        game = defaults.game_port,
        bridge = defaults.bridge_port,
        origins = DEFAULT_ORIGINS.join("\n                           "),
    )
}

/// Reads the arguments after the program name.
///
/// # Errors
/// A message for the user when a flag is unknown, lacks its value or has a bad one.
pub fn parse_args<I: IntoIterator<Item = String>>(args: I) -> Result<Command, String> {
    let mut config = Config::default();
    let mut origins: Vec<String> = Vec::new();
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let (flag, inline) = match arg.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => (flag.to_owned(), Some(value.to_owned())),
            _ => (arg, None),
        };
        match flag.as_str() {
            "-h" | "--help" => return Ok(Command::Help),
            "-V" | "--version" => return Ok(Command::Version),
            "--game-port" => config.game_port = parse_port(&flag, value(&flag, inline, &mut args)?)?,
            "--bridge-port" => config.bridge_port = parse_port(&flag, value(&flag, inline, &mut args)?)?,
            "--origin" => origins.push(normalize_origin(&value(&flag, inline, &mut args)?)?),
            other => return Err(format!("unknown option {other}")),
        }
    }
    if !origins.is_empty() {
        config.origins = origins;
    }
    if config.game_port == config.bridge_port {
        return Err("--game-port and --bridge-port must differ: they are two sockets on the same machine".to_owned());
    }
    Ok(Command::Run(config))
}

fn value(flag: &str, inline: Option<String>, rest: &mut impl Iterator<Item = String>) -> Result<String, String> {
    inline
        .or_else(|| rest.next())
        .ok_or_else(|| format!("{flag} needs a value"))
}

fn parse_port(flag: &str, text: String) -> Result<u16, String> {
    match text.parse::<u16>() {
        Ok(port) if port != 0 => Ok(port),
        _ => Err(format!("{flag} wants a port number from 1 to 65535, not {text:?}")),
    }
}

/// Checks that `text` is an origin and gives its canonical form.
fn normalize_origin(text: &str) -> Result<String, String> {
    canonical_origin(text)
        .ok_or_else(|| format!("--origin wants scheme, host and port only, like http://localhost:4000, not {text:?}"))
}

/// The canonical form of a web origin, so that `HTTPS://Me.github.io:443` and `https://me.github.io` compare equal: the scheme
/// and host in lower case, the scheme's default port (80, 443) dropped, a trailing slash dropped. `None` if `text` is not
/// `http://` or `https://` followed by a host and an optional port (a path, a query, credentials or the literal `null` that
/// browsers send for opaque origins are not). This is the only normalization: there is no wildcard and no suffix match.
#[must_use]
pub fn canonical_origin(text: &str) -> Option<String> {
    let (scheme, rest) = text.trim_end_matches('/').split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    let default_port = match scheme.as_str() {
        "http" => ":80",
        "https" => ":443",
        _ => return None,
    };
    if rest.is_empty() || rest.contains(['/', '?', '#', '@']) || rest.chars().any(char::is_whitespace) {
        return None;
    }
    let rest = rest.to_ascii_lowercase();
    let host = rest.strip_suffix(default_port).unwrap_or(&rest);
    if host.is_empty() || host.starts_with(':') {
        return None;
    }
    Some(format!("{scheme}://{host}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Command, String> {
        parse_args(args.iter().map(|a| (*a).to_owned()))
    }

    #[test]
    fn no_arguments_gives_the_defaults() {
        let Ok(Command::Run(config)) = parse(&[]) else {
            panic!("expected Run")
        };
        assert_eq!(config.game_port, 34198);
        assert_eq!(config.bridge_port, 34199);
        assert!(config.origins.contains(&"https://fmonniot.github.io".to_owned()));
        assert!(config.origins.contains(&"http://localhost:4000".to_owned()));
    }

    #[test]
    fn flags_take_a_value_after_a_space_or_an_equals_sign() {
        let Ok(Command::Run(config)) = parse(&[
            "--game-port",
            "1000",
            "--bridge-port=2000",
            "--origin",
            "http://a.test/",
        ]) else {
            panic!("expected Run")
        };
        assert_eq!((config.game_port, config.bridge_port), (1000, 2000));
        assert_eq!(config.origins, ["http://a.test"]);
    }

    #[test]
    fn repeated_origins_replace_the_defaults() {
        let Ok(Command::Run(config)) = parse(&["--origin", "http://a.test", "--origin", "https://b.test:8443"]) else {
            panic!("expected Run")
        };
        assert_eq!(config.origins, ["http://a.test", "https://b.test:8443"]);
    }

    #[test]
    fn origins_are_compared_in_a_canonical_form() {
        let canonical = |t: &str| canonical_origin(t);
        assert_eq!(
            canonical("HTTPS://Me.GitHub.io:443"),
            Some("https://me.github.io".to_owned())
        );
        assert_eq!(
            canonical("https://me.github.io/"),
            Some("https://me.github.io".to_owned())
        );
        assert_eq!(canonical("http://LOCALHOST:80"), Some("http://localhost".to_owned()));
        // Another scheme's default port is a different origin.
        assert_eq!(canonical("http://a.test:443"), Some("http://a.test:443".to_owned()));
        assert_eq!(canonical("https://a.test:80"), Some("https://a.test:80".to_owned()));
        assert_eq!(
            canonical("http://localhost:4000"),
            Some("http://localhost:4000".to_owned())
        );
        assert_eq!(canonical("http://[::1]:4000"), Some("http://[::1]:4000".to_owned()));
        // Not origins, or not ones that can match anything.
        for bad in [
            "null",
            "",
            "ftp://a.test",
            "http://",
            "http://:80",
            "http://a.test/x",
            "http://u@a.test",
            "http://a b",
        ] {
            assert_eq!(canonical(bad), None, "{bad:?}");
        }
        // Exact match otherwise: no subdomain or suffix is folded in.
        assert_ne!(
            canonical("https://evil.me.github.io"),
            canonical("https://me.github.io")
        );
        assert_ne!(
            canonical("https://me.github.io.evil.test"),
            canonical("https://me.github.io")
        );
    }

    #[test]
    fn an_origin_flag_is_stored_canonical() {
        let Ok(Command::Run(config)) = parse(&["--origin", "HTTPS://Me.github.io:443"]) else {
            panic!("expected Run")
        };
        assert_eq!(config.origins, ["https://me.github.io"]);
    }

    #[test]
    fn mistakes_are_reported_in_words() {
        assert_eq!(parse(&["-h"]), Ok(Command::Help));
        assert_eq!(parse(&["--version"]), Ok(Command::Version));
        assert!(parse(&["--bogus"]).unwrap_err().contains("unknown option --bogus"));
        assert!(parse(&["--game-port"]).unwrap_err().contains("needs a value"));
        assert!(parse(&["--game-port", "0"]).unwrap_err().contains("1 to 65535"));
        assert!(parse(&["--bridge-port", "70000"]).unwrap_err().contains("1 to 65535"));
        assert!(parse(&["--origin", "localhost:4000"]).unwrap_err().contains("--origin"));
        assert!(
            parse(&["--origin", "http://a.test/path"])
                .unwrap_err()
                .contains("--origin")
        );
        assert!(
            parse(&["--game-port", "5", "--bridge-port", "5"])
                .unwrap_err()
                .contains("must differ")
        );
    }
}
