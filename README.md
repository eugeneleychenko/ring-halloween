# Ring Halloween

An AI greeter for a Ring doorbell. When a trick-or-treater walks up, the Ring camera takes a snapshot, Google Gemini writes a short, kind compliment about the costume, ElevenLabs speaks it in a demon voice, and the line plays on a Bluetooth speaker by the door. It ran unattended for a full Halloween night in 2026.

```
Ring motion event ─► snapshot ─► Gemini (comment or SKIP) ─► ElevenLabs TTS ─► Bluetooth speaker
                      └─► "Ooh, who's this?" cover clip plays at once to hide the delay
```

## What is in this repo

| Path | What it is |
|---|---|
| [`ring-halloween/`](ring-halloween/) | The program. Node.js, runs on a Mac. **Start with its [README](ring-halloween/README.md).** |
| [`docs/`](docs/) | The original brief ([`rfp.md`](docs/rfp.md)), the Bluetooth addendum, the feasibility assessment, and the character's [personality and canned lines](docs/personality.md) |
| [`issues/`](issues/) | The build log: 14 numbered issues with acceptance criteria, measurements and validation notes |
| [`research/`](research/) | Desk research on Ring audio, events and snapshots, Gemini and ElevenLabs, and failure modes |
| [`voice-samples/`](voice-samples/) | How the voice was picked, with ElevenLabs preview clips of the finalists |

## Quick start

You need a Mac, a Ring doorbell, a Bluetooth speaker, a Google Gemini API key and an ElevenLabs API key.

```bash
brew install node@24 ffmpeg blueutil switchaudio-osx
cd ring-halloween
npm install
cp .env.example .env        # then fill in your keys and speaker name
npm run simulate            # one pretend visitor, no network, no sound
npm run auth                # sign in to Ring once, in Terminal.app
npm run build-clips         # pre-generate the canned lines in your voice
npm run check               # does everything look right?
npm run night               # run all evening with a watchdog
```

The [app README](ring-halloween/README.md) explains each step, the settings, the Bluetooth speaker, and what to do when something sounds wrong.

## What you need to know before running it

**Ring access is unofficial.** The program uses [`ring-client-api`](https://github.com/dgreif/ring), which signs in with your Ring email, password and 2FA code and then keeps a refresh token in `ring-token.json`. Ring does not support this. It can break when Ring changes something, and heavy use could in principle attract attention to your account. Node 24 is required: Node 26 breaks Ring sign-in as of October 2026.

**Door photos leave your Mac only to go to Gemini.** On Google's free tier, Google staff may review what you send. Photos from a doorstep on Halloween include children. The program therefore refuses to send snapshots until you set `GEMINI_BILLING_CONFIRMED=true`, which you should do only after checking in Google AI Studio that your key's project is on a paid plan. Until then every visitor gets a stock compliment.

**The character is deliberately constrained.** Gemini is told to compliment costumes only, never bodies, age, race or appearance, never to guess who someone is, and to return SKIP when nobody is there. A local deny-list filters the output before it is spoken. See [`docs/personality.md`](docs/personality.md) and [`ring-halloween/config/denylist.txt`](ring-halloween/config/denylist.txt). Keep those constraints if you fork this.

**Costs.** Gemini Flash-Lite calls cost fractions of a cent. ElevenLabs library voices like the default one bill at a multiplier, and need a paid plan. Repeated lines are cached as clips so they cost nothing the second time.

## Privacy and secrets

Nothing private is in this repo, and the `.gitignore` keeps it that way:

- `.env` holds your API keys and speaker address. Only `.env.example` is committed.
- `ring-token.json` is your Ring session. Treat it like a password.
- `snapshots/` holds photos of real people at your door. `measurements/` holds CSV logs of what was seen and said. `clips/` is generated audio. All three stay local.

If you share logs or screenshots from your run, check them for faces and for your Ring device IDs first.

## Status and scope

This is a working prototype built in a few days for one house, one doorbell and one speaker. It is not a product. The doorbell's own speaker was tested and works through Ring's two-way talk, but it was quiet and crackly on the test hardware, so the Bluetooth speaker is the default and the doorbell route is kept as an option (`OUTPUT=doorbell` or `both`).

Things that would make it better are listed at the end of each issue file. Pull requests are welcome. Run `npm test` in `ring-halloween/` before opening one; the tests use temp directories and never touch your real logs or token.

## License

MIT. See [LICENSE](LICENSE).
