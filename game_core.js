/* Hefty Hop — core game logic (no DOM). Runs in browser and Node. */
(function (root) {
"use strict";

const C = {
  TILE: 48,
  GRAV: 2000, GRAV_HOLD: 1100,
  JUMP_V: -700,
  MOVE_ACC: 2400, AIR_ACC: 1600, MAX_VX: 280, FRICTION: 2200,
  COYOTE: 0.09, BUFFER: 0.12,
  BUMP_V: 900, BUMP_BOUNCE: -220,
  STOMP_BOUNCE: -430,
  HIT_IFRAMES: 1.2, KNOCKBACK: 180,
  ENEMY_SPEED: 70,
  PLAYER_W: 40, PLAYER_H: 58,
  ENEMY_W: 40, ENEMY_H: 52,
  MAX_HITS: 1, START_LIVES: 5, PINS_PER_LIFE: 50,
  SHOT: {
    coffee: { speed: 540, ammo: 12, cd: 0.22 },
    fire:   { speed: 330, ammo: 8,  cd: 0.30, grav: 900, arc: -170 },
  },
};


const TURFS = ['EMBER ALLEY', 'HEART COURT', 'CLOCKWORK ROW', 'PATCHWORK YARD'];

function makeRng(seed) {
  let st = (seed >>> 0) || 1;
  return function () { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
}

/* Procedural level: guaranteed completable by construction —
   gaps <= gapMax (jumpable) with flat landings, upward steps <= 2 tiles. */
function generateLevel(n, rng) {
  rng = rng || Math.random;
  const W = Math.min(220, 90 + n * 6), H = 12;
  const gt = new Array(W).fill(null);       // ground-top row per column (null = pit)
  const gapMax = Math.min(4, 2 + Math.floor(n / 3));
  let top = 10, x = 0, flatSince = 0;
  for (; x < 8; x++) gt[x] = 10;            // safe spawn strip
  flatSince = 8;
  while (x < W - 14) {
    const r = rng();
    if (r < 0.26 && flatSince >= 5) {                        // pit
      const w = 2 + Math.floor(rng() * (gapMax - 1));
      for (let i = 0; i < w && x < W - 14; i++, x++) gt[x] = null;
      if (top < 10 && rng() < 0.5) top = Math.min(10, top + 2); // land lower sometimes
      for (let i = 0; i < 3 && x < W - 14; i++, x++) gt[x] = top;
      flatSince = 3;
    } else if (r < 0.48) {                                   // step up / down
      const canUp = top > 6, canDown = top < 10;
      const up = canUp && (!canDown || rng() < 0.55);
      const mag = 1 + (rng() < 0.4 ? 1 : 0);
      top = up ? Math.max(6, top - mag) : Math.min(10, top + mag);
      for (let i = 0; i < 3 && x < W - 14; i++, x++) gt[x] = top;
      flatSince = 3;
    } else {                                                 // flat run
      const w = 3 + Math.floor(rng() * 5);
      for (let i = 0; i < w && x < W - 14; i++, x++) gt[x] = top;
      flatSince += w;
    }
  }
  for (; x < W; x++) gt[x] = top;                            // exit strip

  const rows = [];
  for (let y = 0; y < H; y++) rows.push(new Array(W).fill('.'));
  for (let cx = 0; cx < W; cx++)
    if (gt[cx] !== null) for (let y = gt[cx]; y < H; y++) rows[y][cx] = '#';

  // flat runs for decoration (skip spawn + exit strips)
  const flats = [];
  let run = null;
  for (let cx = 8; cx < W - 8; cx++) {
    if (gt[cx] !== null && run && gt[cx] === run.top) run.end = cx;
    else {
      if (run && run.end - run.start >= 2) flats.push(run);
      run = gt[cx] !== null ? { start: cx, end: cx, top: gt[cx] } : null;
    }
  }
  if (run && run.end - run.start >= 2) flats.push(run);

  const nearPit = new Array(W).fill(false);      // within 3 of a pit
  const nearPitWide = new Array(W).fill(false);  // within 6 of a pit
  for (let cx = 0; cx < W; cx++)
    if (gt[cx] === null) {
      for (let i = Math.max(0, cx - 3); i <= Math.min(W - 1, cx + 3); i++) nearPit[i] = true;
      for (let i = Math.max(0, cx - 6); i <= Math.min(W - 1, cx + 6); i++) nearPitWide[i] = true;
    }

  const used = new Set();
  function claim(cx, w) {
    for (let i = cx - 1; i <= cx + w; i++) if (used.has(i)) return false;
    for (let i = cx; i < cx + w; i++) used.add(i);
    return true;
  }
  function pickFlat() { return flats[Math.floor(rng() * flats.length)]; }

  // pins over pits: follow the actual full-jump trajectory so a single
  // clean jump collects the whole arc (flat lines were uncollectable)
  function jumpRise(x) {           // px above takeoff, matches player physics
    return x <= 145 ? 2.5 * x - 0.00702 * x * x
                    : 223 - 0.01276 * (x - 145) * (x - 145);
  }
  for (let cx = 8; cx < W - 8; cx++)
    if (gt[cx] === null && gt[cx-1] !== null) {
      const t = gt[cx-1];
      let wgap = 0;
      while (cx + wgap < W && gt[cx + wgap] === null) wgap++;
      for (let j = 0; j < wgap; j++) {
        const x = (j + 0.5) * 48 + 10;                     // launch ~10px before edge
        const lift = Math.max(1, Math.min(5, Math.round((jumpRise(x) + 49) / 48)));
        if (t - lift >= 0) rows[t - lift][cx + j] = 'o';
      }
    }
  // one-way platforms with pin rows on wide flats
  for (const f of flats) {
    if (f.end - f.start >= 6 && f.top >= 8 && rng() < 0.6) {
      const c0 = f.start + 1, c1 = Math.min(f.end - 1, c0 + 4);
      if (nearPitWide[c0] || nearPitWide[c1]) continue;
      for (let cx = c0; cx <= c1; cx++) { rows[f.top-4][cx] = '='; rows[f.top-5][cx] = 'o'; }
    } else if (rng() < 0.5) {
      const c0 = f.start + 1, c1 = Math.min(f.end - 1, c0 + 2);
      for (let cx = c0; cx <= c1; cx++) rows[f.top-1][cx] = 'o';   // run-through height
    }
  }
  // cages: 1 + n/2 (cap 5) — solid obstacles, so keep 6 cols clear of pits
  const nCages = Math.min(5, 1 + Math.floor(n / 2));
  for (let k = 0, tries = 0; k < nCages && tries < 60; tries++) {
    const f = pickFlat(); if (!f) break;
    const cx = f.start + 1 + Math.floor(rng() * Math.max(1, f.end - f.start - 1));
    if (!nearPitWide[cx] && rows[f.top-1][cx] === '.' && claim(cx, 1)) {
      rows[f.top-1][cx] = 'c'; k++;
      // from level 3, some cages get a Keeper standing guard beside them
      if (n >= 3 && rng() < 0.5 && cx + 3 < W && rows[f.top-1][cx+3] === '.' && !nearPitWide[cx+3] && claim(cx+3, 2))
        rows[f.top-1][cx+3] = 'K';
    }
  }
  // grunts: 3 + n (cap 14), spaced, never near a pit edge (fair landings)
  const nEnemies = Math.min(10, 2 + n);
  for (let k = 0, tries = 0; k < nEnemies && tries < 120; tries++) {
    const f = pickFlat(); if (!f) break;
    const cx = f.start + 1 + Math.floor(rng() * Math.max(1, f.end - f.start - 1));
    if (cx > 12 && cx < W - 10 && !nearPit[cx] && rows[f.top-1][cx] === '.' && claim(cx, 3)) { rows[f.top-1][cx] = 'g'; k++; }
  }
  // powerup candidate spots
  const nSpots = Math.max(3, 5 - Math.floor(n / 6));
  for (let k = 0, tries = 0; k < nSpots && tries < 60; tries++) {
    const f = pickFlat(); if (!f) break;
    const cx = f.start + 1 + Math.floor(rng() * Math.max(1, f.end - f.start - 1));
    if (rows[f.top-1][cx] === '.' && claim(cx, 1)) { rows[f.top-1][cx] = '?'; k++; }   // run-through height
  }
  // per-turf signature hazard (turf rotates with level number)
  const turf = (n - 1) % 4;
  const nHaz = Math.min(3, 1 + Math.floor((n - 1) / 4));
  if (turf === 0) {
    // Ember Alley: vents in pits — embers rise ~2.4 tiles, full jumps clear them
    let placed = 0;
    for (let cx = 8; cx < W - 8 && placed < nHaz; cx++)
      if (gt[cx] === null && gt[cx-1] !== null) {
        let wgap = 0;
        while (cx + wgap < W && gt[cx + wgap] === null) wgap++;
        if (wgap >= 2) {
          for (let j = 0; j < wgap; j++) rows[gt[cx-1]][cx + j] = 'v';   // full fire trench
          placed++;
        }
        cx += wgap;
      }
  } else if (turf === 1) {
    // Heart Court: bounce-pad hearts on long safe flats
    for (let k = 0, tries = 0; k < nHaz && tries < 40; tries++) {
      const f = pickFlat(); if (!f) break;
      if (f.end - f.start < 6) continue;
      const cx = f.start + 2 + Math.floor(rng() * Math.max(1, f.end - f.start - 3));
      const pinClear = rows[f.top-1][cx-1] !== 'o' && rows[f.top-1][cx] !== 'o' && rows[f.top-1][cx+1] !== 'o';
      if (!nearPitWide[cx] && pinClear && rows[f.top-2][cx] === '.' && claim(cx, 2)) { rows[f.top-2][cx] = 'B'; k++; }
    }
  } else if (turf === 2) {
    // Clockwork Row: timed gates blocking the path
    for (let k = 0, tries = 0; k < nHaz && tries < 40; tries++) {
      const f = pickFlat(); if (!f) break;
      if (f.end - f.start < 6) continue;
      const cx = f.start + 3 + Math.floor(rng() * Math.max(1, f.end - f.start - 5));
      if (!nearPit[cx] && rows[f.top-1][cx] === '.' && claim(cx, 2)) { rows[f.top-1][cx] = 'G'; k++; }
    }
  } else {
    // Patchwork Yard: patrolling sawblades on long flats
    for (let k = 0, tries = 0; k < nHaz && tries < 40; tries++) {
      const f = pickFlat(); if (!f) break;
      if (f.end - f.start < 5) continue;
      const cx = f.start + 2 + Math.floor(rng() * Math.max(1, f.end - f.start - 3));
      if (cx > 12 && !nearPit[cx] && rows[f.top-1][cx] === '.' && claim(cx, 3)) { rows[f.top-1][cx] = 'w'; k++; }
    }
  }
  rows[top-1][W-4] = 'E';
  return rows.map(r => r.join(''));
}

/* Legend: '#' solid  '=' one-way platform  'o' tie pin  'g' grunt
           'c' cage   'E' exit door         '.' empty */
const LEVEL1 = [
"................................................................................................",
"................................................................................................",
"................................................................................................",
"................................................................................................",
"................................................................................................",
"................................................................................................",
".........ooo.........................................gooo..........ooo..........................",
"........=====.......................................======........=====.........................",
".....ooo....?....ooo.......ooo........?..####ooo.......?...ooo........?......ooo.....?.ooo......",
"..............................g...c......####.................g.................g...c.......E...",
"######################...####################...#########################..#####################",
"######################...####################...#########################..#####################",
];

function parseLevel(rows) {
  const grid = [];
  const enemies = [], pins = [], cages = [], powerups = [], puSpots = [];
  const embers = [], hearts = [], gates = [], saws = [], keepers = [];
  let exit = null;
  for (let y = 0; y < rows.length; y++) {
    grid.push([]);
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '#' || ch === '=') { grid[y][x] = ch; continue; }
      grid[y][x] = '.';
      const px = x * C.TILE, py = y * C.TILE;
      if (ch === 'o') pins.push({ x: px + C.TILE/2, y: py + C.TILE/2, taken: false });
      else if (ch === 'g') enemies.push({
        x: px + (C.TILE - C.ENEMY_W)/2, y: py + C.TILE - C.ENEMY_H,
        w: C.ENEMY_W, h: C.ENEMY_H, vx: -C.ENEMY_SPEED, vy: 0, alive: true, t: 0 });
      else if (ch === 'c') cages.push({ tx: x, ty: y, broken: false });
      else if (ch === 'u') powerups.push({ x: px + C.TILE/2, y: py + C.TILE/2, type: 'coffee', taken: false });
      else if (ch === 'f') powerups.push({ x: px + C.TILE/2, y: py + C.TILE/2, type: 'fire', taken: false });
      else if (ch === 'h') powerups.push({ x: px + C.TILE/2, y: py + C.TILE/2, type: 'hotchoc', taken: false });
      else if (ch === 'm') powerups.push({ x: px + C.TILE/2, y: py + C.TILE/2, type: 'melon', taken: false });
      else if (ch === '?') puSpots.push({ x: px + C.TILE/2, y: py + C.TILE/2 });
      else if (ch === 'v') embers.push({ tx: x, top: y, phase: (x * 0.77) % 3.2, y: 0, active: false });
      else if (ch === 'B') hearts.push({ x: px + C.TILE/2, y: py + C.TILE/2, cd: 0 });
      else if (ch === 'G') gates.push({ tx: x, baseTy: y, phase: (x * 1.13) % 3.6, open: false });
      else if (ch === 'w') saws.push({ x: px + 6, y: py + C.TILE - 20, w: 36, h: 20, vx: -55, vy: 0 });
      else if (ch === 'K') keepers.push({ x: px - 2, y: py + C.TILE - 76, w: 52, h: 76, vx: 0, vy: 0, alive: true, t: 0 });
      else if (ch === 'E') exit = { x: px, y: 0, w: C.TILE, h: (y + 1) * C.TILE, doorY: py - C.TILE };
    }
  }
  // ember flames must fit under the jump arc: short at gap edges (crossed low),
  // tall mid-gap (crossed near apex) — a committed full jump always clears
  embers.sort((a, b) => a.tx - b.tx);
  const rise = x => x <= 145 ? 2.5 * x - 0.00702 * x * x
                             : 223 - 0.01276 * (x - 145) * (x - 145);
  let runStart = 0;
  for (let i = 0; i < embers.length; i++) {
    if (i === 0 || embers[i].tx !== embers[i - 1].tx + 1 || embers[i].top !== embers[i - 1].top)
      runStart = i;
    const j = i - runStart;
    const x = (j + 0.5) * C.TILE + 10;
    embers[i].peak = Math.max(34, Math.min(115, rise(x) - 26));
  }
  return { grid, enemies, pins, cages, powerups, puSpots, embers, hearts, gates, saws, keepers,
           exit, w: rows[0].length, h: rows.length };
}

function createGame(levelRows, rng, levelNum) {
  rng = rng || Math.random;
  const level = parseLevel(levelRows || LEVEL1);
  for (const k of level.keepers) {           // each keeper guards its nearest cage
    let best = -1, bd = 1e9;
    for (let i = 0; i < level.cages.length; i++) {
      const d = Math.abs(level.cages[i].tx * C.TILE - k.x);
      if (d < bd) { bd = d; best = i; }
    }
    k.cage = bd < 6 * C.TILE ? best : -1;
  }
  const spd = C.ENEMY_SPEED * Math.min(2, 1 + ((levelNum || 1) - 1) * 0.06);
  for (const e of level.enemies) { e.speed = spd; e.vx = -spd; }
  if (level.puSpots.length >= 2) {
    const idx = level.puSpots.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {           // shuffle
      const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const pool = ['coffee', 'fire', 'hotchoc', 'melon'];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const types = pool.slice(0, 2);
    for (let k = 0; k < 2; k++) {
      const sp = level.puSpots[idx[k]];
      level.powerups.push({ x: sp.x, y: sp.y, type: types[k], taken: false });
    }
  }
  return {
    level, t: 0, levelNum: levelNum || 1, seed: 0,
    player: spawnPlayer(),
    spawnX: 3 * C.TILE, spawnY: 8 * C.TILE,
    checkpointX: 3 * C.TILE, checkpointY: 8 * C.TILE,
    pinsTotal: 0, lives: C.START_LIVES, rescued: 0,
    score: 0,
    won: false, gameOver: false,
    events: [],           // one-frame event strings for sfx/fx
    prevJump: false, prevFire: false,
    shots: [],
  };
}

function spawnPlayer() {
  return {
    x: 3 * C.TILE, y: 8 * C.TILE, w: C.PLAYER_W, h: C.PLAYER_H,
    vx: 0, vy: 0, grounded: false, facing: 1,
    coyote: 0, buffer: 0, bumping: false,
    hits: 0, inv: 0, animT: 0,
    weapon: null, ammo: 0, shotCd: 0, shield: false,
  };
}

function solidAt(level, tx, ty) {
  if (tx < 0 || tx >= level.w) return true;       // side walls
  if (ty < 0) return false;
  if (ty >= level.h) return false;                 // open pits
  if (level.grid[ty][tx] === '#') return true;
  // unbroken cages are solid
  for (const c of level.cages)
    if (!c.broken && c.tx === tx && c.ty === ty) return true;
  // closed clockwork gates block a 3-tile column
  for (const gte of (level.gates || []))
    if (!gte.open && tx === gte.tx && ty <= gte.baseTy) return true;   // full column, sky to floor
  return false;
}

function oneWayAt(level, tx, ty) {
  if (tx < 0 || tx >= level.w || ty < 0 || ty >= level.h) return false;
  return level.grid[ty][tx] === '=';
}

function moveAndCollide(level, b, dt, dropThrough) {
  const T = C.TILE;
  let hitWall = false, landed = false, hitCeil = false;
  // horizontal
  b.x += b.vx * dt;
  {
    const top = Math.floor(b.y / T), bot = Math.floor((b.y + b.h - 1) / T);
    if (b.vx > 0) {
      const tx = Math.floor((b.x + b.w) / T);
      for (let ty = top; ty <= bot; ty++)
        if (solidAt(level, tx, ty)) { b.x = tx * T - b.w - 0.01; b.vx = 0; hitWall = true; break; }
    } else if (b.vx < 0) {
      const tx = Math.floor(b.x / T);
      for (let ty = top; ty <= bot; ty++)
        if (solidAt(level, tx, ty)) { b.x = (tx + 1) * T + 0.01; b.vx = 0; hitWall = true; break; }
    }
  }
  // vertical
  const prevBottom = b.y + b.h;
  b.y += b.vy * dt;
  {
    const left = Math.floor(b.x / T), right = Math.floor((b.x + b.w - 1) / T);
    if (b.vy > 0) {
      const ty = Math.floor((b.y + b.h) / T);
      for (let tx = left; tx <= right; tx++) {
        const solid = solidAt(level, tx, ty);
        const oneway = !dropThrough && oneWayAt(level, tx, ty) && prevBottom <= ty * T + 1;
        if (solid || oneway) { b.y = ty * T - b.h - 0.01; b.vy = 0; landed = true; break; }
      }
    } else if (b.vy < 0) {
      const ty = Math.floor(b.y / T);
      for (let tx = left; tx <= right; tx++)
        if (solidAt(level, tx, ty)) { b.y = (ty + 1) * T + 0.01; b.vy = 0; hitCeil = true; break; }
    }
  }
  return { hitWall, landed, hitCeil };
}

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function damagePlayer(g, fromX) {
  const p = g.player;
  if (p.inv > 0) return;
  p.inv = C.HIT_IFRAMES;
  p.vx = (p.x + p.w / 2 < fromX ? -1 : 1) * C.KNOCKBACK; p.vy = -260;
  if (p.shield) { p.shield = false; g.events.push('shieldbreak'); }
  else {
    p.hits++; g.events.push('hurt');
    if (p.hits >= C.MAX_HITS) loseLife(g, 'hits');
  }
}

function respawn(g) {
  const p = g.player;
  p.x = g.checkpointX; p.y = g.checkpointY;
  p.vx = 0; p.vy = 0; p.hits = 0; p.inv = 2.5; p.bumping = false;
  p.weapon = null; p.ammo = 0; p.shield = false;
}

function loseLife(g, why) {
  g.lives--;
  g.events.push('die:' + why);
  if (g.lives <= 0) { g.gameOver = true; return; }
  respawn(g);
}

function step(g, input, dt) {
  g.events.length = 0;
  if (g.won || g.gameOver) return;
  g.t += dt;
  const p = g.player, L = g.level;
  const jumpPressed = input.jump && !g.prevJump;
  g.prevJump = !!input.jump;

  // timers
  p.inv = Math.max(0, p.inv - dt);
  p.coyote = Math.max(0, p.coyote - dt);
  p.buffer = Math.max(0, p.buffer - dt);
  p.animT += dt;

  // horizontal control
  const acc = p.grounded ? C.MOVE_ACC : C.AIR_ACC;
  if (input.left && !input.right) { p.vx -= acc * dt; p.facing = -1; }
  else if (input.right && !input.left) { p.vx += acc * dt; p.facing = 1; }
  else if (p.grounded) {
    const s = Math.sign(p.vx);
    p.vx -= s * C.FRICTION * dt;
    if (Math.sign(p.vx) !== s) p.vx = 0;
  }
  p.vx = Math.max(-C.MAX_VX, Math.min(C.MAX_VX, p.vx));

  // jump / belly bump
  const wantBump = !p.grounded && input.down && !p.bumping &&
                   (jumpPressed || (input.jump && p.vy > -140));
  if (wantBump) {
    p.bumping = true; p.vy = C.BUMP_V; p.vx *= 0.3;
    g.events.push('bump');
  } else if (jumpPressed) p.buffer = C.BUFFER;
  if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
    p.vy = C.JUMP_V; p.grounded = false; p.coyote = 0; p.buffer = 0;
    g.events.push('jump');
  }

  // gravity (lighter while rising & holding jump)
  const g_ = (p.vy < 0 && input.jump && !p.bumping) ? C.GRAV_HOLD : C.GRAV;
  p.vy = Math.min(p.vy + g_ * dt, 1200);

  const wasGrounded = p.grounded;
  const vyPre = p.vy;                     // fall speed before collision zeroes it
  const res = moveAndCollide(L, p, dt, input.down && !p.bumping ? false : false);
  p.grounded = res.landed;
  if (wasGrounded && !p.grounded) p.coyote = C.COYOTE;

  // belly bump impact
  if (p.bumping && p.grounded) {
    const footY = Math.floor((p.y + p.h + 4) / C.TILE);
    const l = Math.floor(p.x / C.TILE), r = Math.floor((p.x + p.w - 1) / C.TILE);
    for (const c of L.cages) {
      if (!c.broken && (c.ty === footY || c.ty === footY - 1) && c.tx >= l - 1 && c.tx <= r + 1) {
        c.broken = true; g.rescued++; g.score += 500; g.events.push('rescue');
      }
    }
    p.vy = C.BUMP_BOUNCE; p.grounded = false; p.bumping = false;
    g.events.push('bumpland');
  }

  // enemies
  for (const e of L.enemies) {
    if (!e.alive) continue;
    e.t += dt;
    e.vy = Math.min(e.vy + C.GRAV * dt, 1200);
    const pvx = e.vx;
    const er = moveAndCollide(L, e, dt, false);
    const sp = e.speed || C.ENEMY_SPEED;
    if (er.hitWall) e.vx = pvx >= 0 ? -sp : sp;
    if (e.vx === 0) e.vx = -sp;
    if (er.landed) {
      const dir = e.vx > 0 ? 1 : -1;
      const ty = Math.floor((e.y + e.h + 2) / C.TILE);
      // turn at the immediate ledge (never walk off)
      const ntx = Math.floor((dir > 0 ? e.x + e.w + 2 : e.x - 2) / C.TILE);
      let turn = !solidAt(L, ntx, ty) && !oneWayAt(L, ntx, ty);
      // and turn 3 tiles before a true void (pit) — keeps landing zones clear
      if (!turn) {
        const ftx = Math.floor((dir > 0 ? e.x + e.w + C.TILE * 3 : e.x - C.TILE * 3) / C.TILE);
        if (!solidAt(L, ftx, ty) && !oneWayAt(L, ftx, ty)) {
          let isVoid = true;
          for (let yy = ty; yy < L.h; yy++)
            if (L.grid[yy] && L.grid[yy][ftx] === '#') { isVoid = false; break; }
          if (isVoid) turn = true;
        }
      }
      if (turn) e.vx = -e.vx;
    }
    // player interaction
    if (overlap(p, e)) {
      // Mario rule: any falling contact with your center above theirs is a stomp
      const falling = vyPre > 60;
      const fromAbove = p.y + p.h * 0.5 <= e.y + e.h * 0.5 + 10;
      if (p.bumping || (falling && fromAbove)) {
        e.alive = false; g.score += 200;
        g.events.push('stomp');
        if (!p.bumping) p.vy = C.STOMP_BOUNCE;
      } else if (p.inv <= 0) {
        p.inv = C.HIT_IFRAMES;
        p.vx = (p.x < e.x ? -1 : 1) * C.KNOCKBACK; p.vy = -260;
        if (p.shield) {
          p.shield = false; g.events.push('shieldbreak');
        } else {
          p.hits++; g.events.push('hurt');
          if (p.hits >= C.MAX_HITS) loseLife(g, 'hits');
        }
      }
    }
  }

  // shooting
  p.shotCd = Math.max(0, p.shotCd - dt);
  const firePressed = input.fire && !g.prevFire;
  g.prevFire = !!input.fire;
  if (firePressed && p.weapon && p.ammo > 0 && p.shotCd <= 0) {
    const spec = C.SHOT[p.weapon];
    g.shots.push({ x: p.x + p.w/2 + p.facing * 22, y: p.y + p.h * 0.45,
                   vx: p.facing * spec.speed, vy: p.weapon === 'fire' ? spec.arc : 0,
                   type: p.weapon, alive: true, t: 0 });
    p.ammo--; p.shotCd = spec.cd;
    g.events.push('shoot:' + p.weapon);
    if (p.ammo === 0) { p.weapon = null; g.events.push('power:out'); }
  }
  for (const sh of g.shots) {
    if (!sh.alive) continue;
    sh.t += dt;
    if (sh.type === 'fire') sh.vy += C.SHOT.fire.grav * dt;
    sh.x += sh.vx * dt; sh.y += sh.vy * dt;
    const tx = Math.floor(sh.x / C.TILE), ty = Math.floor(sh.y / C.TILE);
    if (sh.x < 0 || sh.x > L.w * C.TILE || sh.y > L.h * C.TILE + 60 || sh.t > 2.5) { sh.alive = false; continue; }
    if (solidAt(L, tx, ty)) {
      if (sh.type === 'fire') {
        for (const c of L.cages)
          if (!c.broken && c.tx === tx && c.ty === ty) { c.broken = true; g.rescued++; g.score += 500; g.events.push('rescue'); }
        // bouncing fireball: skips off floors, dies on walls
        if (sh.vy > 0 && (sh.bounces || 0) < 4) {
          sh.y = ty * C.TILE - 2; sh.vy = -340; sh.bounces = (sh.bounces || 0) + 1;
          g.events.push('firebounce');
          continue;
        }
      }
      sh.alive = false; continue;
    }
    for (const e of L.enemies) {
      if (!e.alive) continue;
      if (sh.x > e.x && sh.x < e.x + e.w && sh.y > e.y && sh.y < e.y + e.h) {
        e.alive = false; g.score += 150; g.events.push('shotkill');
        if (sh.type !== 'fire') { sh.alive = false; break; }   // fire pierces
      }
    }
  }
  if (g.shots.length > 40) g.shots = g.shots.filter(sh => sh.alive);

  // powerups
  for (const pu of L.powerups) {
    if (pu.taken) continue;
    if (pu.x > p.x - 12 && pu.x < p.x + p.w + 12 && pu.y > p.y - 12 && pu.y < p.y + p.h + 12) {
      pu.taken = true;
      if (pu.type === 'hotchoc') {
        g.lives++;                                      // warm cocoa = extra life
      } else if (pu.type === 'melon') {
        p.shield = true;                                // absorb one hit
      } else {
        p.weapon = pu.type; p.ammo = C.SHOT[pu.type].ammo;
      }
      g.events.push('power:' + pu.type);
    }
  }

  // hazards
  for (const gte of L.gates) {
    const cyc = (g.t + gte.phase) % 3.6;
    gte.open = cyc > 1.4;               // closed 1.4s, open 2.2s
    gte.cyc = cyc;
  }
  for (const em of L.embers) {
    const cyc = (g.t + em.phase) % 3.2;
    em.cyc = cyc;
    // 0-0.7 warning glow, 0.7-2.2 ember up-and-down, then idle
    if (cyc > 0.7 && cyc < 2.2) {
      const k = (cyc - 0.7) / 1.5;                    // 0..1
      const height = Math.sin(Math.PI * k) * (em.peak || 2.4 * C.TILE);
      em.y = em.top * C.TILE - height + C.TILE * 0.5;
      em.active = height > 8;
      const box = { x: em.tx * C.TILE + 14, y: em.y - 16, w: 20, h: 32 };
      if (em.active && overlap(p, box)) damagePlayer(g, box.x + 10);
    } else em.active = false;
  }
  for (const ht of L.hearts) {
    ht.cd = Math.max(0, ht.cd - dt);
    const box = { x: ht.x - 20, y: ht.y - 18, w: 40, h: 36 };
    if (ht.cd <= 0 && p.vy > -60 && overlap(p, box)) {   // boing on any real contact
      p.vy = -1050; p.grounded = false; ht.cd = 0.35;
      g.events.push('heartbounce');
    }
  }
  for (const sw of L.saws) {
    const pvx = sw.vx;
    sw.vy = Math.min(sw.vy + C.GRAV * dt, 1200);
    const sr = moveAndCollide(L, sw, dt, false);
    if (sr.hitWall) sw.vx = pvx >= 0 ? -55 : 55;
    if (sw.vx === 0) sw.vx = -55;
    if (sr.landed) {
      const dir = sw.vx > 0 ? 1 : -1;
      const ty2 = Math.floor((sw.y + sw.h + 2) / C.TILE);
      const ntx = Math.floor((dir > 0 ? sw.x + sw.w + 2 : sw.x - 2) / C.TILE);
      if (!solidAt(L, ntx, ty2) && !oneWayAt(L, ntx, ty2)) sw.vx = -sw.vx;
    }
    if (overlap(p, sw)) damagePlayer(g, sw.x + sw.w / 2);   // no stomping a sawblade
  }

  // cage keepers
  for (const k of L.keepers) {
    if (!k.alive) continue;
    k.t += dt;
    if (!k.enraged && k.cage >= 0 && L.cages[k.cage] && L.cages[k.cage].broken) {
      k.enraged = true;
      k.vx = p.x < k.x ? -45 : 45;             // comes looking for you
      g.events.push('keepermad');
    }
    k.vy = Math.min(k.vy + C.GRAV * dt, 1200);
    const kvx = k.vx;
    const kr = moveAndCollide(L, k, dt, false);
    if (k.enraged) {
      if (kr.hitWall) k.vx = kvx >= 0 ? -45 : 45;
      if (k.vx === 0) k.vx = -45;
      if (kr.landed) {
        const dir = k.vx > 0 ? 1 : -1;
        const ty2 = Math.floor((k.y + k.h + 2) / C.TILE);
        const ntx = Math.floor((dir > 0 ? k.x + k.w + 2 : k.x - 2) / C.TILE);
        if (!solidAt(L, ntx, ty2) && !oneWayAt(L, ntx, ty2)) k.vx = -k.vx;
      }
    }
    if (overlap(p, k)) {
      if (p.bumping) {
        k.alive = false; g.score += 300;
        g.events.push('keeperdie');
      } else if (vyPre > 60) {
        p.vy = C.STOMP_BOUNCE;                 // any falling contact boings off the big lug
        if (p.x + p.w / 2 < k.x) p.vx = -Math.abs(p.vx) - 60;
        else if (p.x + p.w / 2 > k.x + k.w) p.vx = Math.abs(p.vx) + 60;
        g.events.push('helmet');
      } else if (vyPre < -50) {
        // rising / mid-boing: harmless brush while separating
      } else {
        damagePlayer(g, k.x + k.w / 2);
      }
    }
  }

  // pins
  const pr = { x: p.x - 6, y: p.y - 6, w: p.w + 12, h: p.h + 12 };
  for (const pin of L.pins) {
    if (pin.taken) continue;
    if (pin.x > pr.x && pin.x < pr.x + pr.w && pin.y > pr.y && pin.y < pr.y + pr.h) {
      pin.taken = true; g.pinsTotal++; g.score += 100;
      g.events.push('pin');
      if (g.pinsTotal % C.PINS_PER_LIFE === 0) { g.lives++; g.events.push('1up'); }
    }
  }

  // checkpoint: first grounded stand past the level midpoint (always a safe spot)
  const midX = (L.w / 2) * C.TILE;
  if (p.grounded && p.x > midX && g.checkpointX < midX) {
    g.checkpointX = p.x; g.checkpointY = p.y - 4;
    g.events.push('checkpoint');
  }

  // pit death
  if (p.y > L.h * C.TILE + 60) loseLife(g, 'pit');

  // exit
  if (L.exit && overlap(p, L.exit)) {
    g.won = true; g.score += 500 + g.levelNum * 500;
    g.events.push('win');
  }
}

function createRun(seed) {
  seed = (seed >>> 0) || 1;
  const rng = makeRng(seed * 7919 + 104729);
  const g = createGame(generateLevel(1, rng), rng, 1);
  g.seed = seed;
  return g;
}

function nextLevel(g) {
  const n = g.levelNum + 1;
  const rng = makeRng((g.seed || 1) * 7919 + n * 104729);
  const ng = createGame(generateLevel(n, rng), rng, n);
  ng.seed = g.seed;
  ng.lives = g.lives;
  ng.pinsTotal = g.pinsTotal;
  ng.score = g.score;
  ng.rescuedTotal = (g.rescuedTotal || 0) + g.rescued;
  ng.player.weapon = g.player.weapon;
  ng.player.ammo = g.player.ammo;
  ng.player.shield = g.player.shield;
  return ng;
}

const GameCore = { C, LEVEL1, TURFS, createGame, createRun, nextLevel, generateLevel, makeRng,
                   step, parseLevel, overlap, solidAt };
if (typeof module !== 'undefined' && module.exports) module.exports = GameCore;
else root.GameCore = GameCore;
})(typeof window !== 'undefined' ? window : globalThis);
