// Neon Tumble v0.3.2 — Three.js renderer + menus + game feel.
// The simulation lives in physics.js (pure, no DOM); this file owns
// the 3D scene, the screen stack, input, Web Audio SFX/music and the
// feel tiers. Grid (x east, y south) maps to world (x east, z south);
// the camera sits south-above the platform so the cube's top and side
// faces — the whole game — stay readable.
import * as THREE from 'three';
import {
  VERSION, LEVELS, levelById, COLOURS, DIRS, DIR_LIST, START_ORIENT,
  rollOrientation, orientKey, beaconAt, isFloor, isWall,
  createRun, startRun, rollCube, solve, litCount, allLit, movesLeft,
  rankFor, defaultSave, serializeSave, parseSave, recordBest,
  isLevelUnlocked, FEEDBACK,
} from './physics.js';

const SAVE_KEY = 'neon-tumble-save-v1';
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------- save
let save = defaultSave();
try {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) save = parseSave(raw);
} catch { /* storage unavailable — play without saving */ }
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, serializeSave(save)); } catch { /* ignore */ }
}
const params = new URLSearchParams(location.search);
if (params.get('unlock') === '1') {
  save.unlocked = LEVELS.length;
  persistSave();
}
const settings = save.settings;

// ---------------------------------------------------------------- state
const state = {
  phase: 'menu', // 'menu' | 'playing' | 'paused' | 'complete' | 'gameover'
  levelId: 1,
  run: null,
  demoRun: createRun(LEVELS[0]),
  demoPath: solve(LEVELS[0]).path,
  demoStep: 0,
  demoTimer: 0,
  autopilot: false,
  autoTimer: 0,
  trauma: 0,
  hitStopT: 0,
  slowMoT: 0,
  timeScale: 1,
  flashT: 0,
  readyT: 0,
  endTimer: null,
  lastDenied: null,
  lastEvent: null,
  fxCounts: { roll: 0, beacon: 0, wrongface: 0, wall: 0, exitlocked: 0, fell: 0, budget: 0, won: 0, denied: 0, queuefull: 0 },
  muted: !!settings.muted,
};
let rollQueue = [];
let rollAnim = null; // { t, dur, fromPos, toPos, fromQuat, toQuat, outcome, dir }
let fallAnim = null; // { t, dur, dir }
let bumpAnim = null; // M3: wall bump — { t, dur, dir } nudge toward the wall and back
let landSquashT = 0; // M3: landing squash timer (seconds remaining)
let cubeRing = null; // M3: tile highlight ring under the cube
let dprCap = 2;
let particleScale = 1;
let fpsEma = 60;
let fpsLowT = 0;
let perfTimer = 0;
let lastPerfNow = 0;

// ---------------------------------------------------------------- audio
let audioCtx = null;
let masterGain = null;
let musicOn = settings.music !== false;
let sfxOn = settings.sfx !== false;
let musicPlaying = false;
let nextNoteTime = 0;
let musicStep = 0;
function ensureAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {}); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = (settings.volume ?? 60) / 100;
    masterGain.connect(audioCtx.destination);
  } catch { audioCtx = null; }
}
function tone(freq, dur, type = 'sine', gain = 0.2, slideTo = null, delay = 0) {
  if (!audioCtx || !masterGain) return;
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(masterGain);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function playSfx(name) {
  if (!audioCtx || state.muted || !sfxOn) return;
  switch (name) {
    case 'roll': tone(140, 0.09, 'sine', 0.25, 70); tone(320, 0.05, 'triangle', 0.08); break;
    case 'beacon': tone(660, 0.18, 'sine', 0.22); tone(880, 0.22, 'sine', 0.2, null, 0.07); tone(1320, 0.3, 'sine', 0.16, null, 0.14); break;
    // M3: one voice per denied event — a wall thunks low, a wrong
    // face buzzes down, a locked exit clangs. The player learns the
    // mistake by ear before the toast finishes reading.
    case 'wall': tone(90, 0.1, 'sine', 0.3, 55); tone(220, 0.05, 'square', 0.06); break;
    case 'wrongface': tone(300, 0.16, 'sawtooth', 0.1, 180); tone(210, 0.14, 'sawtooth', 0.08, 140, 0.05); break;
    case 'exitlocked': tone(520, 0.12, 'triangle', 0.16, 390); tone(780, 0.1, 'sine', 0.08, null, 0.03); break;
    case 'denied': tone(160, 0.14, 'square', 0.12, 110); break;
    case 'fall': tone(520, 0.55, 'sine', 0.22, 60); break;
    case 'fail': tone(220, 0.3, 'triangle', 0.2, 110); tone(165, 0.4, 'triangle', 0.18, 82, 0.12); break;
    case 'solve': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'sine', 0.2, null, i * 0.09)); break;
    case 'hover': tone(900, 0.04, 'sine', 0.05); break;
    case 'click': tone(600, 0.07, 'triangle', 0.12, 400); break;
    default: break;
  }
}
const SCALE = [0, 3, 5, 7, 10, 12, 15];
function musicLift() {
  const run = state.phase === 'menu' ? state.demoRun : state.run;
  return 1 + (run ? litCount(run) : 0);
}
function scheduleMusic() {
  if (!audioCtx || !musicPlaying || state.muted || !musicOn) return;
  const lift = musicLift();
  while (nextNoteTime < audioCtx.currentTime + 0.25) {
    const beat = 60 / 112;
    const step = musicStep % 16;
    const root = 110; // A2
    if (step % 4 === 0) {
      const t0 = nextNoteTime;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = 'triangle'; osc.frequency.value = root;
      g.gain.setValueAtTime(0.10, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + beat * 1.8);
      osc.connect(g); g.connect(masterGain); osc.start(t0); osc.stop(t0 + beat * 2);
    }
    // M3: a soft pad chord fades in once two beacons burn (lift >= 3
    // means 2+ lit — lift is 1 + lit count), so progress is audible
    // as harmony, not only as a denser arp.
    if (lift >= 3 && step % 8 === 0) {
      for (const semis of [0, 3, 7]) {
        const t0 = nextNoteTime;
        const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = root * 2 * Math.pow(2, semis / 12);
        g.gain.setValueAtTime(0.028, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + beat * 3.6);
        osc.connect(g); g.connect(masterGain); osc.start(t0); osc.stop(t0 + beat * 4);
      }
    }
    // Arp density grows with beacons lit (the lift).
    const density = step % Math.max(1, 5 - lift) === 0;
    if (density) {
      const semis = SCALE[(musicStep * 3 + lift) % SCALE.length] + (lift >= 3 ? 12 : 0);
      const t0 = nextNoteTime;
      const osc = audioCtx.createOscillator(); const g = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = root * 4 * Math.pow(2, semis / 12);
      g.gain.setValueAtTime(0.06, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + beat * 0.9);
      osc.connect(g); g.connect(masterGain); osc.start(t0); osc.stop(t0 + beat);
    }
    nextNoteTime += beat / 2;
    musicStep++;
  }
}
function startMusic() {
  ensureAudio();
  if (!audioCtx) return;
  if (!musicPlaying) { musicPlaying = true; nextNoteTime = audioCtx.currentTime + 0.1; }
}
function stopMusic() { musicPlaying = false; }
function audioInfo() {
  return {
    hasAudio: !!audioCtx,
    musicOn,
    musicPlaying: musicPlaying && musicOn && !state.muted,
    sfxOn,
    muted: state.muted,
    lift: musicLift(),
    step: musicStep,
  };
}

