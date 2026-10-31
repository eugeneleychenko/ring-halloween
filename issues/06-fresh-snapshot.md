# #06 Fresh snapshot within the latency budget

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without Eugene) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

`getFreshSnapshot(event)` returns a JPEG taken after the motion event, trying three routes in parallel and returning the first fresh one: (A) the push notification's `snapshot_uuid` image, (B) a keyframe from the live stream via ffmpeg, (C) a forced `getSnapshot()` accepted only if its `timeMillis` is after the event (wired doorbells only). Saves the image locally with its route and timestamp. Day and night behaviour measured.

## Acceptance criteria

- [ ] Route A waits up to 2 s for the second push on battery cameras and handles a 404 by falling through
- [ ] Route B reuses the live call if one is already open for the speaker; otherwise opens one and grabs the first keyframe
- [ ] Route C is skipped on battery power and on `doorbell_graham_cracker`
- [ ] Each snapshot saved to `snapshots/<ding_id>-<route>.jpg`; `measurements/snapshots.csv` gets `ding_id, route, requested_at, taken_at, received_at, fresh, width, height`
- [ ] At least 10 daytime and 10 night-time snapshots measured; median time and freshness rate reported against the 3 s target
- [ ] Night frames inspected: report whether they are colour or infrared and whether a costume is recognisable to a human

## Blocked by

- [#03 Ring motion and press events received on the Mac with latency logged](03-ring-events-latency.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
