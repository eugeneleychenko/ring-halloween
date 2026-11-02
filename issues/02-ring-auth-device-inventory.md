# #02 Ring auth and device inventory

| Field | Value |
|---|---|
| Type | HITL (needs the owner present) |
| Status | done |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

`npm run auth` walks the owner through Ring login (email, password, 2FA code) once and stores the refresh token locally. `npm run devices` lists every Ring device with `id`, `description`, `kind`, model, `power_mode` (battery/wired), firmware, and whether live view is disabled by the current Mode or E2EE is on.

Ring credentials: the owner signs in interactively with `npm run auth` (email, password, 2FA). Nothing but the refresh token is stored, in `ring-token.json`, which is gitignored.

## Acceptance criteria

- [x] `npm run auth` succeeds and writes `ring-token.json`; re-running does not require 2FA again
- [ ] Token is re-saved on every `onRefreshTokenUpdated`; a restart after an hour still receives events (verified in issue 3)
- [x] `controlCenterDisplayName` is set to `ring-halloween-mac` so the client is identifiable in Ring Control Center
- [x] `npm run devices` prints the doorbell's `kind`, model name, power mode, and flags for `live_view_disabled` and E2EE
- [x] The doorbell model and power type are reported to the chief of staff and recorded in `measurements/device.json`

## Blocked by

- [#01 Project scaffold, config loading and measurements CSV](01-scaffold-config-measurements.md)

## Validation log

**2026-10-31, ring-CoS: DONE.** The owner ran `npm run auth` in Terminal.app (the `!` prefix in Claude Code has no TTY; README updated to say so). `ring-token.json` exists, mode 600, 1274 bytes. `npm run devices` ran without prompting (token path works) and wrote `measurements/device.json`. Front Door: model "Doorbell Pro", kind `lpd_v2` (Ring Video Doorbell Pro, 1st gen), wired, no battery, canTakeSnapshotWhileRecording=true, live_view_disabled=false, motion on, E2EE off (encryption_group id null), online. Hourly token-refresh persistence is left open for #03 to prove over a long run.
