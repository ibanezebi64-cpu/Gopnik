import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import "./index.css";

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
}

interface MiniBullet {
  x: number;
  y: number;
}

interface MapObject {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MapInfo {
  width: number;
  height: number;
  objects: MapObject[];
}

interface GameState {
  players: Record<string, Player>;
  bullets: MiniBullet[];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState>({ players: {}, bullets: [] });
  const [mapInfo, setMapInfo] = useState<MapInfo>({ width: 0, height: 0, objects: [] });
  const [myId, setMyId] = useState<string>("");
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const mouseRef = useRef({ x: 0, y: 0, worldX: 0, worldY: 0, isDown: false });
  const lastShootTimeRef = useRef(0);
  const cameraRef = useRef({ x: 0, y: 0 });
  
  // Game state refs for render loop
  const gameStateRef = useRef<GameState>({ players: {}, bullets: [] });
  const displayPlayersRef = useRef<Record<string, Player>>({});
  const mapInfoRef = useRef<MapInfo>({ width: 0, height: 0, objects: [] });
  const myIdRef = useRef("");

  useEffect(() => {
    const newSocket = io({
      // By default socket.io-client connects to the same host that serves the page
    });

    newSocket.on("init", (data) => {
      setMyId(data.id);
      myIdRef.current = data.id;
      setMapInfo(data.map);
      mapInfoRef.current = data.map;
    });

    newSocket.on("stateUpdate", (state: GameState) => {
      setGameState(state);
      gameStateRef.current = state;
    });

    setSocket(newSocket);

    const handleKeyDown = (e: KeyboardEvent) => { keysRef.current[e.code] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keysRef.current[e.code] = false; };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };
    const handleMouseDown = (e: MouseEvent) => { mouseRef.current.isDown = true; };
    const handleMouseUp = (e: MouseEvent) => { mouseRef.current.isDown = false; };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      newSocket.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // Update and Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let lastTime = performance.now();

    const render = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      // Ensure canvas matches window size
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // Handle Input processing and sending to server
      if (socket && myIdRef.current) {
        let dx = 0;
        let dy = 0;
        if (keysRef.current["KeyW"]) dy -= 1;
        if (keysRef.current["KeyS"]) dy += 1;
        if (keysRef.current["KeyA"]) dx -= 1;
        if (keysRef.current["KeyD"]) dx += 1;

        const myPlayer = gameStateRef.current.players[myIdRef.current];
        
        let angle = 0;
        if (myPlayer) {
            // Update camera to follow player
            cameraRef.current.x = myPlayer.x - canvas.width / 2;
            cameraRef.current.y = myPlayer.y - canvas.height / 2;

            // Constrain camera to map bounds (optional)
            cameraRef.current.x = Math.max(0, Math.min(mapInfoRef.current.width - canvas.width, cameraRef.current.x));
            cameraRef.current.y = Math.max(0, Math.min(mapInfoRef.current.height - canvas.height, cameraRef.current.y));

            // Calculate world mouse position
            mouseRef.current.worldX = mouseRef.current.x + cameraRef.current.x;
            mouseRef.current.worldY = mouseRef.current.y + cameraRef.current.y;
            
            angle = Math.atan2(mouseRef.current.worldY - myPlayer.y, mouseRef.current.worldX - myPlayer.x);

            // Send movement
            socket.emit("input", { dx, dy, angle });

            // Handle shooting (throttle)
            if (mouseRef.current.isDown && time - lastShootTimeRef.current > 150 && !myPlayer.isDead) { // 150ms fire rate
              socket.emit("shoot", { angle });
              lastShootTimeRef.current = time;
            }
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      
      // Apply camera transform
      ctx.translate(-cameraRef.current.x, -cameraRef.current.y);

      // Draw Ground (Dirt & Snow patches via procedural look)
      ctx.fillStyle = "#dfe6e9"; // Base snow
      ctx.fillRect(0, 0, mapInfoRef.current.width, mapInfoRef.current.height);

      ctx.strokeStyle = "#b2bec3";
      ctx.lineWidth = 1;
      
      // Draw grid lines
      for (let x = 0; x <= mapInfoRef.current.width; x += 200) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mapInfoRef.current.height);
        ctx.stroke();
      }
      for (let y = 0; y <= mapInfoRef.current.height; y += 200) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(mapInfoRef.current.width, y);
        ctx.stroke();
      }

