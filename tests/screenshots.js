// Neon Tumble v0.3.3 — size sweep screenshots.
// Serves the game dir over local HTTP and captures the menu + gameplay
// at 1280x720, 2560x1080 and 1080x2340 (portrait), plus a level-3
// framing shot. Inspect every shot by eye: no clipped or overlapping
// elements, no cut-off text, HUD fits, cube faces and beacons
// distinguishable. The 1280x720 menu + gameplay shots are also copied
// to docs/screenshots/ for the README.
// Same serving + Three.js-fulfilment setup as tests/render-check.js.
// Run: node tests/screenshots.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-tumble-size-sweep');
const DOCS_DIR = path.join(GAME_DIR, 'docs', 'screenshots');
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
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json',
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

const SIZES = [
  { name: '1280x720', width: 1280, height: 720, deviceScaleFactor: 1 },
  { name: '2560x1080', width: 2560, height: 1080, deviceScaleFactor: 0.5 },
  { name: '1080x2340', width: 1080, height: 2340, deviceScaleFactor: 0.5 },
];

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(GAME_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const { chromium } = loadPlaywright();
const errors = [];
let browser;
try {
  const cached = await fetchThreeModule();
  const executablePath = findHeadlessShell();
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
  });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.deviceScaleFactor, timezoneId: 'Asia/Bangkok', hasTouch: true });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(size.name + ' console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push(size.name + ' pageerror: ' + String(err)));
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__tumble, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS_DIR, `menu-${size.name}.png`), timeout: 120000 });
    console.log(`screenshots: menu-${size.name}.png saved`);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__tumble.state.phase === 'playing', null, { timeout: 5000 });
    await page.evaluate(() => window.__tumble.autopilot(true));
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(SHOTS_DIR, `gameplay-${size.name}.png`), timeout: 120000 });
    console.log(`screenshots: gameplay-${size.name}.png saved`);
    await context.close();
  }
  // Level-3 framing shot (The Vault — 3 beacons, walls, gold accent).
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, timezoneId: 'Asia/Bangkok', hasTouch: true });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('level3 console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push('level3 pageerror: ' + String(err)));
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
    await page.goto(`http://127.0.0.1:${port}/?level=3`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__tumble && window.__tumble.state.phase === 'playing', null, { timeout: 30000 });
    await page.evaluate(() => window.__tumble.autopilot(true));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'level3-1280x720.png'), timeout: 120000 });
    console.log('screenshots: level3-1280x720.png saved');
    await context.close();
  }
  // Level-12 framing shots (Void Crown — the largest platform, 15x9,
  // six beacons): landscape + portrait, the M2 camera-framing check.
  for (const size of [{ name: '1280x720', width: 1280, height: 720 }, { name: '1080x2340', width: 1080, height: 2340 }]) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 0.5, timezoneId: 'Asia/Bangkok', hasTouch: true });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('level12 console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push('level12 pageerror: ' + String(err)));
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
    await page.goto(`http://127.0.0.1:${port}/?level=12`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__tumble && window.__tumble.state.phase === 'playing', null, { timeout: 30000 });
    await page.evaluate(() => window.__tumble.autopilot(true));
    await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(SHOTS_DIR, `level12-${size.name}.png`), timeout: 120000 });
    console.log(`screenshots: level12-${size.name}.png saved`);
    await context.close();
  }
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  for (const [src, dst] of [
    ['menu-1280x720.png', 'menu-1280x720.png'],
    ['gameplay-1280x720.png', 'gameplay-1280x720.png'],
  ]) {
    fs.copyFileSync(path.join(SHOTS_DIR, src), path.join(DOCS_DIR, dst));
    console.log(`screenshots: docs/screenshots/${dst} refreshed`);
  }
  if (errors.length > 0) {
    console.error('screenshots: errors seen:');
    errors.forEach((e) => console.error('  ' + e));
    process.exitCode = 1;
  } else {
    console.log(`screenshots: done — 9 shots in ${SHOTS_DIR} (menu/gameplay copied to docs/screenshots/), zero console/page errors. INSPECT BY EYE.`);
  }
} catch (err) {
  console.error('screenshots: FAIL —', err.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}