// ---------------------------------------------------------------- three setup
let renderer = null;
let scene = null;
let camera = null;
let webglOK = true;
let levelGroup = null;
let cubeMesh = null;
let cubeLight = null;
let beaconVisuals = [];
let exitVisual = null;
let currentLevel = LEVELS[0];
const cameraTarget = new THREE.Vector3();
const cameraPos = new THREE.Vector3();
let menuOrbitT = 0;

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('game-container').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050514);
  scene.fog = new THREE.Fog(0x050514, 18, 46);
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 120);
  scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x1a1030, 0.55));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
  dirLight.position.set(6, 12, 4);
  scene.add(dirLight);
  const rim = new THREE.PointLight(0x9d4dff, 30, 40);
  rim.position.set(-8, 5, -6);
  scene.add(rim);
  // Starfield
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(400 * 3);
  for (let i = 0; i < 400; i++) {
    const r = 34 + Math.random() * 20;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    starPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    starPos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.7 - 4;
    starPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9db8d6, size: 0.14, sizeAttenuation: true })));
} catch (err) {
  webglOK = false;
}

// ---------------------------------------------------------------- particles (pooled)
const P_MAX = 300;
let pGeo = null; let pPoints = null;
const pPos = new Float32Array(P_MAX * 3);
const pCol = new Float32Array(P_MAX * 3);
const pVel = new Float32Array(P_MAX * 3);
const pLife = new Float32Array(P_MAX);
let pCursor = 0;
if (scene) {
  pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  pPoints = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  pPoints.frustumCulled = false;
  scene.add(pPoints);
}
function spawnParticles(x, y, z, hex, n, spread = 1.6, up = 2.4) {
  if (!pPoints) return;
  const c = new THREE.Color(hex);
  const count = Math.max(1, Math.round(n * particleScale));
  for (let i = 0; i < count; i++) {
    const idx = pCursor; pCursor = (pCursor + 1) % P_MAX;
    pPos[idx * 3] = x; pPos[idx * 3 + 1] = y; pPos[idx * 3 + 2] = z;
    pCol[idx * 3] = c.r; pCol[idx * 3 + 1] = c.g; pCol[idx * 3 + 2] = c.b;
    pVel[idx * 3] = (Math.random() - 0.5) * spread;
    pVel[idx * 3 + 1] = Math.random() * up;
    pVel[idx * 3 + 2] = (Math.random() - 0.5) * spread;
    pLife[idx] = 0.5 + Math.random() * 0.5;
  }
}
function updateParticles(dt) {
  if (!pPoints) return;
  for (let i = 0; i < P_MAX; i++) {
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -50; continue; }
    pLife[i] -= dt;
    pVel[i * 3 + 1] -= 5.5 * dt;
    pPos[i * 3] += pVel[i * 3] * dt;
    pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt;
    pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}
function particlesAlive() {
  let n = 0;
  for (let i = 0; i < P_MAX; i++) if (pLife[i] > 0) n++;
  return n;
}

// ---------------------------------------------------------------- feel
function addTrauma(amount) { state.trauma = clamp(state.trauma + amount, 0, 1); }
function hitStop(dur) {
  if (dur > 0) { state.hitStopT = Math.max(state.hitStopT, dur); state.timeScale = 0; }
}
function flashScreen(strength) {
  if (settings.flash === false) return;
  state.flashT = Math.max(state.flashT, strength);
  $('hit-flash').style.opacity = String(clamp(strength, 0, 1));
}
function scorePop(text, screenX, screenY) {
  const el = document.createElement('div');
  el.className = 'pop';
  el.textContent = text;
  el.style.left = screenX + 'px';
  el.style.top = screenY + 'px';
  $('pops').appendChild(el);
  setTimeout(() => el.remove(), 1250);
}
let toastTimer = null;
function toast(msg, seconds = 2.2) {
  const el = $('hud-toast');
  el.textContent = msg;
  el.classList.add('show');
  $('sr-status').textContent = msg;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, seconds * 1000);
}
function hideToast() {
  $('hud-toast').classList.remove('show');
  $('sr-status').textContent = '';
}
function feedback(event, worldPos = null, popText = null) {
  const tier = FEEDBACK[event] || FEEDBACK.denied;
  state.fxCounts[event] = (state.fxCounts[event] || 0) + 1;
  playSfx(tier.sfx);
  addTrauma(tier.trauma);
  hitStop(tier.hitStop);
  if (tier.flash > 0) flashScreen(tier.flash);
  if (worldPos && tier.particles > 0) {
    spawnParticles(worldPos.x, worldPos.y, worldPos.z, worldPos.hex || '#22e6ff', tier.particles);
  }
  if (popText && worldPos) {
    const s = worldToScreen(worldPos.x, worldPos.y, worldPos.z);
    if (s) scorePop(popText, s.x, s.y);
  }
}

