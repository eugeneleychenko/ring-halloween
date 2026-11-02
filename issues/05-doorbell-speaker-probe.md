# #05 Doorbell speaker probe and go/no-go

| Field | Value |
|---|---|
| Type | HITL (needs the owner present) |
| Status | validate |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

The RFP's highest-risk item, tested in isolation. `npm run probe-speaker` opens a Ring live call, waits for `camera_connected`, activates the camera speaker, plays a fixed WAV through the doorbell, and ends the call. It logs the negotiated codec (Opus or PCMU), time from command to speaker-ready, time to first RTP packet, and success or failure reason. Someone must stand at the door to judge loudness and whether the first or last syllable is clipped.

Report to the chief of staff after the first 5 tries, then complete 20 tries at least 30 s apart.

## Acceptance criteria

- [ ] (deferred to just before #11, unattended) `npm run probe-speaker --tries 20` runs unattended and appends rows to `measurements/speaker.csv`: `try, started_at, codec, session_open_ms, first_rtp_ms, success, error`
- [x] Handles `startLiveCall()` throwing on `live_view_disabled` with a clear message
- [x] Audio is padded with 300 ms leading and 700 ms trailing silence; the player keeps a single ffmpeg input open so the call does not end mid-clip
- [x] Human rating per try recorded: audible at 2 m yes/no, clipped start yes/no, clipped end yes/no
- [x] Summary to the chief of staff: success rate, median and p95 session open, codec, loudness verdict, and a go / no-go / conditional recommendation

## Blocked by

- [#02 Ring auth and device inventory](02-ring-auth-device-inventory.md)

## Validation log

**2026-10-31, ring-CoS: CONDITIONAL GO, closed by the owner's decision.** Ring Video Doorbell Pro (lpd_v2, wired). Two-way talk via ring-client-api 14.3.0 WebRTC path works: 10 of 10 tries (1 single + 5 batch + 5 A/B) sent the full clip; codec Opus 48 kHz stereo (no PCMU); session open median ~0.96 s on the batch, 0.83-1.73 s overall, against a 5 s target; first RTP 0.39-0.74 s; Ring's server reported 0% loss and 6-9 ms jitter; a 48.6 s call survived past the 30 s mark on 14.3.0. The owner heard the whole clip each time: no start or end clipping. Defects: audible but quiet at 2 m (app speaker volume already at max 11), and crackle/dropouts that persist across -14 LUFS vs mastered (-11.7 LUFS) copies and with video on or off; the sender leg to Ring's server measures clean, so the fault is downstream (Ring to doorbell, decoder, or the 2016 speaker) and cannot be measured from the Mac. The owner's call: not worth chasing; **Bluetooth speaker is the primary voice**, doorbell stays as an option. 20-try unattended batch deferred to before #11 for the report's success-rate figure. #10 scope reduced: default output bluetooth; doorbell/both remain config options, no further tuning.
