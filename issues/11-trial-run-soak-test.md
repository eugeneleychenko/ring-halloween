# #11 20-trial measurement run and 3-hour soak test

| Field | Value |
|---|---|
| Type | HITL (needs the owner present) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## Scope note 2026-10-31

Nobody is home on Halloween night. The soak test is therefore the most important test in the project: the system must run unattended for the whole evening with no restarts. Add: a watchdog that relaunches the process if it dies, a startup self-check that refuses to start quietly if Ring, speaker, input device, sample rate, Gemini gate or clips are wrong, and a log the owner can read from his phone afterwards.

## What to build

The RFP's measurement deliverable. Someone walks up to the door 20 times (mix of day and night, some with no person to test SKIP) while the system runs unattended; every RFP and Addendum A metric is captured. Then the app runs for 3 hours with the Bluetooth speaker outside to check token persistence, speaker reconnects, and Mac wakefulness. If issue 10 was skipped, the run is Bluetooth-only and the report says so.

## Acceptance criteria

- [ ] `measurements/runs.csv` has 20 trial rows; a script `npm run report` fills every row of the RFP measurements table plus the Addendum A table with median, p95 and success rate
- [ ] Trials include at least 5 night-time and at least 5 no-person triggers
- [ ] Soak test log shows zero unrecovered Bluetooth disconnects, no token re-auth, and events still arriving at hour 3
- [ ] Every failed trial has a one-line failure mode and recovery note
- [ ] Results delivered to the chief of staff for validation before issue 12 starts

## Blocked by

- [#09 Full chain on Bluetooth with cover clip](09-full-chain-bluetooth.md)
- [#10 Doorbell output and both-mode arbitration with continuous audio](10-doorbell-output-arbitration.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
