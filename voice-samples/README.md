# Ring Halloween Doorbell: Voice Selection

Researched 2026-10-31 using the ElevenLabs API (`GET /v1/shared-voices`, `/v1/voices`, `/v1/user/subscription`) and the public OpenAPI spec.

## Chosen voice: Malyx (picked by The owner)

| Field | Value |
|---|---|
| Name | **Malyx - Echoey, Menacing and Deep Demon** |
| voice_id | `vfaqCOvlrKi4Zp7C2IAm` |
| public_owner_id | `ad827f2c0300d36094ca79e518b1a5df8c3609eb269353c30dcec3ac8878a437` |
| Description | "A Deep Demon Monster. Perfect for Video Games, Characters & Animation. Ghoul, Monster, Fantasy, Dark, Horror." |
| Tags | gender neutral · middle_aged · american (en-US) · descriptive **deep** · use_case characters_animation |
| Category | `high_quality` (a high-quality library voice, not labeled `professional`) |
| Usage | cloned_by_count **29,647**; 268.4M characters in the last year; 4.45M in the last 7 days (top 10 among scary voices this week) |
| free_users_allowed | `false` (paid tiers only; **Pro qualifies**) |
| rate | **3.0** (credit multiplier; fiat_rate 0.25) |
| notice_period | 730 days (the owner must give 2 years' notice before removing the voice) |
| live_moderation_enabled | false |
| Model support (verified_languages) | `eleven_flash_v2_5` yes, `eleven_v4_turbo` yes, plus `eleven_turbo_v2_5`, `eleven_multilingual_v2`, `eleven_v4`, `eleven_v4_hq`, `eleven_flash_v2` |
| In account library? | **Yes**, added 2026-10-31 as "Malyx - Halloween Doorbell" |
| Sample | `00-CHOSEN-Malyx-vfaqCOvlrKi4Zp7C2IAm.mp3` (about 10.2 s preview) |

### Add it to the account (DONE 2026-10-31 by ring-CoS)

**Status: added** as "Malyx - Halloween Doorbell", same voice_id `vfaqCOvlrKi4Zp7C2IAm`, now in `.env` as `ELEVENLABS_VOICE_ID`. Smoke test with `eleven_flash_v2_5`, 24-word line, `mp3_44100_128`, US endpoint: HTTP 200, time to first byte 0.79 s, total 0.85 s. Sample: `00-CHOSEN-Malyx-flash-v2_5-TEST-LINE.mp3` (settings used: stability 0.45, similarity 0.8, style 0.3, speed 0.95; compare against the recommended settings below by ear).

Original add call, for reference:

```bash
KEY=$(grep '^ELEVENLABS_API_KEY=' ../.env | cut -d= -f2-)
curl -s -X POST \
  -H "xi-api-key: $KEY" -H "Content-Type: application/json" \
  "https://api.elevenlabs.io/v1/voices/add/ad827f2c0300d36094ca79e518b1a5df8c3609eb269353c30dcec3ac8878a437/vfaqCOvlrKi4Zp7C2IAm" \
  -d '{"new_name": "Halloween Doorbell"}'
```
The body schema (from OpenAPI) is `new_name` (required) and `bookmarked` (optional, default true). The response should return a `voice_id`. Library voices usually keep the same ID after adding, but use whatever the response returns.

## Account / plan

- Tier: **pro**, status active
- Voice slots: **2 used of 160** (158 free), so adding is not blocked
- add/edit counter: 1 of 290
- Characters: 105,023 used of 1,800,000 this cycle

## Recommended voice_settings (eleven_flash_v2_5, 25-word line, small outdoor speaker)

```json
{
  "model_id": "eleven_flash_v2_5",
  "voice_settings": {
    "stability": 0.55,
    "similarity_boost": 0.80,
    "style": 0.0,
    "use_speaker_boost": true,
    "speed": 0.92
  },
  "output_format": "mp3_44100_128"
}
```
Why these values:
- **stability 0.55**: Malyx's echo and demon timbre come from the voice itself, so you don't need low stability to get the menace. Below about 0.4, a demon voice tends to slur or garble words and sometimes adds odd breaths. If it sounds flat, try 0.45; if words smear, try 0.65.
- **similarity_boost 0.80**: this keeps the deep, echoey character. Going above about 0.9 can amplify artifacts from the source recording.
- **style 0.0**: style exaggeration adds latency and makes output less consistent. The voice is already exaggerated. (Unverified: whether Flash v2.5 honors `style` at all.)
- **speed 0.92**: a slightly slower pace adds dread and helps kids follow the words through a tinny speaker. Keep it at 0.85 or above, or 25 words will run past 10 seconds. The API accepts 0.7 to 1.2.
- **use_speaker_boost true**: the API notes it adds a little latency. Turn it off if you are latency-bound, and compare by ear.

Text tips for intelligibility: write short sentences, put commas or ellipses where you want pauses (for example "Ooh... what a *magnificent* pirate."), and spell out names. Stick to plain punctuation, since Flash does not reliably follow audio tags like `[whispers]`.

### Risks for this voice (latency, intelligibility, cost)

1. **Cost multiplier 3x (`rate: 3.0`)**: each greeting costs about 3 times the credits. A 25-word line is about 140 characters, so roughly 420 credits per call at 1 credit per character. Flash's discount may lower that, but I have not verified how the multiplier combines with Flash pricing. At 1.69M remaining characters this is still several thousand greetings, so the budget is fine. One option is caching audio for repeated lines.
2. **Echo and reverb are baked into the timbre**: on a small outdoor speaker, reverb plus low bass can muddy consonants. Small speakers roll off the deep bass where this voice's menace lives, so it may sound thinner and less scary than in headphones. **Test on the real speaker.** If it's muddy, add a high-pass around 100-120 Hz and a small presence boost around 2-4 kHz (post-processing), or raise stability.
3. **The "neutral" or monster register can drop or blur words** at low stability or high speed. That is the main intelligibility risk.
4. **Latency**: I found no signal that a library voice is slower than a premade one on Flash v2.5, but I did not measure it. Streaming (`/v1/text-to-speech/{id}/stream`) with `optimize_streaming_latency` is the lever if time-to-first-audio matters. Latency was not measured.
5. **Unverified:** I did not generate a test line with this voice, because the voice isn't in the account yet and generating would spend credits. The judgments above rely on the 10 s preview and voice metadata only.

## Alternates (from the earlier broad search; all support eleven_flash_v2_5 and work on Pro)

| # | Name | voice_id | public_owner_id | Why it's scary | cloned_by | rate | free users | Sample |
|---|---|---|---|---|---|---|---|---|
| 1 | Oxley - Evil Character | `2gPFXx8pN3Avh27Dw5Ma` | `ae23ca715ed6b339e4ad22f2d45dd40b36a6449e031b4f8970bfe29524bd1bbc` | Raspy baritone that is "clear, understandable, and terrifying"; very intelligible | 182,446 | 1.0 | yes | `01-Oxley-2gPFXx8pN3Avh27Dw5Ma.mp3` |
| 2 | Dante - Growly and Menacing Monster | `wXvR48IpOq9HACltTmt7` | `7f33ed0e4126402ab181a73488dc937283902d6dfae6274884ea1230b85a48dd` | Growling creature, professional clone; the closest 1x-rate alternative to Malyx | 41,446 | 1.0 | yes | `02-Dante-wXvR48IpOq9HACltTmt7.mp3` |
| 3 | True - Crime & Horror Narrator | `tZssYepgGaQmegsMEXjK` | `675db5c1a341e2f820aefb00825680aa042d958a4a3aef3200735c799210dcb4` | Whispery, dark, eerie, calm horror narrator | 315,102 | 1.0 | yes | `03-True-tZssYepgGaQmegsMEXjK.mp3` |
| 4 | Declan - Horror, Narrator | `1BfrkuYXmEwp8AWqSLWk` | `f5c376d5391ca8374f3ef4afce937d91bd32d83c585099a576a7424fc6dc1229` | Ancient, raspy, weathered Irish storyteller; trending now | 54,674 | 1.0 | yes | `04-Declan-1BfrkuYXmEwp8AWqSLWk.mp3` |
| 5 | Nora - Evil Halloween Witch | `5PWbsfogbLtky5sxqtBz` | `006e9f5f98fba4a56d36021e57e0352350b3c14d0e72dc358d5e13be863b6ac4` | Raspy whispers, sinister cackle-witch; featured | 7,294 | 2.0 | no (Pro OK) | `05-Nora-5PWbsfogbLtky5sxqtBz.mp3` |

## Other findings

- **Premade/default voices**: none are horror voices. The closest is **Callum - Husky Trickster** (`N2lVS1w4EtoT3dr4eOWO`, "deceptively gravelly, yet unsettling edge"), which is mildly creepy at best.
- **Seasonal voices**: the API has no dedicated Halloween collection. The `featured=true` list currently includes many horror voices (Nora - Evil Halloween Witch, Vivien - Mysterious Witch, Dante, Alien Master, Oxley, Declan, Gorex, Ian - Distorted Alien). The `trending` sort surfaces "Victor - Halloween Horror Calm Narrator" (`GoV1V2hQd1doxcYR2SuA`), Declan, and "Silas - Weathered Villain". Malyx is not marked featured.
- The `descriptives=` filter returned 0 results for creepy, spooky, and scary. `search=` matches names and descriptions.
- **Not done:** the community-recommendation web search (Reddit and YouTube) was dropped after the change of plan, so no community sources are cited.
