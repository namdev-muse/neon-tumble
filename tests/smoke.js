// Neon Tumble v0.3.1 — smoke tests for the pure sim (physics.js).
// Run: node tests/smoke.js
import {
  VERSION, LEVELS, levelById, START_ORIENT, rollOrientation, orientKey,
  createRun, startRun, rollCube, solve, rankFor, litCount, allLit,
  movesLeft, beaconAt, isFloor, isWall, computeScore,
  defaultSave, serializeSave, parseSave, recordBest, isLevelUnlocked,
  FEEDBACK, FEEDBACK_TIERS, FEEDBACK_LAYERS, COLOURS,
} from '../physics.js';

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.error('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

console.log('smoke: Neon Tumble ' + VERSION);
check('VERSION is 0.3.1', VERSION === '0.3.1');
check('six colours defined', COLOURS.length === 6);

// --- orientation math -------------------------------------------------------
{
  const e = rollOrientation(START_ORIENT, 'E');
  check('roll E puts the east face (lime) down', e.bottom === START_ORIENT.east);
  check('roll E puts the top face on the east side', e.east === START_ORIENT.top);
  check('roll E leaves north/south unchanged', e.north === START_ORIENT.north && e.south === START_ORIENT.south);
  const w = rollOrientation(START_ORIENT, 'W');
  check('roll W puts the west face (orange) down', w.bottom === START_ORIENT.west);
  const n = rollOrientation(START_ORIENT, 'N');
  check('roll N puts the north face (gold) down', n.bottom === START_ORIENT.north);
  const s = rollOrientation(START_ORIENT, 'S');
  check('roll S puts the south face (violet) down', s.bottom === START_ORIENT.south);
  // Four rolls in one direction return to the start orientation.
  let o = { ...START_ORIENT };
  for (let i = 0; i < 4; i++) o = rollOrientation(o, 'E');
  check('four E rolls restore the start orientation', orientKey(o) === orientKey(START_ORIENT));
  // Roll out and back restores orientation.
  const back = rollOrientation(rollOrientation(START_ORIENT, 'N'), 'S');
  check('roll N then S restores the start orientation', orientKey(back) === orientKey(START_ORIENT));
  // Opposite faces stay opposite under any roll sequence.
  let o2 = { ...START_ORIENT };
  for (const d of ['E', 'N', 'E', 'S', 'W', 'N', 'E', 'E']) o2 = rollOrientation(o2, d);
  const opp = (a, b) => Math.abs(a - b) === 1 && Math.min(a, b) % 2 === 0;
  check('opposite pairs stay opposite (top/bottom)', opp(o2.top, o2.bottom), JSON.stringify(o2));
  check('opposite pairs stay opposite (north/south)', opp(o2.north, o2.south));
  check('opposite pairs stay opposite (east/west)', opp(o2.east, o2.west));
  check('all six faces distinct after rolls', new Set(Object.values(o2)).size === 6);
}

// --- level data sanity --------------------------------------------------------
check('12 levels defined', LEVELS.length === 12);
check('solver pars strictly increasing (difficulty curve)',
  LEVELS.every((l, i) => i === 0 || l.parMoves > LEVELS[i - 1].parMoves),
  LEVELS.map((l) => l.parMoves).join(','));
for (const l of LEVELS) {
  check(`level ${l.id} ${l.name}: start and exit on floor`, isFloor(l, l.start.x, l.start.y) && isFloor(l, l.exit.x, l.exit.y));
  check(`level ${l.id}: start is not the exit`, !(l.start.x === l.exit.x && l.start.y === l.exit.y));
  check(`level ${l.id}: budget above par`, l.budget > l.parMoves, `budget=${l.budget} par=${l.parMoves}`);
  const cells = new Set();
  let overlap = false;
  const mark = (x, y) => { const k = x + ',' + y; if (cells.has(k)) overlap = true; cells.add(k); };
  mark(l.start.x, l.start.y);
  mark(l.exit.x, l.exit.y);
  for (const b of l.beacons) {
    mark(b.x, b.y);
    if (!isFloor(l, b.x, b.y) || isWall(l, b.x, b.y)) overlap = true;
    if (b.colour < 0 || b.colour > 5) overlap = true;
  }
  check(`level ${l.id}: no overlapping start/exit/beacon cells`, !overlap);
  const run = createRun(l);
  check(`level ${l.id}: starting state is NOT solved (no-input loses)`, run.phase === 'playing' && !allLit(run) && !(run.x === l.exit.x && run.y === l.exit.y));
  const sol = solve(l);
  check(`level ${l.id}: solver finds a solution`, sol !== null);
  if (sol) {
    check(`level ${l.id}: solver moves match parMoves`, sol.moves === l.parMoves, `solver=${sol.moves} par=${l.parMoves}`);
    check(`level ${l.id}: solver moves within budget`, sol.moves <= l.budget);
  }
}
check('level 1 teaches with one beacon', LEVELS[0].beacons.length === 1);
check('level 2 has two beacons', LEVELS[1].beacons.length === 2);
check('level 3 has three beacons', LEVELS[2].beacons.length === 3);
check('level 12 (Void Crown) uses all six beacon colours',
  new Set(LEVELS[11].beacons.map((b) => b.colour)).size === 6);
check('levelById finds level 2', levelById(2) && levelById(2).id === 2);
check('levelById returns null for a bad id', levelById(99) === null);

// --- run mechanics ------------------------------------------------------------
{
  const run = startRun(1);
  check('startRun(1) creates a playing run', run && run.phase === 'playing' && run.moves === 0);
  check('cube starts with magenta down', run.orient.bottom === 1);
  const out = rollCube(run, 'E');
  check('roll E moves the cube and counts a move', out === 'moved' && run.moves === 1 && run.x === LEVELS[0].start.x + 1);
  check('roll E puts lime down', run.orient.bottom === 4);
  check('movesLeft follows the roll', movesLeft(run) === LEVELS[0].budget - 1);
}
{
  // Beacon face-match: level 1's magenta beacon lights after EEEE.
  const run = startRun(1);
  rollCube(run, 'E'); rollCube(run, 'E'); rollCube(run, 'E');
  check('beacon not lit before landing on it', litCount(run) === 0);
  const out = rollCube(run, 'E');
  check('landing with the matching face down lights the beacon', out === 'moved' && litCount(run) === 1 && run.lastEvent.type === 'beacon');
  check('beacon event names the colour and count', run.lastEvent.colour === 1 && run.lastEvent.lit === 1 && run.lastEvent.total === 1);
}
{
  // Wrong face on a beacon: named denied event, beacon stays dark.
  const run = startRun(1);
  // Reach the beacon cell (4,2) from the north with a wrong face down:
  // E,E,E,N,E,S lands on (4,2) with cyan down (probe path verified
  // against the sim; the direct EEEE approach lights it instead).
  for (const d of ['E', 'E', 'E', 'N', 'E', 'S']) rollCube(run, d);
  check('wrong-face landing does not light the beacon', litCount(run) === 0, `lit=${litCount(run)} bottom=${run.orient.bottom}`);
  check('wrong-face landing names the reason', run.lastEvent && run.lastEvent.type === 'wrongface',
    JSON.stringify(run.lastEvent));
}
{
  // Full solution replay through the public hook.
  const run = startRun(1);
  const sol = solve(run.level);
  for (const d of sol.path) rollCube(run, d);
  check('replaying the solver path wins level 1', run.phase === 'won', `phase=${run.phase}`);
  check('won run has a positive score', run.score > 1000, `score=${run.score}`);
  check('score parts add up', run.scoreParts && run.scoreParts.clear + run.scoreParts.efficiency + run.scoreParts.time === run.score);
  check('optimal play ranks S', rankFor({ won: true, moves: run.moves, parMoves: run.level.parMoves }) === 'S');
  check('computeScore matches the banked score', computeScore(run).total === run.score);
}
{
  // Exit before all beacons lit does not win (named exit-locked event).
  const run = startRun(1);
  // E,E,E,N,E,N reaches the exit (4,0) without ever lighting the beacon.
  for (const d of ['E', 'E', 'E', 'N', 'E', 'N']) rollCube(run, d);
  check('rolling onto the exit with an unlit beacon does not win', run.phase === 'playing' && run.lastEvent.type === 'exitlocked',
    `phase=${run.phase} event=${run.lastEvent && run.lastEvent.type}`);
}
{
  // Edge fall fails the level.
  const run = startRun(1);
  const out = rollCube(run, 'W');
  check('rolling off the edge fails the level', out === 'fell' && run.phase === 'lost' && run.loseReason === 'fell');
}
{
  // Wall blocks: no move spent, named wall event.
  const run = startRun(2);
  for (const d of ['E', 'E', 'S']) rollCube(run, d); // (3,2) beacon cell
  const before = run.moves;
  const out = rollCube(run, 'E'); // (4,2) is a wall
  check('rolling into a wall is denied without spending a move', out === 'wall' && run.moves === before && run.lastEvent.type === 'wall');
}
{
  // Budget exhaustion loses.
  const run = startRun(1);
  let guard = 0;
  while (run.phase === 'playing' && guard++ < 100) rollCube(run, run.moves % 2 === 0 ? 'E' : 'W');
  check('wasting the budget loses the level', run.phase === 'lost' && run.loseReason === 'budget', `phase=${run.phase} reason=${run.loseReason}`);
  check('rolls after the run ends are ignored', rollCube(run, 'E') === 'over');
}
{
  // Ranks.
  check('rank S at par', rankFor({ won: true, moves: 6, parMoves: 6 }) === 'S');
  check('rank A at par+2', rankFor({ won: true, moves: 8, parMoves: 6 }) === 'A');
  check('rank B beyond par+2', rankFor({ won: true, moves: 11, parMoves: 6 }) === 'B');
  check('no rank when not won', rankFor({ won: false, moves: 6, parMoves: 6 }) === null);
}
{
  // Beacon lookup helpers.
  const l1 = LEVELS[0];
  const b = beaconAt(l1, 4, 2);
  check('beaconAt finds the magenta beacon', b && b.colour === 1);
  check('beaconAt returns null on a plain cell', beaconAt(l1, 0, 0) === null);
  check('void cell is not floor', !isFloor(l1, -1, 0) && !isFloor(l1, 99, 99));
}

// --- save ---------------------------------------------------------------------
{
  const save = defaultSave();
  check('default save unlocks level 1 only', save.unlocked === 1 && isLevelUnlocked(save, 1) && !isLevelUnlocked(save, 2));
  recordBest(save, 1, { won: true, score: 2000, moves: 6, time: 12, parMoves: 6 });
  check('recordBest banks the best score', save.best[1] && save.best[1].score === 2000);
  check('recordBest banks the S rank', save.best[1].rank === 'S');
  check('clearing level 1 unlocks level 2', save.unlocked === 2 && isLevelUnlocked(save, 2));
  recordBest(save, 1, { won: true, score: 1500, moves: 11, time: 30, parMoves: 6 });
  check('a worse score does not overwrite the best', save.best[1].score === 2000);
  check('a worse rank does not overwrite the best rank', save.best[1].rank === 'S');
  const round = parseSave(serializeSave(save));
  check('save round-trips through JSON', round.best[1].score === 2000 && round.unlocked === 2);
  check('parseSave survives garbage', parseSave('not json').unlocked === 1);
  check('parseSave clamps unlocked to the level count', parseSave(JSON.stringify({ unlocked: 99 })).unlocked === LEVELS.length);
}

// --- feedback table -------------------------------------------------------------
check('feedback table covers roll/beacon/wrongface/wall/fell/budget/won',
  ['roll', 'beacon', 'wrongface', 'wall', 'fell', 'budget', 'won'].every((k) => FEEDBACK[k]));
check('solve fires a large-tier bundle', FEEDBACK.won.trauma >= FEEDBACK_TIERS.large.trauma[0] && FEEDBACK.won.hitStop >= 0.1);
check('beacon fires a medium-tier bundle', FEEDBACK.beacon.trauma >= FEEDBACK_TIERS.medium.trauma[0] && FEEDBACK.beacon.hitStop >= 0.04);
check('feedback layers named', FEEDBACK_LAYERS.includes('sound') && FEEDBACK_LAYERS.includes('shake'));
// M3: every event fires a bundle with its own voice — the three
// denied events must not share one buzz, and every tier carries
// sound + shake so no event is ever silent or dead.
check('denied events have distinct voices (wrongface/wall/exitlocked)',
  new Set([FEEDBACK.wrongface.sfx, FEEDBACK.wall.sfx, FEEDBACK.exitlocked.sfx]).size === 3 &&
  FEEDBACK.wrongface.sfx !== 'denied' && FEEDBACK.wall.sfx !== 'denied');
check('every feedback tier carries sound + trauma',
  Object.values(FEEDBACK).every((t) => t.sfx && t.trauma > 0));
check('queue-full has its own tier (never a silent drop)', !!FEEDBACK.queuefull && FEEDBACK.queuefull.sfx === 'denied');
check('roll is a small-tier bundle (trauma in small band, no hit-stop)',
  FEEDBACK.roll.trauma >= FEEDBACK_TIERS.small.trauma[0] && FEEDBACK.roll.trauma <= FEEDBACK_TIERS.small.trauma[1] && FEEDBACK.roll.hitStop === 0);
check('fell and budget are large-tier bundles',
  FEEDBACK.fell.trauma >= FEEDBACK_TIERS.large.trauma[0] && FEEDBACK.budget.hitStop >= 0.1);

console.log(`smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('smoke: PASS');
