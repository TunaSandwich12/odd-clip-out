# Odd Clip Out — party lobby prototype

Players create or join a party with a 4-letter code. 3–8 players, everyone hits Ready, the host starts the round.

## Run it

1. Install Node.js (LTS) from https://nodejs.org if you don't have it.
2. Open a terminal in this folder and run:

   ```
   npm install
   npm start
   ```

3. The terminal prints the addresses to open, for example:

   ```
   On this computer:   http://localhost:3000
   Same Wi-Fi players: http://192.168.1.20:3000
   ```

## Testing on your own

Open `http://localhost:3000` in two or three browser windows (use a private/incognito window for each so they act as different players). Create a party in one, join with the code in the others.

## Playing with people on other networks

The server only runs on your computer, so people elsewhere need a private route to it. The easiest free option is **Tailscale**:

1. You and each friend install Tailscale and log in.
2. Invite them to your Tailscale network.
3. They open `http://<your-tailscale-ip>:3000` (shown in the Tailscale app).

Only people you've invited can reach the game. It is not on the public internet.

## Files

- `server.js` — keeps track of parties and players
- `public/index.html` — the page players see
