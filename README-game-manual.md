# Brick Siege — Player Manual

A 3D brick-built tower defense. Twenty-five waves of LEGO-ish invaders march a lane
lane toward the keep in the centre of the board. You build, merge, re-sell and re-tool
five kinds of turret to stop them. Lose the keep and the horde wins; survive wave 25 and
the siege holds.

Everything you see is generated in code — the bricks, the studs, the minions, the
projectiles and all the sound. There are no image, model or audio files.

---

## 1. The goal

Pick a side on the title screen first: **DEFENDER** or **ATTACKER**. Same six maps,
same board, opposite job.

### DEFENDER

Your fortress sits dead centre of a **14×14** stud board. Invaders enter at the spawn
gate, crawl the lane and head for your gate. Every enemy that reaches the
gate chips away at the keep. At **0 keep HP** you lose. If you survive all **25 waves**
you win. There is no timer, no lives and no second base — just bricks, board space and
the turrets you can afford.

### ATTACKER

The fortress is **already defended** before you start, and the defence never changes:
every map has a fixed, pre-placed tower layout, identical on every attempt. You cannot
build towers. Instead you spend bricks sending units in from the lane entrances to tear
that defence down and beat the keep down to **0 HP**, which wins the run.

You have **5 minutes** to do it. The clock is on the top bar next to the keep, labelled
TIME LEFT, and it turns red and starts pulsing in the last 30 seconds. Let it hit zero
with the fortress still standing and you lose — the run ends with THE FORTRESS HELD.
Pausing stops the clock, and `X` (2× speed) burns it twice as fast, so a speedrun is a
real tactic.

The fortress does not fight back on its own — only its towers do.

---

## 1b. Playing the attacker

| Step | What happens |
| --- | --- |
| 1 | Pick a creature from the palette along the bottom (or press its number key) |
| 2 | The four lane entrances light up with cyan rings |
| 3 | Tap a lit tile to send that unit in from that lane |
| 4 | Bricks drip in steadily, so you are never stranded with an empty board |
| 5 | Knock the keep from 20 HP to 0 |

**You can only deploy on the first few tiles of a lane** — the entrance zone. Dropping a
unit next to the fortress would skip the whole puzzle, so units always have to walk in
and fight through the towers.

**Siege units are your tools for cracking the defence.** ARCHER, GUNNER and LAUNCHER
stop to shoot at towers while they march, and they hit towers three times as hard on the
attacker side. Everything else is a body for the towers to shoot at.

Destroying a tower pays a bounty, more for upgraded ones, so thinning the defence out
funds the next wave of units.

Costs: SLIME 20 · SKELETON 35 · ZOMBIE 45 · ARCHER 70 · GHOST 55 · GUNNER 85 ·
DEMON 80 · LAUNCHER 110 · OVERLORD 150.

Because the defender layouts are fixed, every map is a puzzle to learn: find the lane
that is cheapest to break, open it up, then flood it.

The pre-placed towers are **MK1 only** and never upgrade on their own, so a lane you
have cleared stays cleared. Committing to one lane and breaking it properly beats
spreading thin across all four.

---

---

## 2. Controls

### Mouse / touch

| Action | How |
| --- | --- |
| Select a tower | Click it |
| **Look around the board** | **Right-drag** (or two-finger drag on touch) |
| Pan the camera | Left-drag |
| Zoom | Scroll wheel / pinch |
| Start building | Click a shop brick, then click an empty stud |
| Choose tower type | Click a shop brick, or press `1`–`8` |
| Cycle tower types | `Q` |
| Combine | Select a tower, press `C`, click a partner |
| Sell | Select a tower, press `Delete` / `Backspace`, or the SELL button |
| Cancel build / combine | `Esc` |
| Call the next wave early | `Space`, or the CALL WAVE button |
| Pause | `Esc` (when nothing is selected) or `P` |
| Toggle 2× speed | `X` |
| Open codex | `H` — tabs switch **Towers** / **Enemies** |
| Mute / unmute sound | `M` or the ♪ button |
| Restart run | The ↻ button |

### Keyboard

| Action | Key |
| --- | --- |
| Shooter / Mortar / Freezer / Coil / Sprayer | `1` `2` `3` `4` `5` |
| Sniper / Cluster / Support (defender) | `6` `7` `8` |
| Creature palette (attacker) | `1` – `9` |
| Next creature in palette | `Q` |
| Combine selected | `C` |
| Sell selected | `Delete` / `Backspace` |
| Cancel / deselect / pause | `Esc` |
| Pause | `P` |
| Call wave early | `Space` |
| Toggle 2× speed | `X` |
| Codex | `H` |
| Mute | `M` |
| Restart | `Shift`+`R` |
| Camera pan | `W` `A` `S` `D` / arrow keys |
| Camera zoom | Mouse wheel / pinch |

