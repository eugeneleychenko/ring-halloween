# #02 Ring auth and device inventory

| Field | Value |
|---|---|
| Type | HITL (needs Eugene present) |
| Status | ready |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

`npm run auth` walks Eugene through Ring login (email, password, 2FA code) once and stores the refresh token locally. `npm run devices` lists every Ring device with `id`, `description`, `kind`, model, `power_mode` (battery/wired), firmware, and whether live view is disabled by the current Mode or E2EE is on.

Ring credentials: Eugene's Ring login is stored in 1Password; the item link is in `../.env` as `RING_1PASSWORD_ITEM`. Open it with Claude in Chrome (the browser extension) when the auth script is ready, and ask Eugene for the 2FA code at that moment. Do not search his other files for credentials.

## Acceptance criteria

- [ ] `npm run auth` succeeds and writes `ring-token.json`; re-running does not require 2FA again
- [ ] Token is re-saved on every `onRefreshTokenUpdated`; a restart after an hour still receives events (verified in issue 3)
- [ ] `controlCenterDisplayName` is set to `ring-halloween-mac` so the client is identifiable in Ring Control Center
- [ ] `npm run devices` prints the doorbell's `kind`, model name, power mode, and flags for `live_view_disabled` and E2EE
- [ ] The doorbell model and power type are reported to the chief of staff and recorded in `measurements/device.json`

## Blocked by

- [#01 Project scaffold, config loading and measurements CSV](01-scaffold-config-measurements.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
