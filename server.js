// Odd Clip Out — game server
// Run: npm install, then npm start. Clips live in games.json.
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const COLORS = ["#ffd23f", "#ff8fab", "#7bdff2", "#b8f28b", "#c3a6ff", "#ffb26b", "#ff6b6b", "#5eead4"];
const TIMES = {
  load: 15000, // wait this long for everyone's player to load before pressing play anyway
  reconnectGrace: 45000, // keep a dropped player's seat this long
};

// Players must enter this to use the game. Set it on your host as ACCESS_PASSWORD.
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || "letmein";
if (!process.env.ACCESS_PASSWORD) console.warn('No ACCESS_PASSWORD set, using the default "letmein". Set your own before sharing the link.');

// ---------- clips ----------
function parseClip(entry) {
  const c = typeof entry === "string" ? { url: entry } : entry || {};
  const s = String(c.url || "").trim();
  let m, id, vertical = false;
  if ((m = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/))) { id = m[1]; vertical = true; }
  else if ((m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/))) id = m[1];
  else if ((m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/))) id = m[1];
  else if ((m = s.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/))) id = m[1];
  if (!id) return null;
  return {
    id,
    url: s,
    vertical: typeof c.vertical === "boolean" ? c.vertical : vertical,
    start: Number.isFinite(c.start) ? Math.max(0, Math.floor(c.start)) : undefined,
    end: Number.isFinite(c.end) ? Math.floor(c.end) : undefined,
  };
}

let clipProblems = []; // filled in by checkClips()

function loadGames() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(__dirname, "games.json"), "utf8"));
  } catch (e) {
    console.error("Couldn't read games.json:", e.message);
    return { rounds: 5, games: [] };
  }
  const games = [];
  (raw.games || []).forEach((g, i) => {
    const name = String(g.name || `Game ${i + 1}`).slice(0, 40);
    const clips = (g.clips || []).map(parseClip).filter(Boolean);
    if (clips.length < 2) console.warn(`${name}: needs at least 2 valid YouTube links, skipping it.`);
    else games.push({ name, clips });
  });
  return { rounds: Math.max(1, Number(raw.rounds) || 5), games };
}

// Ask YouTube whether each clip exists and allows embedding. Results show in the host's lobby.
async function checkClips() {
  const { games } = loadGames();
  const problems = [];
  for (const g of games) {
    for (const c of g.clips) {
      try {
        const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + c.id)}`);
        if (r.status === 401 || r.status === 403) problems.push(`${g.name}: ${c.url} doesn't allow embedding on other sites`);
        else if (r.status === 404 || r.status === 400) problems.push(`${g.name}: ${c.url} wasn't found (deleted or private?)`);
      } catch (e) {
        console.warn("Couldn't check clips with YouTube right now:", e.message);
        return;
      }
    }
  }
  clipProblems = problems;
  if (problems.length) problems.forEach((p) => console.warn("Clip problem:", p));
  else console.log(`All clips in games.json look good (${games.length} games).`);
}

// ---------- helpers ----------
const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server);

function samePassword(given) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(ACCESS_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
io.use((socket, next) => {
  if (samePassword(socket.handshake.auth?.password)) return next();
  setTimeout(() => next(new Error("wrong_password")), 800); // slow down guessing
});

const rid = (n = 9) => crypto.randomBytes(n).toString("base64url");
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function cleanName(s) {
  return String(s ?? "").replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e<>]/g, "").trim().slice(0, 16);
}
function cleanWord(s) {
  return String(s ?? "").replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e<>]/g, "").trim();
}

// ---------- parties ----------
// code -> party
const parties = new Map();

function newCode() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do code = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
  while (parties.has(code));
  return code;
}

const playersOf = (party) => [...party.players.values()];
const activeOf = (party) => playersOf(party).filter((p) => p.connected);
const byId = (party, id) => playersOf(party).find((p) => p.id === id);

function setTimer(party, ms, fn) {
  clearTimeout(party.timer);
  party.deadline = ms ? Date.now() + ms : 0;
  party.timer = ms ? setTimeout(() => { party.deadline = 0; fn(); }, ms) : null;
}

function publicState(party) {
  const cur = party.cur;
  const host = party.players.get(party.hostKey);
  const { games, rounds } = loadGames();
  const s = {
    code: party.code,
    phase: party.phase,
    hostId: host?.id,
    min: MIN_PLAYERS,
    max: MAX_PLAYERS,
    settings: party.settings,
    round: party.round,
    totalRounds: party.totalRounds || Math.min(rounds, games.length),
    endsIn: party.deadline ? Math.max(0, party.deadline - Date.now()) : 0,
    players: playersOf(party).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      ready: p.ready,
      connected: p.connected,
      loaded: !!cur?.loaded.has(p.key),
      watched: !!cur?.watched.has(p.key),
    })),
  };
  if (cur) {
    s.playing = cur.started;
    if (party.phase === "reveal") s.result = cur.result;
  }
  if (party.phase === "final") s.history = party.history;
  return s;
}

