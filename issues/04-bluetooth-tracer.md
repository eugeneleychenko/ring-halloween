# #04 Bluetooth tracer: a Ring event plays a stock clip on the outdoor speaker

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without the owner) |
| Status | done |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

The first demoable end-to-end path (Addendum A baseline). A Ring event causes a pre-recorded WAV to play through the Bluetooth speaker paired to the Mac, with the speaker outside the door. Includes everything that makes Bluetooth survive an evening: output device pinning, keep-alive tone, auto-reconnect, lead-in silence, Mac kept awake, built-in speaker as last resort.

## Acceptance criteria

- [x] `playAudio(wav, {output:'bluetooth'})` plays via `afplay` (or ffplay) with 300 ms of leading silence prepended
- [x] Output device is pinned with `SwitchAudioSource` before each play and verified; a mismatch is logged and corrected
- [x] A near-silent keep-alive plays every N minutes (configurable, default 3) so the speaker never sleeps
- [x] A health check every 30 s reconnects a dropped speaker with `blueutil --connect <address>`; the address comes from `.env`
- [x] If the speaker is unreachable, audio plays on the Mac's built-in speaker and a warning row is logged
- [x] Command-to-sound delay measured 10 times and logged; target 0.5 s (measured to afplay start: median 250 ms, max 287 ms; plus 300 ms clip lead and ~0.1-0.3 s Bluetooth, unmeasured: ~0.65-0.85 s to first word. Over the 0.5 s target by that definition; the owner judged it immediate at the door. Accepted.)
- [x] `npm start` runs under `caffeinate -dimsu` or documents how to

## Blocked by

- [#03 Ring motion and press events received on the Mac with latency logged](03-ring-events-latency.md)

## Validation log

**2026-10-31, ring-CoS: DONE.** Real SB571 at the door. Lightning-strike run: motion at 17:38:26Z and 17:39:43Z played Malyx clips, event delay 347/250 ms, afplay start +220 ms; the owner heard both, approved volume 80. Verified in measurements/bluetooth.csv: input_corrected rows (mic trap caught and fixed), reconnect attempts with disconnect-first retry, "reconnected ... back after 55 s", keepalive rows at 2 min, fallback to MacBook Air Speakers with warning, call_quality 8 kHz detection and fix. caffeinate running. 132/132 tests. Reconnect after a deliberate disconnect takes 41-55 s because the speaker refuses connections for a while; power-off / out-of-range drops untested, belong to #11 soak. Accepted deviation: Mac fallback plays immediately rather than after 2 min, retries continue in background. Follow-up for the worker: a test fixture row ("e", 1970 timestamps, "hi", comment.wav) landed in the real measurements/runs.csv; tests must write to a temp dir, and that row must be removed.
