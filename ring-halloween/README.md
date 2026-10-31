# Ring Halloween

When someone comes to your door, your Ring doorbell spots them, an AI writes a short compliment about their costume, and a voice says it out loud.

This is a test prototype. Right now only the skeleton works: it can run a pretend visitor from start to finish and record the result. The real Ring connection, AI comment, voice and speakers are added step by step (see `../issues/INDEX.md`).

## What you need

- A Mac with [Homebrew](https://brew.sh) installed
- **Node 24** (a program this project runs on). Node 26 will not work: as of October 2026 it breaks signing in to Ring (`ring-client-api` issues #1874 and #1876). You do not have to remove Node 26. This project finds Node 24 by itself and leaves your default alone.
- **ffmpeg** (a program that handles audio and video)

## Install

Open Terminal, go to this folder, and run these one at a time:

```
brew install node@24 ffmpeg
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

## Private files

These stay on your Mac and are never committed: `.env`, `ring-token.json`, `snapshots/` and `measurements/`.
