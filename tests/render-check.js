// Neon Tumble v0.3.0 — headless browser render check.
// Serves the game dir over local HTTP, loads it in a headless browser,
// and asserts the M1 core, by hook and by eye:
//   - the menu renders over a LIVE 3D demo (the solver rolls the cube
//     on level 1 behind the menu), with no version/engine text
//     anywhere the player can see, one clear primary Play action,
//     and 12 level cards
//   - Play starts level 1 with the HUD; rolling tumbles the cube ON
//     SCREEN and changes the down face (screen-space asserted — the
//     Drift M2 lesson); the HUD moves counter follows
//   - named denied cues: wrong-face landing and wall roll name the
//     reason (Tide lesson), never silence
//   - the autopilot (solver bot) clears level 1 and level 3 in the
//     real browser, the complete screen shows score + parts + rank,
//     the best score is saved, level 2 unlocks
//   - pause focuses Resume; Enter resumes
//   - ?level=3 jumps straight into level 3 (the playtest path)
//   - feel state returns to rest; shake/flash/music toggles work; the
//     FPS guard steps the DPR cap down on a 2x-DPI page
//   - portrait layout fits with the HUD visible
//   - zero console errors and zero page errors
//
// Run: node tests/render-check.js (chromium headless shell; Three.js is
// fulfilled from a local curl cache via page.route so the check does
// not depend on CDN reachability from the browser — the shipped game
// still loads Three.js from the CDN, same setup as neon-cycle).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-tumble-render-check');
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const THREE_CACHE = path.join(os.tmpdir(), 'neon-tumble-three-0.160.0.module.js');

async function fetchThreeModule() {
  try {
    const st = fs.statSync(THREE_CACHE);
    if (st.size > 100000) return THREE_CACHE;
  } catch { /* not cached yet */ }
  await new Promise((resolve, reject) => {
    execFile('curl', ['-s', '-o', THREE_CACHE, THREE_URL], (err) => (err ? reject(err) : resolve()));
  });
  const st = fs.statSync(THREE_CACHE);
  if (st.size < 100000) throw new Error('downloaded Three.js module is unexpectedly small');
  return THREE_CACHE;
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
function findHeadlessShell() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const entry of fs.readdirSync(base)) {
      const candidate = path.join(base, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* cache dir missing */ }
  return null;
}
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    '../node_modules/playwright-core',
    '../../neon-surge/node_modules/playwright-core',
    '../../neon-hexfall/node_modules/playwright-core',
  ];
  for (const c of candidates) {
    try { return require(fileURLToPath(new URL(c, import.meta.url))); } catch { /* try next */ }
  }
  throw new Error('playwright-core not found (looked in neon-tumble, neon-surge and neon-hexfall node_modules)');
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(GAME_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const { chromium } = loadPlaywright();
const errors = [];
const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('  PASS ' + name);
  else { failures.push(name); console.error('  FAIL ' + name + (extra !== undefined ? ' — ' + extra : '')); }
}

