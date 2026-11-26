// Neon Tumble v1.0.0 — pure simulation core (no DOM, no Three.js).
//
// A 3D neon cube-rolling puzzle: a cube with six distinctly coloured
// faces rolls one cell at a time across floating grid platforms. Each
// beacon pad has a colour — it lights only when the cube lands on it
// with the matching face DOWN. Light every beacon, then roll onto the
// exit portal to clear the level. Each roll costs a move against the
// level's move budget; walls block; rolling off the edge drops the cube
// and fails the level.
//
// The cube's visible faces are live feedback of the player's own last
// action (like a trail), never a prediction oracle: they show the cube
// as it IS, not what to do next. There is no auto-roll and no hint that
// names the next move.
//
// Coordinates: grid cells (x east, y south, matching screen rows when
// viewed from the south). Directions: 'E' | 'W' | 'N' | 'S'.
// Orientation: { top, bottom, north, south, east, west } — the colour
// index on each face. Start: top cyan, bottom magenta, north gold,
// south violet, east lime, west orange (opposite pairs 0-1, 2-3, 4-5).
//
// Deterministic: levels are hand-built from fixed grids; the solver
// (BFS over position + orientation + lit mask) gives identical results
// for identical inputs.

export const VERSION = '1.0.0';

export const DIRS = {
  E: { x: 1, y: 0 },
  W: { x: -1, y: 0 },
  N: { x: 0, y: -1 },
  S: { x: 0, y: 1 },
};
export const DIR_LIST = ['E', 'W', 'N', 'S'];

export const COLOURS = [
  { name: 'Cyan', hex: '#22e6ff' },
  { name: 'Magenta', hex: '#ff2e9e' },
  { name: 'Gold', hex: '#ffdf2e' },
  { name: 'Violet', hex: '#9d4dff' },
  { name: 'Lime', hex: '#7dff4d' },
  { name: 'Orange', hex: '#ff5200' },
];

export const START_ORIENT = { top: 0, bottom: 1, north: 2, south: 3, east: 4, west: 5 };

export function rollOrientation(o, dir) {
  switch (dir) {
    case 'E': return { top: o.west, bottom: o.east, north: o.north, south: o.south, east: o.top, west: o.bottom };
    case 'W': return { top: o.east, bottom: o.west, north: o.north, south: o.south, east: o.bottom, west: o.top };
    case 'N': return { top: o.south, bottom: o.north, north: o.top, south: o.bottom, east: o.east, west: o.west };
    case 'S': return { top: o.north, bottom: o.south, north: o.bottom, south: o.top, east: o.east, west: o.west };
    default: return { ...o };
  }
}

export function orientKey(o) {
  return o.top + ',' + o.bottom + ',' + o.north + ',' + o.south + ',' + o.east + ',' + o.west;
}

// ---------------------------------------------------------------- helpers
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function cellKey(x, y) { return x + ',' + y; }

// ---------------------------------------------------------------- levels
// Grid legend: '#' wall (blocks), '.' floor, ' ' void (no platform —
// rolling there drops the cube), 'S' start, 'X' exit, '0'..'5' beacon
// pads with that colour index. parMoves is the solver's minimum
// (verified by tests/bot.js); budget gives the player slack above it.
function parseLevel(def) {
  const rows = def.grid.length;
  const cols = Math.max(...def.grid.map((r) => r.length));
  const floor = new Set();
  const walls = new Set();
  const beacons = [];
  let start = null;
  let exit = null;
  for (let y = 0; y < rows; y++) {
    const row = def.grid[y];
    for (let x = 0; x < cols; x++) {
      const ch = row[x] || ' ';
      if (ch === ' ') continue;
      floor.add(cellKey(x, y));
      if (ch === '#') walls.add(cellKey(x, y));
      else if (ch === 'S') start = { x, y };
      else if (ch === 'X') exit = { x, y };
      else if (ch >= '0' && ch <= '5') beacons.push({ x, y, colour: Number(ch), index: beacons.length });
    }
  }
  return { ...def, cols, rows, floor, walls, beacons, start, exit };
}

