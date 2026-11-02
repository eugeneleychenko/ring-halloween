# Let Claude set it up for you

You do not need to know how to code. Claude will do the technical work and talk you through the rest, one step at a time.

## Before you start

1. **Install the Claude app** on the Mac that will run the doorbell: [claude.ai/download](https://claude.ai/download). Sign in. Any paid Claude plan works.
2. In the Claude app, open **Code** in the sidebar.
3. When it asks for a folder, create a new empty folder called `ring-halloween` in your Documents and pick it.
4. Copy **everything inside the box below**, paste it into the message box, and press Enter.

Have these ready, or Claude will help you get them as you go:

- Your **Ring** email and password, and your phone for the code Ring texts you
- A **Google** account (for the Gemini AI key)
- An **ElevenLabs** account (for the voice): [elevenlabs.io](https://elevenlabs.io)
- A **Bluetooth speaker**, charged and switched on

## The prompt

Copy from the first line to the last line of this box.

````text
You are helping me, a non-technical person, set up the open-source "Ring Halloween" project on this Mac. It makes my Ring doorbell greet trick-or-treaters: the camera takes a photo, Google Gemini writes a kind compliment about the costume, ElevenLabs speaks it in a spooky voice, and it plays on a Bluetooth speaker by my door.

The project is at https://github.com/eugeneleychenko/ring-halloween. Read its README.md and ring-halloween/README.md before you do anything else, and follow them. If they disagree with anything below, the READMEs win.

How to work with me:
- Treat me as someone who has never used Terminal. Explain each step in one or two plain sentences before you do it. No jargon without a one-line explanation.
- Do one step at a time. After each step, tell me what happened and what comes next, then wait for me when you need something from me.
- Do all the technical work yourself: installing programs, downloading the project, writing settings files, running commands. Only ask me to do things a program cannot do: sign in to websites, copy a key, click a button on my phone, type a password, walk to the door.
- Never show my API keys or password back to me on screen, never put them in any file except the project's .env file, and never commit or upload them anywhere. If you ever need to show a file that contains a key, hide the key.
- Do not change the project's code. Only create and edit the .env file, and only run the commands the READMEs describe.
- If something fails, read the error, explain it to me in plain words, and try to fix it yourself before asking me anything.
- If the Mac asks for my password or to install "command line developer tools", tell me to click Install or type my Mac password, and wait.

Work through these phases in order.

PHASE 1. Install.
Check this is a Mac. Install Homebrew if it is missing (https://brew.sh), then: brew install node@24 ffmpeg blueutil switchaudio-osx. Download the project into this folder with git clone, then run npm install inside the ring-halloween folder. Run npm test and tell me if everything passed. If tests fail, do not continue; tell me exactly what failed.

PHASE 2. Settings file.
Copy ring-halloween/.env.example to ring-halloween/.env. We will fill it in during the next phases. Explain to me that this one file holds my private keys and stays on this Mac.

PHASE 3. The voice (ElevenLabs).
Ask me whether I already have an ElevenLabs account and whether it is a free or paid plan. If I have none, send me to https://elevenlabs.io to create one (free is fine to start). Then walk me to the API keys page (click my profile picture, then "API Keys", then "Create API key") and ask me to paste the key here. Put it in .env as ELEVENLABS_API_KEY.
Then choose a voice with me. Read voice-samples/README.md in the project: it lists the voice this project was built with (Malyx, a deep demon; needs a paid ElevenLabs plan and costs 3x) and several alternatives that work on the free plan (Oxley and Dante are good spooky choices). Offer me the options in one short list with a one-line description each. Then add the voice I pick to my ElevenLabs account using the ElevenLabs API (POST /v1/voices/add/{public_owner_id}/{voice_id} with the IDs from that README, body {"new_name": "Halloween Doorbell"}), put the returned voice ID in .env as ELEVENLABS_VOICE_ID, and set CHARACTER_NAME to the voice's first name. Generate one short test sentence with it, save it as a file, play it with afplay, and ask me whether I like how it sounds. If not, let me pick again.

PHASE 4. The AI (Google Gemini).
Send me to https://aistudio.google.com/api-keys, tell me to sign in with Google and click "Create API key", and ask me to paste it here. Put it in .env as GEMINI_API_KEY.
Then explain this carefully, because it matters: on Google's free tier, Google staff may look at photos sent to Gemini, and photos from my doorstep on Halloween will include children. So the project will NOT send any photos to Gemini until I confirm my key's project has billing turned on. Without billing, everything still works, but every visitor gets a random pre-made compliment instead of a personal one. Give me both choices plainly:
  (a) Keep it simple: leave GEMINI_BILLING_CONFIRMED=false. No photos leave the Mac. Pre-made compliments only.
  (b) Personal compliments: on the same AI Studio page, open the project's plan or billing settings and switch to a paid plan (costs are tiny, a fraction of a cent per visitor). When I tell you it says a paid tier and not "Free", set GEMINI_BILLING_CONFIRMED=true.
Do whatever I choose. Never set it to true unless I have told you I checked.

PHASE 5. The Bluetooth speaker.
Tell me to turn the speaker on and pair it in System Settings > Bluetooth (walk me through it if I ask). Then run blueutil --paired to find its name and address, confirm the name with me, and put them in .env as BLUETOOTH_SPEAKER_NAME and BLUETOOTH_SPEAKER_ADDRESS. Leave OUTPUT=bluetooth. Play a short sound through it with afplay and ask me if I heard it from the speaker and not the Mac. If it came from the Mac, use SwitchAudioSource to point output at the speaker and try again.

PHASE 6. Pre-made lines.
Run npm run build-clips. This makes about 26 short audio lines in my chosen voice and uses some ElevenLabs credits (a few thousand characters). Tell me before you run it. Play two of the finished clips for me.

PHASE 7. Sign in to Ring.
This step I must do myself, because the password has to be typed where no program can see it. Tell me to open the Terminal app (press Command-Space, type Terminal, press Enter), then paste these two lines one at a time, where FOLDER is the full path to the ring-halloween folder inside this project (print the real path for me):
  cd FOLDER
  npm run auth
Tell me it will ask for my Ring email, then my password (nothing appears while I type, that is normal), then the code Ring sends to my phone. When I say it is done, run npm run devices and tell me in plain words which doorbell it found and whether anything about it would block the project (live view disabled, end-to-end encryption on, or a battery doorbell, which is slower). If I have more than one doorbell, ask which one and set RING_DEVICE_NAME.

PHASE 8. Dress rehearsal.
Run npm run check and explain every FAIL or WARN line to me in plain words, then fix what you can. Then run npm run simulate and confirm it says "Result: played". Then start npm start, tell me to walk up to my own door and wave at the camera, and tell me what happened: how long it took, what it said, and whether it chose a comment or SKIP. Stop it afterwards. If I did not hear anything, work through the Bluetooth section of ring-halloween/README.md with me.

PHASE 9. Show time.
Explain that on the night I should keep the Mac plugged in and awake-capable, with the speaker charged and placed near the door, and run npm run night in Terminal (it restarts itself if anything goes wrong). Print the exact two commands for me to paste. Explain how to stop it (Control-C) and where to look afterwards (the measurements folder) to see what it said to each visitor. Also tell me that bin/health-check prints a quick "is it healthy" summary while it runs. Do not start npm run night yourself; that is my call on the night.

Finish by giving me a short checklist of everything that is set up and anything that is still waiting on me.
````

## If something goes wrong

Tell Claude what you see on screen, in your own words. It can read the error and usually fix it. If you get properly stuck, open an issue at [github.com/eugeneleychenko/ring-halloween/issues](https://github.com/eugeneleychenko/ring-halloween/issues) and paste what Claude told you. Leave your keys out of it.
