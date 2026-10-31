# #07 Gemini costume comment module with SKIP evaluation harness

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without Eugene) |
| Status | in-progress |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

`generateComment(jpeg)` sends a downscaled snapshot to Gemini and returns `{decision:'COMMENT'|'SKIP', comment}` in under 2 s, with the kind-and-family-friendly rules enforced by system instruction, structured output, safety settings, and a local post-filter. `npm run eval-gemini` runs a labelled folder of frames and reports SKIP accuracy, person recall, word-count compliance, and p50/p95 latency.

Gemini key is available as `GEMINI_API_KEY` in `../.env` (copied from an existing project; confirm it still works and whether its project has billing enabled). Build and test against a public sample image set, then real snapshots once issue 6 lands.

## Acceptance criteria

- [ ] Model `gemini-3.5-flash-lite` with `thinking_level: minimal`, `media_resolution: low`, image downscaled to 768 px JPEG; model and settings are config values
- [ ] Structured output schema with `decision` before `comment`; `comment` 25 words or fewer; harassment and hate-speech safety set to `block_low_and_above`
- [ ] Post-filter rejects comments mentioning body, weight, age, race, skin, hair, attractiveness, or a person's identity; rejection falls back to a stock line and is logged
- [ ] 2.5 s client timeout; timeout returns a stock-line decision and is logged
- [ ] `npm run eval-gemini <folder>` reads `label.csv` (`file, person_visible`) and prints SKIP specificity, person recall, mean word count, p50/p95 latency
- [ ] Warm-up request on startup and every 5 minutes
- [ ] Gemini project billing status confirmed and recorded in README (free tier allows human review of inputs)

## Blocked by

- [#01 Project scaffold, config loading and measurements CSV](01-scaffold-config-measurements.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