// ---------------------------------------------------------------- level scene
function cellToWorld(level, x, y) {
  return { x: x - (level.cols - 1) / 2, z: y - (level.rows - 1) / 2 };
}
const DIR_VEC = {
  east: new THREE.Vector3(1, 0, 0), west: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, 0), bottom: new THREE.Vector3(0, -1, 0),
  south: new THREE.Vector3(0, 0, 1), north: new THREE.Vector3(0, 0, -1),
};
function quatForOrient(orient) {
  const dirOf = (colour) => {
    for (const k of Object.keys(orient)) if (orient[k] === colour) return DIR_VEC[k];
    return DIR_VEC.top;
  };
  // Local cube axes: +x = START east colour, +y = START top, +z = START south.
  const m = new THREE.Matrix4().makeBasis(dirOf(START_ORIENT.east), dirOf(START_ORIENT.top), dirOf(START_ORIENT.south));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((mt) => mt.dispose());
  });
}
function buildLevelScene(level) {
  currentLevel = level;
  if (!scene) return;
  if (levelGroup) { scene.remove(levelGroup); disposeGroup(levelGroup); }
  levelGroup = new THREE.Group();
  beaconVisuals = [];
  exitVisual = null;
  const tileGeo = new THREE.BoxGeometry(0.94, 0.16, 0.94);
  const tileMat = new THREE.MeshStandardMaterial({ color: 0x181840, emissive: 0x0a0a2e, roughness: 0.6, metalness: 0.2 });
  const tileEdgeMat = new THREE.LineBasicMaterial({ color: 0x2a4a8f, transparent: true, opacity: 0.8 });
  const wallGeo = new THREE.BoxGeometry(0.94, 0.85, 0.94);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a1450, emissive: 0x3d1a78, emissiveIntensity: 0.55, roughness: 0.5 });
  const accent = new THREE.Color(level.accent);
  for (let y = 0; y < level.rows; y++) {
    for (let x = 0; x < level.cols; x++) {
      if (!isFloor(level, x, y)) continue;
      const w = cellToWorld(level, x, y);
      const tile = new THREE.Mesh(tileGeo, tileMat);
      tile.position.set(w.x, -0.08, w.z);
      levelGroup.add(tile);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(tileGeo), tileEdgeMat);
      edges.position.copy(tile.position);
      levelGroup.add(edges);
      if (isWall(level, x, y)) {
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(w.x, 0.42, w.z);
        levelGroup.add(wall);
        const we = new THREE.LineSegments(new THREE.EdgesGeometry(wallGeo), new THREE.LineBasicMaterial({ color: 0x9d4dff }));
        we.position.copy(wall.position);
        levelGroup.add(we);
      }
    }
  }
  // Start ring
  {
    const w = cellToWorld(level, level.start.x, level.start.y);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(w.x, 0.02, w.z);
    levelGroup.add(ring);
  }
  // Beacons
  for (const b of level.beacons) {
    const w = cellToWorld(level, b.x, b.y);
    const hex = COLOURS[b.colour].hex;
    const col = new THREE.Color(hex);
    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.4, 0.1, 24),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.4 }),
    );
    pad.position.set(w.x, 0.05, w.z);
    levelGroup.add(pad);
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.17),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1, roughness: 0.2 }),
    );
    gem.position.set(w.x, 0.55, w.z);
    levelGroup.add(gem);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 1.2, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    pillar.position.set(w.x, 0.6, w.z);
    levelGroup.add(pillar);
    beaconVisuals.push({ index: b.index, pad, gem, pillar, baseY: 0.55, bx: b.x, by: b.y });
  }
  // Exit portal
  {
    const w = cellToWorld(level, level.exit.x, level.exit.y);
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.055, 12, 36),
      new THREE.MeshStandardMaterial({ color: 0xffdf2e, emissive: 0xffdf2e, emissiveIntensity: 0.9, roughness: 0.3 }),
    );
    torus.position.set(w.x, 0.45, w.z);
    levelGroup.add(torus);
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.36, 0.36, 0.06, 24),
      new THREE.MeshStandardMaterial({ color: 0xffdf2e, emissive: 0xffdf2e, emissiveIntensity: 0.35, roughness: 0.5 }),
    );
    disc.position.set(w.x, 0.03, w.z);
    levelGroup.add(disc);
    exitVisual = { torus, disc, x: w.x, z: w.z };
  }
  // Cube. M3: emissive 0.8 + a hot key light blew the top face out
  // to white in every screenshot since M1 (the face you read most).
  // Softer emissive + rougher surface keeps all six colours distinct.
  const mats = [START_ORIENT.east, START_ORIENT.west, START_ORIENT.top, START_ORIENT.bottom, START_ORIENT.south, START_ORIENT.north]
    .map((c) => new THREE.MeshStandardMaterial({
      color: new THREE.Color(COLOURS[c].hex),
      emissive: new THREE.Color(COLOURS[c].hex),
      emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.1,
    }));
  cubeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.78, 0.78), mats);
  const cubeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cubeMesh.geometry),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
  );
  cubeMesh.add(cubeEdges);
  levelGroup.add(cubeMesh);
  // M3: tile highlight under the cube — the M2 playtester miscounted
  // columns in perspective; a glowing cell marker under the cube
  // makes its grid position (and the beacon it stands on) unambiguous.
  cubeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.44, 0.66, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  cubeRing.rotation.x = -Math.PI / 2;
  cubeRing.rotation.z = Math.PI / 4;
  cubeRing.position.y = 0.03;
  levelGroup.add(cubeRing);
  // M3 eye-check: intensity 5 parked 0.8 above the cube burned a
  // white specular core into the top face. 2.5 keeps the glow
  // without erasing the colour.
  cubeLight = new THREE.PointLight(accent, 2.5, 9);
  levelGroup.add(cubeLight);
  scene.add(levelGroup);
  const run = state.phase === 'menu' ? state.demoRun : state.run;
  if (run) placeCube(run, true);
}
function placeCube(run, snap = false) {
  if (!cubeMesh) return;
  const w = cellToWorld(currentLevel, run.x, run.y);
  cubeMesh.position.set(w.x, 0.39, w.z);
  cubeMesh.scale.set(1, 1, 1);
  if (snap) cubeMesh.quaternion.copy(quatForOrient(run.orient));
  if (cubeLight) cubeLight.position.set(w.x, 2.2, w.z);
  if (cubeRing) cubeRing.position.set(w.x, 0.03, w.z);
}
function syncBeaconVisuals(run, t) {
  // The tile marker wears the down-face colour: the cell under the
  // cube literally shows which face is touching it. It pulses so it
  // reads as a frame AROUND the cube, not a shadow under it (the
  // 0.4-0.52 ring was a 1cm sliver the cube hid — M3 re-playtest).
  if (cubeRing && run) {
    cubeRing.material.color.set(COLOURS[run.orient.bottom].hex);
    const pulse = Math.sin(t * 4);
    cubeRing.material.opacity = 0.78 + pulse * 0.22;
    const rs = 1 + pulse * 0.06;
    cubeRing.scale.set(rs, rs, 1);
    // The marker belongs to the cube — when the cube falls, the
    // frame goes with it (it used to float on the last cell).
    cubeRing.visible = !fallAnim;
  }
  for (const v of beaconVisuals) {
    const lit = run.lit[v.index];
    v.gem.position.y = v.baseY + Math.sin(t * 2 + v.index * 1.7) * 0.07;
    v.gem.rotation.y = t * (lit ? 2.4 : 1.1);
    v.pad.material.emissiveIntensity = lit ? 1.6 : 0.7 + Math.sin(t * 3 + v.index) * 0.15;
    // M3 re-playtest fix: a lit beam the cube stands in dims to a
    // glow — at full opacity it read as a stick poking out of the
    // cube's top face.
    const cubeOnIt = run.x === v.bx && run.y === v.by;
    v.pillar.material.opacity = lit ? (cubeOnIt ? 0.12 : 0.35) : 0;
  }
  if (exitVisual) {
    exitVisual.torus.rotation.y = t * 1.4;
    exitVisual.torus.rotation.x = Math.sin(t * 1.1) * 0.15;
    const open = allLit(run);
    exitVisual.torus.material.emissiveIntensity = open ? 1.8 : 0.7;
    exitVisual.disc.material.emissiveIntensity = open ? 1.0 : 0.35;
  }
}

