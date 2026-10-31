# Feasibility: playing a custom audio file through a Ring doorbell speaker from a Mac (RFP scope item 3)

Researched 2026-10-31. Sources: GitHub repos and issue trackers (via the GitHub API), npm registry, vendor docs. Nothing here was tested on hardware.
Tags: **[V]** = I checked it against source code or a primary page. **[R]** = someone else reported it and I could not reproduce it. **[U]** = unverified (my inference or estimate).

## Verdict

**CONDITIONAL GO.** Confidence that audio can be made to play through the doorbell speaker at all: **~80%**. Confidence that it meets the RFP bar (≥18/20 successes, session open ≤5 s, motion-to-first-word ≤8 s): **~50%** on a wired doorbell and **~35%** on a battery doorbell. [U]

Why "go":
- The mechanism exists in maintained code today. ring-client-api's `startLiveCall()` → `transcodeReturnAudio()` + `activateCameraSpeaker()` is current in `main` [V].
- The maintainer confirmed on 2026-01-31 that playing custom audio this way works [R].
- An independent developer reported in June 2026 that playing audio files through a Ring doorbell speaker had been working "for quite some time" on a real doorbell, using the same code path [R].

Why only "conditional":
- I found no published latency or success-rate figures for file playback.
- Several things that would break it can only be checked on Eugene's own account and doorbell (see the hardware questions at the end).
- The library's npm release is 8 months old. Fixes that matter here exist only in `main` (see Risks).

## 1. ring-client-api (dgreif/ring): current state

