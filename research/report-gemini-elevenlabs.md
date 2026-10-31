# Feasibility research: Gemini vision (scope item 4), ElevenLabs voice (scope item 5), and handing audio to the Ring speaker

Researched 2026-10-31. Sources are official docs fetched that day unless a date is given. **[UNVERIFIED]** marks a claim I could not confirm from a primary source. **[ESTIMATE]** marks my own engineering estimate. Nothing below was measured on the user's hardware or API keys.

## 1. Verdicts

| Service | RFP target | Verdict | Confidence |
|---|---|---|---|
| Gemini vision: ≤25-word kind costume comment, or SKIP | ≤ 2 s response | **Conditional GO.** Use `gemini-3.5-flash-lite` with `thinking_level: "minimal"`, `media_resolution: "low"` (or medium), a downscaled JPEG, a warm connection, and a paid (billing-enabled) project. The median should land well under 2 s. p95 is near the limit (1.45 s p95 time-to-first-token for text alone, see 3.1), so expect a few slow outliers. Use a hard timeout of about 2.5 s and fall back to a stock line. | Medium-high on the median, medium on p95 |
| Gemini SKIP accuracy | ≥ 95% correct SKIP on empty frames | **Conditional, must be measured.** No published evidence covers Gemini on Ring night-vision (near-IR grayscale) snapshots. It is likely reachable with a SKIP-biased prompt plus structured output. A cheap pre-filter on Ring's person-detection flag helps further, if the user's plan has it ([UNVERIFIED], Ring researcher to confirm). | Medium |
| Kind, non-identifying content | Rule in RFP section 7 | **GO, with guardrails.** System instruction, structured output, safety thresholds, and a local post-filter with a stock-line fallback. | High |
| ElevenLabs custom-voice TTS | ≤ 1.5 s generation | **GO.** Flash v2.5 has about 75–100 ms model latency. A full ~25-word clip should come back in roughly 0.3–0.9 s, and time-to-first-byte (TTFB) should be about 0.15–0.4 s when streamed. An Instant Voice Clone (IVC) is fine. A Professional Voice Clone (PVC) is slower; use `use_pvc_as_ivc` or test it. | High |
| Hand-off to the Ring speaker (format side only) | — | **GO on format, with one design trap.** `transcodeReturnAudio()` always re-encodes, so no ElevenLabs format avoids ffmpeg. WAV or PCM costs the least. The trap: the call ends when that ffmpeg process exits, so a "cover clip, then comment" sequence must go into ONE continuous ffmpeg input (see section 5). | High on format, medium on the workaround (untested) |

## 2. Recommended settings

### Gemini
- **Model:** `gemini-3.5-flash-lite`. It is stable, released 2026-07-21, with no shutdown date announced. Its thinking defaults to "minimal", and it supports structured output.
  - Backup if night accuracy is weak: `gemini-3.6-flash` with `thinking_level: "minimal"`. It defaults to medium thinking, so you must set this.
  - Avoid `gemini-3.8-flash` for this job. Its lowest thinking level is "low" (it has no minimal), and it is 2.5x the input price.
  - Avoid the 2.5 models. Google is "limiting access to the 2.5 models to users who have actively used them in the past" and points new projects to 3.5 Flash-Lite or 3.8 Flash.
  - `gemini-3.1-flash-lite` is cheaper but has a shutdown date of 2027-05-07. Its thinking default is not in the docs table [UNVERIFIED].
- **Thinking:** set `thinking_level: "minimal"` explicitly. Don't rely on the default.
- **Image:** before sending, downscale the snapshot to about 768 px on the long side as a ~70% quality JPEG (roughly 40–90 KB). Set `media_resolution: "low"` (280 tokens per image on Gemini 3/4) and A/B test it against `"medium"` (560 tokens) on night frames. Default and `high` are 1,120 tokens and add latency for no benefit here. Docs tip: put the text before the image in the input.
- **Output:** structured output (`response_format` with a JSON schema; the docs show `enum` support). Example:
  `{ "person_visible": boolean, "decision": enum["COMMENT","SKIP"], "comment": string }`
  - Put the decision field first so the model commits before it writes the comment.
  - Cap output at about 80 tokens.
  - Use a low temperature, about 0.4–0.7, so lines vary without drifting.
  - Plain text with a literal `SKIP` sentinel also works and is slightly simpler. JSON is easier to validate.
