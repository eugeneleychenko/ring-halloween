# Ring Halloween Greeter: end-to-end latency, fallbacks and risk (RFP scope items 6 and 7, plus the risk section)

Researched 2026-10-31. Tags used below:
- **[V]**: verified against the cited source.
- **[E]**: my engineering estimate or judgment. No source measured it.
- **[UNVERIFIED]**: I looked and could not confirm it.

---

## 1. Overall verdict

| Question | Verdict | Confidence |
|---|---|---|
| Can the full chain (event, snapshot, Gemini, ElevenLabs, doorbell speaker) work at all? | **Probably yes.** The ring-client-api maintainer confirms that streaming a file to the camera speaker is supported (`return-audio-example.ts`). Another user got it working after a fix [V]. go2rtc also advertises Ring two-way audio [V]. | Medium-high (~70%) [E] |
| Can a **costume comment** be the first word heard within ≤8 s in at least 18 of 20 trials? | **Unlikely on a battery doorbell. Borderline on a wired one**, and only with parallel session-open and streamed TTS. | Wired: ~30–40%. Battery: ~15–25% [E] |
| Can **any audio**, such as a pre-recorded "Ooh, who's this?" cover clip, start within ≤8 s in at least 18 of 20 trials? | **Likely on wired. Possible on battery.** | Wired: ~65–75%. Battery: ~40–50% [E] |
| Is the Bluetooth fallback (partial pass) achievable? | **Yes, with high confidence.** The comment lands about 1–3 s sooner than on the doorbell route because no talk session has to open. | High (~90%) [E] |

**The RFP must settle one thing first.** "Motion to first word" needs a definition. If the cover clip counts as the first word, ≤8 s is realistic on wired hardware. If the personalised comment must be first, ≤8 s is a stretch target. I suggest the RFP track both:
- **T_first_audio**: the cover clip starts, target ≤6 s.
- **T_comment**: the comment starts, target ≤10 s.

### NEW critical risk found during research (October 2026)

Ring motion and ding push events are currently broken in ring-client-api-based tools. This is a day-1 blocker if it is not patched.

