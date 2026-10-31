# #08 ElevenLabs TTS module and pre-generated clip bank

| Field | Value |
|---|---|
| Type | AFK (can be built and verified without Eugene) |
| Status | in-progress |
| Assignee | ring-worker |
| Labels | needs-triage |

## Parent

RFP: `../ring-halloween-rfp.docx` (scope items 1-7, Addendum A). Research: `../feasibility-assessment.md`, `../research/`.

## What to build

`synthesize(text)` returns a loudness-normalised WAV in Eugene's chosen voice in under 1.5 s. `npm run build-clips` pre-generates and normalises the clip bank: 3 to 5 cover clips ("Ooh, who's this?"), 10 to 20 generic fallback compliments, and a stock error line. Streaming variant writes PCM into a pipe for issue 10.

ElevenLabs key and voice ID are available as `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` in `../.env` (copied from an existing project; confirm both still work, and confirm with the chief of staff that this voice is the one Eugene wants).

## Acceptance criteria

- [ ] Model `eleven_flash_v2_5`; output `wav_24000` for files, `pcm_24000` for the stream variant; base URL pins the US region
- [ ] Every clip normalised with ffmpeg `loudnorm` to -14 LUFS, -1 dBTP, high-passed at 200 Hz, 300 ms leading silence
- [ ] `npm run build-clips` writes `clips/cover-*.wav`, `clips/fallback-*.wav`, `clips/error.wav` and a manifest
- [ ] Generation time measured over 20 lines and logged; p50 and p95 reported against 1.5 s
- [ ] If the voice is a Professional Voice Clone, `use_pvc_as_ivc` is tried and the latency difference recorded
- [ ] Plan tier and monthly character budget noted in README

## Blocked by

- [#01 Project scaffold, config loading and measurements CSV](01-scaffold-config-measurements.md)

## Validation log

_Chief of staff fills this in. Status moves ready -> in-progress -> validate -> done._
