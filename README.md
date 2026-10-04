# Brick Siege

A real-3D LEGO tower defence game for the browser, built with **Vite + TypeScript + Three.js**.

The visual language comes from my [portfolio](https://phyothant-dev.github.io/portfolio/) — LEGO
colours, hard black borders, offset drop shadows and chunky monospace UI.

**Every model, material and animation in this game is generated from code.** There are no imported
meshes, no texture files and no generative AI art. The baseplate studs are a single instanced mesh;
the towers, enemies, fortress and FX are all built from procedural geometry. Sound effects *and*
background music are synthesised at runtime with the Web Audio API, so there are no audio files
either. The score changes with the game: a sparse menu theme, a steady build-phase pulse, a
driving battle theme, and a lift or fall when the run ends.

**New to the game? Read the [full player manual](README-game-manual.md)** — rules, the five turrets,
the resistance table, economy, combining, and strategy.

---

## Features

- **A 14×14 stud board** with the keep dead centre and an inward-spiralling lane: the horde enters at
  the south-west corner and winds east, north, west, south, tightening one buildable gutter per
  revolution until it reaches the gate.
- **5 tower types** — Brick Shooter, Mortar, Freezer, Tesla Coil, Sprayer, each with a distinct role.
- **Combining instead of upgrading** — drag two matching towers of the same tier together to merge
  them into a stronger tier. Three tiers maximum, so positioning matters more than spamming one tower.
- **6 enemy types with an elemental resistance matrix** — Ghosts are completely immune to physical
  damage, Skeletons are immune to poison, Demons and the Overlord take double from ice. A
  single-element board *will* lose. You are expected to swap bricks mid-run.
- **25 hand-tuned waves** ending in a boss.
- **Full economy** — kill rewards, wave rewards, early-call bonuses, and a 60% sell refund.
- **Camera** — free orbit, pinch/scroll zoom and WASD panning.
- **Pause, 2× speed, codex, victory and defeat screens.**
- Mouse, keyboard and touch support.

## Controls

| Action | Input |
| --- | --- |
| Select tower to build | `1` `2` `3` `4` `5` |
| Build at cell | Left click |
| Select existing tower | Left click with nothing armed |
| Combine towers | `C`, or the **COMBINE** button, then click the partner |
| Sell selected tower (60% refund) | `Delete` / `Backspace` |
| Cycle tower type | `Q` |
| Pan camera | `W` `A` `S` `D` / arrow keys / middle-drag / left-drag |
| Orbit camera | Right-drag |
| Zoom | Mouse wheel / pinch |
| Call next wave early | `Space` |
| Pause | `Esc` or `P` |
| Toggle 2× speed | `X` |
| Enemy codex | `H` |
| Mute / unmute sound | `M`, or the ♪ button |
| Restart | `Shift` + `R` |
| Cancel / close | `Esc` |

## Getting started

```bash
npm install
npm run dev      # local dev server
```

```bash
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build locally
npm run typecheck
```

`npm run build` runs `tsc --noEmit` first, so a type error fails the build rather than shipping.

## Deploying

The build is fully static and `vite.config.ts` uses `base: './'`, so the output in `dist/` works from
any subpath without further configuration.

**GitHub Pages** — deploys automatically. Pushing to `main` runs
`.github/workflows/deploy.yml`, which builds and publishes `dist/` to Pages.

```bash
git push          # builds and redeploys automatically
```

To change the hosting setup, enable Pages with **Settings → Pages → Source: GitHub Actions**.

**itch.io** — run `npm run build`, then zip the **contents** of `dist/` (not the folder itself) and
upload it as an HTML5 project.

## Project structure

```
src/
  core/        pure game data and rules, no Three.js imports
    constants.ts   grid, lane generator, LEGO dimensions, palette, economy tuning
    enemies.ts     enemy stats and the resistance matrix
    towers.ts      tower stats per tier
    waves.ts       the 25-wave campaign
    state.ts       towers, combining, economy, fortress health
  logic/
    combat.ts      targeting, projectiles, splash, riders, chain lightning
  scene/        all Three.js rendering
    builder.ts     procedural brick/plate/slope geometry helpers
    materials.ts   shared LEGO plastic material cache
    board.ts       baseplate, lane, spawn gate, fortress, scenery
    towerView.ts   procedural tower models
    enemyView.ts   procedural enemy models
    fx.ts          pooled projectiles, particles, impact rings, lightning
  ui/ui.ts     HUD, shop, inspector, codex, overlays
  input/       keyboard, mouse, touch, camera
  game.ts      simulation orchestration
  main.ts      bootstrap and render loop
```

`src/core` deliberately has no renderer dependency, so the rules can be reasoned about — and tested —
without booting a scene.

The lane is *generated*, not hand-drawn: `constants.ts` winds an inward rectangular spiral that always
stops at the keep's gate, whatever `GRID` is set to, and throws at boot if the result is not a single
connected run of cells that never touches the keep. Changing the board size therefore cannot silently
produce an unwalkable or unreachable layout.

## Performance

The baseplate's 12,544 studs are drawn as a single `InstancedMesh`, and the lane itself is painted by
tinting those studs rather than by adding road geometry. A full board renders in roughly 370 draw
calls and ~1.1M triangles, which is comfortable for any desktop GPU.

## Licence

Code is mine; LEGO is a trademark of the LEGO Group, which does not sponsor or endorse this project.
It is a fan-made homage.