| Item | Finding | Tag |
|---|---|---|
| Latest npm release | `ring-client-api@14.3.0`, published 2026-02-08. No newer stable release. `main` is active (last commit 2026-10-25) and has pending unreleased changesets, including a **major** bump that drops Node 20. https://github.com/dgreif/ring/releases | V |
| Return-audio API | `StreamingSession.transcodeReturnAudio({input:[...]})`, `activateCameraSpeaker()`, `sendAudioPacket(rtp)`, `stop()`. File: `packages/ring-client-api/streaming/streaming-session.ts`. Example: `packages/examples/return-audio-example.ts`. | V |
| How the speaker is enabled | `activateCameraSpeaker()` waits for the signalling message `camera_connected`, then sends `camera_options {stealth_mode:false}`. Audio sent before that point is probably lost, so the first syllables may be cut off. | V (code) / U (clipping) |
| Required audio format | ffmpeg does the conversion. You can give it any input ffmpeg can read (wav, mp3, etc.). Output depends on what the doorbell picks in its SDP answer: **Opus, 48 kHz, 2 channels** (`libopus -ac 2 -ar 48k`), or **PCMU (G.711 µ-law), 8 kHz, mono** (`pcm_mulaw -ac 1 -ar 8k`). Both go out as RTP from ffmpeg using `-re`, so playback runs in real time. The doorbell decides which codec. On PCMU the audio is telephone quality. | V |
| Call ends when the file ends | ffmpeg's `exitCallback` calls `callEnded()`. As soon as the file finishes, the whole call is torn down. That can cut off the last part of the audio, and you cannot play a filler clip and then the real comment in one call without your own ffmpeg/RTP handling. The ring-mqtt fork added an `endCallOnFinish:false` option to work around this (see below). | V (code) / U (truncation) |
| Confirmation it works | Issue #1703 (2026-01-31), "feed an audio signal into the camera… respond automatically using AI". Maintainer reply: "It is possible. See return-audio-example.ts". https://github.com/dgreif/ring/issues/1703 | R |
| Independent working implementation | tsightler/ring-mqtt PR #1098 (2026-06-22, not merged). It adds "play prerecorded audio files out of a Ring camera/doorbell speaker". The author says it was "Tested on a real Ring doorbell" and "I've been using the feature for quite some time". The code waits for the peer connection to reach `connected`, then calls `activateCameraSpeaker()` and `transcodeReturnAudio()`. https://github.com/tsightler/ring-mqtt/pull/1098 (fork: mirkokg/ring-mqtt, branch `feature/audio-playback`) | R |
| ~30 s disconnect bug | Ring's signalling server now sends `ping` and expects `pong`. `14.3.0` does not reply, so streams drop after about 30 s (`Timeout waiting for ping`). Fixed by PR #1834, merged 2026-10-06, **but not in any npm release**. Short clips are unaffected. A session opened early ("pre-warmed") or a long one is affected. https://github.com/dgreif/ring/pull/1834 | V |
| Live view disabled by Mode | Since 14.3.0, `startLiveCall()` **throws** if `settings.live_view_disabled` is true, which happens when Ring Modes (Home/Away/Disarmed) turn off live view for the camera. https://github.com/dgreif/ring/pull/1705 | V |
| Node.js versions (urgent) | **Node 26 breaks auth and cameras with 14.3.0.** Issues #1874 and #1876 (2026-10-28 to 31): "Refresh token is not valid", fixed by downgrading to Node **24.22.x**. https://github.com/dgreif/ring/issues/1874, https://github.com/dgreif/ring/issues/1876 | R (many reports) |
| Push events (motion/ding) broken in 14.3.0 | 14.3.0 pins `@eneris/push-receiver@4.3.0`. FCM now sends `dh=…; p256ecdsa=…`, so every push fails with `ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY`. Fix: force push-receiver **4.4.0** (`main` already does). There are also re-registration problems (#1860, #1878, #1879). This hits scope item 1, the motion trigger, more than audio. https://github.com/dgreif/ring/issues/1877, https://github.com/dgreif/ring/issues/1860 | R |
| Newer 4K models | Motion events missing on `cocoa_doorbell_v5` (4K) with 14.3.0 (#1866, open). Scrypted reports that 2026 "Retinal 4K" models are HEVC-only and send no usable video to an H.264-only offer (scrypted #2045). Unknown whether **audio-only return** still works on these models. | R / U |
| Did Ring break two-way talk in 2025–2026? | I found **no** issue reporting broken return audio or talk on doorbells in 2025–2026. The breakages I found were the ping/pong keepalive, push decryption, Node 26, and streams failing to start on some models (#1804, Jul–Aug 2026, mixed causes). | V (search) |

## 2. go2rtc Ring source (AlexxIT/go2rtc)

- **Two-way audio is supported.** https://go2rtc.org/internal/ring/ says "supports Ring cameras with two-way audio support" (added in v1.9.13). Code check of `pkg/ring/client.go` [V]: the audio track is offered as `sendrecv` with **Opus 48k/2 only**. When a consumer sends audio (`AddTrack`), it sends `camera_options {stealth_mode:false}`, the same mechanism ring-client-api uses.
- **Playing a file**: go2rtc's generic "stream to camera" API, `POST http://localhost:1984/api/streams?dst=ring&src=ffmpeg:/path/greet.wav#audio=opus#input=file` (internal/streams/README.md) [V docs; not tested with Ring specifically, so **U**].
- Advantages: a single native macOS binary, and a "preload" option to keep a stream warm.
- Problems [R]:
  - **Login through the web UI fails** (`406 Not Acceptable` / `invalid_grant`), open since 2026-02 (#2096).
  - Tokens from `ring-auth-cli` come as a raw JWT, but go2rtc expects a wrapped base64 `{"rt":…,"hid":…}` (#2281, open 2026-09). The fix PR was closed unmerged.
  - Battery Doorbell Plus: the first connection picks an empty H.264 track, and two-way audio only worked on a reconnect or with a patched "prefer h265" build (#1961).
  - **Ghost producers keep a battery doorbell awake** and drain it (#1933, #1961).
  - go2rtc ignores the server's `ping` (it handles only `pong`), so it may hit the same ~30 s cutoff [U].
  - Latest release v1.9.15, 2026-10-25.
- Verdict: a workable **fallback**, but not the first choice, because of the auth friction and battery-drain bugs.

## 3. Scrypted @scrypted/ring

- `startIntercom()` in `plugins/ring/src/camera.ts` [V] sends **PCMU 8 kHz mono over SRTP** and calls `activateCameraSpeaker()` on the first packet. It runs on Scrypted's own fork, `@koush/ring-client-api` (`external/ring-client-api`).
- npm `@scrypted/ring` latest is **0.0.145 (2025-06-14)** [V], so the plugin is stale. Recent fixes went into the webrtc/homekit plugins instead.
- Two-way talk is reported working via HomeKit, e.g. "HomeKit-to-doorbell intercom remained functional" on a Pro 2 in PR #2105 (2026-07) and "Talkback works" in #2106 [R].
- Problems [R]:
  - Incoming audio crackles or is missing on Pro 2 and Elite (#1617, #2098, #2106, #2161). That direction is irrelevant here.
  - 4K Retinal models don't stream (#2045).
- Verdict: works, but it's a heavy server with a plugin model. Playing a file needs Scrypted's intercom/MediaObject plumbing. Overkill for a feasibility test. Use only as a last resort.

## 4. Home Assistant Ring integration

- **No.** HA docs, "Known limitations": "Two-way audio in camera live view is not currently supported." https://www.home-assistant.io/integrations/ring/ [V]
- HA does expose a doorbell volume `number` entity ("volume of the doorbell/chime ring"), but nothing that sends audio.
- ring-mqtt's maintainer rejected file playback (PR #1098), so there's no HA route without a fork.

## 5. Behaviour details

- **Session caps.** I could not verify the RFP's "~30 s battery / ~60 s wired" [U]. The 30 s figure is plausibly the ping/pong library bug above, not a device limit. Ring app live view runs about 10 minutes [R, anecdotal]. For 3–6 s clips this doesn't matter. A pre-warmed session must stay under about 25 s on 14.3.0, or use `main`.
- **Time to open a session.** tsightler (ring-mqtt wiki): "Usually, the live stream starts in ~2-3 second" [R]. HomeKit failures in #1804 show calls "ended before answered" after about 9 s, so slow or failed starts do happen [R]. I found no battery-specific measurements [U].
- **Audio quality and loudness.** The doorbell speaker is small. If the doorbell chooses PCMU, audio is band-limited to 8 kHz. Ring app → Device Settings → Audio Settings → **"Device Speaker"** slider controls two-way-talk volume, "may not be available for all Ring devices". https://ring.com/support/articles/p9go2/adjusting-the-volume-on-your-ring-devices [V]. Set it to max. Pre-process the TTS: compress, apply loudnorm to about -14 LUFS with -1 dBTP peak, and high-pass at about 200–300 Hz [U, standard practice].
- **Recording and motion during the session.** With Ring Protect, every live stream also creates an on-demand recording. "Ring cameras will not send motion notifications while live streaming is active" (ring-mqtt wiki) [R]. So while talking, the next trick-or-treater won't trigger a new event.
- **End-to-end encryption.** If E2EE is enabled on the doorbell, third-party viewing is unavailable (Ring E2EE page lists "third-party devices", Quick Replies, Snapshot Capture). Expect the unofficial route to fail. https://ring.com/support/articles/7e3lk/using-video-end-to-end-encryption-e2ee [V page; impact on talk is U]
- **Models.**
  - Reported working with return audio or talk: Video Doorbell Pro 2 (Scrypted, 2026), Battery Doorbell Plus (go2rtc, with caveats), an unnamed "real Ring doorbell" (ring-mqtt PR).
  - At risk: 2026 4K/"Retinal" doorbells (`cocoa_doorbell_v5`, `cocoa_camera_v3`) because of HEVC-only video and missing events.
  - No list exists of models confirmed to accept return audio. [R/U]

## 6. Account and auth risks

- The refresh token rotates about hourly. You **must** persist `api.onRefreshTokenUpdated` every time. If you reuse an old token, auth still works but **push notifications silently stop**, and the only fix is deleting the client in Ring Control Center and re-authing. https://github.com/dgreif/ring/wiki/Refresh-Tokens [V]
- Pushes stop and the client gets stuck "unsubscribed" after re-auth or restart. Fix: remove the client from Control Center, re-auth, and restart twice (#1860, #1829) [R].
- **No reports of lockouts, bans or rate-limiting** in the issues I read [V search, absence of evidence only]. Ring ToS prohibits unofficial clients [U, not checked]. The risk is low for a one-night test. Don't open sessions in a tight loop.
- tsightler's fork has `new_oauth_endpoint` / `v3_and_oauth` branches, and `main` has a fix for a 406 HTML response from the oauth endpoint. Ring's auth may be changing, so expect possible breakage at short notice [U].

## Recommended route to try first

**ring-client-api from the GitHub `main` branch, on Node 24.22.x, in a small Node script on the Mac.** Not npm 14.3.0, and not Node 26.

Why:
- It's the reference implementation that the go2rtc and Scrypted Ring code is derived from.
- It's the same stack the prototype already uses, and it's Node, which the RFP prefers.
- `main` has the ping/pong fix and push-receiver 4.4.0.
- It gives direct access to `sendAudioPacket()`, so I can control the session lifecycle.
- If installing from git is a problem, use 14.3.0 with `overrides: {"@eneris/push-receiver":"4.4.0"}` and keep sessions under 25 s.

Implementation notes [U, design]:
1. Call `startLiveCall()` **the moment the motion or ding event arrives**, in parallel with snapshot → Gemini → TTS. This hides the 2–5 s session open behind the AI steps. Optionally pull the Gemini frame from the live video instead of the slow battery snapshot.
2. Wait for `connected`/`camera_connected`, call `activateCameraSpeaker()`, wait about 300–500 ms, then start audio. Pad clips with about 300 ms of silence at the start and about 700 ms at the end.
3. Don't rely on the stock `transcodeReturnAudio()` for the filler-then-comment sequence, because it ends the call when ffmpeg exits. Run one long-lived ffmpeg in the session (or pipe both clips into it), or use ring-mqtt's `endCallOnFinish:false` pattern. Encode to whatever codec the answer chose (`isUsingOpus`).
4. Day-1 probe:
   - Log the device `kind` and the negotiated codec.
   - Time ticket → answer → `camera_connected` → first RTP.
   - Run 20 back-to-back plays of a fixed clip, at least 30 s apart, then call `stop()`.
5. Fall back to Bluetooth if `camera_connected` doesn't arrive within about 5 s.

## Fallback order

1. ring-client-api `main` with custom session handling (above).
2. The same, with the ring-mqtt PR #1098 streaming code (mirkokg fork) as a reference implementation if the stock flow clips or truncates audio.
3. go2rtc v1.9.15 (macOS binary) with `ring:?device_id=…&refresh_token=<wrapped base64>` and the `POST /api/streams?dst=…&src=ffmpeg:file#audio=opus#input=file` API. Watch for ghost producers on battery doorbells.
4. Scrypted with the Ring plugin and its intercom: heavy, last resort for the doorbell route.
5. Bluetooth speaker near the door (the RFP's partial-pass path). Ring's native **Quick Replies** (pre-set messages on doorbell press, including seasonal ones) can still greet visitors through the doorbell, but they can't be custom or AI-generated.

## Estimates (none measured; reasoning given)

- **Session open (event received → speaker ready)** [U]:
  - Wired: **2–4 s typical, with a tail to about 8 s**. Basis: tsightler's ~2–3 s figure, plus the `camera_connected` and speaker-activation step.
  - Battery: **3–6 s typical, tail to 10 s or more**. The radio sleeps between events, though it should already be awake right after a motion event.
  - The ≤5 s target looks achievable on wired. On battery it's marginal.
- **Success rate per attempt** [U]:
  - Wired: **80–95%**. Battery: **65–85%**.
  - Failure modes: answer timeouts, "call ended before answered" (#1804), clipped first syllable, a model negotiating an odd codec or track (#1961).
  - With one automatic retry, wired could plausibly reach ≥90%, but a retry costs about 3–5 s of the latency budget.
- **End-to-end ≤8 s**: plausible only if the session opens in parallel with Gemini and TTS, so total ≈ max(session open, snapshot + Gemini + TTS) + about 0.5 s. With serial steps it is very unlikely.

## Open questions only hardware can answer

1. Exact model and `kind` string, and wired or battery (or a battery model on wired power). Is it a 2026 4K/HEVC model?
2. Does the doorbell answer with Opus or PCMU? Does audio play at all after `stealth_mode:false`?
3. Real time from ticket to `camera_connected` to audible sound, and how spread out it is over 20 tries, day and night.
4. Is the first syllable clipped or the tail cut off? How much silence padding is needed?
5. Loudness at about 1–2 m from the door with the "Device Speaker" slider at max. Is a TTS comment intelligible over street noise?
6. Account state:
   - E2EE off?
   - Mode settings leave live view enabled? (Otherwise 14.3.0 throws.)
   - Is Eugene's phone in live view at the same time, and does that conflict?
   - Does a doorbell press (chime) interrupt an active session?
7. Does a session started on the motion event block or delay the next motion event? (Expected yes, per the ring-mqtt wiki.)
8. Battery: drain per session, and does the doorbell refuse live view at low battery?
9. Token stability over a 3–4 hour Halloween evening: persistence works, no forced re-auth.

## Key URLs (accessed 2026-10-31)

- https://github.com/dgreif/ring (releases; `packages/examples/return-audio-example.ts`; `packages/ring-client-api/streaming/*.ts`)
- https://github.com/dgreif/ring/issues/1703 · /pull/1834 · /pull/1705 · /issues/1874 · /issues/1876 · /issues/1877 · /issues/1860 · /issues/1866 · /issues/1804
- https://github.com/dgreif/ring/wiki/Refresh-Tokens
- https://github.com/tsightler/ring-mqtt/pull/1098 · https://github.com/tsightler/ring-mqtt/wiki/Video-Streaming
- https://go2rtc.org/internal/ring/ · https://github.com/AlexxIT/go2rtc (pkg/ring/client.go; issues #2096, #2281, #1961, #1933)
- https://github.com/koush/scrypted (plugins/ring/src/camera.ts; issues #2105, #2106, #2045, #1617)
- https://www.home-assistant.io/integrations/ring/
- https://ring.com/support/articles/p9go2/adjusting-the-volume-on-your-ring-devices
- https://ring.com/support/articles/7e3lk/using-video-end-to-end-encryption-e2ee
