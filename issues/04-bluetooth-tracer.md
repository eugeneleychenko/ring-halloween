# #04 Bluetooth tracer: a Ring event plays a stock clip on the outdoor speaker

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without Eugene) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

The first demoable end-to-end path (Addendum A baseline). A Ring event causes a pre-recorded WAV to play through the Bluetooth speaker paired to the Mac, with the speaker outside the door. Includes everything that makes Bluetooth survive an evening: output device pinning, keep-alive tone, auto-reconnect, lead-in silence, Mac kept awake, built-in speaker as last resort.

## Acceptance criteria

- [ ] `playAudio(wav, {output:'bluetooth'})` plays via `afplay` (or ffplay) with 300 ms of leading silence prepended
- [ ] Output device is pinned with `SwitchAudioSource` before each play and verified; a mismatch is logged and corrected
- [ ] A near-silent keep-alive plays every N minutes (configurable, default 3) so the speaker never sleeps
- [ ] A health check every 30 s reconnects a dropped speaker with `blueutil --connect <address>`; the address comes from `.env`
- [ ] If the speaker is unreachable, audio plays on the Mac's built-in speaker and a warning row is logged
- [ ] Command-to-sound delay measured 10 times and logged; target 0.5 s
- [ ] `npm start` runs under `caffeinate -dimsu` or documents how to

## Blocked by

- [#03 Ring motion and press events received on the Mac with latency logged](03-ring-events-latency.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
