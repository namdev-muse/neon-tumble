# Neon Tumble — devlog

## v0.4.0 — M4 progression & depth (2026-11-26)

Endless Tumble: seeded depths that scale as you descend. Each depth
is generated deterministically from (seed, depth) — platform grows
7x4 → 15x9, beacons 1 → 6, walls accumulate, and budget slack above
par shrinks from ~47% to a 12% floor — and is verified solvable by
the BFS solver inside the depth's par band before it is shown (an
unsolvable or trivial candidate is rejected, never shipped). Clear
a depth to build your streak and run score; fail and the run ends.
Best streak + best score are saved (max-only) and shown on the menu,
the HUD and both end screens; the per-depth rank badge shows on the
clear screen too. Ranks S/A/B (saved per level since M1, badged on
level cards and the clear screen) now also tally on the menu line
("Ranks S×… A×… B×…"). Playtest path: `?endless=1&seed=N&depth=N`.
Verification: smoke 176/176, bot gates pass (solver rides to depth 8
on three seeds; random-roll 0/50 at depths 1/4/8; spam never wins),
render check PASS including the full endless flow (start → clear →
Next Depth → bank → menu best line).

## v0.3.3 — M3 third playtest fixes (2026-11-26)

The third playtest passed pop contrast, wall lean (weak), cell
marker pulse, rank line, R-on-complete, low-moves urgency and
beam dimming — but still NO-GO on two items. Landing squash: a
local probe confirmed the squash fires for its full 0.4s window
(hook-sampled), but at 35% dip it was still easy to miss in
stills; it is now a 45% dip over 0.55s plus an expanding landing
ring flash in the down-face colour, so every landing reads in a
single frame. Beam lean: diagnosed as correct perspective — with
a camera pitched down ~49°, the vertical vanishing point sits
above the screen, so world-vertical beams near the frame edges
project tilted 12–20° and read as bent. Beams now align to the
camera's up vector, making them screen-vertical from every
angle, anchored at the pad. Wall lean strengthened to ~24° over
0.4s for margin. Re-playtested after this push.

## v0.3.2 — M3 second playtest fixes (2026-11-26)

The re-playtest was close — rank line, R-on-complete, low-moves
urgency and beams all passed — but still NO-GO: pop text rendered
dim (gold on gold, fading from the first frame), the wall bump was
a translation-only nudge no still could catch, the landing squash
was too brief to register, and the cell marker's pulse was
undetectable. Fixes: pops are white on near-opaque pills at full
opacity for 60% of a longer life; the wall bump is now a real
~18° lean into the wall over 0.34s (quaternion tilt, restored
exactly); squash deepened to a 35% dip over 0.4s; the cell frame
is thicker, pulses in opacity and scale, and hides while the cube
falls; beams are shorter and wider. Re-playtested after this push.

## v0.3.1 — M3 playtest fixes (2026-11-26)

The first live FUN playtest of the feel build came back NO-GO: the
puzzle core and HUD/toast layer were praised, but the juice itself
was thin — in-world pop text hid behind the cube in every beacon
lit, the tile marker under the cube was a sliver the cube occluded,
the wall bump and landing squash were too small to see, the
low-moves meter had no urgency, lit beams poked out of the cube
like sticks, and the rank line clipped at the clear panel's scroll
edge. Fixes: pops now fire above the cube on dark contrast pills;
the cell marker is a wide pulsing frame in the down-face colour;
wall bump (0.22u over 0.26s + "Wall!" pop + stronger shake) and
landing squash (30% dip over 0.28s, more dust) are unmissable;
the MOVES meter turns red and pulses (fill and text) for the last
3 moves; beams are shorter, uniform columns that dim when the cube
stands in them; end-screen spacing tightened; R restarts from the
complete/game-over screens too. Re-playtested after this push.

## v0.3.0 — M3 feel & juice (2026-11-26)

Every event now fires its full feedback bundle. Before this milestone
the roll was a bare SFX call (its trauma/particle tier never fired),
wall and no-moves shared one generic denied buzz, and a full input
queue dropped rolls with a buzz but no words. Now: the roll goes
through the tier system (thock + shake + take-off sparks, landing
dust + squash on arrival); a wall thunk comes with a visible cube
bump; a wrong-face landing sparks in the beacon's own colour and
pops "Needs <colour> down" at the beacon; a locked exit clangs and
pops its lit count; queue-full says "Too fast — let the cube land
first". The HUD MOVES meter warns in stages (gold under 30% of
budget, pulsing danger for the last 2 moves) so running dry is never
a surprise. The generative music gains a soft pad harmony once two
beacons burn, on top of the arp lift. Two readability carry-overs
from earlier playtests are fixed: the cube's top face no longer
blows out to white (softer emissive + key light), and a glowing tile
marker under the cube makes its grid cell unambiguous in
perspective.

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