- **System instruction (outline):**
  - You greet trick-or-treaters at a front door.
  - Compliment the COSTUME only, in 25 words or fewer, kid-friendly, upbeat.
  - Never mention body, weight, age, race, skin, hair, or attractiveness. Never guess who a real person is. Naming the costume character (witch, Spider-Man) is fine.
  - If no person is clearly visible, set SKIP. Shadows, cars, pets, decorations, empty porch, and blur all count as SKIP. When unsure, SKIP.
  - Images may be grayscale infrared at night: don't mention colours unless they are clearly visible.
  - Optionally return a `costume_category` enum so a cached clip can play (see section 6).
- **Safety settings:** the docs say adjustable filters default to **Off** for Gemini 2.5 and later. Set `harassment` and `hate_speech` to `block_low_and_above` explicitly. Child-safety protections are always on and cannot be adjusted. If the output is blocked, empty, longer than 25 words, or matches a local deny-list (fat, skinny, old, ugly, race and ethnicity terms, "you look like <real person>", and so on), play a stock line.
- **Latency hygiene:**
  - Create the SDK client once and keep the HTTP/2 connection warm. Send a tiny warm-up request at startup and every few minutes to avoid repeated TLS handshakes ([ESTIMATE] saves about 100–300 ms on a cold call).
  - Send the image inline as base64; don't use the Files API.
  - Set a client-side timeout of about 2.5 s, then fall back.
  - "Priority inference" exists as a consumption option for 3.5 Flash-Lite and may tighten tail latency. Its price and effect were not checked [UNVERIFIED].
- **API surface:** current docs show the new Interactions API (`client.interactions.create`, `@google/genai`). The docs still mention `generateContent`, so the prototype's calls probably still work, but this was not confirmed [UNVERIFIED]. Check the prototype's SDK version.
- **Cost:** about 280 image tokens + ~300 prompt tokens + ~40 output tokens comes to about $0.0003 per call at $0.30 per 1M input and $2.50 per 1M output. 1,000 triggers cost about $0.30.

### ElevenLabs
- **Model:** `eleven_flash_v2_5`: about 75 ms on the pricing page, about 100 ms median in the docs, excluding network; $0.04 per 1K characters on the API price list.
  - `eleven_flash_v2` (English only) is about 135 ms, so it gains nothing here.
  - Optional test: `eleven_v4_turbo` (about 100 ms, more expressive, $0.04 per 1K). The docs say it is "available via the Text to Dialogue websocket". Whether it is accepted on the plain `/v1/text-to-speech` endpoint is [UNVERIFIED].
  - Avoid `eleven_multilingual_v2` and `eleven_v4`, which are high latency.
- **Endpoints:**
  - Live lines: use `POST /v1/text-to-speech/{voice_id}/stream` to start playback at TTFB.
  - Cached bank: use `POST /v1/text-to-speech/{voice_id}` (non-stream).
  - Base URL: `api.us.elevenlabs.io` pins US servers. Check the `x-region` header.
- **Output format:** use `pcm_24000` or `pcm_16000` when streaming into a FIFO (named pipe), or `wav_24000` or `wav_16000` for files. The `wav_*` values are only on the non-stream endpoint, per the OpenAPI enum fetched 2026-10-31. See section 5 for why.
- **Voice:**
  - IVC (Starter plan or higher) is in the fastest latency group.
  - PVC (Creator plan or higher) is slower. Docs: "We are actively working on optimizing PVC latency for Flash v2.5." For a PVC voice, try `use_pvc_as_ivc: true`.
- **Text:** Flash v2.5 does no text normalization by default. Keep numbers out of the prompt output, or have Gemini spell them out.

## 3. Evidence