      // Render Objects
      mapInfoRef.current.objects.forEach(obj => {
         ctx.save();
         ctx.translate(obj.x, obj.y);

         if (obj.type === "khrushchevka") {
            // Base Building
            ctx.fillStyle = "#95a5a6";
            ctx.fillRect(0, 0, obj.w, obj.h);
            ctx.strokeStyle = "#34495e";
            ctx.lineWidth = 3;
            ctx.strokeRect(0, 0, obj.w, obj.h);

            // Roof texture (gravel/tar)
            ctx.fillStyle = "#7f8c8d";
            ctx.fillRect(10, 10, obj.w - 20, obj.h - 20);
            
            // Draw rows of windows (from top down isometric illusion or simple blocks)
            ctx.fillStyle = "#34495e";
            const windowsX = Math.floor(obj.w / 40);
            const windowsY = Math.floor(obj.h / 40);
            for(let wx = 1; wx < windowsX; wx++) {
               for(let wy = 1; wy < windowsY; wy++) {
                  // Some windows have lights on
                  const isLightOn = (wx + wy * obj.x) % 7 === 0;
                  ctx.fillStyle = isLightOn ? "#f1c40f" : "#2c3e50";
                  ctx.fillRect(wx * 40, wy * 40, 15, 10);
               }
            }
            
            // Doors
            ctx.fillStyle = "#5c4033"; // Brown metal door
            ctx.fillRect(obj.w / 2 - 15, obj.h - 5, 30, 5);

         } else if (obj.type === "pyaterochka") {
            // White box with red stripe
            ctx.fillStyle = "#ecf0f1";
            ctx.fillRect(0, 0, obj.w, obj.h);
            ctx.strokeStyle = "#c0392b";
            ctx.lineWidth = 4;
            ctx.strokeRect(0, 0, obj.w, obj.h);
            
            // Red Roof stripe
            ctx.fillStyle = "#c0392b";
            ctx.fillRect(10, 10, obj.w - 20, 20);
            
            // Green "ПЯТЁРОЧКА" text
            ctx.fillStyle = "#27ae60";
            ctx.font = "bold 24px 'Impact', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("ПЯТЁРОЧКА", obj.w / 2, 60);

            // Doors
            ctx.fillStyle = "#3498db"; // Glass doors
            ctx.fillRect(obj.w / 2 - 30, obj.h - 10, 60, 10);

         } else if (obj.type === "garage") {
            // Rusty green garage
            ctx.fillStyle = (obj.x % 3 === 0) ? "#2c3e50" : "#34495e"; 
            ctx.fillRect(0, 0, obj.w, obj.h);
            
            ctx.strokeStyle = "#1a252f";
            ctx.lineWidth = 2;
            ctx.strokeRect(0, 0, obj.w, obj.h);

            // Garage roof ridges
            ctx.strokeStyle = "#415b76";
            for(let rx = 5; rx < obj.w; rx+=10) {
               ctx.beginPath();
               ctx.moveTo(rx, 5);
               ctx.lineTo(rx, obj.h - 5);
               ctx.stroke();
            }

            // Door line
            ctx.fillStyle = "#1a252f";
            ctx.fillRect(5, obj.h - 5, obj.w - 10, 5);
         } else if (obj.type === "gas_station") {
            // Gas station canopy
            ctx.fillStyle = "#f39c12"; // Yellow canopy
            ctx.fillRect(0, 0, obj.w, obj.h);
            ctx.strokeStyle = "#d35400";
            ctx.lineWidth = 5;
            ctx.strokeRect(0, 0, obj.w, obj.h);

            // Pillars
            ctx.fillStyle = "#bdc3c7";
            ctx.fillRect(20, 20, 20, 20);
            ctx.fillRect(obj.w - 40, 20, 20, 20);
            ctx.fillRect(20, obj.h - 40, 20, 20);
            ctx.fillRect(obj.w - 40, obj.h - 40, 20, 20);

            // Pumps
            ctx.fillStyle = "#c0392b";
            ctx.fillRect(obj.w / 2 - 40, obj.h / 2 - 20, 20, 40);
            ctx.fillRect(obj.w / 2 + 20, obj.h / 2 - 20, 20, 40);

            // Text
            ctx.fillStyle = "#000";
            ctx.font = "bold 32px 'Impact', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("ЛУКОЙЛ-СУРРОГАТ", obj.w / 2, obj.h / 2 - 40);
         }
         ctx.restore();
      });