function personalState(party, p) {
  const cur = party.cur;
  const me = { id: p.id, isHost: party.hostKey === p.key };
  if (me.isHost && party.phase === "lobby" && clipProblems.length) me.clipProblems = clipProblems;
  if (cur && party.phase === "watch") {
    const isImp = cur.imposterKey === p.key;
    const clip = isImp ? cur.impClip : cur.mainClip;
    me.clip = { id: clip.id, vertical: clip.vertical, start: clip.start, end: clip.end, round: party.round };
    if (party.settings.imposterKnows) me.isImposter = isImp;
  }
  return me;
}

function broadcast(party) {
  const pub = publicState(party);
  for (const p of party.players.values()) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit("party", pub);
    io.to(p.socketId).emit("me", personalState(party, p));
  }
}

// ---------- game flow ----------
function startMatch(party) {
  const { games, rounds } = loadGames();
  if (!games.length) return "No games are set up yet. Add clips to games.json.";
  party.totalRounds = Math.min(rounds, games.length);
  party.deck = shuffle(games).slice(0, party.totalRounds);
  party.round = 0;
  party.history = [];
  startRound(party);
}

function startRound(party) {
  party.round++;
  const game = party.deck[party.round - 1];
  const clips = shuffle(game.clips);
  const players = playersOf(party);
  const imposter = pick(players.filter((p) => p.connected).length ? players.filter((p) => p.connected) : players);
  party.cur = {
    gameName: game.name,
    mainClip: clips[0],
    impClip: pick(clips.slice(1)),
    imposterKey: imposter.key,
    imposterId: imposter.id,
    imposterName: imposter.name,
    loaded: new Set(),
    watched: new Set(),
    started: false,
    result: null,
  };
  party.phase = "watch";
  setTimer(party, TIMES.load, () => beginPlayback(party));
  broadcast(party);
}

function beginPlayback(party) {
  const cur = party.cur;
  if (party.phase !== "watch" || cur.started) return;
  cur.started = true;
  setTimer(party, 0); // no time limit: the host reveals when everyone's ready
  broadcast(party);
}

function reveal(party) {
  if (party.phase !== "watch") return;
  const cur = party.cur;
  setTimer(party, 0);
  cur.result = {
    gameName: cur.gameName,
    imposterId: cur.imposterId,
    imposterName: cur.imposterName,
    imposterLeft: !party.players.has(cur.imposterKey),
    mainClip: cur.mainClip,
    impClip: cur.impClip,
    lastRound: party.round >= party.totalRounds,
  };
  party.history.push({ round: party.round, gameName: cur.gameName, imposterName: cur.imposterName });
  party.phase = "reveal";
  broadcast(party);
}

// Called whenever someone leaves, drops or acts: moves the round on if nobody is left to wait for.
function checkProgress(party) {
  const cur = party.cur;
  if (!cur) return;
  const active = activeOf(party);
  if (party.phase !== "lobby" && party.phase !== "final" && party.players.size < 2) {
    party.phase = "lobby";
    party.cur = null;
    setTimer(party, 0);
    party.players.forEach((p) => (p.ready = false));
    return broadcast(party);
  }
  if (party.phase === "watch" && !party.players.has(cur.imposterKey)) return reveal(party);
  if (party.phase === "watch" && !cur.started && active.every((p) => cur.loaded.has(p.key))) return beginPlayback(party);
  broadcast(party);
}

function removePlayer(party, key) {
  const p = party.players.get(key);
  if (!p) return;
  clearTimeout(p.removeTimer);
  party.players.delete(key);
  if (party.players.size === 0) {
    setTimer(party, 0);
    parties.delete(party.code);
    return;
  }
  if (party.hostKey === key) party.hostKey = party.players.keys().next().value; // oldest player becomes host
  if (party.cur) return checkProgress(party);
  broadcast(party);
}

