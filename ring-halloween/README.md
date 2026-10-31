# Ring Halloween

When someone comes to your door, your Ring doorbell spots them, an AI writes a short compliment about their costume, and a voice says it out loud.

This is a test prototype. The AI comment and the voice work. The Ring connection and speakers are being added step by step (see `../issues/INDEX.md`).

## What you need

- A Mac with [Homebrew](https://brew.sh) installed
- **Node 24** (a program this project runs on). Node 26 will not work: as of October 2026 it breaks signing in to Ring (`ring-client-api` issues #1874 and #1876). You do not have to remove Node 26. This project finds Node 24 by itself and leaves your default alone.
- **ffmpeg** (a program that handles audio and video)
- **blueutil** and **switchaudio-osx** (small programs that reconnect the Bluetooth speaker and keep the Mac's sound pointed at it)

## Install

Open Terminal, go to this folder, and run these one at a time:

```
brew install node@24 ffmpeg blueutil switchaudio-osx
npm install
```

Homebrew may update other programs while it installs. If `node -v` shows an error afterwards, run `brew upgrade node`.

## Settings

Your settings go in a file called `.env`. It holds private keys and is never shared or committed.

```
cp .env.example .env
```

Open `.env` in a text editor and fill in:

| Setting | What it is |
|---|---|
| `OUTPUT` | Where the voice comes out: `bluetooth`, `doorbell` or `both` |
| `GEMINI_API_KEY` | Your Google Gemini key |
| `ELEVENLABS_API_KEY` | Your ElevenLabs key |
| `ELEVENLABS_VOICE_ID` | The voice to use |
| `GEMINI_BILLING_CONFIRMED` | Set to `true` once you have checked billing (see below) |
| `SKIP_BEHAVIOR` | When nobody is there: `silence`, or `line` for a short joke |
| `SIGN_OFF` | `true` adds a goodbye after each comment |

If you already have a `.env` in the folder above this one, it is read automatically, so you can skip this step.

## Try it

```
npm run simulate
```

This sends one pretend visitor through the whole chain. It does not touch your doorbell or the internet, and it makes no sound. You should see `Result: played`, and one new row in `measurements/runs.csv`. Open that file in Numbers or Excel to see it.

To check what is set up:

```
npm start
```

This lists what is switched on. It shows only whether each key is present, never the key itself. Once you are signed in to Ring, it also stays running and waits for visitors. Press Ctrl-C to stop it.

## Sign in to Ring

You only do this once. Run it in the Mac's **Terminal app**, not inside Claude Code or another tool, because those can't hide your password as you type:

```
npm run auth
```

It asks for your Ring email, then your password, then a code Ring sends you. Nothing appears on screen while you type the password. That is on purpose. Your email and password are not saved; only a sign-in token is, in `ring-token.json`. If you run it again, it notices you are already signed in and asks for nothing. To sign in again from scratch, run `npm run auth -- --force`.

To see your doorbell's details at any time:

```
npm run devices
```

If it says live view is blocked or E2EE is on, change that in the Ring app.

## The Bluetooth speaker

The speaker is the main voice on the night. Pair it to the Mac in System Settings, then put its name and address in `.env` as `BLUETOOTH_SPEAKER_NAME` and `BLUETOOTH_SPEAKER_ADDRESS`.

While `npm start` runs, the Mac stays awake, the sound output stays pointed at the speaker, a nearly silent sound plays every 3 minutes so the speaker doesn't go to sleep, and the connection is checked every 30 seconds. If the speaker can't be reached, the voice plays on the Mac's own speaker and a warning goes in `measurements/bluetooth.csv`.

**If it suddenly sounds like a bad phone call:** macOS may have started using the speaker's microphone, which forces the speaker into low-quality call mode. The program checks for this and switches the mic back to the Mac's own, and logs when it does. To fix it by hand, go to System Settings > Sound > Input and pick the Mac's microphone.

**Volume:** each play sets the Mac's volume to `BLUETOOTH_VOLUME` (80 unless you change it), so it will override the Mac's volume slider while this runs. Set it to `unchanged` to leave the volume alone.

Keep the Mac plugged in. Bluetooth and 2.4 GHz Wi-Fi share the airwaves, so use 5 GHz Wi-Fi if you can.

## Gemini: check billing first

On Google's free tier, Google staff may read what you send. Photos from your door can include children, so **door photos are not sent to Gemini until you confirm billing is on.** Until then, every visitor gets a stock compliment.

1. Go to [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys) and find the project for your key.
2. Check that its plan is a paid tier, not "Free".
3. In `.env`, set `GEMINI_BILLING_CONFIRMED=true`.

**Status: not yet confirmed.** Google's API doesn't show this to a program, so a person has to check.

To test how well the AI spots people, put photos in a folder with a `label.csv` file (columns: `file, person_visible`) and run `npm run eval-gemini <folder>`.

## The voice

The voice is Malyx, on the ElevenLabs Pro plan (1,800,000 characters a month).

- **It costs 3x.** Malyx bills three credits per character, so a 25-word line costs about 420 credits. Repeated lines are saved and reused, so they cost nothing the second time.
- **Pre-made clips.** `npm run build-clips` makes the 26 ready-to-play lines in `clips/`, listed by category in `clips/manifest.json`. Run it again after changing a line, the voice or a setting; only what changed gets remade.
- **If words sound blurry outside.** The echo is part of the voice, and it can blur consonants on a small speaker. In `.env`, try `TTS_HIGHPASS_HZ=110` and `TTS_PRESENCE_DB=3`, then run `npm run build-clips` again.
- **To tune by ear.** `TTS_STABILITY`, `TTS_SIMILARITY_BOOST`, `TTS_STYLE` and `TTS_SPEED` are all in `.env`.

## Private files

These stay on your Mac and are never committed: `.env`, `ring-token.json`, `snapshots/`, `measurements/`, `clips/` and `eval/`.