// ---------------------------------------------------------------- solver from current state (autopilot / demo)
function solveFrom(run) {
  const level = run.level;
  const fullMask = (1 << level.beacons.length) - 1;
  const startMask = run.lit.reduce((m, v, i) => (v ? m | (1 << i) : m), 0);
  const queue = [{ x: run.x, y: run.y, orient: { ...run.orient }, mask: startMask, path: [] }];
  const seen = new Set([run.x + ',' + run.y + '|' + orientKey(run.orient) + '|' + startMask]);
  while (queue.length > 0) {
    const cur = queue.shift();
    for (const dir of DIR_LIST) {
      const d = DIRS[dir];
      const nx = cur.x + d.x; const ny = cur.y + d.y;
      if (!isFloor(level, nx, ny) || isWall(level, nx, ny)) continue;
      const orient = rollOrientation(cur.orient, dir);
      let mask = cur.mask;
      const b = beaconAt(level, nx, ny);
      if (b && orient.bottom === b.colour) mask |= (1 << b.index);
      const path = [...cur.path, dir];
      if (nx === level.exit.x && ny === level.exit.y && mask === fullMask) return path;
      const k = nx + ',' + ny + '|' + orientKey(orient) + '|' + mask;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny, orient, mask, path });
    }
  }
  return null;
}

// ---------------------------------------------------------------- rolling
function queueRoll(dir) {
  if (state.phase !== 'playing' || !state.run) return false;
  // A full queue must never swallow an input silently (Tide lesson):
  // the M2 playtest desynced exactly this way — batched inputs past
  // the old cap of 3 vanished with no feedback, so the player's
  // mental model of the cube drifted from the sim. Cap is 6 (a full
  // reorientation loop plus change) and a drop fires the denied cue.
  if (rollQueue.length >= 6) {
    state.lastDenied = 'queuefull';
    feedback('queuefull');
    // M3: the drop used to be a bare buzz with no words (the M2
    // desync's last silent corner). Name it.
    toast('Too fast — let the cube land first');
    return false;
  }
  rollQueue.push(dir);
  return true;
}
function doRoll(run, dir, isDemo = false) {
  const outcome = rollCube(run, dir);
  const ev = run.lastEvent;
  if (outcome === 'wall' || outcome === 'nomoves') {
    if (!isDemo) {
      state.lastDenied = ev && ev.type ? ev.type : outcome;
      const cw = cellToWorld(currentLevel, run.x, run.y);
      const cpos = { x: cw.x, y: 0.5, z: cw.z, hex: COLOURS[run.orient.bottom].hex };
      if (outcome === 'wall') {
        // M3: the wall tier (thunk + sparks) plus a visible bump —
        // the cube leans into the wall and springs back, so the
        // refusal reads on the cube itself, not only in the toast.
        feedback('wall', { ...cpos, y: 1.1 }, 'Wall!');
        bumpAnim = { t: 0, dur: 0.34, dir, baseQuat: cubeMesh ? cubeMesh.quaternion.clone() : null };
        toast('Wall — the cube can\'t roll that way');
      } else {
        feedback('denied', cpos);
        toast('No moves left');
      }
    }
    return outcome;
  }
  // Animate the tumble toward the new cell/orientation.
  const lr = run.lastRoll;
  const fromW = cellToWorld(currentLevel, lr.fromX, lr.fromY);
  const toW = cellToWorld(currentLevel, lr.toX, lr.toY);
  rollAnim = {
    t: 0, dur: 0.17,
    fromPos: new THREE.Vector3(fromW.x, 0.39, fromW.z),
    toPos: new THREE.Vector3(toW.x, 0.39, toW.z),
    fromQuat: cubeMesh ? cubeMesh.quaternion.clone() : new THREE.Quaternion(),
    toQuat: quatForOrient(run.orient),
    outcome, dir, isDemo,
  };
  // M3: the roll goes through the full feedback tier (thock +
  // trauma 0.1 + sparks at the take-off cell) instead of a bare
  // SFX call — every event fires its bundle, roll included.
  if (!isDemo) feedback('roll', { x: fromW.x, y: 0.2, z: fromW.z, hex: COLOURS[run.orient.bottom].hex });
  return outcome;
}
function landRoll() {
  const anim = rollAnim;
  rollAnim = null;
  if (!anim || anim.isDemo) return;
  const run = state.run;
  if (!run) return;
  const ev = run.lastEvent;
  const w = cellToWorld(currentLevel, run.x, run.y);
  const pos = { x: w.x, y: 0.5, z: w.z, hex: '#22e6ff' };
  spawnParticles(w.x, 0.1, w.z, '#9db8d6', 9, 1.6, 1.2);
  landSquashT = 0.4; // M3: the cube lands with weight, not a teleport-stop
  if (anim.outcome === 'fell') {
    feedback('fell', { ...pos, hex: COLOURS[run.orient.bottom].hex }, 'OFF THE EDGE!');
    fallAnim = { t: 0, dur: 0.65, dir: anim.dir };
    toast('Off the edge!');
    state.endTimer = 0.85;
    return;
  }
  // M3 re-playtest: pops spawned at cube-centre height hid behind
  // the cube (4/4 beacon lits unreadable). Sparks and pops now fire
  // ABOVE the cube, where nothing can occlude them.
  const popPos = { ...pos, y: 1.15 };
  if (ev && ev.type === 'beacon') {
    const hex = COLOURS[ev.colour].hex;
    feedback('beacon', { ...popPos, hex }, COLOURS[ev.colour].name + ' lit!');
    toast(`${COLOURS[ev.colour].name} beacon lit! (${ev.lit}/${ev.total})`);
  } else if (ev && ev.type === 'wrongface') {
    state.lastDenied = 'wrongface';
    // M3: sparks in the beacon's own colour + a pop naming the face
    // it wanted — the denied cue happens AT the beacon, where the
    // player's eyes already are.
    feedback('wrongface', { ...popPos, hex: COLOURS[ev.colour].hex }, 'Needs ' + COLOURS[ev.colour].name + ' down');
    toast(`Wrong face — that beacon needs ${COLOURS[ev.colour].name} down (you landed ${COLOURS[ev.faceDown].name} down)`, 3);
  } else if (ev && ev.type === 'exitlocked') {
    state.lastDenied = 'exitlocked';
    feedback('exitlocked', { ...popPos, hex: '#ffdf2e' }, `Locked ${ev.lit}/${ev.total}`);
    toast(`Exit locked — light every beacon first (${ev.lit}/${ev.total})`);
  }
  if (anim.outcome === 'won') {
    feedback('won', { ...popPos, hex: '#ffdf2e' }, 'CLEAR!');
    state.slowMoT = 0.9;
    state.endTimer = 0.9;
  } else if (anim.outcome === 'budget') {
    feedback('budget', { ...popPos, hex: '#ff5470' }, 'OUT OF MOVES');
    toast('Out of moves!');
    state.endTimer = 0.7;
  }
  updateHUD();
}

