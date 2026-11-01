//! The shared datagram fixtures in `contract/datagrams/`, which the Lua tests read too.

mod support;

use bridge_lib::protocol::{
    BridgeInbound, BridgeMessage, Inbound, ModMessage, SnapshotId, encode_chunk, encode_end_of_window, encode_ping,
    encode_probe, parse_bridge_datagram, parse_mod_datagram,
};
use bridge_lib::ws::{ErrorCode, PlannerText, encode_snapshot_frame, parse_snapshot_frame, parse_text_frame};
use bridge_lib::{Bridge, Link, Phase, Status};
use serde_json::Value;
use support::{Clock, Sent, drain, hex_decode, id, read_json};

fn opt_id(value: &Value) -> Option<SnapshotId> {
    value.as_str().map(id)
}

fn number(value: &Value) -> u16 {
    u16::try_from(value.as_u64().expect("a number")).expect("fits in u16")
}

/// The mod-to-bridge message a fixture's `fields` describe.
fn mod_message(kind: &str, fields: &Value) -> Inbound {
    match kind {
        "hello" => {
            if fields["protocol"] != 1 {
                return Inbound::OtherVersionHello(u8::try_from(fields["protocol"].as_u64().unwrap()).unwrap());
            }
            Inbound::Mod(ModMessage::Hello {
                stored: opt_id(&fields["stored"]),
                unknown_ids: number(&fields["unknownIds"]),
                assembling: opt_id(&fields["assembling"]),
            })
        }
        "ready" => Inbound::Mod(ModMessage::Ready {
            id: id(fields["id"].as_str().unwrap()),
        }),
        "missing" => Inbound::Mod(ModMessage::Missing {
            id: id(fields["id"].as_str().unwrap()),
            round: number(&fields["round"]),
            ranges: fields["missing"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| (number(&r[0]), number(&r[1])))
                .collect(),
        }),
        "ack" => Inbound::Mod(ModMessage::Ack {
            id: id(fields["id"].as_str().unwrap()),
            unknown_ids: number(&fields["unknownIds"]),
        }),
        "nack" => Inbound::Mod(ModMessage::Refusal {
            id: id(fields["id"].as_str().unwrap()),
            reason: fields["reason"].as_str().unwrap().to_owned(),
        }),
        other => panic!("unknown mod message type {other}"),
    }
}

#[test]
fn every_udp_message_parses_to_its_fields_and_encodes_back_to_its_bytes() {
    let messages = read_json("messages.json");
    let mut checked = 0;
    for m in messages["messages"].as_array().unwrap() {
        if m["link"] != "udp" {
            continue;
        }
        let name = m["name"].as_str().unwrap();
        let bytes = hex_decode(m["hex"].as_str().unwrap());
        let fields = &m["fields"];
        let kind = m["type"].as_str().unwrap();
        if m["from"] == "mod" {
            let parsed = parse_mod_datagram(&bytes).unwrap_or_else(|| panic!("{name} should parse"));
            assert_eq!(parsed, mod_message(kind, fields), "{name}");
            if let Inbound::Mod(message) = parsed {
                assert_eq!(
                    message.encode(),
                    bytes,
                    "{name} should encode back to the fixture's bytes"
                );
            }
        } else {
            let parsed = parse_bridge_datagram(&bytes).unwrap_or_else(|| panic!("{name} should parse"));
            let BridgeInbound::Message(message) = parsed else {
                panic!("{name} is a message of this version");
            };
            let (expected, encoded) = match kind {
                "ping" => {
                    let newest = opt_id(&fields["newest"]);
                    (BridgeMessage::Ping { newest }, encode_ping(newest.as_ref()))
                }
                "probe" => {
                    let (i, count, total) = (
                        id(fields["id"].as_str().unwrap()),
                        number(&fields["count"]),
                        fields["bytes"].as_u64().unwrap(),
                    );
                    let total = u32::try_from(total).unwrap();
                    (
                        BridgeMessage::Probe {
                            id: i,
                            count,
                            bytes: total,
                        },
                        encode_probe(&i, count, total),
                    )
                }
                "chunk" => {
                    let i = id(fields["id"].as_str().unwrap());
                    let (index, count) = (number(&fields["index"]), number(&fields["count"]));
                    let total = u32::try_from(fields["bytes"].as_u64().unwrap()).unwrap();
                    let payload = &bytes[42..];
                    assert_eq!(payload.len() as u64, fields["payloadBytes"].as_u64().unwrap(), "{name}");
                    (
                        BridgeMessage::Chunk {
                            id: i,
                            index,
                            count,
                            bytes: total,
                            payload,
                        },
                        encode_chunk(&i, index, count, total, payload),
                    )
                }
                "end-of-window" => {
                    let i = id(fields["id"].as_str().unwrap());
                    let (round, upto) = (number(&fields["round"]), number(&fields["upto"]));
                    (
                        BridgeMessage::EndOfWindow { id: i, round, upto },
                        encode_end_of_window(&i, round, upto),
                    )
                }
                other => panic!("unknown bridge message type {other}"),
            };
            assert_eq!(message, expected, "{name}");
            assert_eq!(encoded, bytes, "{name} should encode back to the fixture's bytes");
        }
        checked += 1;
    }
    assert!(checked >= 15, "the fixture file shrank: {checked} udp messages");
}

