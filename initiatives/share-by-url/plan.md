# Initiative: Share a plan by URL

Status: Future

Design notes and size measurements for the "share a plan by URL" item in [../backlog.md](../backlog.md#sharing). Nothing is implemented yet.

---

## Question

How long would a link be for a realistic plan, and is putting the plan in a URL viable?

## URL limits

- **Browsers** accept very long URLs (Chrome about 2 MB; Firefox and current Safari are in the same range or higher).
- **Servers and proxies** cap the path plus query at about 8–16 KB (nginx 8 KB, Cloudflare 16 KB). The `#fragment` is never sent to a server, and the app is static and client-side, so the plan goes in the fragment and these caps do not apply.
- **Where the link is pasted** is the real limit. Discord caps a message at 2,000 characters; some clients truncate or stop auto-linking very long URLs; forums and URL shorteners may reject them.

## Measurements

Sample: [sample-plan-middle-ring.json](sample-plan-middle-ring.json), a 10 % mid-game Seablock export (4 blocks, 57,051 B on disk, 33,910 B minified). Reproduce with `node initiatives/share-by-url/measure-size.mjs [plan.json]`.

| Encoding | Link length (base64url chars) |
|---|---|
| deflate-raw on the JSON as exported | 12,151 |
| brotli on the JSON as exported | 10,430 |
| deflate-raw, UUIDs renumbered to short ids | 5,267 |
| brotli, UUIDs renumbered to short ids | 4,524 |

Where the bytes are (minified JSON): `blocks` 31,518 (`rootPlan` alone about 25 KB), `horizonTechnologyIds` 2,190, everything else under 100.

Plain compression only reaches about 3.7× because the export holds 270 UUID occurrences (229 distinct). They are random, so they do not compress, and they make up roughly 9 KB of the minified JSON. Renumbering them to short ids on encode (and restoring or minting fresh ones on import) more than halves the link.

## Proposed design

- **Encoding:** `CompressionStream('deflate-raw')`, then base64url, in the URL fragment. It is built into browsers, so no dependency. Brotli saves about 700 characters but is not exposed by `CompressionStream`; it would need a WASM dependency.
- **Ids:** renumber the UUIDs to short ids when encoding; import must produce valid ids for the plan schema.
- **Possible further trims:** `horizonTechnologyIds` (2.2 KB) if it can be recomputed on import; any derived data the export carries.
- **Size guard:** when the encoded link exceeds a threshold (about 8 KB), the share action warns and points to file export. Plans under it get a copy-link button.
- **Import:** opens the plan as a new plan, with the same data-set check as a file import.
- **No backend:** a paste-bin or gist backend would give short, size-independent links but conflicts with the client-only design. Revisit only if large plans turn out to matter.

## Open questions

- Is the ceiling acceptable for late-game plans? Extrapolating, a plan with 5× the blocks is about 25 K characters even with short ids.
- Can `horizonTechnologyIds` be derived instead of stored?