// ---------------------------------------------------------------- screens
const SCREEN_IDS = ['menu', 'levels', 'howto', 'settings', 'pause', 'complete', 'gameover'];
let screenStack = ['menu'];
function showOnly(id) {
  for (const s of SCREEN_IDS) $(s).classList.toggle('hidden', s !== id);
}
function focusFirst(id) {
  const el = $(id).querySelector('.btn.primary, .btn, input, select');
  if (el) el.focus();
}
function pushScreen(id) {
  screenStack.push(id);
  showOnly(id);
  focusFirst(id);
}
function popScreen() {
  screenStack.pop();
  const top = screenStack[screenStack.length - 1] || 'menu';
  showOnly(top);
  focusFirst(top);
}
function hoverFeedback(el) {
  el.addEventListener('mouseenter', () => playSfx('hover'));
  el.addEventListener('click', () => playSfx('click'));
}
function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + s.toFixed(1).padStart(4, '0');
}
function buildLevelCards(container, onPick) {
  container.innerHTML = '';
  for (const level of LEVELS) {
    const unlocked = isLevelUnlocked(save, level.id);
    const best = save.best[level.id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'track-card' + (level.id === state.levelId ? ' selected' : '');
    card.disabled = !unlocked;
    const rank = best && best.rank ? `<span class="tc-rank rank-${best.rank}">RANK ${best.rank}</span>` : '';
    card.innerHTML = `<span class="tc-name">${level.id}. ${level.name}${rank}</span>` +
      `<span class="tc-meta">${level.beacons.length} beacon${level.beacons.length > 1 ? 's' : ''} · ${level.budget} moves · par ${level.parMoves}</span>` +
      `<span class="tc-best">${unlocked ? (best ? 'Best ' + best.score : 'Not cleared yet') : 'Locked — clear the previous level'}</span>`;
    card.addEventListener('click', () => onPick(level.id));
    hoverFeedback(card);
    container.appendChild(card);
  }
}
function updateMenuText() {
  const cleared = Object.keys(save.best).filter((id) => save.best[id] && save.best[id].won).length;
  $('menu-best').textContent = cleared > 0 ? `Cleared ${cleared}/${LEVELS.length} levels` : '';
  const level = levelById(state.levelId);
  $('menu-hint').textContent = '';
  $('level-hint').textContent = level ? `Selected: ${level.name} — ${level.hint}` : '';
}
function updateMuteButtons() {
  const label = state.muted ? 'Sound: Off' : 'Sound: On';
  $('btn-mute-menu').textContent = label;
  $('btn-mute-hud').textContent = label;
  $('btn-mute-pause').textContent = label;
}
function toggleMute() {
  state.muted = !state.muted;
  settings.muted = state.muted;
  persistSave();
  updateMuteButtons();
  if (!state.muted) { ensureAudio(); startMusic(); }
}
function showMenu() {
  state.phase = 'menu';
  state.autopilot = false;
  state.run = null;
  rollQueue = [];
  rollAnim = null;
  fallAnim = null;
  bumpAnim = null;
  landSquashT = 0;
  state.endTimer = null;
  hideToast();
  $('hud').classList.add('hidden');
  $('touch-controls').classList.add('hidden');
  state.demoRun = createRun(LEVELS[0]);
  state.demoPath = solve(LEVELS[0]).path;
  state.demoStep = 0;
  state.demoTimer = 0;
  buildLevelScene(LEVELS[0]);
  buildLevelCards($('level-select'), (id) => { state.levelId = id; updateMenuText(); buildLevelCards($('level-select'), (i2) => { state.levelId = i2; updateMenuText(); }); });
  updateMenuText();
  updateMuteButtons();
  screenStack = ['menu'];
  showOnly('menu');
  focusFirst('menu');
}

// ---------------------------------------------------------------- run control
function startLevel(id, unlockedOverride = false) {
  if (!unlockedOverride && !isLevelUnlocked(save, id)) return;
  ensureAudio();
  startMusic();
  state.levelId = id;
  state.run = startRun(id);
  state.phase = 'playing';
  state.autopilot = false;
  state.autoTimer = 0;
  state.readyT = 0.5;
  state.endTimer = null;
  state.lastDenied = null;
  state.lastEvent = null;
  rollQueue = [];
  rollAnim = null;
  fallAnim = null;
  bumpAnim = null;
  landSquashT = 0;
  hideToast();
  buildLevelScene(state.run.level);
  placeCube(state.run, true);
  $('hud').classList.remove('hidden');
  $('touch-controls').classList.remove('hidden');
  screenStack = [];
  showOnly(null);
  updateHUD();
  toast(state.run.level.hint, 3);
}
function restartLevel() { startLevel(state.levelId, true); }
function endRun() {
  const run = state.run;
  if (!run) return;
  hideToast();
  if (run.phase === 'won') {
    state.phase = 'complete';
    const rank = rankFor({ won: true, moves: run.moves, parMoves: run.level.parMoves });
    recordBest(save, run.level.id, { won: true, score: run.score, moves: run.moves, time: run.time, parMoves: run.level.parMoves });
    persistSave();
    const last = run.level.id === LEVELS.length;
    $('complete-title').textContent = last ? 'All Levels Clear' : 'Level Cleared';
    $('complete-score').textContent = 'Score ' + run.score;
    $('complete-parts').textContent = `Clear ${run.scoreParts.clear} + Efficiency ${run.scoreParts.efficiency} + Time ${run.scoreParts.time} = ${run.scoreParts.total}`;
    $('complete-detail').textContent = `${run.moves} moves (par ${run.level.parMoves}) in ${fmtTime(run.time)}`;
    const best = save.best[run.level.id];
    $('complete-best').textContent = best ? `Best ${best.score}` : '';
    const rankEl = $('complete-rank');
    rankEl.textContent = rank ? 'RANK ' + rank : '';
    rankEl.className = 'complete-best complete-rank-badge' + (rank ? ' rank-' + rank : '');
    $('btn-next').classList.toggle('hidden', last);
    $('touch-controls').classList.add('hidden');
    screenStack = ['complete'];
    showOnly('complete');
    focusFirst('complete');
  } else {
    state.phase = 'gameover';
    $('gameover-title').textContent = 'Level Failed';
    $('gameover-detail').textContent = run.loseReason === 'fell'
      ? `The cube rolled off the edge on move ${run.moves} with ${litCount(run)}/${run.level.beacons.length} beacons lit. Watch the rim — and the face underneath.`
      : `Out of moves: ${run.moves}/${run.level.budget} spent with ${litCount(run)}/${run.level.beacons.length} beacons lit. Par is ${run.level.parMoves} — every roll is an orientation decision.`;
    const best = save.best[run.level.id];
    $('gameover-best').textContent = best ? `Best ${best.score}` : 'No clear yet — the next tumble is yours.';
    $('touch-controls').classList.add('hidden');
    screenStack = ['gameover'];
    showOnly('gameover');
    focusFirst('gameover');
  }
}
function quitToMenu() { showMenu(); }
function pauseGame() {
  if (state.phase !== 'playing') return;
  state.phase = 'paused';
  screenStack = ['pause'];
  showOnly('pause');
  focusFirst('pause');
}
function resumeGame() {
  if (state.phase !== 'paused') return;
  state.phase = 'playing';
  screenStack = [];
  showOnly(null);
}
function togglePause() {
  if (state.phase === 'playing') pauseGame();
  else if (state.phase === 'paused') resumeGame();
}

// ---------------------------------------------------------------- HUD
function updateHUD() {
  const run = state.run;
  if (!run) return;
  $('hud-level').textContent = `Level ${run.level.id} — ${run.level.name}`;
  $('hud-time').textContent = fmtTime(run.time);
  const best = save.best[run.level.id];
  $('hud-best').textContent = best ? 'Best ' + best.score : 'Best —';
  $('hud-beacons').textContent = `Beacons ${litCount(run)}/${run.level.beacons.length}`;
  const face = COLOURS[run.orient.bottom];
  $('hud-face-name').textContent = face.name;
  const sw = $('hud-face-swatch');
  sw.style.background = face.hex;
  sw.style.color = face.hex;
  const left = movesLeft(run);
  $('hud-moves-left').textContent = left + ' left';
  const fill = $('hud-moves-fill');
  fill.style.width = clamp((left / run.level.budget) * 100, 0, 100) + '%';
  // M3: the meter warns in stages — gold under 30% of budget, then a
  // pulsing danger state for the last 3 moves (fill AND the "N left"
  // text turn red) — so running dry is never a surprise (the budget
  // is a decision, not a trap).
  fill.classList.toggle('warn', left > 3 && left <= Math.ceil(run.level.budget * 0.3));
  fill.classList.toggle('low', left <= 3);
  $('hud-moves-left').classList.toggle('low', left <= 3);
}

// ---------------------------------------------------------------- settings
function applySettings() {
  if (masterGain) masterGain.gain.value = state.muted ? 0 : (settings.volume ?? 60) / 100;
  document.body.classList.toggle('high-contrast', !!settings.contrast);
  document.body.classList.toggle('text-large', settings.textSize === 'large');
  document.body.classList.toggle('text-xlarge', settings.textSize === 'xlarge');
  $('volume-range').value = settings.volume ?? 60;
  $('volume-value').textContent = (settings.volume ?? 60) + '%';
  $('shake-range').value = settings.shake ?? 100;
  $('shake-value').textContent = (settings.shake ?? 100) + '%';
  $('shake-range-pause').value = settings.shake ?? 100;
  $('shake-value-pause').textContent = (settings.shake ?? 100) + '%';
  $('music-toggle').checked = settings.music !== false;
  $('sfx-toggle').checked = settings.sfx !== false;
  $('reduce-flashing').checked = settings.flash === false;
  $('text-size-select').value = settings.textSize || 'normal';
  $('high-contrast-toggle').checked = !!settings.contrast;
  musicOn = settings.music !== false;
  sfxOn = settings.sfx !== false;
}
function setShake(pct) {
  settings.shake = clamp(Math.round(pct), 0, 100);
  persistSave();
  applySettings();
}
function setFlash(on) {
  settings.flash = !!on;
  persistSave();
  applySettings();
}
function setMusic(on) {
  settings.music = !!on;
  musicOn = !!on;
  persistSave();
  applySettings();
  if (on) startMusic(); else stopMusic();
}
function setSfx(on) {
  settings.sfx = !!on;
  sfxOn = !!on;
  persistSave();
  applySettings();
}
function setTextSize(v) {
  settings.textSize = v;
  persistSave();
  applySettings();
}
function setContrast(on) {
  settings.contrast = !!on;
  persistSave();
  applySettings();
}

// ---------------------------------------------------------------- input
const KEY_DIRS = {
  ArrowUp: 'N', KeyW: 'N', ArrowDown: 'S', KeyS: 'S',
  ArrowLeft: 'W', KeyA: 'W', ArrowRight: 'E', KeyD: 'E',
};
window.addEventListener('keydown', (e) => {
  if (KEY_DIRS[e.code]) {
    e.preventDefault();
    if (state.phase === 'playing') { ensureAudio(); queueRoll(KEY_DIRS[e.code]); }
    return;
  }
  switch (e.code) {
    case 'KeyR': if (state.phase === 'playing' || state.phase === 'complete' || state.phase === 'gameover') restartLevel(); break;
    case 'KeyP': togglePause(); break;
    case 'KeyM': toggleMute(); break;
    case 'Escape':
      if (state.phase === 'playing') pauseGame();
      else if (state.phase === 'paused') resumeGame();
      else if (screenStack.length > 1) popScreen();
      break;
    default: break;
  }
});
function bindDpad(id, dir) {
  const el = $(id);
  el.addEventListener('click', () => {
    ensureAudio();
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 150);
    queueRoll(dir);
  });
  hoverFeedback(el);
}
bindDpad('btn-roll-n', 'N');
bindDpad('btn-roll-s', 'S');
bindDpad('btn-roll-w', 'W');
bindDpad('btn-roll-e', 'E');
// Swipe to roll
let swipeStart = null;
if (renderer) {
  renderer.domElement.addEventListener('pointerdown', (e) => { swipeStart = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!swipeStart || state.phase !== 'playing') { swipeStart = null; return; }
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.hypot(dx, dy) < 24) return;
    queueRoll(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N'));
  });
}

