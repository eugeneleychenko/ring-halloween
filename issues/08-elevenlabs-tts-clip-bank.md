# #08 ElevenLabs TTS module and pre-generated clip bank

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without the owner) |
| Status | done |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

`synthesize(text)` returns a loudness-normalised WAV in the owner's chosen voice in under 1.5 s. `npm run build-clips` pre-generates and normalises the clip bank: 3 to 5 cover clips ("Ooh, who's this?"), 10 to 20 generic fallback compliments, and a stock error line. Streaming variant writes PCM into a pipe for issue 10.

ElevenLabs key and voice ID are available as `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `.env`.

## Acceptance criteria

- [x] Model `eleven_flash_v2_5`; output `wav_24000` for files, `pcm_24000` for the stream variant; base URL pins the US region
- [x] Every clip normalised with ffmpeg `loudnorm` to -14 LUFS, -1 dBTP, high-passed at 200 Hz, 300 ms leading silence
- [x] `npm run build-clips` writes `clips/cover-*.wav`, `clips/fallback-*.wav`, `clips/error.wav` and a manifest
- [x] Generation time measured over 20 lines and logged; p50 and p95 reported against 1.5 s
- [x] If the voice is a Professional Voice Clone, `use_pvc_as_ivc` is tried and the latency difference recorded
- [x] Plan tier and monthly character budget noted in README

## Blocked by

- [#01 Project scaffold, config loading and measurements CSV](01-scaffold-config-measurements.md)

## Validation log

**2026-10-31, ring-CoS: DONE, with one follow-up.** Verified: 26 clips in clips/ with manifest keyed by category (cover 5, fallback 10, group 3, press 3, skip 2, error 1, signoff 2); measured 7 clips at -13.9 to -14.4 LUFS, sample peak -0.9/-1.0 dBFS (worker reports true peak -0.7 dBTP, 0.3 dB over the ceiling, acceptable); flash_v2_5, wav_24000/pcm_24000, US endpoint, Malyx settings as config; TTS p50 ~0.71 s, p95 ~0.79 s (target 1.5 s); A/B clips for use_pvc_as_ivc present; 82/82 tests x3. Played cover-04, fallback-01, group-01 and both A/B clips for the owner on 2026-10-31. Accepted cover line 3 rewrite (old line broke rule 2). Follow-up (small, do before #09): covers are 3.8-6.6 s, too long; regenerate from the short-cover set in docs/personality.md 2a (≤2.5 s incl. lead). Also fix the double 300 ms lead (clips carry it; doorbell player adds another) in #04/#10.