let browser;
try {
  const cached = await fetchThreeModule();
  const executablePath = findHeadlessShell();
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });

  async function newPage(context, tag) {
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`${tag} console: ${msg.text()}`); });
    page.on('pageerror', (err) => errors.push(`${tag} pageerror: ${String(err)}`));
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
    return page;
  }

  // --- menu ---------------------------------------------------------------
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const page = await newPage(context, 'menu');
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__tumble, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const menuText = await page.evaluate(() => document.body.innerText);
  check('menu shows the game title', /NEON\s*TUMBLE/i.test(menuText));
  check('menu has one clear primary Play action', await page.evaluate(() => {
    const b = document.getElementById('btn-play');
    return b && !b.classList.contains('hidden') && b.textContent.includes('Play');
  }));
  check('no version text on the player-facing menu', !/v0\.2\.1|0\.2\.1/.test(menuText), menuText.slice(0, 200));
  check('no engine text on the player-facing menu', !/three\.js|canvas 2d|webgl/i.test(menuText));
  check('menu lists 12 levels', await page.evaluate(() => window.__tumble.levels.length === 12));
  const demo1 = await page.evaluate(() => window.__tumble.info());
  check('live demo cube exists behind the menu', demo1.phase === 'menu' && demo1.x !== null, JSON.stringify(demo1));
  await page.waitForTimeout(4000);
  const demo2 = await page.evaluate(() => window.__tumble.info());
  check('live demo rolls behind the menu (cube moves / demo steps)',
    demo1.x !== demo2.x || demo1.y !== demo2.y || demo1.demoStep !== demo2.demoStep || demo1.downFace !== demo2.downFace,
    `(${demo1.x},${demo1.y},step ${demo1.demoStep}) -> (${demo2.x},${demo2.y},step ${demo2.demoStep})`);
  await page.screenshot({ timeout: 120000, path: path.join(SHOTS_DIR, 'menu-1280x720.png') });
  console.log('render-check: menu shot captured');

  // --- level select ---------------------------------------------------------
  await page.click('#btn-levels');
  await page.waitForFunction(() => !document.getElementById('levels').classList.contains('hidden'), null, { timeout: 5000 });
  check('level select shows 12 level cards', await page.evaluate(() => document.querySelectorAll('#level-grid .track-card').length === 12));
  check('level 1 unlocked, levels 2-12 locked on a fresh save', await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#level-grid .track-card')];
    return !cards[0].disabled && cards.slice(1).every((c) => c.disabled);
  }));
  await page.screenshot({ timeout: 120000, path: path.join(SHOTS_DIR, 'levels-1280x720.png') });
  await page.click('#btn-levels-back');
  await page.waitForFunction(() => window.__tumble.state.phase === 'menu', null, { timeout: 5000 });

  // --- play: screen-space roll + wrong-face denied + autopilot clear --------
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__tumble.state.phase === 'playing', null, { timeout: 5000 });
  check('Play starts level 1', await page.evaluate(() => window.__tumble.state.levelId === 1));
  check('HUD is visible while playing', await page.evaluate(() => !document.getElementById('hud').classList.contains('hidden')));
  const audio = await page.evaluate(() => window.__tumble.audio());
  check('music loop runs after Play (audio live, scheduler on)', audio.hasAudio && audio.musicOn && audio.musicPlaying, JSON.stringify(audio));
  await page.waitForTimeout(700); // ready beat
  const before = await page.evaluate(() => window.__tumble.info());
  await page.evaluate(() => window.__tumble.roll('E'));
  await page.waitForFunction(() => window.__tumble.info().moves === 1, null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => window.__tumble.info());
  check('screen space: rolling tumbles the cube ON SCREEN',
    Math.hypot(after.cubeScreen.x - before.cubeScreen.x, after.cubeScreen.y - before.cubeScreen.y) > 20,
    `(${before.cubeScreen.x.toFixed(0)},${before.cubeScreen.y.toFixed(0)}) -> (${after.cubeScreen.x.toFixed(0)},${after.cubeScreen.y.toFixed(0)})`);
  check('screen space: the down face changes after a roll', before.downFace === 1 && after.downFace === 4,
    `down ${before.downFace} -> ${after.downFace}`);
  check('HUD moves counter follows the roll', await page.evaluate(() =>
    document.getElementById('hud-moves-left').textContent.includes('10 left')));
  check('HUD names the face down', await page.evaluate(() =>
    document.getElementById('hud-face-name').textContent === 'Lime'));
  // M3: the roll fires its full bundle (tier counter), and the MOVES
  // meter drains with the budget (10/11 after one roll).
  check('roll bundle fired (roll counter)', await page.evaluate(() => window.__tumble.feel().fxCounts.roll >= 1));
  check('MOVES meter tracks the budget (fill ~91% after 1 of 11 spent)', await page.evaluate(() => {
    const w = parseFloat(document.getElementById('hud-moves-fill').style.width);
    return w > 88 && w < 94;
  }), await page.evaluate(() => document.getElementById('hud-moves-fill').style.width));
  // Wrong-face denied cue: E,E,N,E,S lands on the magenta beacon with
  // the wrong face down (probe path verified in tests/smoke.js).
  await page.evaluate(() => { const T = window.__tumble; T.roll('E'); T.roll('E'); T.roll('N'); });
  await page.waitForFunction(() => window.__tumble.info().moves === 4, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const T = window.__tumble; T.roll('E'); T.roll('S'); });
  await page.waitForFunction(() => window.__tumble.info().lastDenied === 'wrongface', null, { timeout: 10000 });
  check('wrong-face landing names the reason (denied cue, never silence)', await page.evaluate(() =>
    document.getElementById('hud-toast').textContent.includes('Wrong face')));
  check('wrong-face landing leaves the beacon dark', await page.evaluate(() => window.__tumble.info().lit === 0));
  check('wrong-face bundle fired (wrongface counter)', await page.evaluate(() => window.__tumble.feel().fxCounts.wrongface >= 1));
  // Restart fresh for the autopilot clear.
  await page.evaluate(() => window.__tumble.startLevel(1));
  await page.evaluate(() => window.__tumble.autopilot(true));
  await page.screenshot({ timeout: 120000, path: path.join(SHOTS_DIR, 'gameplay-1280x720.png') });
  console.log('render-check: gameplay shot captured');
  await page.waitForFunction(() => window.__tumble.feel().fxCounts.beacon >= 1, null, { timeout: 30000 });
  const fxBeacon = await page.evaluate(() => window.__tumble.feel());
  check('beacon bundle fired (beacon counter, sparks alive)', fxBeacon.fxCounts.beacon >= 1 && fxBeacon.particlesAlive > 0, JSON.stringify(fxBeacon.fxCounts));
  check('music lift rises with beacons lit', await page.evaluate(() => window.__tumble.audio().lift >= 2));
  await page.waitForFunction(() => window.__tumble.state.phase === 'complete', null, { timeout: 60000 });
  const final = await page.evaluate(() => window.__tumble.state.run);
  check('autopilot (solver bot) clears level 1 in the real browser', final.phase === 'won' && final.level.id === 1, JSON.stringify({ phase: final.phase, moves: final.moves }));
  check('complete screen shows the score', await page.evaluate(() => /Score \d/.test(document.getElementById('complete-score').textContent)));
  check('complete screen names the score parts', await page.evaluate(() =>
    /Clear 1000 \+ Efficiency \d+ \+ Time \d+ = \d+/.test(document.getElementById('complete-parts').textContent)),
    await page.evaluate(() => document.getElementById('complete-parts').textContent));
  check('complete screen shows the clear rank badge', await page.evaluate(() =>
    /^RANK [SAB]$/.test(document.getElementById('complete-rank').textContent.trim())));
  check('rank badge carries its tier color class', await page.evaluate(() =>
    /rank-[SAB]/.test(document.getElementById('complete-rank').className)));
  check('solve bundle fired (won counter)', await page.evaluate(() => window.__tumble.feel().fxCounts.won >= 1));
  check('best score is saved after the clear', await page.evaluate(() => {
    const s = window.__tumble.save;
    return s.best && s.best[1] && s.best[1].score > 0;
  }));
  check('clearing level 1 unlocks level 2', await page.evaluate(() => window.__tumble.save.unlocked >= 2));
  await page.click('#btn-menu-complete');
  await page.waitForFunction(() => window.__tumble.state.phase === 'menu', null, { timeout: 5000 });
  await page.waitForTimeout(2500);
  const feelRest = await page.evaluate(() => window.__tumble.feel());
  check('feel state returns to rest (trauma 0, timeScale 1, flash 0)',
    feelRest.trauma === 0 && feelRest.timeScale === 1 && feelRest.flashT === 0,
    JSON.stringify(feelRest));
  await context.close();

  // --- pause + wall denied cue ------------------------------------------------
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const page2 = await newPage(context2, 'pause');
  await page2.goto(`http://127.0.0.1:${port}/?level=2`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.waitForFunction(() => window.__tumble, null, { timeout: 30000 });
  await page2.waitForFunction(() => window.__tumble.state.phase === 'playing', null, { timeout: 5000 });
  check('?level=2 jumps straight into level 2', await page2.evaluate(() => window.__tumble.state.levelId === 2));
  await page2.evaluate(() => window.__tumble.pause());
  await page2.waitForFunction(() => window.__tumble.state.phase === 'paused', null, { timeout: 5000 });
  check('pause shows the pause screen with Resume focused', await page2.evaluate(() => document.activeElement && document.activeElement.id === 'btn-resume'));
  await page2.keyboard.press('Enter');
  await page2.waitForFunction(() => window.__tumble.state.phase === 'playing', null, { timeout: 5000 });
  check('Enter resumes the run', true);
  // Wall denied cue: E,E,S reaches the lime beacon cell (3,2); E is a wall.
  await page2.waitForTimeout(700);
  await page2.evaluate(() => { const T = window.__tumble; T.roll('E'); T.roll('E'); T.roll('S'); });
  await page2.waitForFunction(() => window.__tumble.info().moves === 3, null, { timeout: 10000 });
  await page2.waitForTimeout(500);
  await page2.evaluate(() => window.__tumble.roll('E'));
  await page2.waitForFunction(() => window.__tumble.info().lastDenied === 'wall', null, { timeout: 10000 });
  check('wall roll is denied by name and spends no move', await page2.evaluate(() =>
    window.__tumble.info().moves === 3 && document.getElementById('hud-toast').textContent.includes('Wall')));
  check('wall bundle fired (wall counter, not generic denied)', await page2.evaluate(() => window.__tumble.feel().fxCounts.wall >= 1));
  // Rapid-input regression (M2 playtest): six rolls fired in one batch
  // must ALL execute — position, orientation and move count stay in
  // lockstep (the sim rolls atomically; a silently dropped input is
  // what desynced the playtester). E,E,S,S,W,W from (1,1) ends (1,3).
  await page2.evaluate(() => window.__tumble.startLevel(2));
  await page2.waitForTimeout(700); // ready beat
  await page2.evaluate(() => { const T = window.__tumble; for (const d of ['E', 'E', 'S', 'S', 'W', 'W']) T.roll(d); });
  await page2.waitForFunction(() => window.__tumble.info().moves === 6, null, { timeout: 15000 });
  const rapid = await page2.evaluate(() => window.__tumble.info());
  check('rapid batched input: all 6 rolls execute, cube ends at (1,3)',
    rapid.moves === 6 && rapid.x === 1 && rapid.y === 3, JSON.stringify(rapid));
  // M3: a 7th/8th roll fired in the same batch overflows the queue —
  // the drop must be NAMED (toast), never a silent buzz.
  await page2.evaluate(() => window.__tumble.startLevel(2));
  await page2.waitForTimeout(700);
  await page2.evaluate(() => { const T = window.__tumble; for (let i = 0; i < 8; i++) T.roll('E'); });
  check('queue-full drop names the reason (toast, never silence)', await page2.evaluate(() =>
    window.__tumble.info().lastDenied === 'queuefull' &&
    document.getElementById('hud-toast').textContent.includes('Too fast')));
  check('queue-full bundle fired (queuefull counter)', await page2.evaluate(() => window.__tumble.feel().fxCounts.queuefull >= 1));
  // M3: MOVES meter enters its pulsing low state at 2 moves left.
  // Level 1 (budget 11): oscillate E/W nine times -> 2 left.
  await page2.evaluate(() => window.__tumble.startLevel(1));
  await page2.waitForTimeout(700);
  await page2.evaluate(() => { const T = window.__tumble; for (const d of ['E', 'W', 'E', 'W', 'E']) T.roll(d); });
  await page2.waitForFunction(() => window.__tumble.info().moves === 5, null, { timeout: 15000 });
  await page2.evaluate(() => { const T = window.__tumble; for (const d of ['W', 'E', 'W', 'E']) T.roll(d); });
  await page2.waitForFunction(() => window.__tumble.info().movesLeft === 2, null, { timeout: 15000 });
  check('MOVES meter pulses low at 2 moves left', await page2.evaluate(() =>
    document.getElementById('hud-moves-fill').classList.contains('low') &&
    document.getElementById('hud-moves-left').textContent.includes('2 left')));
  await context2.close();

  // --- ?level=3 playtest path --------------------------------------------------
  const context3 = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const page3 = await newPage(context3, 'level3');
  await page3.goto(`http://127.0.0.1:${port}/?level=3`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page3.waitForFunction(() => window.__tumble, null, { timeout: 30000 });
  await page3.waitForFunction(() => window.__tumble.state.phase === 'playing', null, { timeout: 5000 });
  check('?level=3 jumps straight into level 3', await page3.evaluate(() => window.__tumble.state.levelId === 3));
  const c3 = await page3.evaluate(() => window.__tumble.info());
  check('level 3 has 3 beacons', c3.total === 3, JSON.stringify(c3));
  await page3.evaluate(() => window.__tumble.autopilot(true));
  await page3.waitForFunction(() => window.__tumble.state.phase === 'complete', null, { timeout: 120000 });
  check('autopilot clears level 3 (all three beacons lit)', await page3.evaluate(() => window.__tumble.state.run.phase === 'won'));
  check('mid-game complete screen shows Next, titles Level Cleared', await page3.evaluate(() =>
    !document.getElementById('btn-next').classList.contains('hidden') &&
    document.getElementById('complete-title').textContent === 'Level Cleared'));
  await page3.screenshot({ timeout: 120000, path: path.join(SHOTS_DIR, 'level3-1280x720.png') });
  console.log('render-check: level 3 shot captured');
  await context3.close();

  // --- ?level=12 finale path (M2: largest platform, six beacons) -------------
  const context12 = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const page12 = await newPage(context12, 'level12');
  await page12.goto(`http://127.0.0.1:${port}/?level=12`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page12.waitForFunction(() => window.__tumble, null, { timeout: 30000 });
  await page12.waitForFunction(() => window.__tumble.state.phase === 'playing', null, { timeout: 5000 });
  check('?level=12 jumps straight into level 12', await page12.evaluate(() => window.__tumble.state.levelId === 12));
  const c12 = await page12.evaluate(() => window.__tumble.info());
  check('level 12 has 6 beacons', c12.total === 6, JSON.stringify(c12));
  await page12.evaluate(() => window.__tumble.autopilot(true));
  await page12.waitForFunction(() => window.__tumble.state.phase === 'complete', null, { timeout: 180000 });
  check('autopilot clears level 12 (all six beacons lit)', await page12.evaluate(() => window.__tumble.state.run.phase === 'won'));
  check('last-level complete screen hides Next, titles All Levels Clear', await page12.evaluate(() =>
    document.getElementById('btn-next').classList.contains('hidden') &&
    document.getElementById('complete-title').textContent === 'All Levels Clear'));
  await page12.screenshot({ timeout: 120000, path: path.join(SHOTS_DIR, 'level12-1280x720.png') });
  console.log('render-check: level 12 shot captured');
  await context12.close();

  // --- toggles + FPS guard -------------------------------------------------------
  const contextG = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok' });
  const pageG = await newPage(contextG, 'fps-guard');
  await pageG.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageG.waitForFunction(() => window.__tumble, null, { timeout: 30000 });
  await pageG.evaluate(() => window.__tumble.setFlash(false));
  check('flash toggle turns flashing off (persisted)', await pageG.evaluate(() => window.__tumble.feel().flashEnabled === false && window.__tumble.save.settings.flash === false));
  await pageG.evaluate(() => window.__tumble.setFlash(true));
  await pageG.evaluate(() => window.__tumble.setMusic(false));
  check('music toggle stops the loop', await pageG.evaluate(() => window.__tumble.audio().musicPlaying === false));
  await pageG.evaluate(() => window.__tumble.setMusic(true));
  await pageG.evaluate(() => window.__tumble.setShake(0));
  check('shake slider at 0 gates the shake (amplitude 0)', await pageG.evaluate(() => {
    const f = window.__tumble.feel();
    return f.shakeSetting === 0 && f.shakeAmp === 0;
  }));
  await pageG.evaluate(() => window.__tumble.setShake(1));
  check('shake slider restores to 100%', await pageG.evaluate(() => window.__tumble.feel().shakeSetting === 1));
  await pageG.evaluate(() => window.__tumble.setTextSize('large'));
  check('large text applies the text-large body class and persists',
    await pageG.evaluate(() => document.body.classList.contains('text-large') && window.__tumble.save.settings.textSize === 'large'));
  await pageG.evaluate(() => window.__tumble.setContrast(true));
  check('high contrast applies the high-contrast body class and persists',
    await pageG.evaluate(() => document.body.classList.contains('high-contrast') && window.__tumble.save.settings.contrast === true));
  await pageG.evaluate(() => { window.__tumble.setTextSize('normal'); window.__tumble.setContrast(false); });
  check('accessibility toggles switch back off',
    await pageG.evaluate(() => !document.body.classList.contains('text-large') && !document.body.classList.contains('high-contrast')));
  // HUD shows current state only: after a restart the moves counter is
  // back to the full budget, never a stale value from the last run.
  await pageG.evaluate(() => window.__tumble.startLevel(1));
  check('HUD resets to full moves on restart (no stale max)',
    await pageG.evaluate(() => document.getElementById('hud-moves-left').textContent.includes('11 left') &&
      document.getElementById('hud-beacons').textContent.includes('Beacons 0/1')));
  await pageG.waitForTimeout(1200);
  check('perf readout names fps and render scale',
    await pageG.evaluate(() => /\d+ fps · render scale [\d.]+x/.test(document.getElementById('perf-line').textContent)),
    await pageG.evaluate(() => document.getElementById('perf-line').textContent));
  check('fps hook reports the guard state',
    await pageG.evaluate(() => { const f = window.__tumble.fps(); return typeof f.fps === 'number' && f.dprCap === 2 && f.guardActive === false; }));
  const backingBefore = await pageG.evaluate(() => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    window.dispatchEvent(new Event('resize'));
    return document.querySelector('#game-container canvas').width;
  });
  check('high-DPI backing store starts at 2x', backingBefore === 2560, `canvas width=${backingBefore}`);
  await pageG.evaluate(() => { window.__tumble.triggerFpsGuard(); window.__tumble.triggerFpsGuard(); });
  check('FPS guard drops the DPR cap to 1', await pageG.evaluate(() => window.__tumble.dprCap === 1));
  const backingAfter = await pageG.evaluate(() => document.querySelector('#game-container canvas').width);
  check('canvas backing store shrinks to 1x after the guard', backingAfter === 1280, `canvas width=${backingAfter}`);
  check('fps hook names the active FPS guard', await pageG.evaluate(() => window.__tumble.fps().guardActive === true));
  await contextG.close();

  // --- portrait framing ------------------------------------------------------------
  const contextP = await browser.newContext({ viewport: { width: 540, height: 1170 }, timezoneId: 'Asia/Bangkok' });
  const pageP = await newPage(contextP, 'portrait');
  await pageP.goto(`http://127.0.0.1:${port}/?level=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageP.waitForFunction(() => window.__tumble && window.__tumble.state.phase === 'playing', null, { timeout: 30000 });
  check('portrait HUD is visible (no clipped HUD)',
    await pageP.evaluate(() => {
      const hud = document.getElementById('hud');
      const r = hud.getBoundingClientRect();
      return !hud.classList.contains('hidden') && r.width > 0 && r.top >= 0;
    }));
  await pageP.screenshot({ timeout: 120000, path: path.join(SHOTS_DIR, 'portrait-gameplay.png') });
  console.log('render-check: portrait shot captured');
  await contextP.close();

  if (errors.length > 0) {
    console.error('render-check: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    failures.push(`${errors.length} console/page error(s)`);
  }
} catch (err) {
  console.error('render-check: FAIL —', err.message);
  failures.push(err.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}

if (failures.length > 0) { console.error(`render-check: ${failures.length} failure(s)`); process.exit(1); }
console.log(`render-check: PASS — shots in ${SHOTS_DIR} — INSPECT BY EYE (menu, levels, gameplay, level 3, portrait)`);