      // Draw Bullets
      ctx.fillStyle = "#f1c40f"; // Yellow bullets
      gameStateRef.current.bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#d35400";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // --- Client-Side Interpolation ---
      const targetPlayers = gameStateRef.current.players;
      const displayPlayers = displayPlayersRef.current;
      
      for (const id in targetPlayers) {
          const target = targetPlayers[id];
          if (!displayPlayers[id]) {
              displayPlayers[id] = { ...target };
          } else {
              const display = displayPlayers[id];
              const dist = Math.sqrt((target.x - display.x)**2 + (target.y - display.y)**2);
              
              if (dist > 150) { // Deep snap if desynced
                  display.x = target.x;
                  display.y = target.y;
              } else {
                  // Fixed lerp ~15 ops per sec
                  const factor = Math.min(1, dt * 10);
                  display.x += (target.x - display.x) * factor;
                  display.y += (target.y - display.y) * factor;
              }
              
              // Angle shortest path lerp
              let diff = target.angle - display.angle;
              while (diff < -Math.PI) diff += Math.PI * 2;
              while (diff > Math.PI) diff -= Math.PI * 2;
              display.angle += diff * Math.min(1, dt * 15);

              display.hp = target.hp;
              display.maxHp = target.maxHp;
              display.isDead = target.isDead;
              display.name = target.name;
              display.score = target.score;
              display.color = target.color;
          }
      }
      
      for (const id in displayPlayers) {
          if (!targetPlayers[id]) delete displayPlayers[id];
      }

      // Draw Players
      Object.values(displayPlayers).forEach(p => {
        if (p.isDead) {
           // Draw blood/dead body
           ctx.fillStyle = "#c0392b";
           ctx.beginPath();
           ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
           ctx.fill();
           return;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        
        // Draw Nameplate & HP Bar
        ctx.fillStyle = "#2c3e50";
        ctx.font = "bold 14px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(p.name, 0, -35);
        ctx.fillText(`Убито: ${p.score}`, 0, -50); // "Убито" = Kills
        
        // HP Bar background
        ctx.fillStyle = "#e74c3c";
        ctx.fillRect(-20, -25, 40, 6);
        // HP Bar foreground
        ctx.fillStyle = "#2ecc71";
        ctx.fillRect(-20, -25, 40 * (p.hp / p.maxHp), 6);

        // Rotate player
        ctx.rotate(p.angle);

        // Draw Player Body Context
        ctx.fillStyle = p.id === myIdRef.current ? "#2980b9" : p.color; // Tracksuit base color
        
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#2c3e50";
        ctx.stroke();

        // Adidas stripes on the shoulders
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, -16);
        ctx.lineTo(0, -6);
        ctx.moveTo(4, -15);
        ctx.lineTo(4, -5);
        ctx.moveTo(-4, -15);
        ctx.lineTo(-4, -5);
        ctx.stroke();

        // Head (Beanie or Ushanka)
        ctx.fillStyle = "#000000"; // Black beanie
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();

        // Draw Player Hands
        ctx.fillStyle = "#e0ac69"; // Skin tone
        ctx.beginPath();
        ctx.arc(8, -12, 5, 0, Math.PI * 2);
        ctx.arc(8, 12, 5, 0, Math.PI * 2);
        ctx.fill();

        // Draw AK-47 (detailed)
        ctx.save();
        ctx.translate(10, 8); // position gun in hands
        ctx.fillStyle = "#111"; // Gun metal
        ctx.fillRect(0, -4, 30, 6); // Barrel / Receiver
        
        ctx.fillStyle = "#a0522d"; // Wood stock and grip
        ctx.fillRect(-5, -5, 8, 8); // Stock
        ctx.fillRect(15, -5, 10, 4); // Handguard
        ctx.fillRect(5, -1, 4, 8); // Pistol grip
        
        // Magazine
        ctx.fillStyle = "#222";
        ctx.beginPath();
        ctx.arc(12, 4, 6, Math.PI, 0, true);
        ctx.fill();
        ctx.restore();

        ctx.restore();
      });