export const LEVELS = [
  parseLevel({
    id: 1,
    name: 'First Tumble',
    hint: 'Roll east — the magenta face comes back underneath after four rolls. Then turn north to the exit.',
    accent: '#22e6ff',
    grid: [
      '....X.',
      '......',
      'S...1.',
    ],
    budget: 11, parMoves: 6, parTime: 40,
  }),
  parseLevel({
    id: 2,
    name: 'Crosscurrent',
    hint: 'Two beacons, two faces. The wall forces a detour — plan the tumble.',
    accent: '#ff2e9e',
    grid: [
      '.......',
      '.S.....',
      '...4#.X',
      '.2.....',
      '.......',
    ],
    budget: 18, parMoves: 14, parTime: 70,
  }),
  parseLevel({
    id: 3,
    name: 'The Vault',
    hint: 'Three beacons around the vault. Every roll is an orientation decision.',
    accent: '#ffdf2e',
    grid: [
      '..##....',
      '.S...5..',
      '..##.#..',
      '.3....#X',
      '....1...',
      '..##....',
    ],
    budget: 22, parMoves: 18, parTime: 100,
  }),
  // M2 (v0.2.0): nine more hand-crafted levels. Solver pars form a
  // strictly increasing curve across all 12 levels: 6, 14, 18, 21,
  // 23, 26, 27, 28, 31, 34, 35, 37 (verified by tests/bot.js).
  // Platforms stay at least two cells deep everywhere so 2x2 loops
  // can always re-orient the cube onto any face — a 1-wide corridor
  // would lock the north/south faces away from the bottom forever.
  parseLevel({
    id: 4,
    name: 'The Loop',
    hint: 'Two beacons on opposite sides of the wall blocks. Loop around them — the loop itself turns the cube.',
    accent: '#9d4dff',
    grid: [
      '...........',
      '.S..##.....',
      '....##..4..',
      '...........',
      '..##.......',
      '.2....##..X',
      '...........',
    ],
    budget: 30, parMoves: 21, parTime: 125,
  }),
  parseLevel({
    id: 5,
    name: 'Crossroads',
    hint: 'Four beacons, one crossroads. Choose an order — every detour is also a tumble.',
    accent: '#7dff4d',
    grid: [
      '.....X......',
      '.....4......',
      '............',
      '.S...##...1.',
      '............',
      '.....3......',
      '.....5......',
      '............',
    ],
    budget: 32, parMoves: 23, parTime: 135,
  }),
  parseLevel({
    id: 6,
    name: 'Twin Gates',
    hint: 'Three beacons behind twin wall gates. Thread the gaps without wasting the face you need.',
    accent: '#ff5200',
    grid: [
      '..............',
      '.S....##....0.',
      '...##.........',
      '.........##...',
      '.5....##......',
      '....1........X',
      '..............',
    ],
    budget: 36, parMoves: 26, parTime: 150,
  }),
  parseLevel({
    id: 7,
    name: 'Switchback',
    hint: 'Beacons at both ends of the switchback. The long way round is the orientation you need.',
    accent: '#22e6ff',
    grid: [
      '.............',
      '.S.......0...',
      '....##.......',
      '.............',
      '.....##....3.',
      '............X',
      '.2...........',
    ],
    budget: 37, parMoves: 27, parTime: 155,
  }),
  parseLevel({
    id: 8,
    name: 'Hourglass',
    hint: 'The hourglass pinches in the middle. Pass through it twice — once for each face.',
    accent: '#ff2e9e',
    grid: [
      '............',
      '.S....0.....',
      '....##......',
      '.....##.....',
      '....##...3..',
      '............',
      '....5.......',
      '...........X',
    ],
    budget: 38, parMoves: 28, parTime: 160,
  }),
  parseLevel({
    id: 9,
    name: 'The Gauntlet',
    hint: 'All six faces, all six beacons. The gauntlet runs the full length of the platform.',
    accent: '#ffdf2e',
    grid: [
      'S............X',
      '....##........',
      '.0....##...5..',
      '....##........',
      '......##......',
      '.3....##...2..',
      '....##........',
      '..............',
      '....1....4....',
    ],
    budget: 43, parMoves: 31, parTime: 175,
  }),
  parseLevel({
    id: 10,
    name: 'The Maze',
    hint: 'Walls everywhere and only three beacons — the maze is the puzzle. Count your faces at every turn.',
    accent: '#9d4dff',
    grid: [
      'S....#......',
      '.....#..4...',
      '.##..#......',
      '.....##.##..',
      '..2.........',
      '.##.##..#...',
      '.........#X.',
      '....0.......',
    ],
    budget: 46, parMoves: 34, parTime: 190,
  }),
  parseLevel({
    id: 11,
    name: 'Four Corners',
    hint: 'You start in the middle. Four beacons, four corners — pick a route and commit.',
    accent: '#7dff4d',
    grid: [
      '0..........5',
      '............',
      '..##....##..',
      '.....S......',
      '..##....##..',
      '............',
      '3..........X',
      '.....1......',
    ],
    budget: 47, parMoves: 35, parTime: 195,
  }),
  parseLevel({
    id: 12,
    name: 'Void Crown',
    hint: 'The crown: every colour, every corner, one long tumble home. Spend nothing twice.',
    accent: '#ff5200',
    grid: [
      'S..............',
      '.....##........',
      '.0.....##...5..',
      '.....##........',
      '.......##......',
      '.3.....##...2..',
      '.....##........',
      '..............X',
      '....1....4.....',
    ],
    budget: 49, parMoves: 37, parTime: 205,
  }),
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

export function beaconAt(level, x, y) {
  return level.beacons.find((b) => b.x === x && b.y === y) || null;
}

export function isFloor(level, x, y) {
  return level.floor.has(cellKey(x, y));
}
export function isWall(level, x, y) {
  return level.walls.has(cellKey(x, y));
}

// ---------------------------------------------------------------- solver
// BFS over (x, y, orientation, litMask). Returns { moves, path } with
// path a list of directions, or null if unsolvable. Walls block (the
// state does not change, so BFS simply skips them); voids are terminal
// (never part of a solution).
export function solve(level) {
  const startMask = 0;
  const fullMask = (1 << level.beacons.length) - 1;
  const startKey = level.start.x + ',' + level.start.y + '|' + orientKey(START_ORIENT) + '|' + startMask;
  const queue = [{ x: level.start.x, y: level.start.y, orient: { ...START_ORIENT }, mask: startMask, path: [] }];
  const seen = new Set([startKey]);
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const dir of DIR_LIST) {
      const d = DIRS[dir];
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (!isFloor(level, nx, ny) || isWall(level, nx, ny)) continue;
      const orient = rollOrientation(cur.orient, dir);
      let mask = cur.mask;
      const b = beaconAt(level, nx, ny);
      if (b && orient.bottom === b.colour) mask |= (1 << b.index);
      const path = [...cur.path, dir];
      if (nx === level.exit.x && ny === level.exit.y && mask === fullMask) {
        return { moves: path.length, path };
      }
      const k = nx + ',' + ny + '|' + orientKey(orient) + '|' + mask;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny, orient, mask, path });
    }
  }
  return null;
}