#[test]
fn every_websocket_message_matches_the_codec() {
    let messages = read_json("messages.json");
    for m in messages["messages"].as_array().unwrap() {
        if m["link"] != "ws" {
            continue;
        }
        let name = m["name"].as_str().unwrap();
        let bytes = hex_decode(m["hex"].as_str().unwrap());
        let fields = &m["fields"];
        match m["type"].as_str().unwrap() {
            "snapshot" => {
                let frame = parse_snapshot_frame(&bytes).unwrap_or_else(|e| panic!("{name}: {e:?}"));
                assert_eq!(frame.id, id(fields["id"].as_str().unwrap()), "{name}");
                assert_eq!(frame.bytes.len() as u64, fields["bytes"].as_u64().unwrap(), "{name}");
                assert_eq!(encode_snapshot_frame(&frame.id, frame.bytes), bytes, "{name}");
            }
            "announce" => {
                let text = std::str::from_utf8(&bytes).unwrap();
                assert_eq!(
                    parse_text_frame(text),
                    Ok(PlannerText::Announce {
                        id: id(fields["id"].as_str().unwrap())
                    }),
                    "{name}"
                );
                assert_eq!(
                    bridge_lib::ws::encode_announce(&id(fields["id"].as_str().unwrap())),
                    text,
                    "{name}"
                );
            }
            "status" => {
                let expected: Value = serde_json::from_slice(&bytes).unwrap();
                let status: Status = serde_json::from_value(expected.clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
                let actual: Value = serde_json::from_str(&status.to_json()).unwrap();
                assert_eq!(actual, expected, "{name}");
            }
            "error" => {
                let expected: Value = serde_json::from_slice(&bytes).unwrap();
                let code = match fields["code"].as_str().unwrap() {
                    "bad-envelope" => ErrorCode::BadEnvelope,
                    "too-large" => ErrorCode::TooLarge,
                    "protocol-mismatch" => ErrorCode::ProtocolMismatch,
                    "bad-message" => ErrorCode::BadMessage,
                    other => panic!("unknown error code {other}"),
                };
                let actual: Value = serde_json::from_str(&code.to_json()).unwrap();
                assert_eq!(actual, expected, "{name}");
            }
            other => panic!("unknown websocket message type {other}"),
        }
    }
}

#[test]
fn every_malformed_input_is_dropped_by_its_reader() {
    let malformed = read_json("malformed.json");
    let mut counts = [0; 3];
    for input in malformed["inputs"].as_array().unwrap() {
        let why = input["why"].as_str().unwrap();
        let bytes = hex_decode(input["hex"].as_str().unwrap());
        match input["reader"].as_str().unwrap() {
            "mod" => {
                assert_eq!(parse_bridge_datagram(&bytes), None, "mod reader: {why}");
                counts[0] += 1;
            }
            "bridge-udp" => {
                assert_eq!(parse_mod_datagram(&bytes), None, "bridge reader: {why}");
                // A dropped datagram does not even count as hearing the mod.
                let mut clock = Clock::new();
                let mut bridge = Bridge::new(clock.now);
                drain(&mut bridge);
                bridge.handle_datagram(clock.ms(10), &bytes);
                assert_eq!(bridge.link(clock.now), Link::None, "{why}");
                assert!(drain(&mut bridge).is_empty(), "{why}");
                counts[1] += 1;
            }
            "bridge-ws" => {
                let expected = match input["error"].as_str().unwrap() {
                    "bad-envelope" => ErrorCode::BadEnvelope,
                    "too-large" => ErrorCode::TooLarge,
                    "protocol-mismatch" => ErrorCode::ProtocolMismatch,
                    "bad-message" => ErrorCode::BadMessage,
                    other => panic!("unknown error code {other}"),
                };
                let actual = if input["frame"] == "binary" {
                    parse_snapshot_frame(&bytes).map(|_| ()).unwrap_err()
                } else {
                    parse_text_frame(&String::from_utf8(bytes).unwrap())
                        .map(|_| ())
                        .unwrap_err()
                };
                assert_eq!(actual, expected, "ws reader: {why}");
                counts[2] += 1;
            }
            other => panic!("unknown reader {other}"),
        }
    }
    assert!(counts.iter().all(|&n| n >= 10), "the fixture file shrank: {counts:?}");
}

fn phase_named(name: &str) -> Phase {
    match name {
        "delivered" => Phase::Delivered,
        "rejected" => Phase::Rejected,
        "failed" => Phase::Failed,
        other => panic!("unknown phase {other}"),
    }
}

/// Runs one case's `bridge` entries against the bridge, as the protocol's Fixtures section describes.
fn run_bridge_case(case: &Value) {
    let name = case["case"].as_str().unwrap();
    let snapshot = &case["snapshot"];
    let snapshot_id = id(snapshot["id"].as_str().unwrap());
    let bytes = hex_decode(snapshot["hex"].as_str().unwrap());
    let chunk_size = usize::try_from(snapshot["chunkSize"].as_u64().unwrap()).unwrap();
    assert_eq!(bytes.len() as u64, snapshot["bytes"].as_u64().unwrap(), "{name}");
    let count = bytes.len().div_ceil(chunk_size);

    let mut clock = Clock::new();
    let mut bridge = Bridge::with_chunk_size(clock.now, chunk_size);
    drain(&mut bridge);
    // Make the link connected, then hand over the snapshot: the bridge is in `Probing`.
    bridge.handle_datagram(clock.ms(1), b"FP01 H ---------------- 0 ----------------");
    bridge
        .receive_snapshot(clock.ms(1), snapshot_id, bytes.clone())
        .unwrap();
    let first = drain(&mut bridge);
    assert_eq!(
        first.probes,
        vec![(
            snapshot_id,
            u16::try_from(count).unwrap(),
            u32::try_from(bytes.len()).unwrap()
        )],
        "{name}"
    );
    assert_eq!(bridge.phase(), Phase::Probing, "{name}");

    for (n, entry) in case["bridge"].as_array().unwrap().iter().enumerate() {
        let hears = entry["hears"].as_str().unwrap();
        let context = format!("{name}, entry {n} (hears {hears})");
        // More than PROBE_REFILL_AFTER between answers, so that a hello counts as proof the mod drained its buffer.
        bridge.handle_datagram(clock.ms(1_100), hears.as_bytes());
        let mut sent = drain(&mut bridge);
        // Let the pacing run out.
        while bridge.phase() == Phase::Sending {
            bridge.handle_timeout(clock.ms(20));
            sent.merge(drain(&mut bridge));
        }
        // Pings are on their own schedule; the fixtures describe the transfer.
        let transfer = Sent {
            pings: Vec::new(),
            ..sent.clone()
        };
        match &entry["sends"] {
            Value::Null => {
                assert!(
                    transfer.probes.is_empty() && transfer.chunks.is_empty() && transfer.eows.is_empty(),
                    "{context}: {transfer:?}"
                );
            }
            sends if sends.get("indices").is_some() => {
                let indices: Vec<u16> = sends["indices"].as_array().unwrap().iter().map(number).collect();
                assert_eq!(transfer.chunk_indices(), indices, "{context}");
                assert_eq!(
                    transfer.eows,
                    vec![(number(&sends["round"]), number(&sends["upto"]))],
                    "{context}"
                );
                assert!(transfer.probes.is_empty(), "{context}");
                // The end-of-window comes last, and every chunk carries the right slice of the snapshot.
                assert!(transfer.order.replace('P', "").ends_with('E'), "{context}");
                for datagram in sent.raw.iter().filter(|d| d.get(5) == Some(&b'C')) {
                    let Some(BridgeInbound::Message(BridgeMessage::Chunk { index, payload, .. })) =
                        parse_bridge_datagram(datagram)
                    else {
                        panic!("{context}: not a chunk");
                    };
                    let start = usize::from(index) * chunk_size;
                    assert_eq!(
                        payload,
                        &bytes[start..(start + chunk_size).min(bytes.len())],
                        "{context}: chunk {index}"
                    );
                }
            }
            sends if sends.get("endOfWindow").is_some() => {
                let eow = &sends["endOfWindow"];
                assert_eq!(
                    transfer.eows,
                    vec![(number(&eow["round"]), number(&eow["upto"]))],
                    "{context}"
                );
                assert!(transfer.chunks.is_empty() && transfer.probes.is_empty(), "{context}");
            }
            sends if sends.get("probe").is_some() => {
                assert_eq!(transfer.probes.len(), 1, "{context}");
                assert!(transfer.chunks.is_empty() && transfer.eows.is_empty(), "{context}");
            }
            other => panic!("{context}: unknown sends {other}"),
        }
        if let Some(state) = entry.get("state") {
            assert_eq!(bridge.phase(), phase_named(state.as_str().unwrap()), "{context}");
        }
    }
}

#[test]
fn the_bridge_follows_every_case_that_describes_it() {
    let dir = support::datagram_dir();
    let mut ran = Vec::new();
    let mut paths: Vec<_> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).collect();
    paths.sort();
    for path in paths {
        let file = path.file_name().unwrap().to_str().unwrap().to_owned();
        if !file.starts_with("case-") {
            continue;
        }
        let case = read_json(&file);
        if case.get("bridge").is_some() {
            run_bridge_case(&case);
            ran.push(file);
        }
    }
    assert!(
        ran.len() >= 12,
        "expected the bridge cases of the fixtures, got {ran:?}"
    );
}
