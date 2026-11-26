# Neon Tumble — devlog

## v0.2.1 — M2 playtest fixes (2026-11-26)

The first live FUN playtest of the 12-level build came back NO-GO:
budgets felt punishing (one mistake costs a ~4-move reorientation
loop, and +5 slack doesn't cover it on a 30-move level), Gold/Orange
and Magenta/Violet were still too close under the glow, and batched
inputs past the old queue cap of 3 were silently dropped — desyncing
the player's mental model from the cube. (The report's "rotates and
spends a move without moving" is impossible in the sim, where a roll
is atomic; the silent queue drop is the real defect.) Fixes: budget
slack raised to ~+30% on levels 4–12 (ranks still demand par for S),
palette pushed apart (Magenta #ff2e9e, Gold #ffdf2e, Violet #9d4dff,
Orange #ff5200), input queue cap 3→6 with a named denied cue on drop,
scroll-snap on the menu level strip, plus a rapid-input regression
check in the render test. Re-playtested after this push.

## v0.2.0 — M2 level craft (2026-11-26)

Twelve hand-crafted levels with a real difficulty curve. The nine new
levels (The Loop, Crossroads, Twin Gates, Switchback, Hourglass, The
Gauntlet, The Maze, Four Corners, Void Crown) each have their own
platform shape, wall layout, beacon pattern and budget, and the BFS
solver's minimum move counts rise strictly across all twelve levels:
6, 14, 18, 21, 23, 26, 27, 28, 31, 34, 35, 37 — no cliff, each level a
few more deliberate tumbles than the last. The finale, Void Crown,
uses all six beacon colours on the largest platform (15x9).

Design lesson found while tuning: a one-cell-wide corridor locks the
cube's north/south faces away from the bottom forever (rolling E/W
never cycles them down, and a single-file drop can't either) — a gold
beacon at the end of a serpent corridor was provably unlightable. Every
M2 platform therefore stays at least two cells deep everywhere, so a
2x2 loop can always re-orient the cube onto any face. Walls force
detours; they never amputate the orientation space.

Verification: smoke + bot gates pass on all 12 levels (solver clears
each in exactly par; no-input, spam and random-roll bots fail —
random 0/50 on every level), headless render check PASS (autopilot
clears levels 1, 3 and 12 in the browser), size sweep inspected by
eye including the level-12 platform in portrait.

## v0.1.0 — M1 core (2026-11-26, shipped live the same day)

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