// ---------------------------------------------------------------- endless
// M4: Endless Tumble — seeded scaling depths. Each depth is a fresh
// generated platform (bigger, more beacons, more walls, less budget
// slack as you descend), verified solvable by the same BFS solver
// before it is handed to the player. Generation is deterministic
// from (seed, depth): the same pair always builds the same depth, so
// a restart replays the identical puzzle and the bot harness can
// gate every depth. The generator only ever returns a level the
// solver cleared inside the depth's par band — an unsolvable or
// trivial depth is rejected and the next candidate is drawn.
export function endlessBeaconCount(depth) {
  return Math.min(6, 1 + Math.floor((depth - 1) / 2));
}
export function endlessSlackFrac(depth) {
  // Budget slack above par shrinks as you descend: ~47% at depth 1
  // (teaching), ~20% at depth 10, floored at 12% — the deeper you
  // go, the fewer wasted tumbles you can afford.
  return Math.max(0.12, 0.5 - depth * 0.03);
}
export function generateEndlessLevel(seed, depth) {
  const cols = Math.min(15, 6 + depth); // depth 1: 7 wide, depth 9+: 15
  const rows = Math.min(9, 3 + Math.ceil(depth / 2)); // depth 1: 4, depth 11+: 9
  const beaconTotal = endlessBeaconCount(depth);
  const wallTotal = Math.min(12, Math.floor(depth * 1.3));
  const minPar = 5 + depth * 2;
  const maxPar = 16 + depth * 3;
  const rng = mulberry32((Math.imul(seed + 1, 2654435761) + Math.imul(depth, 40503)) >>> 0);
  const pick = (n) => Math.floor(rng() * n);
  // Two phases: strict par band first, then any solvable depth, so
  // generation can never hang or hand back an impossible puzzle.
  for (let phase = 0; phase < 2; phase++) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const grid = Array.from({ length: rows }, () => Array(cols).fill('.'));
      const start = { x: pick(2), y: pick(rows) };
      let exit = { x: cols - 1 - pick(2), y: pick(rows) };
      if (Math.abs(exit.x - start.x) + Math.abs(exit.y - start.y) < Math.floor(cols * 0.7)) continue;
      const taken = new Set([cellKey(start.x, start.y), cellKey(exit.x, exit.y)]);
      const colours = [0, 1, 2, 3, 4, 5];
      for (let i = colours.length - 1; i > 0; i--) {
        const j = pick(i + 1);
        [colours[i], colours[j]] = [colours[j], colours[i]];
      }
      const beacons = [];
      let guard = 0;
      while (beacons.length < beaconTotal && guard++ < 200) {
        const bx = pick(cols);
        const by = pick(rows);
        if (taken.has(cellKey(bx, by))) continue;
        if (Math.abs(bx - start.x) + Math.abs(by - start.y) < 2) continue;
        if (Math.abs(bx - exit.x) + Math.abs(by - exit.y) < 2) continue;
        taken.add(cellKey(bx, by));
        beacons.push({ x: bx, y: by, colour: colours[beacons.length] });
      }
      if (beacons.length < beaconTotal) continue;
      let wallsPlaced = 0;
      guard = 0;
      while (wallsPlaced < wallTotal && guard++ < 200) {
        const wx = pick(cols);
        const wy = pick(rows);
        if (taken.has(cellKey(wx, wy))) continue;
        taken.add(cellKey(wx, wy));
        grid[wy][wx] = '#';
        wallsPlaced++;
      }
      grid[start.y][start.x] = 'S';
      grid[exit.y][exit.x] = 'X';
      for (const b of beacons) grid[b.y][b.x] = String(b.colour);
      const level = parseLevel({
        id: 'E' + depth,
        name: 'Depth ' + depth,
        hint: `Endless depth ${depth} — light every beacon, then the exit. The deeper you go, the less slack you get.`,
        accent: COLOURS[(depth - 1) % 6].hex,
        grid: grid.map((r) => r.join('')),
        budget: 0, parMoves: 0, parTime: 0,
      });
      const sol = solve(level);
      if (!sol) continue;
      if (phase === 0 && (sol.moves < minPar || sol.moves > maxPar)) continue;
      level.parMoves = sol.moves;
      level.budget = sol.moves + Math.max(2, Math.round(sol.moves * endlessSlackFrac(depth)));
      level.parTime = sol.moves * 5;
      level.seed = seed;
      level.depth = depth;
      level.endless = true;
      return level;
    }
  }
  return null;
}

