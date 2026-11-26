// Neon Tumble v0.2.0 — bot harness (anti-slop gates).
// Run: node tests/bot.js
//
// Gates:
//  - Solver bot (real BFS search over position + orientation + lit
//    mask, replayed through the public rollCube hook) clears every
//    level within budget, in exactly parMoves.
//  - No-input bot loses every level (starting state unsolved).
//  - Spam-one-direction bots (roll the same way every attempt) never
//    win any level — they fall off the edge or burn the budget.
//    (Wall-blocked rolls spend no move, so the spam bot is capped at
//    4x budget attempts; the gate is "never wins", and on these levels
//    every spam direction in fact ends in a fall.)
//  - Random-roll bot (uniform random direction each attempt, 50 seeds
//    per level, attempts capped at 4x budget) wins rarely: <35% on
//    the teaching level 1 and <10% on levels 2+ — tracking the cube's
//    faces is the skill, flailing is not. (Prism lesson: the honest
//    gate is solver 100% vs random far below it, plus the deterministic
//    dumb bots at 0%.)
import { LEVELS, startRun, rollCube, solve, mulberry32, DIR_LIST } from '../physics.js';

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS ' + name);
  else { failed++; console.error('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

for (const level of LEVELS) {
  const sol = solve(level);
  check(`level ${level.id} ${level.name}: solver finds a solution`, sol !== null);
  if (sol) {
    const run = startRun(level.id);
    for (const d of sol.path) rollCube(run, d);
    check(`level ${level.id}: solver bot clears within budget`, run.phase === 'won' && run.moves <= level.budget,
      `phase=${run.phase} moves=${run.moves}/${level.budget}`);
    check(`level ${level.id}: solver moves == parMoves (${level.parMoves})`, sol.moves === level.parMoves,
      `solver=${sol.moves}`);
  }

  const idle = startRun(level.id);
  check(`level ${level.id}: no-input bot loses`, idle.phase !== 'won' && idle.lit.every((v) => !v));

  for (const dir of DIR_LIST) {
    const spam = startRun(level.id);
    let attempts = 0;
    while (spam.phase === 'playing' && attempts < level.budget * 4) {
      rollCube(spam, dir);
      attempts++;
    }
    check(`level ${level.id}: spam-${dir} bot never wins`, spam.phase !== 'won',
      `phase=${spam.phase} reason=${spam.loseReason} attempts=${attempts}`);
  }

  let wins = 0;
  const SEEDS = 50;
  for (let s = 0; s < SEEDS; s++) {
    const rng = mulberry32(1000 + level.id * 101 + s);
    const run = startRun(level.id);
    let attempts = 0;
    while (run.phase === 'playing' && attempts < level.budget * 4) {
      rollCube(run, DIR_LIST[Math.floor(rng() * DIR_LIST.length)]);
      attempts++;
    }
    if (run.phase === 'won') wins++;
  }
  const rate = wins / SEEDS;
  const limit = level.id === 1 ? 0.35 : 0.10;
  check(`level ${level.id}: random-roll bot rarely wins (${wins}/${SEEDS} = ${(rate * 100).toFixed(0)}% < ${(limit * 100).toFixed(0)}%)`,
    rate < limit, `wins=${wins}`);
}

if (failed > 0) { console.error(`bot: ${failed} failure(s)`); process.exit(1); }
console.log('bot: all gates pass');
