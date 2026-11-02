
# RFP: Feasibility Test – AI Halloween Greeter via Ring Doorbell

Requested by: the project owner

Date issued: October 31, 2026

Response due: [fill in]

Engagement type: Short, fixed-scope feasibility test (prototype, not production)

## 1. Summary

I want my Ring doorbell to greet trick-or-treaters with a personalized spoken comment about their costume. The comment should play through the Ring doorbell's own speaker. When motion is detected, the system takes a snapshot from the Ring camera. Google Gemini (vision) writes a short, friendly line about what it sees, ElevenLabs turns that line into speech in a custom voice, and the audio plays through the doorbell.

Before investing further, I need a developer to prove or disprove that this works end to end on my actual hardware. I also need real measurements of reliability and latency.

## 2. Target flow ("ideal route")

Ring motion event (or doorbell press)  -> grab a snapshot from the Ring camera  -> send the snapshot to Gemini vision -> 1 short costume comment (or SKIP if nobody is there)  -> ElevenLabs text-to-speech (custom voice) -> audio file  -> open a Ring two-way talk session -> play the audio through the doorbell speaker  -> log the snapshot, comment, and timings

Optional: play a pre-recorded ElevenLabs "Ooh, who's this?" clip right away to cover the processing delay.

## 3. Known constraints (from my research)

