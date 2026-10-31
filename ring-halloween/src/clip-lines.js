// Every pre-generated line, from personality.md section 2. The voice does the
// scaring; the words do the hugging. Filenames in clips/ follow these categories.
export const CLIP_LINES = {
  // Short enough (2.5 s with lead-in) to fit the 6 s Bluetooth budget.
  cover: ["Ooooh… who's there?", 'Footsteps… hmm.', 'Who dares?', 'A visitor…', 'Mwahaha… wait.'],
  // For nights when the cover clip is the whole reaction.
  'cover-long': [
    'Ooooh… who dares approach my door?',
    'I sense… a visitor. Let me take a look…',
    'Hmm… footsteps! Now, what do we have here…',
    'A knock at the door of doom… or is it?',
    'Mwahaha… wait, wait, wait… who is this?',
  ],
  fallback: [
    'What a magnificent costume! A thousand years at this door, and you still surprised me. Happy Halloween!',
    'Ooooh, that costume is wonderful. Even a door demon is impressed. Take some candy and go have fun!',
    'Behold! The best costume to reach my door tonight. Well… so far. Happy Halloween, brave one!',
    'Spooky, sparkly, splendid! I love it. Grab some candy before I get too jealous.',
    'You look ready for the greatest Halloween ever. I approve! Go on, the candy awaits.',
    'A fine costume indeed. I would clap, but I have no hands. Happy Halloween!',
    'Oh my… that is a good one. The pumpkins are whispering about you already. Enjoy your night!',
    'Impressive! Most impressive. The door demon gives you two thumbs up… if I had thumbs.',
    'Every Halloween I wait for a costume like that. Worth it! Take your treats, friend.',
    'Boo! Ha, I scared myself. Great costume, by the way. Happy Halloween!',
  ],
  group: [
    'A whole crew of costumes! You all look fantastic. There is candy enough for everyone… I think.',
    'So many spooky friends at once! Wonderful costumes, all of you. Happy Halloween!',
    'Is this a party? It looks like a party. Great costumes, everyone. Come get your treats!',
  ],
  press: [
    'You rang? Oh good, I was getting bored in here. Happy Halloween!',
    'Ding dong… the demon is home! Welcome, welcome. Treats are on the way.',
    'Ah, the doorbell! Nobody has pressed it in a hundred years. Thank you! Candy is coming.',
  ],
  skip: [
    'Hmm… nobody there. Just the wind. Or a very sneaky ghost.',
    'False alarm! Back to my nap. Wake me when the costumes arrive.',
  ],
  error: ['Happy Halloween, brave visitor! Your costume is wonderful. Please take some candy!'],
  signoff: [
    'Farewell! Be spooky, be safe, and save me a chocolate.',
    'Go forth and trick or treat! The door demon salutes you.',
  ],
}