### 3.1 Gemini
- **Model lineup** (models page fetched 2026-10-31; https://ai.google.dev/gemini-api/docs/models): Gemini 4 Argon; 3.8 Flash; 3.6 Flash; 3.5 Flash-Lite ("fastest, most cost-effective 3.5 model"); 3.1 Flash-Lite; plus Live, TTS and image models.
- **Thinking defaults** (https://ai.google.dev/gemini-api/docs/thinking):

  | Model | Default thinking | Levels supported |
  |---|---|---|
  | 3.5-flash-lite | On (minimal) | minimal, low, medium, high |
  | 3.6-flash | On (medium) | minimal–high |
  | 3.8-flash | On (medium) | low, medium, high |
  | 2.5-flash-lite | Off | — |

  Thinking can't be fully disabled on 3.x; "minimal" is the floor.
- **Deprecations** (https://ai.google.dev/gemini-api/docs/deprecations, updated 2026-10-22): 3.5-flash-lite has no shutdown date. 3.1-flash-lite shuts down 2027-05-07. 2.5 access is restricted to prior users.
- **Pricing** (https://ai.google.dev/gemini-api/docs/pricing): 3.5 Flash-Lite is $0.30 per 1M input (text/image/video/audio) and $2.50 per 1M output, including thinking. The free tier is "free of charge", but "Used to improve our products: Yes".
- **Image tokens** (https://ai.google.dev/gemini-api/docs/media-resolution): Gemini 3/4 images cost low 280, medium 560, high and default 1,120, ultra_high 2,240 tokens.
- **Latency evidence:**
  - Google blog, 2026-07-21: "3.5 Flash-Lite ... 350 output tokens/s" (https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-6-flash-3-5-flash-lite-3-5-flash-cyber/).
  - Artificial Analysis reports 406 tok/s, but a 6.59 s time to first *answer* token (https://artificialanalysis.ai/models/gemini-3-5-flash-lite). That figure is for the reasoning configuration on their benchmark prompts and includes thinking time, so it does **not** represent minimal thinking on a short prompt.
  - llm-stats reports a **p95 TTFT of 1.45 s** via Google over the trailing 7 days (page dated 2026-07-21, viewed 2026-10-31; https://llm-stats.com/models/gemini-3.5-flash-lite). The workload mix is unknown.
  - Roboflow vision playground: 3.9 s average inference per sample (https://playground.roboflow.com/models/google/gemini-3-5-flash-lite, from the search snippet only). The task, thinking setting, and output length are unknown, so this is a warning sign, not a contradiction.
  - **No published single-image, minimal-thinking latency figure was found [UNVERIFIED].**
- **Estimated Gemini budget [ESTIMATE]:**
  - Upload of a ~60 KB JPEG on home broadband: 50–150 ms
  - Prefill of about 600 tokens plus minimal thinking: 300–900 ms
  - About 40 output tokens at ~350 tok/s: about 120 ms
  - **Total: about 0.6–1.3 s median, 1.5–2.5 s p95.** The developer must measure this with 50 or more calls.

### 3.2 ElevenLabs
- **Models** (https://elevenlabs.io/docs/overview/models): `eleven_flash_v2_5` "~100ms†"; `eleven_v4_turbo` "~100ms†"; `eleven_flash_v2` "~135ms†". † = median, excluding application and network latency. Turbo v2 and v2.5 are deprecated in favour of Flash.
- **Pricing pages:**
  - API price list (https://elevenlabs.io/pricing/api): Flash/Turbo "Ultra-low latency (~75ms)", $0.04 per 1K characters. v4 Turbo is $0.04 per 1K.
  - Plans (https://elevenlabs.io/pricing): Free has 10k credits a month and no IVC. Starter adds a commercial licence and IVC, with 30k credits. Creator adds PVC, with 121k credits. Pro adds 44.1 kHz PCM through the API and 192 kbps. The pricing-page snippet says Flash costs 0.5–1 credit per character on the API.
- **Latency guide** (https://elevenlabs.io/docs/eleven-api/guides/how-to/best-practices/latency-optimization):
  - Flash over websockets has 100–150 ms TTFB in North America.
  - Voice speed order: default, synthetic, and IVC voices are fastest; PVC is slower.
  - "Higher audio quality output formats can increase latency."
- **Output formats** (OpenAPI at https://api.elevenlabs.io/openapi.json, fetched 2026-10-31):
  - Stream endpoint: mp3_22050_32, mp3_24000_48, mp3_44100_32/64/96/128/192, pcm_8000/16000/22050/24000/32000/44100/48000, ulaw_8000, alaw_8000, opus_48000_32/64/96/128/192.
  - Non-stream endpoint: the same list plus wav_8000 through wav_48000.
  - Tier rules from the docs: mp3 at 192 kbps needs Creator or higher, and PCM/WAV at 44.1 kHz needs Pro or higher.
  - Whether pcm_48000 and opus_48000_* are tier-gated is not stated [UNVERIFIED]. All formats at 24 kHz and below appear available on every plan [UNVERIFIED for Free].
- **Concurrency** (models page): Free allows 4 concurrent Flash requests and Starter allows 6, which is plenty.
- **Estimated ElevenLabs budget [ESTIMATE]:**
  - Streamed: TTFB 150–400 ms from a US home connection with a warm connection.
  - Non-streamed: a full 25-word (~150-character, ~7–8 s of audio) clip takes 0.3–0.9 s.
  - The ≤1.5 s target is met either way. Measure p95.
- **Cost:** about 100 lines × ~130 characters = 13k characters, which is about 6.5k–13k credits on Flash. That is borderline on Free (10k a month). Starter covers it (30k credits; $6 a month, first month shown as $1), and Starter is required anyway for a cloned voice. Free can't create an IVC. It may use premade or designed voices. Whether Free can use Voice Library voices through the API is [UNVERIFIED].

### 3.3 ring-client-api return audio (brief)
- Source: https://raw.githubusercontent.com/dgreif/ring/main/packages/ring-client-api/streaming/streaming-session.ts (main branch, fetched 2026-10-31).
- `transcodeReturnAudio({input})` spawns: `ffmpeg -re -i <input...> -acodec (libopus -ac 2 -ar 48k | pcm_mulaw -ac 1 -ar 8k) -f rtp rtp://127.0.0.1:<port>`.
  - It uses Opus when Ring's SDP answer contains `opus/`, and otherwise PCMU (mu-law) at 8 kHz.
  - So **any** input is decoded and re-encoded, and ElevenLabs can't supply a pass-through format.
  - `-re` paces the input at real-time speed, so "transcode time" is effectively playback time. The CPU cost of a mono 16–24 kHz clip is negligible.
- **Only the ffmpeg start-up and first-packet delay matter** ([ESTIMATE] about 50–200 ms on a Mac). WAV or PCM input is the cheapest to decode, ahead of mp3 or Opus decoding.
- The `input` array is placed right after `-i`, so you can't add `-f s16le -ar ...` input flags in front of it. **Raw `pcm_*` needs a container.** Two options:
  - Request `wav_24000` from the non-stream endpoint.
  - Or prepend a 44-byte WAV header yourself when writing streamed `pcm_24000` to a file or FIFO. A WAV header with an oversized data length works for streaming [ESTIMATE].
- Picking `ulaw_8000` "to match PCMU" doesn't save a transcode, because ffmpeg re-encodes anyway, and it hurts quality if Ring negotiates Opus.
- **Trap:** `FfmpegProcess` is created with `exitCallback: () => this.callEnded()`, so **the live call ends as soon as the return-audio ffmpeg exits.** You can't play the cover clip, wait, and then call `transcodeReturnAudio` again in the same session. See section 5.
- Advanced alternative: skip ffmpeg and push pre-encoded Opus RTP packets with `call.sendAudioPacket(rtp)`. That gives full control over sequencing, but it is more work [UNVERIFIED in practice].

## 4. SKIP accuracy and night (IR) images

- **Evidence:**
  - I found no published benchmark of Gemini, or any frontier vision-language model (VLM), on doorbell near-IR night snapshots [UNVERIFIED].
  - Ring night mode is active near-IR, which gives reflective grayscale images. That is closer to a monochrome photo than to thermal imagery.
  - The thermal-imagery literature suggests VLMs degrade on out-of-distribution sensor modalities: ThermEval, 2026, https://dl.acm.org/doi/abs/10.1145/3770855.3817469. I saw only the title and snippet; the page was bot-blocked.
  - That does not transfer directly to near-IR. The likely night failure modes [ESTIMATE] are:
    - IR bloom or overexposure on close faces and white costumes
    - motion blur
    - fisheye distortion
    - low resolution on battery models
    - no colour information, which hurts costume naming but matters less for SKIP
    - IR glare from spider webs, insects and rain, which can trigger motion with no person present
- **Pre-filter:** if the Ring event carries a person-detection flag, use it as the first gate (Ring researcher to confirm availability and plan requirements [UNVERIFIED]). Gemini then acts as the second gate.
- **Prompt measures:**
  - Bias toward SKIP ("when unsure, SKIP").
  - List the known false-trigger objects.
  - Tell the model the image may be grayscale IR.
  - Ask for `person_visible` before the comment.
  - Optionally require "a person's full head and torso" to count, so a passer-by at the edge of frame doesn't get greeted.
- **Evaluation method (recommended):**
  1. **Build a labelled set from the user's own Ring camera.** Pull past motion snapshots and recordings, plus staged shots on test night.
     - At least 100 no-person frames: day, dusk, and IR night; cars, pets, swaying decorations, shadows, rain or insects in IR, headlights sweeping.
     - At least 50 person frames: costumed and plain clothes; single and group; partly in frame; close (IR bloom) and far.
     - 95% on only 20 empty frames is statistically meaningless. With 100 empties, 95 correct gives a 95% confidence interval of about 89–98% (Wilson) [ESTIMATE].
  2. Run each frame 3 times at the production settings, because outputs are nondeterministic. Record decision, comment, and latency.
  3. Report the metrics:
     - SKIP specificity on empty frames (target ≥95%).
     - Person recall, meaning no false SKIP on real visitors. Suggested target ≥90%; the RFP doesn't set one.
     - Kindness and policy violations: a human rates every generated comment, and the target is 0 violations.
     - Word-count compliance.
     - p50/p95 latency, split by day and night.
  4. A/B test `media_resolution` low vs medium, and 3.5 Flash-Lite vs 3.6 Flash with minimal thinking, on the same set. Pick the cheapest setting that meets the targets.
  5. Save the set and a script so it can be re-run after prompt changes. Snapshots stay local.

## 5. Latency budget (per step, realistic) [ESTIMATE unless noted]

| Step | Realistic p50 | Realistic p95 | Notes |
|---|---|---|---|
| Image prep (resize, JPEG) | 20–50 ms | 100 ms | sharp or ffmpeg locally |
| Gemini request (3.5 Flash-Lite, minimal, low-res) | 0.6–1.3 s | 1.5–2.5 s | Target ≤2 s; enforce a 2.5 s timeout and fall back |
| ElevenLabs Flash v2.5, streamed TTFB | 0.15–0.4 s | 0.6 s | Docs: 100–150 ms websocket TTFB in NA, excluding app overhead |
| ElevenLabs Flash v2.5, full clip (non-stream) | 0.3–0.9 s | 1.2 s | Target ≤1.5 s |
| ffmpeg spawn to first RTP packet | 50–200 ms | 300 ms | `-re` means playback runs at real time after that |
| Cached clip (no TTS) | ~0 ms | ~0 ms | See section 6 |
| **Gemini + TTS on the critical path** | **≈1.0–2.0 s** | **≈2.5–3.5 s** | Fits the 8 s end-to-end budget if the Ring talk session is opened **in parallel** at motion time, not after TTS |

- **Ordering:** on motion, start `startLiveCall()` and the snapshot fetch at the same time. Run Gemini, then TTS, while the session negotiates.
- **Cover clip under the single-ffmpeg constraint:**
  - Create a FIFO with `mkfifo` and pass it as the `input`.
  - Write a WAV header, then the cover-clip PCM ("Ooh, who's this?", about 1.2 s), then pad with silence PCM until the comment arrives, then the comment PCM. Close the FIFO afterwards.
  - With `-re`, ffmpeg plays it continuously in one session, and the call ends on EOF.
  - Status: [UNVERIFIED, untested design]. Watch the ~30 s live-session cap on battery models.

## 6. Pre-caching and streaming

- **Pre-generated bank: feasible and recommended.** It is cheap: about 50 clips × 60 characters is about 3k characters, a few cents.
  1. 3–5 cover clips ("Ooh, who's this?", "Well, well, what do we have here...").
  2. 10–20 generic fallbacks for a Gemini timeout or error ("Happy Halloween! Love the costume!").
  3. **Optional costume-category bank.** Give Gemini an enum of the ~30–40 most common costumes (witch, vampire, ghost, skeleton, princess, superhero, Spider-Man, dinosaur, pumpkin, zombie, pirate, ninja, fairy, inflatable, and so on) with 2–3 cached lines each.
     - When Gemini returns a known category, play the cached line instantly. TTS leaves the critical path, and the cached text has been human-vetted for kindness.
     - Fall back to live TTS of Gemini's free-text comment for unusual costumes.
     - This hybrid is the strongest latency and safety lever available.
  - Store clips as `wav_24000` (any plan) so ffmpeg needs no extra input flags.
- **Streaming Gemini into ElevenLabs sentence by sentence: little gain, not recommended.**
  - The comment is 1–2 sentences, about 40 tokens. Gemini generates that in about 0.1 s once the first token arrives, so nearly all the Gemini time is prefill and thinking before the first token.
  - Sentence-level streaming would save perhaps 50–150 ms [ESTIMATE] at a real cost in complexity. Structured JSON output also arrives as fragments.
  - The better gain is streaming ElevenLabs **output** (`pcm_24000` over `/stream` into the FIFO) so playback starts at TTFB instead of after the full clip: about 0.2–0.6 s saved [ESTIMATE].
  - The ElevenLabs websocket input-streaming mode (`auto_mode`) is an option if a later design streams text, but it isn't needed for a 25-word line.

## 7. ToS and content-policy flags (not legal advice)

1. **Gemini free tier is a data-use issue.**
   - The Gemini API Additional Terms (https://ai.google.dev/gemini-api/terms) say that for Unpaid Services, Google uses submitted content to improve products, and "human reviewers may read, annotate, and process your API input and output ... Do not submit sensitive, confidential, or personal information to the Unpaid Services."
   - Snapshots of children at the door should not go to the unpaid tier. **Enable Cloud Billing on the project, which makes it a Paid Service.** Paid content is not used for training, but it is still logged "for a limited period of time" for abuse detection.
   - The cost is pennies. It also conflicts less with the RFP privacy wording ("go only to Gemini for analysis").
2. **Gemini API age clause.** The same terms say: "You must be 18 years of age or older to use the APIs. You also will not use the Services as part of a website, application, or other service ... that is directed towards or is likely to be accessed by individuals under the age of 18."
   - Here the minors are photographed subjects, not users who access the app. Arguably the app is not "accessed by" them, but it is a gray area worth flagging to the user.
3. **Generative AI Prohibited Use Policy** (https://policies.google.com/terms/generative-ai/use-policy, last modified 2024-12-17).
   - Relevant clauses:
     - no "using personal data or biometrics without legally-required consent"
     - no tracking or monitoring of people without consent
     - no harassment or "insulting of others"
   - The RFP's exclusion of face recognition and identity guessing, plus the kindness guardrails, line up with this policy.
   - Local recording and biometric laws for a doorbell camera are outside this research scope, but there is no biometric processing here.
4. **Gemini safety filters default to Off** for 2.5 and later, per the safety-settings doc (https://ai.google.dev/gemini-api/docs/safety-settings). Kindness therefore rests on the prompt and the post-filter. Set thresholds explicitly anyway.
5. **ElevenLabs voice cloning.**
   - An IVC needs Starter or higher; a PVC needs Creator or higher.
   - Cloning a real person's voice requires that person's consent and rights. This is standard ElevenLabs policy, but the current ToS wording was not fetched [UNVERIFIED].
   - The Free plan has no commercial licence. That is fine for personal Halloween use; attribution requirements are [UNVERIFIED].
6. **Ring ToS** for the unofficial talk-session route is covered by the Ring researcher.

## 8. Open questions

1. Which Ring model and power type does the user have? This sets snapshot resolution and the 30 s vs 60 s session cap, and how the cover-clip FIFO must be timed.
2. Is the user's ElevenLabs voice ID a premade, designed, IVC, or PVC voice, and on which plan? PVC adds latency, and the plan sets which formats are available.
3. Is the user's Gemini key on a billing-enabled project? Strongly recommended, see 7.1.
4. Is a Ring person-detection flag available on motion events for this account? It would make a cheap SKIP pre-filter.
5. Real measured p50/p95 for `gemini-3.5-flash-lite` with minimal thinking on one low-resolution image from the user's network. No public figure exists.
6. Does `eleven_v4_turbo` work on the standard TTS stream endpoint, and does it beat Flash v2.5 on quality at equal latency?
7. Does the Ring session tolerate a FIFO input with silence padding and a stall of up to ~2 s without dropping? This needs a bench test.
8. Does the existing prototype use `generateContent` or the Interactions API, and does its SDK version support `thinking_level` and `media_resolution`?