- Ring's official API (Ring Appstore Partner API) supports motion webhooks, snapshots, clips and live video. It does not support sending custom audio to the camera, so the speaker step needs an unofficial route.
- Unofficial route: the open-source `ring-client-api` (https://github.com/dgreif/ring) Node library, which supports a two-way talk session (startLiveCall(), activateCameraSpeaker(), transcodeReturnAudio() via ffmpeg). Alternatives worth evaluating are go2rtc (https://go2rtc.org/internal/ring/) and Scrypted's Ring plugin (https://www.npmjs.com/package/@scrypted/ring).
- Auth: the unofficial route uses a Ring refresh token (email, password and 2FA). The token rotates and must be saved on every update.
- Snapshots on battery doorbells can be slow or stale, and live sessions are capped at about 30 seconds on battery devices and about 60 seconds on wired ones.
- Runtime: a Mac laptop on the home network (Node.js and ffmpeg). A Bluetooth speaker is available as a fallback audio output.
A working prototype already exists. It is untested on hardware and is attached as ring-halloween.zip. The developer may use it, fix it, or replace it.

## 4. Scope of work

The developer will:

1. Ring connection. Authenticate with my Ring account, list devices, and confirm motion and doorbell-press events reach the Mac. Measure event delay and miss rate.
1. Snapshot quality. Capture snapshots on motion. Measure the time to get the image and whether it is fresh (taken after the motion event), in daylight and at night.
1. Doorbell speaker (highest risk). Play an audio file through the Ring doorbell speaker using the talk-session route. Measure time to open the session, success rate, and audio quality and loudness. Confirm whether this works on my specific Ring model and power type (battery or wired).
1. Gemini vision. Send snapshots to Gemini and get a single kind, family-friendly comment of 25 words or fewer about costumes, or SKIP when no person is visible. Evaluate accuracy on real or staged costume images, including night images from the Ring camera.
1. ElevenLabs voice. Generate speech with my chosen voice and measure the time to generate it.
1. End-to-end run. Chain all steps and measure total latency from motion to the first audible word, across at least 20 triggers.
1. Fallbacks. If the doorbell talk session fails, play on the Bluetooth speaker. If Gemini fails, play a stock message.
Out of scope: face recognition or identifying repeat visitors, cloud hosting, a mobile app, and Ring's official app certification.

## 5. Deliverables

1. Working source code (Node.js preferred) with a README that a non-developer can follow to run it on a Mac.
1. A short feasibility report (1–2 pages) covering:
- go / no-go for each of the 7 scope items, especially the doorbell speaker

- the measurements table below

- failure modes seen and how to recover from them

- the recommended production setup, and any risks such as Ring updates, account throttling or ToS

1. A 1–2 minute screen or phone video showing a full trigger-to-speech run at my door.
Measurements table (required):

Metric

Target

Measured

Motion event delay (motion to event received)

≤ 3 s

Snapshot time and freshness

≤ 3 s, after the motion

Gemini response time

≤ 2 s

ElevenLabs generation time

≤ 1.5 s

Ring talk session open time

≤ 5 s

Doorbell audio success rate (20 tries)

≥ 90%

End-to-end motion to first word

≤ 8 s (ideal ≤ 6 s)

Gemini correct SKIP on empty or no-person frames

≥ 95%

## 6. Success criteria

The test passes if, on my hardware, the full flow plays a relevant costume comment through the Ring doorbell speaker within 8 seconds of motion in at least 18 of 20 trials, with no manual help.

The test partially passes if everything works except the doorbell speaker, so the audio plays on the Bluetooth speaker instead. The report must say why the doorbell route failed and whether it could be fixed.

## 7. Content and privacy requirements

- Comments must be kind and family-friendly. Compliment costumes only; never comment on bodies, weight, age, race or appearance, and never guess who someone is.
- No facial recognition or biometric storage.
- Snapshots stay on the local Mac and go only to Gemini for analysis. Nothing is posted or shared.
- All API keys and Ring tokens stay in local config files that are not committed to any repo. The developer uses my keys and account only for this test.

## 8. What I'll provide

- Access to my Ring account, through a shared user on my account or a session we set up together, plus help with 2FA codes.
- Gemini API key and ElevenLabs API key, plus a voice ID.
- The Mac laptop and Bluetooth speaker, and someone to walk up to the door during tests.
- The existing prototype (ring-halloween.zip).

## 9. Proposal should include

1. Your relevant experience, such as ring-client-api, Home Assistant, Scrypted, WebRTC or SIP audio, or vision/LLM APIs
1. Your approach, and which Ring audio route you'd try first and why
1. Timeline (target: [fill in, e.g. 3–5 days])
1. Fixed price for the feasibility test: [budget range, fill in]
1. Your availability for on-site or remote testing at my door, including evening tests

## 10. Timeline

Milestone

Target date

Proposals due

[fill in]

Developer selected

[fill in]

Doorbell speaker go/no-go (scope item 3)

Day 1–2

End-to-end prototype + measurements

Day 3–4

Final report and video

Day 5

Scope item 3 is the biggest risk and must be tested first. If it fails on day 1–2, the developer should report right away so we can decide whether to continue with the Bluetooth fallback.

Contact: the project owner, [email / phone]

## Addendum A: Bluetooth speaker route

Added: October 31, 2026. This addendum modifies the RFP dated October 31, 2026.

### A.1 Purpose

The doorbell speaker route (scope item 3) is the highest-risk part of this project, and desk research suggests the ≤8 s target is a stretch on that route. This addendum promotes the Bluetooth speaker from a fallback to a first-class route that is built, measured and delivered in its own right.

A Bluetooth speaker paired to the Mac laptop is placed outside, near the door, so visitors hear the costume comment from the speaker. The audio no longer passes through Ring at all. Ring still provides the motion trigger and the snapshot.

The developer builds both routes. The Bluetooth route is the baseline that must work. The doorbell speaker route remains the stretch goal.

### A.2 Revised target flow

Ring motion event (or doorbell press)-> grab a snapshot from the Ring camera-> Gemini vision -> 1 short costume comment (or SKIP)-> ElevenLabs text-to-speech (custom voice) -> audio file-> play the audio on the Mac, with the Bluetooth speaker as the output device-> in parallel, if the doorbell speaker route is enabled: open the Ring talk session and play the same audio there-> log the snapshot, comment, timings, and which output played

Optional: play the pre-recorded "Ooh, who's this?" cover clip on the Bluetooth speaker the instant the motion event arrives, before Gemini finishes.

The system is configurable at runtime: output = bluetooth | doorbell | both. When set to both, the Bluetooth speaker plays first and the doorbell plays only if its session opens in time; the same comment must never play twice at the door.

### A.3 Scope changes

Scope item 7 (Fallbacks) is replaced by:

7. Bluetooth speaker route (baseline). Play the audio through a Bluetooth speaker paired to the Mac. Pin the speaker as the output device, keep it awake, reconnect it automatically, and measure the time from motion to first audible word. If Gemini fails, play a stock message.

New scope item:

8. Output arbitration. Implement the bluetooth | doorbell | both setting. In both mode, decide within a fixed deadline (for example 5 s after the event) whether the doorbell session is ready; otherwise commit to Bluetooth. Log the decision for every trigger.

The order of work changes. The Bluetooth route is built first, on day 1, so that an end-to-end chain exists before the doorbell speaker is attempted. The doorbell speaker go/no-go still happens on day 1–2.

### A.4 Technical requirements for the Bluetooth route

- Playback. Spawn afplay (or an ffplay/ffmpeg pipe) from Node.js. Prepend about 300 ms of silence to every clip so a sleeping speaker does not clip the first syllable.
- Keep-alive. Most Bluetooth speakers sleep after 10–30 minutes idle. Play a near-silent tone every 2–5 minutes so the speaker never sleeps during the evening.
- Output pinning. macOS can switch the output device when a speaker reconnects. Pin the output with SwitchAudioSource (Homebrew switchaudio-osx) and verify the current output device before every play.
- Auto-reconnect. Script reconnects with blueutil --connect <address>. A health check runs every 30 s and reconnects if the speaker has dropped.
- No sleep. Run the Mac on mains power with caffeinate -dimsu for the whole session.
- Radio interference. Bluetooth and 2.4 GHz Wi-Fi share spectrum. The Mac should be on 5 GHz Wi-Fi or Ethernet. Keep the Mac within about 5 m of the speaker with at most one wall or window between them.
- Loudness. Normalize all clips to about -14 LUFS with -1 dBTP peak so every comment is the same volume. The speaker must be audible at 2–3 m over street noise.
- Weather and power. The speaker sits outside, so it must be rain-protected (under an eave or in a covered spot) and fully charged or on mains. The developer documents the placement that worked in the README.
- Fallback for the fallback. If the Bluetooth speaker is unreachable, play on the Mac's built-in speaker and log a warning.

### A.5 Measurements table (additions)

Metric

Target

Measured

Bluetooth output: motion to first audible word

≤ 6 s (ideal ≤ 4 s)

Bluetooth playback start delay (command to sound)

≤ 0.5 s

Bluetooth audio success rate (20 tries)

≥ 95%

Speaker disconnects during a 3-hour soak test

0, or all recovered automatically within 30 s

Loudness at 2 m, A-weighted

≥ 70 dB(A), speech intelligible

both mode: duplicate plays at the door

0

Latency expectations from desk research: the Bluetooth route should beat the doorbell route by about 2–5 s because no Ring talk session has to open. Bluetooth itself adds roughly 0.1–0.3 s. These are estimates, not measurements.

### A.6 Revised success criteria

Section 6 of the RFP is replaced by:

- Passes (baseline): on my hardware, the full flow plays a relevant costume comment through the Bluetooth speaker within 6 s of motion in at least 18 of 20 trials, with no manual help, and the speaker stays connected through a 3-hour soak test.
- Passes (stretch): in addition, the same comment plays through the Ring doorbell speaker within 8 s of motion in at least 18 of 20 trials.
- Partially passes: the Bluetooth baseline passes but the doorbell route does not. The report must say why the doorbell route failed and whether it could be fixed.
- Fails: the Bluetooth baseline does not pass.

### A.7 Deliverable changes

- The README covers pairing the speaker, pinning the output, where to place the speaker, and how to switch between bluetooth, doorbell, and both.
- The feasibility report adds a one-paragraph comparison of the two routes, with a recommendation for which to use on the night.
- The video shows a Bluetooth-route run, and a doorbell-route run if that route works.

### A.8 What I'll provide (additions)

- The Bluetooth speaker, charged, plus its model name and Bluetooth address.
- A spot outside the door, under cover, with power within reach if the speaker needs it.
- The Mac on mains power, within Bluetooth range of the speaker.

### A.9 Proposal additions

Proposals should also state:

- Experience with macOS audio output control and Bluetooth reliability from scripts.
- Whether you recommend a wired (3.5 mm or USB) outdoor speaker instead of Bluetooth, and why. A wired speaker is more deterministic if a cable run to the door is practical.
- Whether you can supply or recommend an outdoor-rated Bluetooth speaker if mine proves unreliable.

### A.10 Revised timeline

Milestone

Target date

Proposals due

[fill in]

Developer selected

[fill in]

Bluetooth route end to end (scope items 1, 2, 4, 5, 7)

Day 1

Doorbell speaker go/no-go (scope item 3)

Day 1–2

Both routes + output arbitration + measurements

Day 3–4

Soak test, final report and video

Day 5