// ---------------------------------------------------------------- buttons
document.querySelectorAll('.btn, .icon-btn').forEach(hoverFeedback);
$('btn-play').addEventListener('click', () => { ensureAudio(); startLevel(state.levelId); });
$('btn-levels').addEventListener('click', () => {
  buildLevelCards($('level-grid'), (id) => startLevel(id));
  $('levels-hint').textContent = 'Clear a level to unlock the next. Ranks: S in par, A within par + 2, B cleared.';
  pushScreen('levels');
});
$('btn-levels-back').addEventListener('click', () => popScreen());
$('btn-howto').addEventListener('click', () => pushScreen('howto'));
$('btn-howto-close').addEventListener('click', () => popScreen());
$('btn-settings').addEventListener('click', () => pushScreen('settings'));
$('btn-settings-close').addEventListener('click', () => popScreen());
$('btn-mute-menu').addEventListener('click', toggleMute);
$('btn-mute-hud').addEventListener('click', toggleMute);
$('btn-mute-pause').addEventListener('click', toggleMute);
$('btn-pause').addEventListener('click', pauseGame);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart').addEventListener('click', () => restartLevel());
$('btn-quit').addEventListener('click', quitToMenu);
$('btn-next').addEventListener('click', () => startLevel(state.levelId + 1, true));
$('btn-replay').addEventListener('click', () => restartLevel());
$('btn-retry').addEventListener('click', () => restartLevel());
$('btn-menu-complete').addEventListener('click', quitToMenu);
$('btn-menu-over').addEventListener('click', quitToMenu);
$('volume-range').addEventListener('input', (e) => {
  settings.volume = Number(e.target.value);
  persistSave(); applySettings();
});
$('shake-range').addEventListener('input', (e) => setShake(Number(e.target.value)));
$('shake-range-pause').addEventListener('input', (e) => setShake(Number(e.target.value)));
$('music-toggle').addEventListener('change', (e) => setMusic(e.target.checked));
$('sfx-toggle').addEventListener('change', (e) => setSfx(e.target.checked));
$('reduce-flashing').addEventListener('change', (e) => setFlash(!e.target.checked));
$('text-size-select').addEventListener('change', (e) => setTextSize(e.target.value));
$('high-contrast-toggle').addEventListener('change', (e) => setContrast(e.target.checked));

