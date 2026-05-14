import express from "express";
import path from "path";
import { createServer } from "http";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";

// Calculate __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Game State
  const MAP_WIDTH = 3000;
  const MAP_HEIGHT = 3000;
  
  interface Player {
    id: string;
    x: number;
    y: number;
    angle: number;
    hp: number;
    maxHp: number;
    color: string;
    isDead: boolean;
    score: number;
    name: string;
    respawnTimer: number;
    inputs: { dx: number, dy: number, angle: number };
  }
  
  interface Bullet {
    id: string;
    x: number;
    y: number;
    angle: number;
    speed: number;
    ownerId: string;
    life: number;
  }

  interface StaticObject {
    id: string;
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }

  const players: Record<string, Player> = {};
  let bullets: Bullet[] = [];

  function generateMap(): StaticObject[] {
    const objects: StaticObject[] = [];
    
    // Пятёрочка (Center)
    objects.push({ id: "shop1", type: "pyaterochka", x: MAP_WIDTH/2 - 150, y: MAP_HEIGHT/2 - 100, w: 300, h: 200 });
    
    // Гаражи (Garages block)
    for(let i=0; i<5; i++) {
        objects.push({ id: `gar1_${i}`, type: "garage", x: MAP_WIDTH/2 - 600 + (100 * i), y: MAP_HEIGHT/2 - 400, w: 100, h: 150 });
        objects.push({ id: `gar2_${i}`, type: "garage", x: MAP_WIDTH/2 - 600 + (100 * i), y: MAP_HEIGHT/2 - 250, w: 100, h: 150 });
    }

    // Хрущевки (Khrushchevkas)
    objects.push({ id: "house1", type: "khrushchevka", x: MAP_WIDTH/2 + 300, y: MAP_HEIGHT/2 - 500, w: 200, h: 600 });
    objects.push({ id: "house2", type: "khrushchevka", x: MAP_WIDTH/2 + 600, y: MAP_HEIGHT/2 - 500, w: 200, h: 600 });
    
    objects.push({ id: "house3", type: "khrushchevka", x: MAP_WIDTH/2 - 800, y: MAP_HEIGHT/2 + 200, w: 600, h: 200 });
    objects.push({ id: "house4", type: "khrushchevka", x: MAP_WIDTH/2 - 800, y: MAP_HEIGHT/2 + 500, w: 600, h: 200 });

    // Заправка (Gas station)
    objects.push({ id: "gas1", type: "gas_station", x: MAP_WIDTH/2 + 200, y: MAP_HEIGHT/2 + 400, w: 400, h: 300 });

    return objects;
  }

  const mapObjects = generateMap();

  const PLAYER_SPEED = 300; // pixels per second
  const BULLET_SPEED = 1000;
  const TICK_RATE = 60;
  const TICK_DURATION = 1000 / TICK_RATE;
  
  const colors = ["#ff0000", "#00ff00", "#0000ff", "#ff00ff", "#00ffff", "#ffff00", "#ffffff"];

  io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);
    
    // Create new player
    players[socket.id] = {
      id: socket.id,
      x: Math.random() * MAP_WIDTH,
      y: Math.random() * MAP_HEIGHT,
      angle: 0,
      hp: 100,
      maxHp: 100,
      color: colors[Math.floor(Math.random() * colors.length)],
      isDead: false,
      score: 0,
      name: "Gopnik " + Math.floor(Math.random() * 10000),
      respawnTimer: 0,
      inputs: { dx: 0, dy: 0, angle: 0 },
    };

    socket.emit("init", {
      id: socket.id,
      map: { width: MAP_WIDTH, height: MAP_HEIGHT, objects: mapObjects },
      players,
    });

    socket.on("input", (data: { dx: number; dy: number; angle: number }) => {
      const player = players[socket.id];
      if (!player || player.isDead) return;

      // Update strictly normalized inputs (Anti-Speedhack)
      player.inputs.dx = data.dx || 0;
      player.inputs.dy = data.dy || 0;
      player.inputs.angle = data.angle || 0;
    });

    socket.on("shoot", (data: { angle: number }) => {
      const player = players[socket.id];
      if (!player || player.isDead) return;
      
      const bullet: Bullet = {
        id: uuidv4(),
        x: player.x + Math.cos(data.angle) * 30, // Spawn a bit ahead
        y: player.y + Math.sin(data.angle) * 30,
        angle: data.angle,
        speed: BULLET_SPEED,
        ownerId: socket.id,
        life: 1.5 // Seconds
      };
      
      bullets.push(bullet);
      io.emit("playSound", { name: "ak47_shoot", x: player.x, y: player.y });
    });

    socket.on("disconnect", () => {
      console.log("Player disconnected:", socket.id);
      delete players[socket.id];
      io.emit("playerDisconnected", socket.id);
    });
  });

  // Game Loop
  let lastTime = Date.now();
  setInterval(() => {
    const now = Date.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    // Movement Loop (Server Auth)
    for (const pid in players) {
      const p = players[pid];
      if (p.isDead) continue;
      
      let { dx, dy } = p.inputs;
      
      // Max speed normalization
      const mag = Math.sqrt(dx * dx + dy * dy);
      if (mag > 0) {
         dx = dx / mag;
         dy = dy / mag;
      }

      // X Movement & Collision
      p.x += dx * PLAYER_SPEED * dt;
      for (const obj of mapObjects) {
        if (p.x + 15 > obj.x && p.x - 15 < obj.x + obj.w && p.y + 15 > obj.y && p.y - 15 < obj.y + obj.h) {
            if (dx > 0) p.x = obj.x - 16;
            else if (dx < 0) p.x = obj.x + obj.w + 16;
        }
      }

      // Y Movement & Collision
      p.y += dy * PLAYER_SPEED * dt;
      for (const obj of mapObjects) {
        if (p.x + 15 > obj.x && p.x - 15 < obj.x + obj.w && p.y + 15 > obj.y && p.y - 15 < obj.y + obj.h) {
            if (dy > 0) p.y = obj.y - 16;
            else if (dy < 0) p.y = obj.y + obj.h + 16;
        }
      }

      p.angle = p.inputs.angle;

      // Constrain player position to map bounds
      p.x = Math.max(0, Math.min(MAP_WIDTH, p.x));
      p.y = Math.max(0, Math.min(MAP_HEIGHT, p.y));
    }

    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += Math.cos(b.angle) * b.speed * dt;
      b.y += Math.sin(b.angle) * b.speed * dt;
      b.life -= dt;

      // Check bullet collisions with strictly map objects
      let hitBuilding = false;
      for (const obj of mapObjects) {
         if (b.x > obj.x && b.x < obj.x + obj.w && b.y > obj.y && b.y < obj.y + obj.h) {
            hitBuilding = true;
            break;
         }
      }

      if (hitBuilding) {
         bullets.splice(i, 1);
         continue;
      }

      // Check bullet collisions with players
      let hit = false;
      for (const pid in players) {
        if (pid === b.ownerId) continue; // Don't shoot yourself
        const p = players[pid];
        if (p.isDead) continue;

        const dist = Math.sqrt((b.x - p.x)**2 + (b.y - p.y)**2);
        if (dist < 30) { // Player hit radius
          p.hp -= 20;
          hit = true;
          if (p.hp <= 0 && !p.isDead) {
            p.hp = 0;
            p.isDead = true;
            p.respawnTimer = 5; // 5 seconds respawn
            
            // Give score to killer
            if (players[b.ownerId]) {
              players[b.ownerId].score += 1;
            }
            
            io.emit("playerDied", { victimId: p.id, killerId: b.ownerId });
          }
          break;
        }
      }

      if (hit || b.life <= 0 || b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) {
        bullets.splice(i, 1);
      }
    }

    // Handle respawns
    for (const pid in players) {
      const p = players[pid];
      if (p.isDead) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) {
          p.isDead = false;
          p.hp = p.maxHp;
          p.x = Math.random() * MAP_WIDTH;
          p.y = Math.random() * MAP_HEIGHT;
          io.emit("playerRespawned", p.id);
        }
      }
    }

    // Broadcast state
    io.emit("stateUpdate", {
      players,
      bullets: bullets.map(b => ({ x: b.x, y: b.y })) // Minimal bullet data
    });

  }, TICK_DURATION);


  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