// ---------- sockets ----------
io.on("connection", (socket) => {
  const ctx = () => {
    const party = parties.get(socket.data.code);
    const p = party?.players.get(socket.data.key);
    return p && p.socketId === socket.id ? { party, p } : {};
  };

  function seat(party, name, color, ack) {
    if (party.players.size >= MAX_PLAYERS) return ack({ error: `That party is full (${MAX_PLAYERS} players max).` });
    if (party.phase !== "lobby") return ack({ error: "That party is in the middle of a game. Join when they're back in the lobby." });
    leave();
    const key = rid(12);
    party.players.set(key, {
      key,
      id: rid(6),
      socketId: socket.id,
      name,
      color: COLORS.includes(color) ? color : COLORS[0],
      ready: false,
      connected: true,
    });
    if (!party.hostKey) party.hostKey = key;
    socket.data.code = party.code;
    socket.data.key = key;
    ack({ ok: true, code: party.code, key });
    broadcast(party);
  }

  function leave() {
    const { party, p } = ctx();
    socket.data.code = socket.data.key = null;
    if (party) removePlayer(party, p.key);
  }

  socket.on("create", ({ name, color } = {}, ack = () => {}) => {
    name = cleanName(name);
    if (!name) return ack({ error: "Type your name first." });
    const code = newCode();
    const party = { code, hostKey: null, phase: "lobby", settings: { imposterKnows: false }, players: new Map(), round: 0, cur: null, timer: null, deadline: 0 };
    parties.set(code, party);
    seat(party, name, color, ack);
  });

  socket.on("join", ({ name, color, code } = {}, ack = () => {}) => {
    name = cleanName(name);
    if (!name) return ack({ error: "Type your name first." });
    const party = parties.get(String(code || "").toUpperCase());
    if (!party) return ack({ error: "No party with that code. Check the letters and try again." });
    seat(party, name, color, ack);
  });

  // Coming back after a refresh or a dropped connection.
  socket.on("resume", ({ code, key } = {}, ack = () => {}) => {
    const party = parties.get(String(code || ""));
    const p = party?.players.get(String(key || ""));
    if (!p) return ack({ error: "gone" });
    clearTimeout(p.removeTimer);
    if (p.socketId && p.socketId !== socket.id) io.sockets.sockets.get(p.socketId)?.disconnect(true); // old tab
    p.socketId = socket.id;
    p.connected = true;
    socket.data.code = party.code;
    socket.data.key = key;
    ack({ ok: true });
    checkProgress(party);
    if (!party.cur) broadcast(party);
  });

  socket.on("ready", (ready) => {
    const { party, p } = ctx();
    if (!p || party.phase !== "lobby") return;
    p.ready = !!ready;
    broadcast(party);
  });

  socket.on("settings", (s = {}) => {
    const { party, p } = ctx();
    if (!p || party.hostKey !== p.key || party.phase !== "lobby") return;
    if (typeof s.imposterKnows === "boolean") party.settings.imposterKnows = s.imposterKnows;
    broadcast(party);
  });

  socket.on("start", (ack = () => {}) => {
    const { party, p } = ctx();
    if (!p || party.hostKey !== p.key) return ack({ error: "Only the host can start." });
    if (party.phase !== "lobby") return ack({ error: "A game is already running." });
    const players = playersOf(party);
    if (players.length < MIN_PLAYERS) return ack({ error: `Need at least ${MIN_PLAYERS} players.` });
    if (!players.every((x) => x.ready)) return ack({ error: "Not everyone is ready yet." });
    const err = startMatch(party);
    ack(err ? { error: err } : { ok: true });
  });

  socket.on("loaded", () => {
    const { party, p } = ctx();
    if (!p || party.phase !== "watch") return;
    party.cur.loaded.add(p.key);
    checkProgress(party);
  });

  socket.on("watched", ({ error } = {}) => {
    const { party, p } = ctx();
    if (!p || party.phase !== "watch") return;
    party.cur.loaded.add(p.key);
    party.cur.watched.add(p.key);
    if (error) console.warn(`Round ${party.round} (${party.cur.gameName}): ${p.name}'s clip couldn't play (YouTube error ${error}).`);
    checkProgress(party);
  });

  // Host controls
  socket.on("startNow", () => {
    const { party, p } = ctx();
    if (p && party.hostKey === p.key) beginPlayback(party);
  });

  socket.on("reveal", () => {
    const { party, p } = ctx();
    if (p && party.hostKey === p.key) reveal(party);
  });

  socket.on("next", () => {
    const { party, p } = ctx();
    if (!p || party.hostKey !== p.key || party.phase !== "reveal") return;
    if (party.round < party.totalRounds) startRound(party);
    else { party.phase = "final"; broadcast(party); }
  });

  socket.on("toLobby", () => {
    const { party, p } = ctx();
    if (!p || party.hostKey !== p.key) return;
    setTimer(party, 0);
    party.phase = "lobby";
    party.cur = null;
    party.round = 0;
    party.totalRounds = 0;
    party.players.forEach((x) => (x.ready = false));
    broadcast(party);
  });

  socket.on("leave", leave);

  socket.on("disconnect", () => {
    const { party, p } = ctx();
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    p.removeTimer = setTimeout(() => removePlayer(party, p.key), TIMES.reconnectGrace);
    checkProgress(party);
    if (!party.cur) broadcast(party);
  });
});

// Keep the server up for everyone else if one request hits a bug.
process.on("uncaughtException", (e) => console.error("Unexpected error:", e));

server.listen(PORT, () => {
  console.log(`\nOdd Clip Out is running.`);
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === "IPv4" && !n.internal) console.log(`  Same Wi-Fi players: http://${n.address}:${PORT}`);
    }
  }
  console.log("");
  checkClips();
});