// ---------------------------------------------------------------- camera + screen space
function worldToScreen(x, y, z) {
  if (!camera || !renderer) return null;
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
}
function frameCamera(dt, run, orbiting) {
  if (!camera) return;
  const level = currentLevel;
  const span = Math.max(level.cols, level.rows);
  const aspect = window.innerWidth / window.innerHeight;
  const dist = span * (aspect < 1 ? 2.3 : 1.0) + (aspect < 1 ? 3.2 : 2.4);
  // Fog must scale with the camera distance: at portrait distance for
  // a 15-wide platform (M2) the fixed 18-46 fog swallowed the whole
  // platform into the background (eye-check catch).
  if (scene && scene.fog) { scene.fog.near = dist * 0.9; scene.fog.far = dist * 2.4; }
  let tx = 0; let tz = 0;
  if (run) {
    const w = cellToWorld(level, run.x, run.y);
    // Portrait: follow less — the narrow horizontal FOV clips the
    // platform edge when the view chases the cube (eye-check fix).
    const follow = aspect < 1 ? 0.15 : 0.35;
    tx = w.x * follow; tz = w.z * follow;
  }
  // Menu: shift the view left so the demo platform reads on the right
  // of the left-anchored menu panel (the menu IS the game).
  if (orbiting && aspect >= 1) tx -= span * 0.34;
  cameraTarget.lerp(new THREE.Vector3(tx, 0, tz), 1 - Math.pow(0.001, dt));
  let px = cameraTarget.x;
  let pz = cameraTarget.z + dist * 0.82;
  if (orbiting) {
    menuOrbitT += dt * 0.12;
    px = cameraTarget.x + Math.sin(menuOrbitT) * dist * 0.35;
    pz = cameraTarget.z + Math.cos(menuOrbitT) * dist * 0.82;
  }
  cameraPos.lerp(new THREE.Vector3(px, dist * 0.95, pz), 1 - Math.pow(0.001, dt));
  camera.position.copy(cameraPos);
  // Trauma shake on a visual-only offset (never the sim).
  const shakeAmp = (state.trauma * state.trauma) * 0.35 * ((settings.shake ?? 100) / 100);
  if (shakeAmp > 0.0005) {
    camera.position.x += (Math.random() - 0.5) * shakeAmp;
    camera.position.y += (Math.random() - 0.5) * shakeAmp;
  }
  camera.lookAt(cameraTarget.x, 0.1, cameraTarget.z);
}

// ---------------------------------------------------------------- fps guard
function stepFpsGuard() {
  if (dprCap > 1.5) dprCap = 1.5;
  else if (dprCap > 1) dprCap = 1;
  else return dprCap;
  particleScale = dprCap === 1.5 ? 0.6 : 0.35;
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  return dprCap;
}
function fpsInfo() {
  return {
    fps: Math.round(fpsEma),
    dprCap,
    pixelRatio: renderer ? +renderer.getPixelRatio().toFixed(2) : 0,
    particleScale,
    guardActive: dprCap < 2,
  };
}