// ---------------------------------------------------------------- run
export function createRun(level) {
  return {
    level,
    x: level.start.x,
    y: level.start.y,
    orient: { ...START_ORIENT },
    lit: level.beacons.map(() => false),
    moves: 0,
    time: 0,
    phase: 'playing', // 'playing' | 'won' | 'lost'
    loseReason: null, // 'fell' | 'budget'
    score: 0,
    scoreParts: null,
    lastEvent: null, // { type, ... } for the game layer's feedback
    lastRoll: null, // { dir, fromX, fromY, toX, toY } for animation
  };
}

export function startRun(levelId) {
  const level = levelById(levelId);
  return level ? createRun(level) : null;
}

export function litCount(run) {
  return run.lit.filter(Boolean).length;
}

export function allLit(run) {
  return run.lit.every(Boolean);
}

export function movesLeft(run) {
  return run.level.budget - run.moves;
}

// Score: clear 1000 + efficiency (unused moves) + time bonus.
export function computeScore(run) {
  const clear = 1000;
  const efficiency = Math.max(0, run.level.budget - run.moves) * 150;
  const time = Math.max(0, Math.round((run.level.parTime - run.time) * 10));
  return { clear, efficiency, time, total: clear + efficiency + time };
}

// Roll the cube one cell. Returns an outcome string:
//   'moved' | 'won' | 'fell' | 'budget' | 'wall' | 'nomoves' | 'over'
// Wall rolls are denied (no move spent, cube stays) and named via
// run.lastEvent so the game layer can fire the denied cue — never
// silence (Tide lesson).
export function rollCube(run, dir) {
  if (run.phase !== 'playing') return 'over';
  if (movesLeft(run) <= 0) {
    run.lastEvent = { type: 'nomoves' };
    return 'nomoves';
  }
  const d = DIRS[dir];
  if (!d) return 'over';
  const nx = run.x + d.x;
  const ny = run.y + d.y;
  const level = run.level;
  if (isWall(level, nx, ny)) {
    run.lastEvent = { type: 'wall', dir };
    return 'wall';
  }
  const fromX = run.x;
  const fromY = run.y;
  run.moves += 1;
  run.orient = rollOrientation(run.orient, dir);
  run.x = nx;
  run.y = ny;
  run.lastRoll = { dir, fromX, fromY, toX: nx, toY: ny };
  if (!isFloor(level, nx, ny)) {
    run.phase = 'lost';
    run.loseReason = 'fell';
    run.lastEvent = { type: 'fell', dir };
    return 'fell';
  }
  const b = beaconAt(level, nx, ny);
  if (b) {
    if (run.orient.bottom === b.colour && !run.lit[b.index]) {
      run.lit[b.index] = true;
      run.lastEvent = { type: 'beacon', index: b.index, colour: b.colour, lit: litCount(run), total: level.beacons.length };
    } else if (run.orient.bottom !== b.colour && !run.lit[b.index]) {
      run.lastEvent = { type: 'wrongface', index: b.index, colour: b.colour, faceDown: run.orient.bottom };
    } else {
      run.lastEvent = { type: 'moved', dir };
    }
  } else if (nx === level.exit.x && ny === level.exit.y && !allLit(run)) {
    run.lastEvent = { type: 'exitlocked', lit: litCount(run), total: level.beacons.length };
  } else {
    run.lastEvent = { type: 'moved', dir };
  }
  if (nx === level.exit.x && ny === level.exit.y && allLit(run)) {
    run.phase = 'won';
    run.scoreParts = computeScore(run);
    run.score = run.scoreParts.total;
    run.lastEvent = { type: 'won' };
    return 'won';
  }
  if (run.moves >= level.budget) {
    run.phase = 'lost';
    run.loseReason = 'budget';
    run.lastEvent = { type: 'budget' };
    return 'budget';
  }
  return 'moved';
}

