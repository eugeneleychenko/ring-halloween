# Ring Halloween issues

Vertical slices of the RFP and Addendum A. Each issue is a complete, demoable path; prefer finishing one over starting several.

## Workflow

- **ring-worker** picks the lowest-numbered issue whose status is `ready`, sets Status to `in-progress` in the issue file, builds it, ticks the acceptance criteria it has verified, sets Status to `validate`, and messages the chief-of-staff session (`ring-CoS`) with evidence (CSV rows, log excerpts, screenshots).
- **ring-CoS** validates against the acceptance criteria, writes the outcome in the Validation log, sets Status to `done` or back to `in-progress` with notes, and flips dependants from `blocked` to `ready`.
- HITL issues need the owner; the worker builds as far as possible, then states exactly what is needed and stops.
- Issues #07 and #08 can run in parallel with #02-#06 once API keys are available.
- 2026-10-31 decision: nobody home on the night; motion-only trigger; unattended operation and the #11 soak test are the priority.
- 2026-10-31 decision: doorbell speaker is a conditional go (works, quiet, crackly). Bluetooth speaker is the primary output for the night; doorbell/both stay as options.
- #13 is the owner's UAT script. It runs three times: after #04 (does it hear me), after #09 (does it see me), after #10 or #09 (would I run it on Halloween). The `npm run uat` wrapper can be built any time after #01.

## Board

| Issue | Type | Status | Blocked by |
|---|---|---|---|
| [#01 Project scaffold, config loading and measurements CSV](01-scaffold-config-measurements.md) | AFK | done | - |
| [#02 Ring auth and device inventory](02-ring-auth-device-inventory.md) | HITL | done | #01 |
| [#03 Ring motion and press events received on the Mac with latency logged](03-ring-events-latency.md) | AFK | ready | #02 |
| [#04 Bluetooth tracer: a Ring event plays a stock clip on the outdoor speaker](04-bluetooth-tracer.md) | AFK | done | #03 |
| [#05 Doorbell speaker probe and go/no-go](05-doorbell-speaker-probe.md) | HITL | done (conditional) | #02 |
| [#06 Fresh snapshot within the latency budget](06-fresh-snapshot.md) | AFK | blocked | #03 |
| [#07 Gemini costume comment module with SKIP evaluation harness](07-gemini-comment-module.md) | AFK | done | #01 |
| [#08 ElevenLabs TTS module and pre-generated clip bank](08-elevenlabs-tts-clip-bank.md) | AFK | done | #01 |
| [#09 Full chain on Bluetooth with cover clip](09-full-chain-bluetooth.md) | AFK | blocked | #04, #06, #07, #08 |
| [#10 Doorbell output and both-mode arbitration with continuous audio](10-doorbell-output-arbitration.md) | AFK | blocked | #05, #09 |
| [#11 20-trial measurement run and 3-hour soak test](11-trial-run-soak-test.md) | HITL | blocked | #09, #10 |
| [#12 Feasibility report, non-developer README, and demo video](12-report-readme-video.md) | HITL | blocked | #11 |
| [#13 UAT: The owner's walk-up acceptance script](13-uat-walkup-script.md) | HITL | ready (cp1) | #04 (cp1), #09 (cp2), #10 or #09 (cp3) |
| [#14 Visitor log: what the camera saw and what Malyx said](14-visitor-log.md) | AFK | blocked | #09 (generator can start now) |

## Dependency graph

```
#01 scaffold
 ├─ #02 ring auth (HITL) ── #03 events ── #04 bluetooth tracer ─┐
 │                       │             └─ #06 snapshot ─────────┤
 │                       └─ #05 speaker probe (HITL) ──┐        ├─ #09 full chain (Bluetooth)
 ├─ #07 gemini ─────────────────────────────────────────┼────────┤        │
 └─ #08 elevenlabs ─────────────────────────────────────┘        │        │
                                                       └── #10 doorbell + both ──┤
                                                                                #11 trials + soak (HITL)
                                                                                 └─ #12 report + video (HITL)
#13 UAT script (HITL) runs after #04, again after #09, again after #10
```
