// server.js
// Node.js + Express + ws WebSocket server
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files (index.html, create.html, room.html)
app.use(express.static(path.join(__dirname)));

// Simple API to check room existence
app.get("/api/rooms/:code", (req, res) => {
  const code = req.params.code;
  if (rooms[code]) return res.json({ exists: true });
  return res.status(404).json({ exists: false });
});

// Rooms data structure
// rooms[code] = {
//   gamesCount, timeBefore, maxUsers,
//   games: [{type:'wheel'|'guess', name, prize, extra}], // extra used for guess game
//   users: [username], sockets: Set(ws), currentGameIndex, scores: {username: points}, state: {}
// }
let rooms = {};

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcastRoom(code, data) {
  if (!rooms[code]) return;
  for (const ws of rooms[code].sockets) {
    send(ws, data);
  }
}

/** Utility to sanitize and normalize text for comparison */
function normalizeText(s) {
  if (!s) return "";
  return s.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\w\s]/g,"").trim();
}

// Guess-game image bank and answers (ordered)
const GUESS_IMAGES = [
  "https://cdn.labcoin.bg/DEV/thumbail_coin/2024-12/fb9sd9Nt9dTfPQazxH2NDS2wy4C6Ei4P1OGyNuzx.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/GYWPGp8E4M7dILO51TBV3Z4kTyzcTXN2Sm2zbnU5.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-07/z7tvrPMFAsCzV92JeX0sYoGAvViv96pZwOvWmUnH.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/CCWY1P5EyrbMoZq4B4ewe6h1zd0YyiMoKyo7GxTl.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/wYL3sgjQdF4AdZOCVyxSSLpSFIjmSmQbYvqdpkxw.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/XGB9zW2tSW5JC4c8KfdNSpm5MkW509gucdzg03C5.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-05/lCtUQTJacC8RWZeaFa8NHkdt6iNBNr7RNsWuc0hi.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-06/BuxOWaRLOCpZ0hjjNwjYMsD7rSOqzkMjEudn1cqb.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/RaWSPUs6P2rWTUi6e0AGM8nc7ebgqREhBxjPAHVg.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/pLCijiWfC9sKFEq3KAF25Q8aPuO9CwQGhVfYXyJb.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/d8olpAiTh3bP02c02eq9cxva7myLXqOh8zcrd56c.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-06/D0bgDmm0Dy8cBAbgA1FmJZeWDjQ8jyXuinsDHzEc.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/ssMkeoGbhYMzjutCkqYaSVL2zlEL4QVasd2CgaV4.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/66pkPOGIRlidJRL21t3yZGXm3A7rv124jMsb6XTZ.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/KVIcWEU6R4iMJmCRjB7yIx4R4APPpiqLrBmMb8tO.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/txIurBdzBuJZl4pVstOWMt09zwHAGUn6sktdVqqc.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-03/XjBvupIJaMkoWfXLl6JYzuFqGb1IKSL7RVtBTMsU.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-05/3dxqGktC2BdqfwhkXnuZYXz1rCmizwfb1xjhMPKi.png",
  "https://cdn.labcoin.bg/DEV/upload/2025-08/PDdGNVpBLSksgHi4sIoDBfHpvSTzXX0iS88CuWH1.png"
];

const GUESS_ANSWERS = [
  "oreo", //1
  "лотос",
  "божур",
  "северна корея",
  "южна корея",
  "армения",
  "великобритания",
  "китай",
  "lv freddy", // allow variations
  "морско син фреди",
  "икеа фреди",
  "nlo pate",
  "legacy pate",
  "пате с царевичка",
  "пате с нурка",
  "коте edition",
  "art the great wave",
  "поетите",
  "aladin foods labcoin"
].map(normalizeText);

// Create a room
function handleCreateRoom(ws, data) {
  const code = data.code;
  rooms[code] = {
    gamesCount: data.gamesCount || 1,
    timeBefore: data.timeBefore || 10,
    maxUsers: data.maxUsers || null,
    games: data.games || [], // each game: {type, name, prize}
    users: [],
    sockets: new Set(),
    currentGameIndex: 0,
    scores: {}, // username -> points
    guessState: null // temporary per-run state
  };
  send(ws, { type: "roomCreated", code });
}

