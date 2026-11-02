# #09 Full chain on Bluetooth with cover clip

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without the owner) |
| Status | blocked |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

The Addendum A baseline, complete. A Ring event triggers: cover clip starts on the Bluetooth speaker immediately; in parallel the fresh snapshot goes to Gemini, the comment goes to ElevenLabs, and the comment plays after the cover clip with no gap or overlap. SKIP plays nothing beyond the cover clip (configurable). Every step's timing lands in `measurements/runs.csv`. Gemini failure plays a fallback clip; snapshot failure plays a fallback clip.

## Acceptance criteria

- [ ] Cover clip starts within 1 s of the event being received
- [ ] Comment follows the cover clip in the same playback queue; never plays twice; never overlaps
- [ ] `gemini_decision=SKIP` behaviour is configurable: silence, or a generic fallback clip
- [ ] Any step failure falls back to a clip and is recorded in the `error` column; the app never crashes on a trigger
- [ ] 10 staged walk-ups logged with motion-to-first-audio and motion-to-comment; both reported against targets of 6 s and 10 s
- [ ] Measurements CSV columns from issue 1 are all populated on a successful run

## Blocked by

- [#04 Bluetooth tracer: a Ring event plays a stock clip on the outdoor speaker](04-bluetooth-tracer.md)
- [#06 Fresh snapshot within the latency budget](06-fresh-snapshot.md)
- [#07 Gemini costume comment module with SKIP evaluation harness](07-gemini-comment-module.md)
- [#08 ElevenLabs TTS module and pre-generated clip bank](08-elevenlabs-tts-clip-bank.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