      // Draw UI overlay relative to camera window
      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [socket]);

  const myPlayer = gameState.players[myId];

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#1a1a1e] text-white font-sans flex flex-col">
      <canvas ref={canvasRef} className="absolute inset-0 z-0 block w-full h-full cursor-crosshair" />

      {/* HUD: Top Bar */}
      <div className="relative z-10 flex justify-between p-6 pointer-events-none">
        <div className="flex gap-4">
          {myPlayer && (
            <div className="backdrop-blur-md bg-white/10 border border-white/20 p-3 rounded-xl flex items-center gap-4 shadow-xl">
              <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 border-2 border-white/30 hidden sm:block"></div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-300">{myPlayer.name}</p>
                <p className="text-xl font-black text-green-400">Фраги: {myPlayer.score}</p>
              </div>
            </div>
          )}
          {/* Status Panel */}
          <div className="backdrop-blur-md bg-white/10 border border-white/20 p-3 rounded-xl flex items-center gap-4 shadow-xl">
            <div>
              <h1 className="text-sm font-black italic tracking-tighter text-white mb-1 uppercase">Криминальная Россия</h1>
              <div className="text-xs font-bold text-gray-300">Онлайн: <span className="text-green-400">{Object.keys(gameState.players).length} чел.</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Center: Action/Respawn Alert & Overlay */}
      {(!myPlayer || myPlayer.isDead) && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
          <div className="backdrop-blur-xl bg-red-900/20 border border-red-500/30 px-12 py-8 rounded-3xl text-center shadow-[0_0_50px_rgba(220,38,38,0.3)]">
            <h1 className="text-5xl font-black italic tracking-tighter text-white mb-2 uppercase">
              {!myPlayer ? "ЗАГРУЗКА БРАТОК..." : "ВЫ УМЕРЛИ"}
            </h1>
            <p className="text-gray-400 font-medium tracking-widest uppercase text-sm">
              {!myPlayer ? "Ожидание сервера" : `Респавн через ${Math.ceil(myPlayer.respawnTimer)} сек...`}
            </p>
          </div>
        </div>
      )}

      {/* Bottom HUD: Status & Info */}
      <div className="mt-auto relative z-10 p-6 flex justify-between items-end pointer-events-none">
        {/* Help Info Panel */}
        <div className="w-80 backdrop-blur-md bg-black/40 border border-white/10 rounded-xl p-4 flex flex-col pointer-events-none shadow-xl">
          <div className="space-y-2 text-sm text-gray-300">
            <p><span className="text-blue-400 font-bold">Сервер:</span> Москва-1 [RU]</p>
            <p><span className="text-yellow-400 font-bold">INFO:</span> Управление: W A S D</p>
            <p><span className="text-red-400 font-bold">INFO:</span> Стрельба: Мышь</p>
          </div>
        </div>

        {/* Health & Ammo */}
        {myPlayer && !myPlayer.isDead && (
          <div className="flex flex-col items-end gap-4 shadow-xl">
            <div className="backdrop-blur-md bg-white/10 border border-white/20 p-4 rounded-2xl flex items-center gap-6 shadow-xl">
              <div className="text-right">
                <p className="text-xs text-gray-400 uppercase font-bold tracking-widest">Автомат АК-47</p>
                <p className="text-3xl font-black">30 <span className="text-lg text-gray-500">/ ∞</span></p>
              </div>
              <div className="w-20 h-12 bg-white/5 rounded-lg flex items-center justify-center border border-white/10">
                <div className="w-16 h-4 bg-gray-600 rounded-sm"></div>
              </div>
            </div>

            <div className="backdrop-blur-md bg-white/10 border border-white/20 p-4 rounded-2xl w-80 space-y-3 shadow-xl">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] uppercase font-bold">
                  <span>Здоровье</span>
                  <span>{Math.floor(myPlayer.hp)} / {myPlayer.maxHp}</span>
                </div>
                <div className="w-full h-3 bg-black/40 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-all duration-200" style={{ width: `${Math.max(0, (myPlayer.hp / myPlayer.maxHp) * 100)}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
