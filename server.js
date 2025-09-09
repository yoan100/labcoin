// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname)));

// Rooms storage
let rooms = {}; // { code: { users: [], games: [], timeBefore, currentGame, sockets: [] } }

// Broadcast function
function broadcast(roomCode, data) {
  if (!rooms[roomCode]) return;
  rooms[roomCode].sockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  });
}

wss.on("connection", ws => {
  ws.on("message", msg => {
    try {
      const data = JSON.parse(msg);

      // Create room
      if (data.type === "createRoom") {
        rooms[data.code] = {
          users: [],
          games: data.games,
          timeBefore: data.timeBefore,
          currentGame: 0,
          sockets: []
        };
        ws.send(JSON.stringify({ type: "roomCreated", code: data.code }));
      }

      // Join room
      if (data.type === "joinRoom") {
        const { code, username } = data;
        if (!rooms[code]) { ws.send(JSON.stringify({ type: "error", message: "Room not found" })); return; }
        rooms[code].users.push(username);
        rooms[code].sockets.push(ws);
        ws.roomCode = code;
        ws.username = username;
        broadcast(code, { type: "userJoined", username, users: rooms[code].users });
      }

      // Start game
      if (data.type === "startGame") {
        const { code } = data;
        const room = rooms[code];
        if (!room) return;
        const game = room.games[room.currentGame];
        broadcast(code, { type: "gameStart", game });

        if (game.name === "Колело на късмета") {
          const users = room.users;
          const winner = users[Math.floor(Math.random() * users.length)];
          setTimeout(() => {
            broadcast(code, { type: "gameWinner", winner });
            room.currentGame++;
          }, 5000);
        }
      }

      // Delete all rooms
      if (data.type === "deleteAllRooms") {
        rooms = {};
        ws.send(JSON.stringify({ type: "roomsDeleted" }));
      }

      // Admin announcement
      if (data.type === "announcement") {
        broadcast(data.code, { type: "announcement", message: data.message });
      }

    } catch (err) {
      console.error("Error handling message:", err);
    }
  });

  ws.on("close", () => {
    if (ws.roomCode && rooms[ws.roomCode]) {
      rooms[ws.roomCode].users = rooms[ws.roomCode].users.filter(u => u !== ws.username);
      rooms[ws.roomCode].sockets = rooms[ws.roomCode].sockets.filter(s => s !== ws);
      broadcast(ws.roomCode, { type: "userLeft", username: ws.username });
    }
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
