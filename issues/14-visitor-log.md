# #14 Visitor log: what the camera saw and what Malyx said

| Field | Value |
|---|---|
| Type | AFK |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP section 2 ("log the snapshot, comment, and timings") and section 7 (privacy: snapshots stay on the local Mac, nothing is posted or shared). Requested by the owner 2026-10-31.

## What to build

A browsable, local-only visitor log the owner can open after the night (or glance at from his phone on the home network) showing, for every trigger: the snapshot the camera took, what Gemini decided (COMMENT or SKIP, the costume label), the exact line that was spoken, which clip or TTS file played, which output it played on, and the key timings. Newest first. Clicking an entry plays the audio that was spoken.

Two surfaces:
1. **`npm run log`** regenerates `measurements/visitors.html`, a single self-contained page (thumbnails inline or relative links to `snapshots/`), with a summary header: total triggers, comments vs SKIPs vs fallbacks, median motion-to-first-audio, errors.
2. **`npm run log -- --serve`** serves the same page on the LAN (e.g. `http://<mac>.local:8471/`) with the page refreshing itself every 30 s, so the owner can watch it on his phone during the evening. LAN only, no auth beyond that, documented as such; never exposed outside the home network.

Each entry shows: local time, thumbnail (click for full size), decision badge, costume label, comment text (or "SKIP" / "fallback: <clip name>"), output (bluetooth / doorbell / mac), and three numbers: motion to event, event to first audio, Gemini ms. Entries with errors show the error column.

Data source is `runs.csv` plus the snapshot files and the saved TTS or clip file per run. The pipeline must therefore persist, per trigger: `snapshot_path`, `comment_text`, `audio_path`, `costume_label`. Add those columns to `runs.csv` (keep existing columns in place; append the new ones at the end).

Privacy: everything stays under `ring-halloween/measurements/` and `snapshots/`, which are gitignored. The page must not embed external scripts or fonts, so opening it never calls out to the internet. A `npm run log -- --purge --older-than 7d` deletes snapshots and audio older than N days.

## Acceptance criteria

- [ ] `runs.csv` gains `snapshot_path, costume_label, comment_text, audio_path` columns, populated on every real trigger (empty on SKIP where appropriate)
- [ ] `npm run log` writes `measurements/visitors.html`; opening it offline shows every trigger with thumbnail, decision, costume label, comment text, output and timings, newest first
- [ ] Clicking a thumbnail opens the full snapshot; clicking a play button plays the audio that was spoken for that trigger
- [ ] Summary header shows counts (triggers, comments, SKIPs, fallbacks, errors) and median motion-to-first-audio
- [ ] `npm run log -- --serve` serves the page on the LAN and it auto-refreshes; the owner can open it on his phone
- [ ] The page loads no external resources (verified by grepping the HTML for `http`)
- [ ] `--purge --older-than` deletes old snapshots and audio and is documented in the README
- [ ] the owner reviews the page after a few real walk-ups and confirms it shows what he expects

## Blocked by

- [#09 Full chain on Bluetooth](09-full-chain-bluetooth.md) for real comments and snapshots. The HTML generator and the CSV columns can be built now against the clip-only triggers (snapshot and comment columns empty or "canned").

## Validation log

_Chief of staff fills this in._