### Camera

Right-drag to orbit. Left-drag or `WASD` to pan. Scroll or pinch to zoom. The camera
pulls back far enough to see the whole map at once; zoom in when you want to read a
single turret's range ring.

---

## 2b. Choosing a map

The title screen offers **six maps**, and every map has a **fixed lane** that never
changes between runs, so you can learn one and plan around it.

| Map | Shape | Lane | Feel |
| --- | --- | --- | --- |
| **SPIRAL** | long inward coil | 88 cells | Longest lane; most build space to spare |
| **CROSSFIRE** | two crossing sweeps | 63 cells | Short but very open, lots of room to place |
| **SERPENT** | wide zig-zag | 82 cells | Long lane that folds back on itself |
| **RINGS** | tight concentric loops | 93 cells | Longest lane, tightest corners |
| **MAZE** | switchback corridors | 76 cells | Dense zig-zags, strong Mortar country |
| **FOUR PATHS** | four-armed cross | 4 × 14 cells | Four lanes feed one keep; pick your axis |

FOUR PATHS is the only map with more than one lane: invaders arrive from the north,
east, south and west, and the four arms are identical, so it plays fair. As the
defender you must cover four approaches; as the attacker you choose which arm to feed.

Pick a map and a side before you press BUILD FORTRESS (defender) or START ASSAULT
(attacker). The dark slate blocks in each preview are the lane, the red block in the
middle is your fortress, and the cyan blocks mark every entrance. The lane can enter from any of the four sides. The N/S/E/W labels sit
in the margin so a preview can never be read the wrong way up.

---

## 2c. Background themes

The scenery **around** the baseplate is themeable. Pick one on the title screen; it
saves and applies instantly, including mid-run.

| Theme | Look | Landmarks | Ground |
| --- | --- | --- | --- |
| **FOREST** | Blue sky, pale grass | **232 props**: 130 broadleaf trees, 52 pines, 36 undergrowth clumps, 12 fallen logs, a cut stump, a mossy boulder | 80 grass tufts |
| **DESERT** | Warm sand sky | **124 props**: 96 cacti, 18 palms, 8 obelisks, a stepped **pyramid**, a **sphinx** | 74 sand ripples |
| **ARCTIC** | Cold white sky | **140 props**: 108 frosted pines, 26 ice spires, two **icebergs**, **three polar bears**, an **igloo** | 74 snow drifts |
| **VOLCANO** | Dark ash sky | **131 props**: 100 charred trunks, 30 obsidian shards, a **volcano** with a glowing crater | 64 glowing lava cracks + 4 lava pools |

Every theme scatters its scenery in loose clumps rather than on even rings, so the
landscape grows in groves with natural clearings between them instead of reading as
concentric circles around the plate. It still reaches every direction — roughly 8 of 8
compass sectors, out to about 33 tiles past the plate — so the plate sits *inside* the
landscape. Forest is the densest by design (232 props, 182 of them trees) — it is meant
to feel wooded in. The volcano's crater, lava spill and lava pool are emissive, so they
actually glow.

Props are stamped in bulk and merged per material, so the extra density costs a couple
of draw calls rather than hundreds.

A theme only restyles the terrain, sky, fog, props and ground cover. The baseplate, the
lane and the fortress never change, so a theme cannot alter how a map plays. All scenery
sits outside the baseplate: nothing standing rises within the plate edge, and the flat
ground cover tucks just under the plate lip where it is never visible.

**Beyond the scatter:** each theme also builds two rings of distant ridges (about
46 and 66 tiles out) and a far backdrop wall, all recoloured to match. That keeps the
world from visibly ending at the edge of the tree line when you tilt the camera down,
without adding geometry to the shadow pass or meaningfully costing draw calls.

---

## 3. The loop

This is the defender loop. As the attacker there is no clock and no wave: arm a
creature, tap a lane entrance, and watch the keep lose HP.

1. **Build phase.** The clock reads BUILD PHASE. Spend bricks placing turrets on any
   stud that is not lane and not the keep.
2. **Wave.** Press `Space` (or CALL WAVE) to release the horde early, or let the timer
   run out. Enemies stream in and your turrets open fire.
3. **Resolve.** Kills pay bricks. Anything that reaches the gate damages the keep.
4. **Repeat.** Clear the wave to return to build phase and spend your earnings.

Each wave is tougher: enemy health grows about **8.5% per wave** and creeps slightly
faster (speed gain is capped so nothing outruns the lane). By wave 20 the Overlord shows
up — a single 1500-HP brick that takes **10** from the keep if it gets through.

---

## 4. Bricks (economy)