export function rankFor(result) {
  // S: cleared in par moves. A: within par + 2. B: cleared.
  if (!result || !result.won) return null;
  const par = result.parMoves !== undefined ? result.parMoves : (result.level ? result.level.parMoves : result.par);
  if (typeof par !== 'number') return 'B';
  if (result.moves <= par) return 'S';
  if (result.moves <= par + 2) return 'A';
  return 'B';
}

// ---------------------------------------------------------------- save
export const RANK_ORDER = { B: 1, A: 2, S: 3 };
export function defaultSave() {
  return {
    version: 1,
    best: {}, // levelId -> { score, moves, time, won, rank? }
    unlocked: 1, // highest level id unlocked
    endless: { bestStreak: 0, bestScore: 0 }, // M4: Endless Tumble bests
    settings: {
      muted: false, volume: 60, shake: 100, music: true, sfx: true,
      flash: true, textSize: 'normal', contrast: false,
    },
  };
}
export function serializeSave(save) { return JSON.stringify(save); }
export function parseSave(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return defaultSave();
    const d = defaultSave();
    const best = {};
    for (const [id, entry] of Object.entries(s.best || {})) {
      if (!entry || typeof entry !== 'object') continue;
      const kept = { ...entry };
      if (kept.rank !== undefined && !['S', 'A', 'B'].includes(kept.rank)) delete kept.rank;
      best[id] = kept;
    }
    const endlessRaw = (s.endless && typeof s.endless === 'object') ? s.endless : {};
    return {
      version: 1,
      best,
      unlocked: Number.isInteger(s.unlocked) ? clamp(s.unlocked, 1, LEVELS.length) : 1,
      endless: {
        bestStreak: Number.isInteger(endlessRaw.bestStreak) && endlessRaw.bestStreak > 0 ? endlessRaw.bestStreak : 0,
        bestScore: Number.isInteger(endlessRaw.bestScore) && endlessRaw.bestScore > 0 ? endlessRaw.bestScore : 0,
      },
      settings: { ...d.settings, ...(s.settings || {}) },
    };
  } catch {
    return defaultSave();
  }
}
export function recordBest(save, levelId, result) {
  if (!result.won) return save;
  const prev = save.best[levelId];
  const better = !prev || result.score > prev.score;
  let rank = prev ? prev.rank : undefined;
  const r = rankFor(result);
  if (r && (!rank || RANK_ORDER[r] > RANK_ORDER[rank])) rank = r;
  if (better) {
    save.best[levelId] = { score: result.score, moves: result.moves, time: result.time, won: true };
  }
  if (rank && save.best[levelId]) save.best[levelId].rank = rank;
  if (levelId < LEVELS.length && save.unlocked < levelId + 1) save.unlocked = levelId + 1;
  return save;
}
export function isLevelUnlocked(save, levelId) {
  return levelId <= save.unlocked;
}
// M4: bank an Endless Tumble run's streak + score (max-only, so a
// worse run never overwrites a better one; safe to call on quit).
export function recordEndlessBest(save, streak, score) {
  if (!save.endless) save.endless = { bestStreak: 0, bestScore: 0 };
  if (streak > save.endless.bestStreak) save.endless.bestStreak = streak;
  if (score > save.endless.bestScore) save.endless.bestScore = score;
  return save;
}

