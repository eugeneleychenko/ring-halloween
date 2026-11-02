# #07 Gemini costume comment module with SKIP evaluation harness

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without the owner) |
| Status | done |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

`generateComment(jpeg)` sends a downscaled snapshot to Gemini and returns `{decision:'COMMENT'|'SKIP', comment}` in under 2 s, with the kind-and-family-friendly rules enforced by system instruction, structured output, safety settings, and a local post-filter. `npm run eval-gemini` runs a labelled folder of frames and reports SKIP accuracy, person recall, word-count compliance, and p50/p95 latency.

Gemini key is available as `GEMINI_API_KEY` in `../.env` (copied from an existing project; confirm it still works and whether its project has billing enabled). Build and test against a public sample image set, then real snapshots once issue 6 lands.

## Acceptance criteria

- [x] Model `gemini-3.5-flash-lite` with `thinking_level: minimal`, `media_resolution: low`, image downscaled to 768 px JPEG; model and settings are config values
- [x] Structured output schema with `decision` before `comment`; `comment` 25 words or fewer; harassment and hate-speech safety set to `block_low_and_above`
- [x] Post-filter rejects comments mentioning body, weight, age, race, skin, hair, attractiveness, or a person's identity; rejection falls back to a stock line and is logged
- [x] 2.5 s client timeout; timeout returns a stock-line decision and is logged
- [x] `npm run eval-gemini <folder>` reads `label.csv` (`file, person_visible`) and prints SKIP specificity, person recall, mean word count, p50/p95 latency
- [x] Warm-up request on startup and every 5 minutes
- [x] Gemini project billing status confirmed and recorded in README (free tier allows human review of inputs)

## Blocked by

- [#01 Project scaffold, config loading and measurements CSV](01-scaffold-config-measurements.md)

## Validation log

**2026-10-31, ring-CoS: DONE, one criterion open.** Verified: settings in src/gemini.js (3.5-flash-lite, thinkingLevel minimal, media resolution low, safety BLOCK_LOW_AND_ABOVE, 2.5 s timeout, stock fallback, warm-up); 17-line deny-list; billing gate `GEMINI_BILLING_CONFIRMED` in config with door snapshots withheld until true; 82/82 tests x3. Eval on 54 public images (colour + simulated grey, x2): SKIP specificity 100%, recall 96.6%, p50 1.14 s, p95 1.47 s. Accepted the worker's prompt revision (binary human-present test) and synced it into docs/personality.md section 3. Billing: The owner confirmed a paid Cloud Billing account on 2026-10-31 (AI Studio billing page); GEMINI_BILLING_CONFIRMED=true set in .env. the ≥100 real empty Ring frames wait on #06. Follow-up for #09: pass last comment into the prompt to reduce "Behold/magnificent" repeats.