- You start every run with **260 bricks**.
- Every kill pays out (values in the codex). Clearing a wave pays a bonus.
- Calling a wave early pays **+3 bricks per second** of build time you skip. Skipping a
  full 18-second clock is a fat payout — rush waves when your defence is ready.
- **Selling** a tower refunds **60%** of everything invested in it. Selling is your main
  way to re-tool mid-run, so do not be sentimental about a turret in the wrong spot.
- **Cost scaling:** every tower you place makes the next one slightly dearer (+9%,
  capped at ×1.6 by the end). A greedy "fill every stud" board is punished; a focused
  board is cheaper.

**As the attacker** the economy is different: you start with **160 bricks** and earn
only **5 bricks per second**. That trickle is just enough to keep deploying; it will
not fund an army. There is no wave bonus and no early-call payout, because there are no
waves to call. **Killing towers is the attacker's real income** — a bounty of **45
bricks**, or **70** for an upgraded one — so every tower you break pays for the next
push. The clock and the income both start the moment you press START ASSAULT — reading
the menu is free.

---

## 5. Combining

Two **same-type, same-tier** towers can merge into the next tier (tier 1 + 1 → tier 2,
2 + 2 → tier 3). You need:

- The same tower type,
- The same tier level,
- A partner within **Manhattan distance 3** (roughly a short hop on the board),
- `C` to arm the combine, then click the partner.

A merged tower is worth roughly **1.7×** a tier 1 — so combining is about efficiency and
board space, not a giant damage spike. Tier 3 is the cap. Combine early to hit tier 3
sooner; spread out too much and you can strand two lonely tier 1s.

---

## 6. The eight turrets

| # | Tower | Element | Cost | Role |
| --- | --- | --- | --- | --- |
| 1 | **Brick Shooter** | Physical | 60 | Rapid single-target blip. Cheap, steady, the backbone of any wall. |
| 2 | **Mortar** | Physical | 110 | Lobs a shell that bursts in a splash. Slow reload, hits crowds. |
| 3 | **Freezer** | Ice | 95 | Chills and slows. Low damage, enormous crowd control. |
| 4 | **Tesla Coil** | Lightning | 130 | Instant arcs that jump to 1–3 nearby enemies. No travel time. |
| 5 | **Sprayer** | Poison | 100 | Sprays toxic paint that damages over time. Stacks and melts tanks. |
| 6 | **Long Shot** | Physical | 95 | Range 6.4 and a 44-damage hit, but a 2.3s reload. Picks off tanks from across the map. |
| 7 | **Cluster** | Ice | 85 | Short-range scatter with a 1.3-tile splash that also chills. Weak alone, lethal in a pack. |
| 8 | **Beacon** | Support | 70 | **Deals no damage.** Projects a field: nearby towers hit ~18% harder and fire ~12% faster. |

Tiers raise range, damage and special effects. Mortar tier 3 fires a double shell; Tesla
coil tier 3 chains to three targets; freezer tier 3 slows by 55%.

**Beacon tips:** the aura is a visible circle on the ground and covers about 2.6 tiles
at MK1, 3.4 at MKIII. Buffs stack additively on damage (capped at +80%) and multiply
on fire rate (floored at 40% of base). Two beacons covering the same cluster beat one
beacon covering half of it, but spreading them thin wastes the bonus.

**Targeting:** turrets always fire the enemy **furthest along the lane** that is in
range — the one closest to your gate.

---

## 7. Enemies, resistances & tower siege

### Enemies that shoot at your towers

Three enemy types ignore your fortress and open fire on your **towers** instead. Towers
are no longer indestructible: every tower has a **HULL**, shown in the inspector when
you select it, and a tower at 0 hull is destroyed and its cell becomes empty.

| Attacker | From wave | Range | Damage | Rate | Blast | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **BOW BRICK** | 9 | 3.4 studs | 5 | 1.50s | — | Single arrow, steady poke |
| **GUN BRICK** | 13 | 4.2 studs | 4 | 0.55s | — | Fast weak rounds, never stops |
| **ROCKET BRICK** | 17 | 6.0 studs | 26 | 3.20s | 1.5 studs | Splash: deletes tower clusters |

Tower hull by tier: Shooter 100 / 165, Mortar 85 / 136, Freezer 110 / 176, Coil 80 / 128,
Sprayer 95 / 152 (tier 1 / tier 3). Tier 3 towers are far tougher, so a finished
combined tower is a safe place to build behind.

**What to do about it:**
- Kill the shooter first. An attacker that dies stops shooting instantly.
- Rocket Brick splash hits everything nearby, so keep towers spaced or bury them behind
  tier 3 hull.
- Select a tower to read its HULL. A damaged tower is one wrong wave from gone.
- Gun Bricks are the most dangerous in numbers because their rate never drops, even
  though each shot is weak.

### Resistances

Damage is multiplied by the target's resistance to the element you hit it with. **×2 is
double damage, ×0.5 is half, ×0 is immune.**

