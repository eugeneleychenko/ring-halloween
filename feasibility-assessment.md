# Ring Halloween RFP: Desk Feasibility Assessment

Date: 2026-10-31. Produced by four parallel research passes (Ring speaker route, Ring events and snapshots, Gemini and ElevenLabs, end-to-end budget and risk). Desk research only: source code, issue trackers, vendor docs, and npm as of today. **Nothing was run on hardware. Every number below is an estimate or a sourced report, not a measurement.** Detailed reports with URLs and per-claim verification tags are in `research/`.

## 1. Bottom line

| Question | Answer | Confidence |
|---|---|---|
| Can audio play through the Ring doorbell speaker from a Mac? | **Probably yes** | ~80% |
| Will it pass the RFP bar (18/20 trials, comment within 8 s of motion)? | **Unlikely as written**; ~50% wired, ~35% battery for the speaker step alone; ~30–40% wired for the full chain without a cover clip | Low-medium |
| Will a pre-recorded cover clip play within 8 s? | **Likely on wired** | ~65–75% |
| Will the Bluetooth-speaker partial pass work? | **Yes** | ~90% |
| Gemini ≤2 s and ElevenLabs ≤1.5 s? | **Yes, with the right settings** | High |

The architecture is sound. What makes the 8 s target hard is that the three slow steps (event delivery, fresh snapshot, talk-session open) are all on the Ring side and all land at 2–5 s each. The RFP's success criterion should be read as a stretch goal; a cover clip within ~6 s and the real comment within ~10 s is the realistic win.

## 2. Go / no-go by RFP scope item