// ---------------------------------------------------------------- main loop
let lastNow = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (!renderer || !scene || !camera) return;
  let dt = Math.min(0.05, (now - lastNow) / 1000);
  lastNow = now;
  if (dt > 0) fpsEma = fpsEma * 0.95 + (1 / dt) * 0.05;
  if (fpsEma < 40) { fpsLowT += dt; if (fpsLowT > 2.5) { stepFpsGuard(); fpsLowT = 0; } }
  else fpsLowT = 0;
  // Time scale: hit-stop owns the freeze, slow-mo after it.
  if (state.hitStopT > 0) {
    state.hitStopT -= dt;
    state.timeScale = state.hitStopT > 0 ? 0 : (state.slowMoT > 0 ? 0.35 : 1);
  } else if (state.slowMoT > 0) {
    state.slowMoT -= dt;
    state.timeScale = state.slowMoT > 0 ? 0.35 : 1;
  } else state.timeScale = 1;
  const sdt = dt * state.timeScale;
  state.trauma = Math.max(0, state.trauma - dt * 1.6);
  if (state.flashT > 0) {
    state.flashT = Math.max(0, state.flashT - dt * 2.2);
    $('hit-flash').style.opacity = String(state.flashT);
  }
  scheduleMusic();
  const t = now / 1000;

  if (state.phase === 'menu') {
    // Live demo: the solver plays level 1 behind the menu.
    state.demoTimer += sdt;
    if (!rollAnim && state.demoTimer > 0.55) {
      state.demoTimer = 0;
      if (state.demoStep >= state.demoPath.length || state.demoRun.phase !== 'playing') {
        state.demoRun = createRun(LEVELS[0]);
        state.demoPath = solve(LEVELS[0]).path;
        state.demoStep = 0;
        placeCube(state.demoRun, true);
      } else {
        doRoll(state.demoRun, state.demoPath[state.demoStep++], true);
      }
    }
    syncBeaconVisuals(state.demoRun, t);
    frameCamera(dt, state.demoRun, true);
  } else if (state.phase === 'playing' && state.run) {
    const run = state.run;
    run.time += sdt;
    if (state.readyT > 0) state.readyT -= sdt;
    if (state.autopilot && !rollAnim && !fallAnim && run.phase === 'playing') {
      state.autoTimer += sdt;
      if (state.autoTimer > 0.42) {
        state.autoTimer = 0;
        const path = solveFrom(run);
        if (path && path.length > 0) queueRoll(path[0]);
      }
    }
    if (!rollAnim && !fallAnim && state.readyT <= 0 && rollQueue.length > 0 && run.phase === 'playing') {
      doRoll(run, rollQueue.shift());
    }
    if (state.endTimer !== null) {
      state.endTimer -= dt;
      if (state.endTimer <= 0) { state.endTimer = null; endRun(); }
    }
    syncBeaconVisuals(run, t);
    frameCamera(dt, run, false);
    updateHUD();
  } else {
    const run = state.run || state.demoRun;
    if (run) syncBeaconVisuals(run, t);
    frameCamera(dt, run, false);
  }

  // Roll animation
  if (rollAnim && cubeMesh) {
    rollAnim.t += sdt;
    const k = clamp(rollAnim.t / rollAnim.dur, 0, 1);
    const ease = 1 - Math.pow(1 - k, 3);
    cubeMesh.position.lerpVectors(rollAnim.fromPos, rollAnim.toPos, ease);
    cubeMesh.position.y = 0.39 + Math.sin(k * Math.PI) * 0.16;
    cubeMesh.quaternion.slerpQuaternions(rollAnim.fromQuat, rollAnim.toQuat, ease);
    if (cubeLight) cubeLight.position.set(cubeMesh.position.x, 2.2, cubeMesh.position.z);
    if (cubeRing) cubeRing.position.set(cubeMesh.position.x, 0.03, cubeMesh.position.z);
    if (k >= 1) {
      cubeMesh.position.copy(rollAnim.toPos);
      cubeMesh.quaternion.copy(rollAnim.toQuat);
      landRoll();
    }
  }
  // M3: wall bump — lean toward the wall, spring back. Visual only;
  // the sim never moved (wall rolls spend no move). The lean is a
  // real tilt (~18°) around the roll axis, not just a slide: a
  // translation-only nudge read as "nothing happened" in playtests.
  if (bumpAnim && cubeMesh && !rollAnim) {
    bumpAnim.t += sdt;
    const k = clamp(bumpAnim.t / bumpAnim.dur, 0, 1);
    const d = DIRS[bumpAnim.dir];
    const run2 = state.run;
    if (run2) {
      const w2 = cellToWorld(currentLevel, run2.x, run2.y);
      const s = Math.sin(k * Math.PI);
      const nudge = s * 0.22;
      cubeMesh.position.set(w2.x + d.x * nudge, 0.39, w2.z + d.y * nudge);
      if (bumpAnim.baseQuat) {
        // Lean INTO the wall: E/W tilts around Z, N/S around X.
        const axis = (bumpAnim.dir === 'E' || bumpAnim.dir === 'W') ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const sign = (bumpAnim.dir === 'E' || bumpAnim.dir === 'N') ? -1 : 1;
        const tilt = new THREE.Quaternion().setFromAxisAngle(axis, sign * s * 0.32);
        cubeMesh.quaternion.copy(tilt).multiply(bumpAnim.baseQuat);
      }
    }
    if (k >= 1) {
      if (bumpAnim.baseQuat) cubeMesh.quaternion.copy(bumpAnim.baseQuat);
      bumpAnim = null;
      if (run2) placeCube(run2);
    }
  }
  // M3: landing squash — scale dips and recovers, snapped to exact
  // rest at the end (never a permanently squashed cube).
  if (landSquashT > 0 && cubeMesh) {
    landSquashT -= sdt;
    const k = clamp(1 - landSquashT / 0.4, 0, 1);
    const s = Math.sin(k * Math.PI);
    cubeMesh.scale.set(1 + 0.2 * s, 1 - 0.35 * s, 1 + 0.2 * s);
    if (landSquashT <= 0) cubeMesh.scale.set(1, 1, 1);
  }
  // Fall animation
  if (fallAnim && cubeMesh) {
    fallAnim.t += sdt;
    const k = clamp(fallAnim.t / fallAnim.dur, 0, 1);
    const d = DIRS[fallAnim.dir];
    cubeMesh.position.y = 0.39 - k * k * 4.5;
    cubeMesh.position.x += d.x * sdt * 1.2;
    cubeMesh.position.z += d.y * sdt * 1.2;
    cubeMesh.rotation.x += sdt * 3;
    cubeMesh.rotation.z += sdt * 2.2;
    if (k >= 1) fallAnim = null;
  }
  updateParticles(sdt);

  // Wall-clock cadence (not clamped dt): under a slow software
  // renderer the clamped accumulator starves the readout.
  if (now - lastPerfNow > 500) {
    lastPerfNow = now;
    const f = fpsInfo();
    $('perf-line').textContent = `Performance: ${f.fps} fps · render scale ${f.pixelRatio}x${f.guardActive ? ' · FPS guard active' : ''}`;
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- resize / context
window.addEventListener('resize', () => {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (state.phase === 'playing') pauseGame();
});
window.addEventListener('webglcontextrestored', () => { /* renderer recovers on next frame */ });

// ---------------------------------------------------------------- test hooks
function info() {
  const run = state.phase === 'menu' ? state.demoRun : state.run;
  const level = run ? run.level : currentLevel;
  const w = run ? cellToWorld(level, run.x, run.y) : { x: 0, z: 0 };
  return {
    phase: state.phase,
    version: VERSION,
    levelId: state.levelId,
    x: run ? run.x : null,
    y: run ? run.y : null,
    downFace: run ? run.orient.bottom : null,
    downFaceName: run ? COLOURS[run.orient.bottom].name : null,
    lit: run ? litCount(run) : 0,
    total: level.beacons.length,
    moves: run ? run.moves : 0,
    movesLeft: run ? movesLeft(run) : 0,
    budget: level.budget,
    score: run ? run.score : 0,
    time: run ? +run.time.toFixed(2) : 0,
    runPhase: run ? run.phase : null,
    loseReason: run ? run.loseReason : null,
    lastDenied: state.lastDenied,
    lastEvent: run ? run.lastEvent : null,
    screen: worldToScreen(w.x, 0.4, w.z),
    cubeScreen: cubeMesh ? worldToScreen(cubeMesh.position.x, cubeMesh.position.y, cubeMesh.position.z) : null,
    autopilot: state.autopilot,
    unlocked: save.unlocked,
    demoStep: state.demoStep,
    trauma: +state.trauma.toFixed(3),
    timeScale: state.timeScale,
    fps: Math.round(fpsEma),
    fpsGuard: fpsInfo(),
  };
}
function feelInfo() {
  const shakeSetting = (settings.shake ?? 100) / 100;
  return {
    trauma: +state.trauma.toFixed(3),
    shakeSetting,
    shakeAmp: +(state.trauma * state.trauma * 0.35 * shakeSetting).toFixed(4),
    timeScale: state.timeScale,
    flashT: +state.flashT.toFixed(3),
    flashEnabled: settings.flash !== false,
    particlesAlive: particlesAlive(),
    bumpActive: !!bumpAnim,
    squash: landSquashT > 0,
    fxCounts: { ...state.fxCounts },
  };
}
window.__tumble = {
  version: VERSION,
  get run() { return state.run; },
  get demoRun() { return state.demoRun; },
  get phase() { return state.phase; },
  get state() { return state; },
  get save() { return save; },
  levels: LEVELS,
  info,
  feel: feelInfo,
  audio: audioInfo,
  fps: fpsInfo,
  startLevel: (id) => startLevel(id, true),
  roll: (dir) => queueRoll(dir),
  autopilot(on) { state.autopilot = !!on; state.autoTimer = 0; },
  pause: pauseGame,
  resume: resumeGame,
  quitToMenu,
  setMuted(m) { if (!!m !== state.muted) toggleMute(); },
  setShake(p) { setShake(p * 100); },
  setFlash,
  setMusic,
  setSfx,
  setTextSize,
  setContrast,
  triggerFpsGuard() { stepFpsGuard(); return dprCap; },
  get dprCap() { return dprCap; },
  worldToScreen,
};

// ---------------------------------------------------------------- boot
applySettings();
updateMuteButtons();
if (!webglOK || !renderer) {
  $('webgl-error').classList.remove('hidden');
  showMenu();
} else {
  showMenu();
  const levelParam = Number(params.get('level'));
  if (levelParam >= 1 && levelParam <= LEVELS.length) {
    startLevel(levelParam, true);
  }
  requestAnimationFrame(frame);
}
