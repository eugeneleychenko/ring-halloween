# Addendum A: Bluetooth speaker route

Added: October 31, 2026. This addendum modifies the RFP dated October 31, 2026.

## A.1 Purpose

The doorbell speaker route (scope item 3) is the highest-risk part of this project, and desk research suggests the ≤8 s target is a stretch on that route. This addendum promotes the Bluetooth speaker from a fallback to a **first-class route** that is built, measured and delivered in its own right.

A Bluetooth speaker paired to the Mac laptop is placed outside, near the door, so visitors hear the costume comment from the speaker. The audio no longer passes through Ring at all. Ring still provides the motion trigger and the snapshot.

The developer builds **both** routes. The Bluetooth route is the baseline that must work. The doorbell speaker route remains the stretch goal.

## A.2 Revised target flow

Ring motion event (or doorbell press)
-> grab a snapshot from the Ring camera
-> Gemini vision -> 1 short costume comment (or SKIP)
-> ElevenLabs text-to-speech (custom voice) -> audio file
-> **play the audio on the Mac, with the Bluetooth speaker as the output device**
-> in parallel, if the doorbell speaker route is enabled: open the Ring talk session and play the same audio there
-> log the snapshot, comment, timings, and which output played

Optional: play the pre-recorded "Ooh, who's this?" cover clip on the Bluetooth speaker the instant the motion event arrives, before Gemini finishes.

The system is configurable at runtime: `output = bluetooth | doorbell | both`. When set to `both`, the Bluetooth speaker plays first and the doorbell plays only if its session opens in time; the same comment must never play twice at the door.

## A.3 Scope changes

Scope item 7 (Fallbacks) is replaced by:

7. **Bluetooth speaker route (baseline).** Play the audio through a Bluetooth speaker paired to the Mac. Pin the speaker as the output device, keep it awake, reconnect it automatically, and measure the time from motion to first audible word. If Gemini fails, play a stock message.

New scope item:

8. **Output arbitration.** Implement the `bluetooth | doorbell | both` setting. In `both` mode, decide within a fixed deadline (for example 5 s after the event) whether the doorbell session is ready; otherwise commit to Bluetooth. Log the decision for every trigger.

The order of work changes. The Bluetooth route is built first, on day 1, so that an end-to-end chain exists before the doorbell speaker is attempted. The doorbell speaker go/no-go still happens on day 1–2.

## A.4 Technical requirements for the Bluetooth route

- **Playback.** Spawn `afplay` (or an ffplay/ffmpeg pipe) from Node.js. Prepend about 300 ms of silence to every clip so a sleeping speaker does not clip the first syllable.
- **Keep-alive.** Most Bluetooth speakers sleep after 10–30 minutes idle. Play a near-silent tone every 2–5 minutes so the speaker never sleeps during the evening.
- **Output pinning.** macOS can switch the output device when a speaker reconnects. Pin the output with `SwitchAudioSource` (Homebrew `switchaudio-osx`) and verify the current output device before every play.
- **Auto-reconnect.** Script reconnects with `blueutil --connect <address>`. A health check runs every 30 s and reconnects if the speaker has dropped.
- **No sleep.** Run the Mac on mains power with `caffeinate -dimsu` for the whole session.
- **Radio interference.** Bluetooth and 2.4 GHz Wi-Fi share spectrum. The Mac should be on 5 GHz Wi-Fi or Ethernet. Keep the Mac within about 5 m of the speaker with at most one wall or window between them.
- **Loudness.** Normalize all clips to about -14 LUFS with -1 dBTP peak so every comment is the same volume. The speaker must be audible at 2–3 m over street noise.
- **Weather and power.** The speaker sits outside, so it must be rain-protected (under an eave or in a covered spot) and fully charged or on mains. The developer documents the placement that worked in the README.
- **Fallback for the fallback.** If the Bluetooth speaker is unreachable, play on the Mac's built-in speaker and log a warning.

## A.5 Measurements table (additions)

| Metric | Target | Measured |
|---|---|---|
| Bluetooth output: motion to first audible word | ≤ 6 s (ideal ≤ 4 s) | |
| Bluetooth playback start delay (command to sound) | ≤ 0.5 s | |
| Bluetooth audio success rate (20 tries) | ≥ 95% | |
| Speaker disconnects during a 3-hour soak test | 0, or all recovered automatically within 30 s | |
| Loudness at 2 m, A-weighted | ≥ 70 dB(A), speech intelligible | |
| `both` mode: duplicate plays at the door | 0 | |

Latency expectations from desk research: the Bluetooth route should beat the doorbell route by about 2–5 s because no Ring talk session has to open. Bluetooth itself adds roughly 0.1–0.3 s. These are estimates, not measurements.

## A.6 Revised success criteria

Section 6 of the RFP is replaced by:

- **Passes (baseline):** on my hardware, the full flow plays a relevant costume comment through the **Bluetooth speaker** within **6 s** of motion in at least 18 of 20 trials, with no manual help, and the speaker stays connected through a 3-hour soak test.
- **Passes (stretch):** in addition, the same comment plays through the **Ring doorbell speaker** within 8 s of motion in at least 18 of 20 trials.
- **Partially passes:** the Bluetooth baseline passes but the doorbell route does not. The report must say why the doorbell route failed and whether it could be fixed.
- **Fails:** the Bluetooth baseline does not pass.

## A.7 Deliverable changes

- The README covers pairing the speaker, pinning the output, where to place the speaker, and how to switch between `bluetooth`, `doorbell`, and `both`.
- The feasibility report adds a one-paragraph comparison of the two routes, with a recommendation for which to use on the night.
- The video shows a Bluetooth-route run, and a doorbell-route run if that route works.

## A.8 What I'll provide (additions)

- The Bluetooth speaker, charged, plus its model name and Bluetooth address.
- A spot outside the door, under cover, with power within reach if the speaker needs it.
- The Mac on mains power, within Bluetooth range of the speaker.

## A.9 Proposal additions

Proposals should also state:

- Experience with macOS audio output control and Bluetooth reliability from scripts.
- Whether you recommend a wired (3.5 mm or USB) outdoor speaker instead of Bluetooth, and why. A wired speaker is more deterministic if a cable run to the door is practical.
- Whether you can supply or recommend an outdoor-rated Bluetooth speaker if mine proves unreliable.

## A.10 Revised timeline

| Milestone | Target date |
|---|---|
| Proposals due | [fill in] |
| Developer selected | [fill in] |
| Bluetooth route end to end (scope items 1, 2, 4, 5, 7) | Day 1 |
| Doorbell speaker go/no-go (scope item 3) | Day 1–2 |
| Both routes + output arbitration + measurements | Day 3–4 |
| Soak test, final report and video | Day 5 |
