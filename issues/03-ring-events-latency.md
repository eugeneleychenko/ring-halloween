# #03 Ring motion and press events received on the Mac with latency logged

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without Eugene) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

Running `npm start`, a walk-up or doorbell press produces a trigger event in the app within seconds. Each event is logged with the Mac's receive time, Ring's `triggered_at` and `eventito.timestamp`, the event category, `ding.id`, and whether a `snapshot_uuid` was attached. Duplicates are collapsed on `ding.id`. A cooldown suppresses new triggers while an audio session is active.

## Acceptance criteria

- [ ] Uses `onNewNotification`, not `onMotionStarted`; two walk-ups 20 s apart both fire
- [ ] Each event appends a row to `measurements/events.csv` with `received_at, triggered_at, delay_ms, category, ding_id, has_snapshot_uuid`
- [ ] Delay is measured over at least 20 events (press events are the cleanest); median and p95 reported to the chief of staff against the RFP target of 3 s
- [ ] A second push for the same `ding.id` (battery cameras) is merged into the first event, not fired twice
- [ ] Cooldown setting (default 15 s) prevents a trigger while `playAudio` is running; suppressed events are still logged

## Blocked by

- [#02 Ring auth and device inventory](02-ring-auth-device-inventory.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
