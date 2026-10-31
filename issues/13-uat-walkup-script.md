# #13 UAT: Eugene's walk-up acceptance script

| Field | Value |
|---|---|
| Type | HITL (Eugene at the door, ring-worker at the Mac, ring-CoS validating) |
| Status | ready (checkpoint 1) |
| Assignee | ring-worker (prepares), Eugene (performs) |
| Labels | needs-triage |

## Parent

RFP section 6 (success criteria), Addendum A section A.6. Research: `../feasibility-assessment.md`.

## What to build

A repeatable user-acceptance script that Eugene performs at his own door, with the system running unattended, so he can see and hear how it reacts. The same script runs at three checkpoints as the build matures, each time against a `measurements/uat-<checkpoint>.csv` log and a short written verdict from Eugene.

ring-worker builds `npm run uat -- --checkpoint <1|2|3>`: it starts the system in the right mode, announces (on the Mac screen) each scenario and when to walk, records each trigger with the scenario label, and at the end prints a scorecard. ring-CoS validates the scorecard against the pass criteria below.

### Checkpoint 1: "Does it hear me?" (after #04)

Mode: `output=bluetooth`, stock clip only, no Gemini or ElevenLabs.

| # | Scenario | Expected reaction |
|---|---|---|
| 1 | Walk up to the door normally, stop, wait 10 s | Stock clip plays on the Bluetooth speaker within 6 s |
| 2 | Press the doorbell | Stock clip plays within 6 s |
| 3 | Walk up again 20 s after scenario 1 | Plays again (dedupe does not swallow it) |
| 4 | Walk up again within 10 s of the clip ending | Nothing plays (cooldown), event is logged as suppressed |
| 5 | Walk past at the edge of the camera's view without approaching | Either plays or not; just log what the Ring motion zone does |

### Checkpoint 2: "Does it see me?" (after #09)

Mode: `output=bluetooth`, full chain with cover clip, Malyx voice.

| # | Scenario | Expected reaction |
|---|---|---|
| 1 | Walk up in a clear costume (or holding an obvious prop, e.g. a witch hat) | Cover clip within ~1 s of the event, then a kind comment that names the costume, within 10 s of motion |
| 2 | Walk up in plain clothes | Cover clip, then a comment that stays kind and does not mention body, age, clothing size or identity |
| 3 | Two people walk up together | One cover clip, one comment that addresses the group or one costume; never two comments |
| 4 | No person: roll a ball, wave a broom, or have a car pass | SKIP: cover clip at most, no comment (per the configured SKIP behaviour) |
| 5 | Repeat scenario 1 at night with the porch light on | Same as 1; note whether the frame was colour or infrared |
| 6 | Repeat scenario 1 at night with the porch light off | Report whether the costume was still recognised |
| 7 | Stand still in frame for 30 s | One comment only; no repeats while still |
| 8 | Unplug the Bluetooth speaker mid-scenario, walk up | Plays on the Mac speaker, warning logged, speaker reconnects within 30 s when plugged back in |

### Checkpoint 3: "Would I run this on Halloween?" (after #10 if the doorbell route is go, otherwise after #09)

Mode: `output=both` (or `bluetooth` if the doorbell route failed). Run checkpoint 2 scenarios 1, 3, 4 and 5 again, plus:

| # | Scenario | Expected reaction |
|---|---|---|
| 9 | Walk up; listen for which speaker talks | Exactly one output plays the comment; the decision and reason are in the log |
| 10 | Walk up while Eugene's phone has Ring live view open | Report what happens (conflict or not) |
| 11 | Leave it running 3 hours, then walk up | Still reacts; no re-auth, no speaker drop (overlaps #11 soak) |

## Acceptance criteria

- [ ] `npm run uat -- --checkpoint N` exists, prompts scenario by scenario on screen, and writes `measurements/uat-N.csv` with `checkpoint, scenario, trigger_id, event_received_at, first_audio_at, comment_at, output, gemini_decision, comment_text, pass, eugene_note`
- [ ] Checkpoint 1: scenarios 1-4 behave as expected; 5 is logged
- [ ] Checkpoint 2: 1, 2, 3, 4, 7, 8 behave as expected; 5 and 6 are logged with a colour/infrared note; every comment text is kind and family-friendly on Eugene's read
- [ ] Checkpoint 3: 9 behaves as expected; 10 and 11 are logged; Eugene answers "would I run this on Halloween night?" yes or no, with one sentence why
- [ ] The scorecard for each checkpoint is sent to ring-CoS with the CSV and Eugene's notes; ring-CoS records the verdict in this file's Validation log

## Blocked by

- Checkpoint 1: [#04 Bluetooth tracer](04-bluetooth-tracer.md)
- Checkpoint 2: [#09 Full chain on Bluetooth](09-full-chain-bluetooth.md)
- Checkpoint 3: [#10 Doorbell output and both-mode](10-doorbell-output-arbitration.md), or #09 if #10 is skipped

The `npm run uat` command itself can be built as soon as #01 is done (it is a thin wrapper over the pipeline's logging), so ring-worker may start it any time; Status flips to `ready` for checkpoint 1 when #04 is done.

## Validation log

_Chief of staff fills this in, one entry per checkpoint._
