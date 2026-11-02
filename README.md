# Ring Halloween

**Your Ring doorbell compliments every trick-or-treater's costume, out loud, in a spooky voice.**

A kid in a dinosaur costume walks up to your door. Your Ring camera sees them. A second later a deep demon voice from a speaker by the door says: *"Ooh, who's this?"* Then: *"A dinosaur! Those teeth could scare a whole street. Happy Halloween, mighty lizard."*

Nobody needs to be home. It ran unattended for a full Halloween night in 2026 and greeted every visitor.

## How it works, in one picture

```
Someone walks up
      │
      ▼
Ring doorbell notices motion ──► takes a photo
      │                              │
      ▼                              ▼
Speaker says "Ooh, who's this?"   Google Gemini looks at the photo
(instantly, to cover the wait)    and writes one kind line about the costume
                                     │
                                     ▼
                                  ElevenLabs turns that line into speech
                                     │
                                     ▼
                                  The speaker by your door says it
```

If Gemini sees nobody (a car, a cat, a leaf), it says nothing. If anything breaks, the speaker plays one of 26 pre-made compliments instead, so visitors always get something.

## What you need

| | What | Why |
|---|---|---|
| 1 | **A Mac** (laptop is fine) that can sit plugged in near the door for the evening | It runs the program |
| 2 | **A Ring video doorbell**, and your Ring login | It spots visitors and takes the photo |
| 3 | **A Bluetooth speaker** | It is the voice. Put it outside, near the door |
| 4 | **A Google account** | For a free Gemini AI key |
| 5 | **An ElevenLabs account** ([elevenlabs.io](https://elevenlabs.io)) | For the voice. Free plan works; the deep demon voice needs a paid plan |
| 6 | **The Claude app** ([claude.ai/download](https://claude.ai/download)) | Claude does the technical setup for you |

Total cost for the evening, beyond what you already have: usually under a dollar in AI usage.

## Set it up (no coding needed)

**Open [SETUP-PROMPT.md](SETUP-PROMPT.md), copy the prompt inside it, and paste it into Claude on your Mac.**

Claude will install what is needed, ask you for your keys one at a time, help you pick a voice, pair the speaker, sign you in to Ring, and do a dress rehearsal at your own door. It explains every step in plain language and waits for you when it needs something. Plan for about 30 to 45 minutes.

If you would rather do it by hand, the step-by-step instructions are in [ring-halloween/README.md](ring-halloween/README.md).

## On the night

1. Plug the Mac in. Charge the speaker and put it by the door.
2. Open the Terminal app and run the two lines Claude gave you (they end with `npm run night`).
3. Leave. It restarts itself if anything goes wrong.
4. Afterwards, the `measurements` folder has a log of every visitor: when they came, what the camera saw, and what the voice said.

## Three things worth knowing

**Children's photos and Google.** On Google's free tier, Google staff may look at photos you send to Gemini. Doorstep photos on Halloween are full of kids. So this program will **not** send any photo to Gemini until you confirm your Google key is on a paid plan (costs are tiny). Until then it works in a simpler mode: every visitor gets a random pre-made compliment and no photo ever leaves your Mac. Both modes are fine. You choose.

**It is kind on purpose.** The AI is told to compliment costumes only. Never bodies, weight, age, race or looks. Never guess who someone is. A word filter double-checks every line before it is spoken. Please keep that if you change it.

**Ring does not officially allow this.** The program signs in to Ring the way the Ring app does, using a well-known open-source library. Ring could change something and break it, though it has worked for years. Your Ring password is typed once, in the Terminal app, where no program can read it, and is never saved.

## Privacy

Everything stays on your Mac: your keys, your Ring session, the photos, and the logs. Nothing is uploaded except the one photo per visitor that goes to Gemini (and only if you turned that on). This repository contains no keys and no photos, and it is set up so you cannot accidentally publish yours.

## For developers

- [`ring-halloween/`](ring-halloween/) is the program: Node 24, plain JavaScript, no framework. Its [README](ring-halloween/README.md) covers every command and setting.
- [`docs/`](docs/) has the original brief, the Bluetooth addendum, the feasibility assessment, and the character's [personality and canned lines](docs/personality.md).
- [`issues/`](issues/) is the build log: 14 issues with acceptance criteria, measurements and validation notes.
- [`research/`](research/) is the desk research on Ring audio, events and snapshots, Gemini and ElevenLabs.
- [`voice-samples/`](voice-samples/) explains how the voice was chosen.

The doorbell's own speaker works through Ring's two-way talk (`OUTPUT=doorbell` or `both`) but was quiet and crackly on the test hardware, so Bluetooth is the default. Run `npm test` before a pull request; the tests use temp folders and never touch real logs or tokens.

## License

MIT. See [LICENSE](LICENSE).