// Start running all games in room (admin triggers)
async function handleStartRoom(ws, data) {
  const code = data.code;
  const room = rooms[code];
  if (!room) { send(ws, {type:'error', message:'Room not found'}); return; }
  // Broadcast start countdown for first game
  broadcastRoom(code, { type: "countdownStart", seconds: room.timeBefore, gameIndex: room.currentGameIndex, game: room.games[room.currentGameIndex] });
  // server will orchestrate: setTimeout to actually start the game after timeBefore seconds
  setTimeout(() => runGameSequenceStep(code), room.timeBefore * 1000);
}

// Orchestrate a single game step (start immediately)
function runGameSequenceStep(code) {
  const room = rooms[code];
  if (!room) return;
  if (room.currentGameIndex >= room.gamesCount || room.currentGameIndex >= room.games.length) {
    broadcastRoom(code, { type: "allGamesFinished" });
    return;
  }
  const game = room.games[room.currentGameIndex];
  // Reset per-game temporary data
  room.guessState = null;
  // Broadcast gameStart with game info
  broadcastRoom(code, { type: "gameStart", game, gameIndex: room.currentGameIndex });

  if (game.type === "wheel") {
    // Let clients spin visually — server picks the winner after small delay (spin time)
    const spinMs = Math.max(3500, (game.spinMs || 4500));
    setTimeout(() => {
      const users = [...room.users];
      const winner = users.length ? users[Math.floor(Math.random() * users.length)] : null;
      if (winner) {
        room.scores[winner] = (room.scores[winner] || 0) + (game.pointsForWinner || 10);
      }
      broadcastRoom(code, { type: "gameFinished", result: { winner }, gameIndex: room.currentGameIndex });
      room.currentGameIndex++;
      // start countdown before next game if any
      if (room.currentGameIndex < room.gamesCount && room.currentGameIndex < room.games.length) {
        broadcastRoom(code, { type: "countdownStart", seconds: room.timeBefore, gameIndex: room.currentGameIndex, game: room.games[room.currentGameIndex] });
        setTimeout(() => runGameSequenceStep(code), room.timeBefore * 1000);
      } else {
        broadcastRoom(code, { type: "allGamesFinished", scores: room.scores });
      }
    }, spinMs);
  } else if (game.type === "guess") {
    // Prepare a randomized set of 10 images from bank (or fewer if bank smaller)
    const totalQ = Math.min(10, GUESS_IMAGES.length);
    // pick random indices
    const indices = [];
    const pool = GUESS_IMAGES.map((u, idx) => idx);
    while (indices.length < totalQ && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      indices.push(pool.splice(i,1)[0]);
    }
    // Initialize guessState
    room.guessState = {
      questionIndices: indices,
      currentQuestion: 0,
      answersCollected: {}, // questionIndex -> {username: guessString}
      pointsPerCorrect: game.pointsPerCorrect || 10
    };
    // Start first question immediately
    runGuessQuestion(code);
  } else {
    // Unknown game type - skip
    room.currentGameIndex++;
    runGameSequenceStep(code);
  }
}