| # | Scope item | Verdict | Key finding |
|---|---|---|---|
| 1 | Ring connection, motion and press events | **Conditional go** | **Day-1 blocker:** events are broken in the current npm release `ring-client-api@14.3.0`. An Oct 2026 Google push-header change makes every push fail to decrypt (`ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY`). Fix: npm override `@eneris/push-receiver` to 4.4.0, or install from GitHub `main`. Also: **Node 26 breaks auth** as of this week; pin Node 24.22.x. Expected delay: wired ~0.5–2.5 s (passes ≤3 s), battery ~2–6 s (borderline). |
| 2 | Snapshot quality and freshness | **Conditional** | Wired, or battery with a Ring Protect plan and Rich Notifications on: fresh image via the push's `snapshot_uuid` in ~1–3 s (passes). Battery without a plan: on-demand snapshots are stale for 30–40 s after motion; only route is a frame from the live stream at ~3–6 s (misses ≤3 s, fits 8 s overall). The UUID fetch can 404, so needs a fallback. |
| 3 | Doorbell speaker (highest risk) | **Conditional go** | Mechanism exists and is current in `main`: `startLiveCall()` → `activateCameraSpeaker()` → `transcodeReturnAudio()`. Maintainer confirmed it works (Jan 2026); an independent developer reported file playback working on a real doorbell for months (ring-mqtt PR #1098, June 2026). No 2025–26 reports of Ring breaking return audio. Session open: wired ~2–4 s, battery ~3–6 s. Per-attempt success: wired ~80–95%, battery ~65–85%. |
| 4 | Gemini vision | **Conditional go** | Use `gemini-3.5-flash-lite`, `thinking_level: "minimal"`, `media_resolution: "low"`, 768 px JPEG, structured output `{decision: COMMENT|SKIP, comment}`. Median ~0.6–1.3 s, p95 ~1.5–2.5 s. Set a 2.5 s timeout with stock-line fallback. SKIP accuracy on infrared night frames has no published evidence; must be measured on ≥100 empty frames from this camera. |
| 5 | ElevenLabs voice | **Go** | `eleven_flash_v2_5`, ~75–100 ms model latency; full 25-word clip ~0.3–0.9 s. Instant Voice Clone needs Starter plan ($6/mo). Professional Voice Clone is slower; use `use_pvc_as_ivc`. Output `wav_24000` for files, `pcm_24000` streamed into a pipe. |
| 6 | End-to-end ≤8 s over 20 triggers | **Unlikely as specified** | Serial pipeline: ~11–15 s. Parallel (open talk session at motion time, alongside snapshot → Gemini → TTS): ~8–10 s. Parallel plus cover clip: first audio ~6–8 s, comment ~8–10 s. See budget below. |
| 7 | Fallbacks | **Go** | Bluetooth speaker is reliable with a keep-alive tone and pinned output device. Alexa Routines can't speak dynamic text without unofficial tooling. Ring's native Halloween Quick Replies cover doorbell presses with zero code as a safety net. |

## 3. Latency budget (typical, estimated)

| Step | Wired | Battery | Notes |
|---|---|---|---|
| Motion → event on Mac | 0.5–2.5 s | 2–6 s | Smart Alerts add delay; use `onNewNotification`, not `onMotionStarted` (65 s dedupe window) |
| Fresh snapshot | 1–3 s (push UUID) | 1–4 s with plan; 3–6 s from live stream without | Runs in parallel with session open |
| Gemini | 0.6–1.3 s | same | p95 ~2.5 s |
| ElevenLabs | 0.3–0.9 s | same | ~0 if using a cached costume-category clip |
| Talk session open → speaker ready | 2–4 s | 3–6 s | Must start at motion time, in parallel |
| Audio start | 0.3–0.6 s | same | Pad 300 ms silence at start to avoid clipped first syllable |
| **Total, parallel design** | **~6–9 s** | **~8–12 s** | Comment, not cover clip |
| **First audio with cover clip** | **~4–7 s** | **~6–9 s** | |

Pre-warming the session before motion is not viable: Ring sends no motion events while a live stream is open, and the npm release drops streams after ~30 s (keepalive bug, fixed in `main` only).

## 4. Design traps the developer must know

1. **The call ends when the return-audio ffmpeg exits.** `transcodeReturnAudio()` wires ffmpeg's exit to `callEnded()`. You cannot play the cover clip, then call it again for the comment. Feed one continuous input (a FIFO: WAV header → cover clip → silence → comment) or use the `endCallOnFinish:false` pattern from ring-mqtt PR #1098.
2. **First syllable may be clipped.** Speaker activates only after `camera_connected`. Wait 300–500 ms after activation and pad clips.
3. **No new motion events during a live session.** One comment per group; expect to miss the next group that arrives during the ~10 s window. Add a cooldown.
4. **Refresh token rotates ~hourly.** Persist on every `onRefreshTokenUpdated`. Reusing a stale token logs in fine but silently kills push events; the only recovery is deleting the client in Ring Control Center.
5. **`startLiveCall()` throws if a Ring Mode disables live view.** Check Modes, Smart Alerts, and End-to-End Encryption (must be off) before day 1.
6. **2026 4K "Retinal" doorbells are at risk.** HEVC-only video and missing motion events reported in both ring-client-api and Scrypted. Confirm the model before accepting the job.
7. **Codec is the doorbell's choice.** Opus 48 kHz or G.711 µ-law 8 kHz (telephone quality). Normalize TTS to ~-14 LUFS, high-pass ~200 Hz, "Device Speaker" slider to max.

## 5. Recommended route and fallback order

**Try first:** `ring-client-api` from GitHub `main`, Node 24.22.x, small Node script on the Mac. Open the live call the instant the event arrives; fetch the push snapshot and grab a live-stream keyframe in parallel; play the cover clip as soon as the speaker is live; stream the comment into the same ffmpeg input.

Fallbacks, in order:
1. Same stack, borrowing the ring-mqtt PR #1098 playback code if audio clips or truncates.
2. go2rtc v1.9.15 (native macOS binary, has a "stream file to camera" API). Weaker right now: web login broken since Feb 2026, token-format mismatch, battery-drain bug.
3. Scrypted Ring plugin: works but heavy, plugin not updated since June 2025.
4. Bluetooth speaker (the RFP's partial pass), plus Ring's native Quick Replies as a no-code safety net.

Home Assistant cannot do this; its docs state two-way audio is unsupported. Ring's official Partner API has no audio-out path, requires a plan, watermarks all media, and needs a public webhook tunnel; usable only as a backup event source.

## 6. Account, ToS and content risk

- **Ring ToS** bans reverse engineering and lets Ring terminate for any reason. **No documented bans** of ring-client-api, Home Assistant, Scrypted or homebridge users were found. Practical risk is breakage, not lockout: this month alone saw the push decryption break and the Node 26 auth break.
- **Gemini terms** (effective 2026-03-23) forbid use in a service "likely to be accessed by individuals under 18" and say the API is "not for consumer use." Children here are photographed subjects, not users, but it is a gray area to sign off on. **Use a billing-enabled project:** on the free tier human reviewers may read inputs and content is used for training.
- Gemini safety filters default to **off** for 2.5+; set harassment and hate-speech to `block_low_and_above`, add a local post-filter and stock-line fallback.
- ElevenLabs cloned voices require the voice owner's consent and a paid plan for commercial use.
- Privacy laws (COPPA, BIPA) likely don't apply to local-only snapshots with no biometrics; not legal advice.

## 7. Prior art

No public write-up exists of a Ring doorbell speaking LLM-generated lines, and no measured latency for one. Nearest: ring-client-api return-audio issue #436 and PR #1098; a Halloween 2025 costume classifier on a DoorBird (no audio); several Reolink AI-camera projects. This project would be first-of-kind on Ring, which supports the RFP's "prove it first" framing.

## 8. Suggested changes to the RFP

1. **Split the success metric:** first audible sound (cover clip) ≤6 s, and costume comment ≤10 s, each over 20 trials. Keep ≤8 s for the comment as the stretch target.
2. **Add prerequisites the developer should verify on day 1:** exact model and power type, Ring Protect plan active (30-day trial suffices), E2EE off, no Mode disabling live view, Smart Alerts off for the test, Node 24.x, porch light on for night tests.
3. **Add a scope-0 task:** patch or build from `main` and confirm events arrive at all before anything else.
4. **State the Gemini billing requirement** and the age-clause gray area in section 7.
5. **Timeline:** 5 working days is realistic for one developer but spread over 7–10 calendar days given evening tests. Today is Halloween, so all trials are staged until 2027; suggest proposals due Nov 6, selection Nov 10, report Nov 20.
6. **Budget:** $2,000–4,000 fixed, in two milestones: speaker go/no-go $800–1,500 (paid regardless of outcome), remainder $1,200–2,500 (reduced ~30% if the job falls back to Bluetooth).

## 9. Open questions only the hardware can answer

- Exact Ring model, `kind` string, and battery vs wired. Is it a 2026 4K/HEVC model?
- Which codec the doorbell negotiates (Opus vs µ-law), and whether audio plays at all after `stealth_mode:false`.
- Real session-open times and spread over 20 tries, day and night.
- Whether the first syllable or tail is clipped and how much padding is needed.
- Loudness and intelligibility at 1–2 m with the speaker slider at max.
- Whether events or doorbell presses arrive during an open session, and how fast they resume afterward.
- Snapshot UUID timing, fetch time, and 404 rate on this account.
- Gemini SKIP accuracy on this camera's infrared night frames (needs ≥100 empty frames).
- Token stability over a 3–4 hour evening.
- Whether a shared Ring user can open a talk session.

## Files

- `research/report-ring-audio.md`: speaker route (scope item 3)
- `research/report-ring-events-snapshots.md`: events and snapshots (items 1–2)
- `research/report-gemini-elevenlabs.md`: Gemini and ElevenLabs (items 4–5)
- `research/report-e2e-fallbacks-risk.md`: latency budget, fallbacks, ToS, prior art, timeline and budget (items 6–7)
