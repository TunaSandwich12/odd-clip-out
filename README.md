# Odd Clip Out

3–8 players each watch a clip. One player secretly gets a different clip. Players say a one-word hint out loud (on your call or stream), then the host presses **Reveal roles** to show who the imposter was and both clips. There are no timers: the host moves things along. A game is 5 rounds, with a recap at the end.

## Adding or changing clips

All clips live in `games.json`. Each game is one round's set of clips:

```json
{
  "name": "Game 6",
  "clips": [
    "https://www.youtube.com/shorts/AAAAAAAAAAA",
    "https://www.youtube.com/shorts/BBBBBBBBBBB",
    "https://www.youtube.com/shorts/CCCCCCCCCCC"
  ]
}
```

- Each game needs at least 2 clips. It can have 3 or more.
- Each round, the game picks one clip at random for everyone, and a different one from the same game for the imposter.
- Shorts links, normal `watch?v=` links and `youtu.be` links all work.
- To play only part of a long video, write the clip like this (times in seconds):
  `{ "url": "https://www.youtube.com/watch?v=XXXXXXXXXXX", "start": 30, "end": 60 }`
- Instagram reels work too. Instagram doesn't tell the game how long a reel is, so add its length in seconds:
  `{ "url": "https://www.instagram.com/reel/XXXXXXXXXXX/", "seconds": 12 }`
  Each player taps play on the reel themselves once everyone has loaded. Keep both clips in a game on the same site, or the look gives the imposter away.
- `"rounds": 5` at the top sets how many rounds a game has. Each round uses a different game, so you need at least that many games.

When the server starts, it checks every clip with YouTube. If a clip is deleted, private or blocks embedding, the host sees a warning in the lobby.

On Render: edit `games.json` on GitHub and commit. Render redeploys automatically in a few minutes.

## Settings

The host can switch on **Imposter knows they're the imposter** in the lobby. When it's off, nobody is told, not even the imposter.

## Run it on your computer

```
npm install
npm start
```

Open `http://localhost:3000`. The password is whatever `ACCESS_PASSWORD` is set to (default `letmein`).

## Files

- `server.js` handles parties, rounds, hints, votes and scores
- `games.json` holds your clips
- `public/index.html` is the page players see
