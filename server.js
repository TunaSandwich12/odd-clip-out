// Odd Clip Out — party lobby server
// Run: npm install, then npm start. Players open http://<your-address>:3000
const path = require("path");
const os = require("os");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const COLORS = ["#ffd23f", "#ff8fab", "#7bdff2", "#b8f28b", "#c3a6ff", "#ffb26b"];

const app = express();
app.use(express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server);

// code -> { code, hostId, phase, players: Map<socketId, player> }
const parties = new Map();

function newCode() {
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () => L[Math.floor(Math.random() * L.length)]).join("");
  } while (parties.has(code));
  return code;
}

function cleanName(s) {
  return String(s ?? "").replace(/[\u0000-\u001f​-‏‪-‮<>]/g, "").trim().slice(0, 16);
}

function partyState(party) {
  return {
    code: party.code,
    phase: party.phase,
    hostId: party.hostId,
    min: MIN_PLAYERS,
    max: MAX_PLAYERS,
    players: [...party.players.values()].map(({ id, name, color, ready }) => ({ id, name, color, ready })),
  };
}

function broadcast(party) {
  io.to(party.code).emit("party", partyState(party));
}

function leaveParty(socket) {
  const code = socket.data.code;
  if (!code) return;
  const party = parties.get(code);
  socket.leave(code);
  socket.data.code = null;
  if (!party) return;
  party.players.delete(socket.id);
  if (party.players.size === 0) {
    parties.delete(code);
    return;
  }
  if (party.hostId === socket.id) party.hostId = party.players.keys().next().value; // next oldest player becomes host
  broadcast(party);
}

io.on("connection", (socket) => {
  function join(party, name, color, ack) {
    if (party.players.size >= MAX_PLAYERS) return ack({ error: `That party is full (${MAX_PLAYERS} players max).` });
    if (party.phase !== "lobby") return ack({ error: "That party has already started a round." });
    leaveParty(socket);
    party.players.set(socket.id, {
      id: socket.id,
      name,
      color: COLORS.includes(color) ? color : COLORS[0],
      ready: false,
    });
    socket.join(party.code);
    socket.data.code = party.code;
    ack({ ok: true, you: socket.id });
    broadcast(party);
  }

  socket.on("create", ({ name, color } = {}, ack = () => {}) => {
    name = cleanName(name);
    if (!name) return ack({ error: "Type your name first." });
    const code = newCode();
    const party = { code, hostId: socket.id, phase: "lobby", players: new Map() };
    parties.set(code, party);
    join(party, name, color, ack);
  });

  socket.on("join", ({ name, color, code } = {}, ack = () => {}) => {
    name = cleanName(name);
    if (!name) return ack({ error: "Type your name first." });
    const party = parties.get(String(code || "").toUpperCase());
    if (!party) return ack({ error: "No party with that code. Check the letters and try again." });
    join(party, name, color, ack);
  });

  socket.on("ready", (ready) => {
    const party = parties.get(socket.data.code);
    const p = party?.players.get(socket.id);
    if (!p || party.phase !== "lobby") return;
    p.ready = !!ready;
    broadcast(party);
  });

  socket.on("start", (ack = () => {}) => {
    const party = parties.get(socket.data.code);
    if (!party || party.hostId !== socket.id) return ack({ error: "Only the host can start." });
    const players = [...party.players.values()];
    if (players.length < MIN_PLAYERS) return ack({ error: `Need at least ${MIN_PLAYERS} players.` });
    if (!players.every((p) => p.ready)) return ack({ error: "Not everyone is ready yet." });
    party.phase = "round";
    ack({ ok: true });
    broadcast(party);
  });

  socket.on("backToLobby", () => {
    const party = parties.get(socket.data.code);
    if (!party || party.hostId !== socket.id) return;
    party.phase = "lobby";
    party.players.forEach((p) => (p.ready = false));
    broadcast(party);
  });

  socket.on("leave", () => leaveParty(socket));
  socket.on("disconnect", () => leaveParty(socket));
});

server.listen(PORT, () => {
  console.log(`\nOdd Clip Out is running.`);
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === "IPv4" && !n.internal) console.log(`  Same Wi-Fi players: http://${n.address}:${PORT}`);
    }
  }
  console.log("");
});
