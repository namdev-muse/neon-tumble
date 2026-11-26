# Neon Tumble — devlog

## v0.1.0 — M1 core (2026-11-26, LOCAL ONLY — not yet shipped)

First build of game #15, the first 3D game of the next loop. This entry
records a **local tree only**: no GitHub repo exists yet, nothing has
been pushed, and M1 is **NOT done** — the milestone's done-when requires
a real-browser FUN playtest GO, which belongs to the first milestone
run (repo creation + browser upload + live verification + playtest).

### What was built

- **Cube-rolling core** (`physics.js`, pure sim): six-colour orientation
  tracking, discrete rolls (arrows/WASD, D-pad taps, swipe), beacon
  face-match (lights only when the matching face lands DOWN), exit
  portal locked until all beacons lit, move budget, wall block (denied,
  no move spent), edge-fall fail. BFS solver over position +
  orientation + lit mask. Score = clear 1000 + efficiency 150/unused
  move + time bonus; ranks S/A/B saved per level with an unlock chain.
- **3 dense hand-crafted levels** with distinct identities and strictly
  increasing solver pars: First Tumble (1 beacon, par 6, budget 11 —
  teaches face cycling), Crosscurrent (2 beacons, par 14, budget 18),
  The Vault (3 beacons, par 18, budget 22).
- **Three.js shell** (`game.js`): renderer capped at DPR 2, live solver
  demo rolling behind the menu, screen-stack menus (menu / levels /
  how-to / settings / pause / complete / game-over), hover tick + scale
  pop + press feedback, no version/engine text on player screens.
  Roll animation slerps the cube mesh to the exact sim orientation, so
  what you see is always the cube's true state — never a hint.
- **Game feel**: trauma shake tiers, hit-stop on beacon/solve, slow-mo
  on the finish, pooled particles (beacon sparks, landing dust), Web
  Audio synth SFX, generative music that lifts with beacons lit,
  named denied cues for wall / wrong-face / exit-locked / no-moves.
- **Settings**: volume, shake, music, SFX, reduce flashing, text size,
  high contrast, live performance readout, FPS guard (DPR 2 → 1.5 → 1).
- Public playtest path `?level=N` / `?unlock=1` (not in the player UI).

### Verification (local)

- `npm test` — smoke + bot PASS (see milestone-M1.md for totals).
- `npm run render-check` — PASS, zero console errors (headless).
- `npm run screenshots` — size sweep at 1280x720 / 2560x1080 /
  1080x2340, inspected by eye.

### Honest status

M1 is **not done** until the first milestone run pushes this tree,
verifies the live site, and a real-browser playtest judges it FUN.
Known carry-overs are listed in the sprint's milestone-M1.md.
