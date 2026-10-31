# #10 Doorbell output and both-mode arbitration with continuous audio

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without Eugene) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

Adds `output: doorbell` and `output: both` to the full chain. On an event the live call opens immediately, in parallel with the AI steps. The audio player feeds one continuous input (WAV header, cover clip, silence, comment) into a single ffmpeg process so the call does not end between clips. In `both` mode, Bluetooth plays by default and the doorbell takes over only if its speaker is ready before a deadline; the same comment never plays at the door twice. Only worth doing if issue 5 is go or conditional.

## Acceptance criteria

- [ ] Live call opens at event time; `session_open_ms` logged
- [ ] Cover clip and comment play through the doorbell in one call with no premature hang-up
- [ ] `both` mode: a deadline setting (default 5 s) decides the output; the decision and reason are logged per trigger
- [ ] Zero duplicate plays over 10 staged runs in `both` mode
- [ ] Battery session cap respected: total session length stays under 25 s and the call is closed explicitly
- [ ] Cooldown from issue 3 blocks the next trigger until the call has closed

## Blocked by

- [#05 Doorbell speaker probe and go/no-go](05-doorbell-speaker-probe.md)
- [#09 Full chain on Bluetooth with cover clip](09-full-chain-bluetooth.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