Damage is multiplied by the target's resistance. Full table:

| Enemy | From wave | HP | Speed | Leak dmg | Physical | Ice | Lightning | Poison |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Stud Slime** | 1 | 42 | 1.05 | 1 | ×0.35 | **×1.7** | ×1.6 | ×1.0 |
| **Bone Builder** | 2 | 34 | 1.55 | 1 | **×1.8** | ×0.6 | ×1.0 | **×0** |
| **Crumble Zombie** | 5 | 98 | 0.72 | 2 | ×0.45 | **×2.0** | ×0.9 | **×0** |
| **Ghost Brick** | 7 | 58 | 1.38 | 1 | **×0** | ×1.1 | ×1.3 | ×1.0 |
| **Brick Demon** | 10 | 215 | 0.62 | 3 | ×0.55 | **×2.0** | ×1.2 | ×0.9 |
| **The Overlord** | 20 | 1500 | 0.48 | **10** | ×0.6 | ×1.6 | ×1.1 | ×0.9 |

The two hard rules that catch new players:

- **A single-element board loses.** Physical-only cannot touch ghosts (×0). Poison-only
  cannot touch skeletons or zombies (×0). You must mix elements.
- **Ice is your answer to tanky physical** (zombies and demons take double frost) while
  **physical crushes skeletons**. No one element wins alone.

Press `H` in game for the always-current codex. Two tabs: **Towers** shows all
eight turrets with stats and the Beacon aura, **Enemies** lists the nine invaders.

---

## 8. Strategy tips

- **Mix two or three elements early.** A ring of shooters alone will get shredded by
  ghosts the moment they unlock (wave 7).
- **Spray the bends.** Lanes funnel enemies into long stretches; a Mortar or Tesla
  Coil placed inside a curve covers several cells at once.
- **Freeze the fast ones.** Skeletons and ghosts are quick; an ice turret in front of
  your damage buys your shooters the time they need.
- **Call waves early for the brick bonus** once your core is online, not before.
- **Sell and re-place freely** — 60% refund means a mis-placed turret is a temporary
  mistake, not a permanent one.
- **Save your combines for tier 3.** Two tier 2s into a tier 3 pays off far more than
  two separate tier 2s.

---

## 9. Audio

All sound is synthesised live in the browser with the Web Audio API — there are no audio
files. Each turret has its own report (shooter blip, mortar thump, freezer chime, coil
zap, sprayer hiss), plus build/sell/merge clacks, kill pops, a fortress-hit alarm, wave
horns and win/lose stingers.

- **Sound on open.** The game tries to start audio the moment the page loads. Browsers
  block audio until you have interacted with a page, so in most browsers the first click
  or keypress is what actually unlocks it — the menu shows a pulsing
  *"CLICK ANYWHERE TO ENABLE SOUND"* hint until then, and it disappears the instant sound
  is live. Where autoplay *is* permitted (you have interacted with the site before, or
  your browser setting allows it) you hear sound immediately with no click.
- **M / ♪ button** toggles sound.
- **Volume** is fixed at a comfortable 70% out of the box.
- Combat audio is throttled and voice-limited so a full board stays musical, not a click
  storm.

### Background music

Music is generated the same way — no audio files. It follows what you are doing, and
changes on the next bar so the loop never breaks mid-phrase.

| Mood | When | Feel |
| --- | --- | --- |
| **Menu** | Title screen / map picker | Slow, sparse, mostly pad |
| **Building** | Build phase and pause | Steady pulse, same key |
| **Battle** | During a wave | Faster tempo, driving bass |
| **Victory** | You win | Bright major lift |
| **Defeat** | Fortress falls | Sinking minor fall |

The music is deliberately mixed low under the sound effects, and **M / ♪ mutes both**
at once. Muting fades out over about a fifth of a second rather than cutting, so
unmuting mid-wave is not jarring.

---

## 10. FAQ

**Can I move a tower?** No — towers are fixed once placed. Sell it (60% back) and rebuild
it where you want it.

**Why can't I build there?** That stud is lane, keep, or already occupied. Green studs
are buildable; red ones are not.

**Why won't my two turrets combine?** They must be the same type *and* the same tier, and
within Manhattan distance 3.

**Do I need a mortar-only / poison-only defence?** No — single-element boards provably
lose. Mix elements.

**I ran out of bricks.** Sell something, or kill more. Selling refunds 60%.

**My 2× speed button shows "2×" but nothing is faster.** Speed only matters while a wave
is running.

**Where do the enemies come from / go?** The spawn gate at the board edge, along the
in along the map lane, into the keep's gate.

---

*Build target: any static host. No server, no network calls, no accounts. Open
`index.html` from a built `dist/` folder or any static host and play.*