// Run a single question in guess game
function runGuessQuestion(code) {
  const room = rooms[code];
  if (!room || !room.guessState) return;
  const gs = room.guessState;
  const qIdx = gs.questionIndices[gs.currentQuestion];
  const imageURL = GUESS_IMAGES[qIdx];
  // Pick a cropping "seed" so clients show a zoomed/cropped part — server provides crop parameters
  // We'll send a simple seed number; clients must use it to calculate crop
  const crop = { seed: Math.floor(Math.random()*1000000), zoom: 1.8 + Math.random()*0.8 }; // zoom 1.8..2.6
  // Reset collected answers for this question
  gs.answersCollected[gs.currentQuestion] = {};
  broadcastRoom(code, { type: "guessQuestion", questionNumber: gs.currentQuestion+1, totalQuestions: gs.questionIndices.length, imageURL, crop, seconds: 10 });

  // After 10 seconds, evaluate answers
  setTimeout(() => {
    // Evaluate each player's guess that submitted
    const correctNormalized = GUESS_ANSWERS[qIdx] || "";
    const results = [];
    for (const ws of room.sockets) {
      // nothing here; we evaluate based on collected answers in gs.answersCollected
    }
    const answers = gs.answersCollected[gs.currentQuestion] || {}; // username -> guess
    const correctPlayers = [];
    for (const [player, guess] of Object.entries(answers)) {
      if (!guess) continue;
      const gNorm = normalizeText(guess);
      if (correctNormalized && gNorm.includes(correctNormalized) || correctNormalized.includes(gNorm) || gNorm === correctNormalized) {
        // count as correct
        room.scores[player] = (room.scores[player] || 0) + gs.pointsPerCorrect;
        correctPlayers.push(player);
      }
    }
    // Send questionResult
    broadcastRoom(code, { type: "guessQuestionResult", questionNumber: gs.currentQuestion+1, correctPlayers, correctAnswer: GUESS_ANSWERS[qIdx] });

    gs.currentQuestion++;
    if (gs.currentQuestion < gs.questionIndices.length) {
      // small delay then next question (3s)
      setTimeout(() => runGuessQuestion(code), 3000);
    } else {
      // End of guess game — broadcast leaderboard partial
      // compute top 3
      const leaderboard = Object.entries(room.scores).map(([u,p])=>({username:u,points:p})).sort((a,b)=>b.points-a.points).slice(0,3);
      broadcastRoom(code, { type: "guessGameFinished", leaderboard, scores: room.scores });
      room.currentGameIndex++;
      // countdown to next game or finish
      if (room.currentGameIndex < room.gamesCount && room.currentGameIndex < room.games.length) {
        broadcastRoom(code, { type: "countdownStart", seconds: room.timeBefore, gameIndex: room.currentGameIndex, game: room.games[room.currentGameIndex] });
        setTimeout(() => runGameSequenceStep(code), room.timeBefore*1000);
      } else {
        broadcastRoom(code, { type: "allGamesFinished", scores: room.scores });
      }
    }
  }, 10000); // 10 seconds per question
}

// WebSocket handling
wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { send(ws, { type:'error', message:'invalid json' }); return; }

    // CREATE ROOM
    if (data.type === "createRoom") {
      handleCreateRoom(ws, data);
    }

    // DELETE ALL ROOMS
    if (data.type === "deleteAllRooms") {
      rooms = {};
      send(ws, { type: "roomsDeleted" });
    }

    // JOIN ROOM
    if (data.type === "joinRoom") {
      const { code, username } = data;
      const room = rooms[code];
      if (!room) { send(ws, { type: "error", message: "Стаята не съществува" }); return; }
      if (room.maxUsers && room.users.length >= room.maxUsers) { send(ws, { type:"error", message:"Стая пълна" }); return; }
      // register
      if (!room.users.includes(username)) room.users.push(username);
      room.sockets.add(ws);
      ws.roomCode = code; ws.username = username;
      if (!room.scores[username]) room.scores[username] = 0;
      // send ack + state
      send(ws, { type: "joined", code, users: room.users, gamesCount: room.gamesCount });
      // broadcast join
      broadcastRoom(code, { type: "userJoined", username, users: room.users });
    }

    // ADMIN: start room (run games sequence)
    if (data.type === "startRoom") {
      handleStartRoom(ws, data);
    }

    // ADMIN: announcement to a room (live)
    if (data.type === "announcement") {
      const { code, message } = data;
      broadcastRoom(code, { type: "announcement", message });
    }

    // ADMIN: start single step (for testing) - not required
    if (data.type === "startNext") {
      runGameSequenceStep(data.code);
    }

    // GAME: client submits guess (for guess game)
    if (data.type === "submitGuess") {
      const { code, username, questionIndex, guess } = data;
      const room = rooms[code];
      if (!room || !room.guessState) return;
      const q = room.guessState;
      // Save guess
      if (!q.answersCollected[questionIndex]) q.answersCollected[questionIndex] = {};
      q.answersCollected[questionIndex][username] = guess;
    }

    // For debug: get room state
    if (data.type === "getRoomState") {
      const r = rooms[data.code];
      send(ws, { type: "roomState", room: r ? { users: r.users, currentGameIndex: r.currentGameIndex, scores: r.scores } : null });
    }
  });

  ws.on("close", () => {
    // remove from rooms
    const code = ws.roomCode;
    const username = ws.username;
    if (code && rooms[code]) {
      rooms[code].sockets.delete(ws);
      rooms[code].users = rooms[code].users.filter(u => u !== username);
      // broadcast user left
      broadcastRoom(code, { type: "userLeft", username, users: rooms[code].users });
    }
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