// ---------------------------------------------------------------- feedback
// Game-feel tiers (same shape as the other games): every event fires a
// bundle of layered responses within ~100ms.
export const FEEDBACK = {
  roll: { trauma: 0.1, hitStop: 0, sfx: 'roll', flash: 0, particles: 6 },
  beacon: { trauma: 0.4, hitStop: 0.05, sfx: 'beacon', flash: 0.08, particles: 26 },
  // M3: denied events each get their own voice + a few sparks so the
  // player can tell a wrong face from a wall from a locked exit by
  // ear and eye, not only by toast (Tide lesson: never silence, and
  // never the same buzz for three different mistakes).
  wrongface: { trauma: 0.12, hitStop: 0, sfx: 'wrongface', flash: 0, particles: 12 },
  wall: { trauma: 0.18, hitStop: 0, sfx: 'wall', flash: 0, particles: 6 },
  exitlocked: { trauma: 0.12, hitStop: 0, sfx: 'exitlocked', flash: 0, particles: 8 },
  fell: { trauma: 0.8, hitStop: 0.12, sfx: 'fall', flash: 0.18, particles: 30 },
  budget: { trauma: 0.6, hitStop: 0.1, sfx: 'fail', flash: 0.12, particles: 16 },
  won: { trauma: 0.85, hitStop: 0.13, sfx: 'solve', flash: 0.2, particles: 60 },
  denied: { trauma: 0.08, hitStop: 0, sfx: 'denied', flash: 0, particles: 0 },
  queuefull: { trauma: 0.08, hitStop: 0, sfx: 'denied', flash: 0, particles: 0 },
};
export const FEEDBACK_TIERS = {
  small: { trauma: [0.1, 0.2], hitStop: 0 },
  medium: { trauma: [0.3, 0.5], hitStop: [0.04, 0.06] },
  large: { trauma: [0.7, 1.0], hitStop: [0.1, 0.15] },
};
export const FEEDBACK_LAYERS = ['sound', 'particles', 'shake', 'flash', 'number-pop'];
