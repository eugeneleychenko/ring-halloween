# #01 Project scaffold, config loading and measurements CSV

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without Eugene) |
| Status | done |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

A runnable Node.js project at `Ring_Halloween/ring-halloween/` that a non-developer can start on a Mac. `npm start` loads config from a gitignored `.env`, prints which outputs and services are enabled, and appends one row to `measurements/runs.csv` for every trigger (even stubbed ones). This is the spine every later slice hangs on.

Stub modules for `ring`, `snapshot`, `gemini`, `tts`, and `audio` with the agreed interfaces: `onTrigger(event)`, `getFreshSnapshot(event) -> {jpegBuffer, takenAt}`, `generateComment(jpeg) -> {decision:'COMMENT'|'SKIP', comment}`, `synthesize(text) -> wavPath`, `playAudio(input, {output:'bluetooth'|'doorbell'|'both'})`. A `npm run simulate` command fires a fake trigger through the whole stubbed chain and writes a CSV row.

## Acceptance criteria

- [x] `.nvmrc` pins Node 24.22.x; README says why Node 26 is not supported
- [x] `package.json` installs `ring-client-api` from GitHub `main`, or from npm 14.3.0 with `overrides` forcing `@eneris/push-receiver` 4.4.0; `npm ls @eneris/push-receiver` shows 4.4.0
- [x] `.env.example` lists every setting; `.env`, `ring-token.json`, `snapshots/`, `measurements/` are in `.gitignore`
- [x] `npm run simulate` writes a CSV row with columns: `trigger_id, trigger_at, event_received_at, snapshot_at, snapshot_route, gemini_ms, gemini_decision, tts_ms, output, session_open_ms, first_audio_at, success, error`
- [x] README covers install, config, and `npm run simulate`, in plain language

## Blocked by

None - can start immediately

## Validation log

**2026-10-31, ring-CoS: DONE.** Independently verified: `.nvmrc` 24.22.2 and `bin/node24` shim; `npm ls` shows push-receiver 4.4.0 overridden; `.gitignore` covers .env, ring-token.json, snapshots/, measurements/; no git repo initialised; `npm run simulate` wrote a well-formed row with all 13 columns; `npm start` without a token explains the next step and exits cleanly; README 398 words, plain language; grep for key patterns in README/src/test: 0 hits.

Notes carried forward:
- Flaky test: `test/doorbell-audio.test.js` "two clips play in one continuous PCMU call" failed 1 of 4 runs (leading silence measured 243 ms vs a 250-400 ms window). Wall-clock assertions on a real-time encoder are timing-sensitive. Fix under #10 (or earlier): assert on RTP packet counts / payload bytes of silence rather than wall-clock deltas, or widen the window. Suite must be green on 5 consecutive runs before #10 is validated.
- Deviation accepted: npm 14.3.0 + override instead of GitHub `main`; the worker added its own ping/pong keepalive in `src/live-session.js`, untested against Ring. #03/#05 must confirm sessions survive past 30 s.
- README "non-developer has followed it" is deferred to #12.
