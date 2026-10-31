# #05 Doorbell speaker probe and go/no-go

| Field | Value |
|---|---|
| Type | HITL (needs Eugene present) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

The RFP's highest-risk item, tested in isolation. `npm run probe-speaker` opens a Ring live call, waits for `camera_connected`, activates the camera speaker, plays a fixed WAV through the doorbell, and ends the call. It logs the negotiated codec (Opus or PCMU), time from command to speaker-ready, time to first RTP packet, and success or failure reason. Someone must stand at the door to judge loudness and whether the first or last syllable is clipped.

Report to the chief of staff after the first 5 tries, then complete 20 tries at least 30 s apart.

## Acceptance criteria

- [ ] `npm run probe-speaker --tries 20` runs unattended and appends rows to `measurements/speaker.csv`: `try, started_at, codec, session_open_ms, first_rtp_ms, success, error`
- [ ] Handles `startLiveCall()` throwing on `live_view_disabled` with a clear message
- [ ] Audio is padded with 300 ms leading and 700 ms trailing silence; the player keeps a single ffmpeg input open so the call does not end mid-clip
- [ ] Human rating per try recorded: audible at 2 m yes/no, clipped start yes/no, clipped end yes/no
- [ ] Summary to the chief of staff: success rate, median and p95 session open, codec, loudness verdict, and a go / no-go / conditional recommendation

## Blocked by

- [#02 Ring auth and device inventory](02-ring-auth-device-inventory.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