- **Cause.** FCM changed the format of a crypto header. `@eneris/push-receiver` 4.3.0 mis-parses the new header and fails with `ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY`. The result is that motion and ding events never arrive, while login and live video keep working [V: scrypted#2177 (14–31 Oct 2026); dgreif/ring#1709].
- **Exposure.** `npm view ring-client-api dependencies` shows that the latest ring-client-api@14.3.0 (8 Feb 2026) **pins `@eneris/push-receiver` at exactly `4.3.0`** [V, checked on npm today]. The fix is in 4.3.1+, and 4.4.0 is current [V].
- **Fix.** Add an npm `overrides` entry forcing `@eneris/push-receiver` to `^4.4.0`. Community members confirm that patching this restores events [V: scrypted#2177 comments].
- **Home Assistant is affected too.** The Python stack (`firebase-messaging`) has a parallel break [V: home-assistant/core#189254, opened 28 Oct 2026]. Users report no events since about 14 Oct.
- **Takeaway.** This is exactly the "Ring/Google changes something and push silently dies" failure the report must cover.

---

## 2. End-to-end latency budget

All numbers are in seconds.
- "Best" is a good Wi-Fi, wired doorbell and warm APIs.
- "Typical" is my central estimate.
- "Worst" is the tail that will break the 18/20 criterion.

| # | Step | Best | Typical | Worst | Basis |
|---|---|---|---|---|---|
| 1 | Physical motion → Ring cloud registers the event. This covers the doorbell's own detection, the Wi-Fi wake on battery models, and person-only Smart Alert classification if enabled. | 1.0 | 2–3 (wired), 3–5 (battery) | 8–20 | [E]. Ring support and community threads blame 5–10 s and even 20 s delays on weak Wi-Fi [V, anecdotal: tekdash, justanswer, Ring community]. |
| 2 | Ring cloud → FCM push → Mac (ring-client-api `onMotionDetected`/`onDoorbellPressed`) | 0.3 | 0.5–2 | 5+ | One homebridge user says the Ring app consistently gets dings about **5 s before** homebridge-ring [V, anecdotal: r/homebridge 16r4786]. |
| **1+2** | **Motion → event on the Mac (RFP target ≤3 s)** | **1.5** | **3–5** | **10–20** | The ≤3 s target will be missed on many trials [E]. |
| 3a | Snapshot through the REST API (`getSnapshot`) | 0.8 | 1.5–3 | 6+ or stale | [E]. The RFP's own constraint says battery snapshots are slow or stale. ring-client-api 14.0 avoids snapshots while recording on `doorbell_graham_cracker` [V: release notes]. |
| 3b | *Or* a frame grabbed from a live stream (when you open the talk session anyway) | 2.0 | 2.5–4 | 8+ | ring-mqtt docs: "Usually, the live stream starts in ~2–3 seconds" [V], plus up to one keyframe interval [E]. |
| 4 | Gemini vision, one comment of 25 words or fewer (Flash-Lite class, thinking disabled, JPEG of about 100 KB) | 0.5 | 0.8–1.5 | 3–6 | Time to first token is 0.21 s average and 0.44 s p95 for Gemini 2.5 Flash-Lite [V: Artificial Analysis via Reddit; llm-stats]. Add image upload and roughly 40 output tokens [E]. A Google forum reports 2.5 Flash latency spikes (6 s→20 s) [V]. |
| 5 | ElevenLabs Flash v2.5 TTS (streaming, time to first byte) | 0.15 | 0.2–0.5 | 1.5 | 50–75 ms model time [V: ElevenLabs blog, Feb 2026]. Independent test: 197 ms median first audio over 50 streaming trials [V: Vapi]. A full non-streamed 25-word clip takes about 0.5–1 s [E]. |
| 6 | Ring talk session open (`startLiveCall` → `activateCameraSpeaker`) | 2.0 | 3–5 (wired), 4–8 (battery) | 10+ or failure | Video stream start is about 2–3 s [V: ring-mqtt]. Talk and speaker activation on top of that is [UNVERIFIED]. Battery wake adds more [E]. |
| 7 | ffmpeg transcode → RTP → doorbell buffer → audible | 0.2 | 0.3–0.6 | 1.0 | [E] |

### Totals by architecture [E]

| Architecture | Best | Typical | Worst | Meets ≤8 s at 18/20? |
|---|---|---|---|---|
| **A. Naive serial** (event → snapshot → Gemini → TTS file → open session → play) | ~5 | **11–15** | 25+ | No |
| **B. Parallel**: open the talk session the moment the event arrives, while snapshot → Gemini → streamed TTS runs concurrently. Total = event + max(snapshot+Gemini+TTS, session) + playout. | ~3.5 | **8–10** | 20+ | Borderline on wired, no on battery |
| **C. B plus a cover clip**: play a cached "Ooh, who's this?" clip as soon as the session is up, then the comment. | first audio ~3.5 / comment ~4 | first audio **6–8** / comment **8–11** | 20+ | First audio: likely on wired. Comment: no |
| **D. Wired only, "always watching"**: hold a live stream open, run local person detection on the frames (YOLO, as in the basecase project), and skip Ring's motion event entirely. | ~2 | **4–6** | 10 | Plausible, but see the caveats under trick 7 |

### Architectural tricks, ranked by value

1. **Open the talk session in parallel** with snapshot, Gemini and TTS, as soon as the event arrives. This removes 3–5 s from the critical path and is the single biggest win [E].
2. **Pre-cached cover clip.** Generate 5–10 ElevenLabs clips in the custom voice in advance and play one as soon as the speaker channel opens. It hides 2–4 s of Gemini and TTS time. Also keep a cache of generic compliments ("Love that costume! Happy Halloween!"). Play one if Gemini has not answered within N seconds, or if it fails (scope item 7).
3. **Stream TTS straight into ffmpeg.** Pipe the ElevenLabs streaming response (PCM/μ-law output) straight into the return-audio ffmpeg process instead of writing a file first. This saves about 0.3–1 s [E].
4. **Snapshot strategy: race both sources.** Request `getSnapshot` and also grab the first decoded frame from the live session, then use whichever arrives first and is newer than the event timestamp. On battery models the stream frame is probably the only fresh source [E].
5. **Model choice.** Use a Flash-Lite class model with thinking off, a hard 25-word cap, and a short system prompt. A JSON `{skip:boolean, line:string}` response lets SKIP short-circuit. Downscale the image to about 768 px.
6. **Keep connections warm.** Keep HTTP/2 keep-alive connections open to Gemini and ElevenLabs. Send a dummy request every few minutes so cold TLS and DNS setup does not land on the first trigger [E].
7. **Pre-warming on PIR is mostly not available.**
   - Ring exposes no "PIR armed" signal before the motion event [E/UNVERIFIED].
   - Holding a live stream open continuously stops motion notifications. ring-mqtt docs: "Ring cameras will not send motion notifications while live streaming is active" [V].
   - That stream also drains battery and can overheat the device [V: ring-mqtt].
   - Architecture D is only viable on **wired** doorbells, with local person detection replacing Ring's events. Expect a reconnect every ~10 minutes (ring-mqtt describes on-demand interactive sessions as "short term (10 minute)") [V]. The 60 s wired cap in the RFP may differ by model [UNVERIFIED].
8. **Battery 30 s session cap.**
   - The cover clip, the comment and any second line must all fit inside one roughly 30 s session.
   - Larger groups should get one comment per group, not one per child.
   - While a session is open, motion notifications are suppressed, so a new group arriving mid-session is missed [V, inferred from ring-mqtt]. Add a cooldown of about 30–45 s after each session.
   - Each trigger costs battery. With dozens of visitors, charge the battery fully beforehand. The battery may not last the night [E].

---

## 3. Fallback audio outputs, ranked

| Rank | Option | Latency to audio | Reliability | Effort | Notes |
|---|---|---|---|---|---|
| **1** | **Wired (3.5 mm/USB) powered speaker from the Mac** using `afplay` or an ffplay pipe | <0.05 s [E] | Very high | Very low | Needs a long cable or a Mac near the door. Most deterministic. Keeps the custom ElevenLabs voice. |
| **2** | **Bluetooth speaker from the Mac** using `afplay` (spawned from Node) | ~0.1–0.3 s added by Bluetooth [E, typical A2DP] | High once paired | Low | Quirks below. |
| 3 | **Amazon Echo used as a plain Bluetooth speaker** for the Mac ("Alexa, pair") | ~0.2–0.4 s [E] | High | Low | Keeps the custom voice. Bluetooth range through a wall to the porch may be marginal. Echo Bluetooth-sink behaviour is [UNVERIFIED] for this setup. |
| 4 | **Hidden phone or tablet on the porch** playing audio pushed from the Mac over LAN (a small WebSocket page or app) | ~0.2–0.5 s [E] | Medium | Medium | iOS/Safari needs one user tap to unlock audio. Use Guided Access and keep it plugged in and weather-protected. A FaceTime or phone call alternative adds 0.5–1 s and can drop [E]. |
| 5 | **AirPlay 2 speaker** (HomePod and similar) as the Mac output | ~1–2 s buffer [UNVERIFIED, commonly cited] | Medium-high | Low | Too slow to lead with. Acceptable for comment-only playback. |
| 6 | **Alexa route** | see below | Low-medium | Medium-high | Best used as a Mac-independent last resort with a fixed greeting, not for dynamic comments. |

### Bluetooth quirks to engineer around [E]

- **Auto-sleep.** Many speakers sleep after 10–30 minutes idle. The first syllable then gets clipped, or the speaker disconnects.
  - Mitigation: play a near-silent keep-alive every 2–5 minutes.
  - Mitigation: prepend 300 ms of silence to every clip.
- **Output switching.** macOS may switch output on reconnect.
  - Pin the output with `SwitchAudioSource` (Homebrew `switchaudio-osx`).
  - Have the health check verify the current output device before each play.
- **Auto-reconnect.** The `blueutil` CLI can script reconnects (`blueutil --connect <mac>`).
- **Sleep.** Prevent Mac sleep with `caffeinate -dimsu` and keep it on mains power.
- **Wi-Fi interference.** Bluetooth and 2.4 GHz Wi-Fi share spectrum. Reports of choppy Bluetooth audio on Apple Silicon Macs exist [V, anecdotal: Apple Discussions, r/MacOS]. Prefer 5 GHz Wi-Fi or Ethernet for the Mac.

### Alexa route assessment

- **Official route.** Ring doorbell press or motion can trigger an Alexa Routine, and "Alexa Says" or "Announce" can speak typed text on an Echo [V: Ring community how-to; Ring support "Alexa Announcements"].
  - The text is **static**, set in the app.
  - It uses the **Alexa voice, not the ElevenLabs voice**.
  - Users report routine/announcement delays from a few seconds up to about 15 s, and routines silently stopping [V, anecdotal: Universal Devices forum; Ring community "routines just stop working"]. I found no rigorous measurement [UNVERIFIED].
- **Dynamic text.** This needs unofficial tooling: Home Assistant **Alexa Media Player** (it emulates the Alexa app with cookie auth) or `alexa-remote-control`.
  - Both break when Amazon changes things [V: alexa_media_player#2484].
  - Custom audio is limited. The maintainers said SSML `<audio>` is not supported by Amazon [V: AMP#439, 2019], though some users report the audio tag working [V, anecdotal].
  - Net effect: you would be stacking a second unofficial cloud dependency on the first.
- **Recommended use.** A **Mac-independent safety net**. A Ring motion → Alexa routine → outdoor or porch-facing Echo says "Happy Halloween! Great costume!" This covers a crashed Mac, broken Ring push or a dead laptop. Disable it when the main system is healthy, or accept the occasional double greeting.

### Two more zero-code fallbacks

- **Ring Quick Replies.** These are official pre-recorded responses on **doorbell press**, and Ring advertises Halloween-themed replies this season [V: Ring Facebook video, ~2 weeks ago]. They are press-only, use Ring's voices and are not personalised.
- **Gemini failure → stock message** (scope item 7). Trigger it on timeout, error or a safety block, keyed off a hard deadline of about 3 s after the snapshot. Rotate 10+ pre-generated generic compliments so it does not sound robotic.

---

## 4. Ring ToS and account risk, plus privacy

### What the terms say

- **Ring ToS §2(h) Software** (effective 6 Nov 2025): "You may not reverse engineer, decompile or disassemble, tamper with, or bypass any security associated with the Software" [V: ring.com/terms].
- **Ring ToS §2(a):** Ring may "terminate accounts, terminate or suspend your rights to use or access the Services ... for any reason in its sole discretion" [V].
- **Ring ToS §2(e):** the license is for "personal and non-commercial use" [V]. Personal use fits. A paid contractor operating the system on your account is still your personal use, but see open question 4.

### How Ring treats unofficial clients in practice

- **No bans found.** I found **no documented cases of Ring banning or locking accounts for using ring-client-api, Home Assistant, Scrypted or homebridge** [UNVERIFIED absence; searched 2023–2026].
- **Ring can see these clients.** They register as visible "Authorized Client Devices" in Ring Control Center [V: scrypted#2178, HA#189254], so Ring tolerates them openly.
- **Using ring-client-api is a gray area.** It is an independently reverse-engineered client. Arguably you are not reverse-engineering anything yourself, but Ring could still object. Practical risk: **low for a personal account, not zero** [E].

### Documented breakages, 2025–2026

These matter more than bans:

| When | What | Effect |
|---|---|---|
| Oct 2025 | AWS us-east-1 outage | Ring auth and 2FA failed for hours for everyone [V: HA#154869] |
| Feb–Sep 2026 | go2rtc Ring login returns 406/401 `invalid_grant` | Unresolved for months, while ring-mqtt kept working [V: go2rtc#2096]. **This makes go2rtc a weaker choice than ring-client-api right now.** |
| Feb 2026 onward, acute Oct 2026 | FCM push decrypt failure in ring-client-api, Scrypted and homebridge (via `@eneris/push-receiver` 4.3.0) | Events silently stop [V: dgreif/ring#1709, scrypted#2177] |
| Oct 2026 | Home Assistant Ring: FCM `PHONE_REGISTRATION_ERROR` | Push permanently unavailable even after re-auth [V: HA#189254] |

### Token and 2FA behaviour

- **2FA is mandatory.** The initial refresh token comes from `npx -p ring-client-api ring-auth-cli`, using email, password and a 2FA code [V: dgreif/ring wiki "Refresh Tokens"].
- **The token rotates about hourly.** Consumers **must** persist every `onRefreshTokenUpdated` value [V].
- **Re-using an old token silently breaks push notifications.** The FCM registration is bound to the first connection. The only fix is to delete the client in Ring Control Center and re-authenticate [V].
  - This is the most likely way to "lose" motion events in the middle of a test session.
  - Mitigations: write the token atomically to a local file (temp file plus rename), never run two instances on one token, and keep a backup.

### Halloween-night failure risks, in likely order [E]

1. Push events silently stop: an FCM or library bug, or a token mishandled.
2. Ring cloud or AWS slowness raises the talk-session failure rate.
3. The battery doorbell drains.
4. The Mac sleeps, or the Bluetooth speaker disconnects.
5. A full account lock is unlikely.

### Mitigations

- **Dependencies.** Pin and patch: force `@eneris/push-receiver` ≥4.3.1 via npm overrides. Freeze `package-lock`. Do not update anything during the week of Halloween.
- **Watchdog.** If a doorbell press, or a manual test from the Ring app, produces no event within 10 s, alert and fall back to polling. Recent dings are retrievable over REST [E]. ring-client-api's polling options are [UNVERIFIED for current version].
- **Account.** Use a **dedicated shared user** on the owner's account to limit blast radius. Check that shared users can use Live View and Two-Way Talk [UNVERIFIED]. Avoid repeated failed logins and 2FA requests on the night itself.
- **Independent safety net.** Keep the Alexa routine or Quick Replies running whatever happens to the Mac.
- **Startup check.** Before going live, run one scripted end-to-end self-test: press the doorbell and confirm the event, the snapshot and audio playback.

### Privacy and legal (practical, not legal advice)

- **Gemini API terms (effective 23 Mar 2026)** [V: ai.google.dev/gemini-api/terms]:
  - "You also will not use the Services as part of a website, application, or other service ... that is directed towards or is likely to be accessed by individuals under the age of 18."
  - Use is "for developers building ... for professional or business purposes, not for consumer use."
  - **Why it matters:** a doorbell that speaks to trick-or-treaters is arguably "likely to be accessed by" minors. The children do not operate the client, and the operator is an adult, but it is a real gray area. Flag it to the client.
  - **Option:** use Vertex AI (Google Cloud terms) instead. Whether Vertex has an equivalent age clause is [UNVERIFIED].
- **Free tier vs paid tier** [V]:
  - On the **unpaid tier**, Google uses inputs to improve products, and "human reviewers may read, annotate, and process your API input and output. ... Do not submit sensitive, confidential, or personal information."
  - On the **paid tier** (Cloud Billing enabled), prompts and images are not used for training and are logged only briefly for abuse detection.
  - **Requirement: use a billing-enabled project.** Images of children must not go to the free tier.
- **COPPA.** It targets operators of commercial online services directed to children that collect their data. A private homeowner's doorbell is very likely outside its scope [E, not legal advice].
- **BIPA and similar biometric laws.** These target face geometry and templates. No face recognition and no stored embeddings means minimal exposure [E].
- **Retention and wording.**
  - Delete snapshots after the test, or within N days.
  - Never upload snapshots elsewhere, which the RFP already says.
  - Enforce the prompt rules: costumes only, no comments on body, age or race, and no guessing identity.
- **Speaking to children unprompted.**
  - Use a friendly voice, no scares aimed at small kids, and short lines.
  - Put up a small visible sign ("Talking AI doorbell, say hi!").
  - Provide a kill switch: a hotkey or a phone shortcut that mutes output.
- **Ring ToS §2(b)** makes the owner responsible for any notice or consent laws around recording [V]. Recording itself is unchanged from normal Ring use.

---

## 5. Prior art (2020–2026)

| Project | What it did | What worked or failed | Latency data |
|---|---|---|---|
| **dgreif/ring issue #436** (2020–21): https://github.com/dgreif/ring/issues/436 | Play custom audio on a Ring doorbell at motion | The maintainer points to `examples/return-audio-example.ts`. One user's audio cut off after about 2 s until they added the example's cleanup step, then it worked. | None |
| **go2rtc Ring source** (v1.9.13+): https://go2rtc.org/internal/ring/ | Ring streams with two-way audio | Login broken for many users Feb–Sep 2026 (#2096) | None |
| **ring-mqtt** (tsightler): https://github.com/tsightler/ring-mqtt/wiki/Video-Streaming | Ring → RTSP through go2rtc | Documents the ~2–3 s stream start, no motion events while streaming, and ~10-minute sessions | Stream start ~2–3 s [V] |
| **basecase.vc "streaming halloween"** (Halloween 2025): https://basecase.vc/notes/streaming-halloween/ (code: github.com/alanagoyal/ghostbusters) | DoorBird RTSP → Raspberry Pi YOLOv8 → Gemma 3 27B costume classification → dashboard. No audio. | Worked. Lessons: groups (detect each person), inflatable costumes detected as "car", passers-by on the street (fix with a region of interest), a 30 s cooldown, a 2-consecutive-frame rule, and auto-restart. They got only one trick-or-treater. | Not reported |
| **How-To Geek: Gemini describes who's at the door** (Mar 2025): https://tech.yahoo.com/articles/home-assistant-describe-whos-door-140017256.html | Reolink → HA LLM Vision → Gemini → phone notification plus smart-speaker announcement | Worked. The author notes **Ring is harder because snapshots are not easy to get**. | Not reported |
| **How-To Geek: local LLM doorbell concierge** (May 2026): https://www.howtogeek.com/i-let-a-local-llm-take-control-of-my-video-doorbell/ | Reolink + Piper TTS + Whisper + Ollama, speaking through the doorbell | One-shot spoken greeting through the doorbell worked. Two-way conversation failed (too slow, confused small model). The author left Ring for Reolink to run locally. | Qualitative "too long" |
| **How-To Geek: spooky doorbell** (30 Oct 2026): https://tech.yahoo.com/home/articles/3-spooky-home-assistant-projects-140016379.html | Person detection → random TTS-generated spooky clip through the Reolink doorbell | Worked, using pre-generated clips, not live generation | None |
| **HA Facebook group: Halloween AI doorbell** (2026): https://www.facebook.com/groups/HomeAssistant/posts/4552971568307511/ | UniFi G6 Entry plus AI vision costume-themed lines | Work in progress, with no results posted | None |
| **r/homeassistant: LLM Vision + Reolink notifications**: https://www.reddit.com/r/homeassistant/comments/1gy3c17/ | Doorbell descriptions by LLM | Worked (notifications only) | None |
| **r/homeassistant 2022: "Can HA play audio through a Ring doorbell?"**: https://www.reddit.com/r/homeassistant/comments/wswbce/ | — | The community answer was "no", with Echo via Alexa Media Player suggested instead. This predates practical ring-client-api return audio. | — |
| **AI Halloween Ghost** (YouTube, ~2024): https://www.youtube.com/watch?v=O_IbtlQWvrI | Standalone prop that converses with trick-or-treaters using TTS | Works as a standalone speaker prop, not a doorbell | Not reported |

**Gap:** I found **no public write-up of a Ring doorbell speaking LLM-generated lines, and no measured end-to-end latency for one** [UNVERIFIED absence]. This test would be novel, which supports treating ≤8 s as a hypothesis to measure, not a given. Most working prior art uses Reolink or UniFi doorbells with local two-way audio.

---

## 6. Timeline and budget recommendation

### Is the 5-day plan realistic for one developer? Mostly yes, with caveats [E]

- **Days 1–2 (speaker go/no-go).** Realistic if the doorbell model and power type are known, and the owner is available for 2FA. Day 1 morning must include the push-receiver patch, or the events check will look broken.
- **Days 3–4 (end to end plus 20 trials).** Tight. The 20 trials need a person walking up repeatedly, in **daylight and at night**. Each battery trial also needs a cooldown and drains the battery. Plan for about 2 test windows of 1.5–2 hours, one of them in the evening.
- **Day 5 (report and video).** Fine.
- **Calendar.** Plan **5 working days of effort across 7–10 calendar days**, to fit evening tests and owner availability.
- **Next Halloween.** Today is Halloween 2026, so there will be no real trick-or-treaters until 2027. All trials will be staged. Gemini accuracy on real costumes at night can only be approximated with staged or AI-generated images, as basecase did.

### Effort and price [E]

- **Effort.** About 30–45 hours: 8–14 for Ring auth, events and the speaker; 6–8 for Gemini, TTS and fallbacks; 8–12 for trials and measurement; 6–8 for the README, report and video.
- **Market rates** [V]:
  - Upwork Node.js developers: median $25/h, typical $18–38.
  - Upwork "focused IoT developer work": $500–2,500 per project.
  - Home-automation projects: $500–1,500.
  - North American freelancers: up to about $140/h (index.dev).
- **Specialist premium.** Someone with real ring-client-api, WebRTC/SIP or ffmpeg experience who can come to the door in the evening should charge above Upwork medians.

**Recommended fixed price: $2,000–$4,000, split by milestone:**
- **Milestone 1** (days 1–2, doorbell speaker go/no-go plus events and snapshot measured): **$800–1,500**, paid whatever the outcome.
- **Milestone 2** (end to end, 20 trials, fallbacks, report, video): **$1,200–2,500**.
- **Reduced Milestone 2 at about 70%** if the speaker fails and the work continues on Bluetooth only (partial pass).
- **API costs** are paid separately by the client. They should be a few dollars (Gemini Flash-Lite per image and ElevenLabs characters) [UNVERIFIED exact pricing].

### Suggested dates for the RFP blanks

| Milestone | Suggested date |
|---|---|
| Proposals due | Fri 6 Nov 2026 (one week) |
| Developer selected | Tue 10 Nov 2026 |
| Kickoff and account access session (2FA) | Wed 11 Nov 2026 |
| Speaker go/no-go | Thu 12 – Fri 13 Nov |
| End to end plus measurements (including 2 evening sessions) | Mon 16 – Wed 18 Nov |
| Final report and video | Fri 20 Nov 2026 |

**Timeline target to put in §9 item 13:** "5 working days of effort within 10 calendar days".

---

## 7. Open questions for the client

1. **Exact Ring model and power type** (battery, battery wired for trickle charge, or fully wired). This is the biggest driver of latency and the session cap. The ring-client-api changelog shows model-specific quirks such as `doorbell_graham_cracker` and new Battery Doorbell Pro/Plus support.
2. **Definition of "first word".** Does the cover clip count? I suggest measuring T_first_audio and T_comment separately (see §1).
3. **Ring Protect subscription?** It affects whether snapshots and rich notifications carry images [UNVERIFIED for current plans].
4. **Account access method.** Will the developer use a shared user or the owner's account? Shared users' talk and API capabilities are [UNVERIFIED]. Who holds 2FA during the evening tests?
5. **Smart Alerts set to "person only" or "all motion"?** Person-only alerts may add cloud classification delay but cut false triggers [E].
6. **Wi-Fi signal (RSSI) at the doorbell.** Weak Wi-Fi is the main documented cause of 5–20 s delays [V, anecdotal].
7. **Is a wired speaker or cable run possible?** It is better than Bluetooth as the fallback.
8. **Owner sign-off on the Gemini age clause.** Is the owner comfortable with it, and with using a billing-enabled (paid) Gemini project? Would they consider Vertex AI?
9. **Mac-independent safety net.** Does the owner have an Echo or want an Alexa-routine one?
10. **Target date of real use.** Halloween 2027? If so, add a re-validation step in October 2027, because Ring and FCM changes break unofficial clients every few months, as this October shows.
