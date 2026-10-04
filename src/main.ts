import './styles.css';
import { audio, type SoundName } from './audio/audio';
import type { MusicMood } from './audio/music';
import type { GamePhase } from './core/types';
import { on } from './core/events';
import { ENEMIES } from './core/enemies';
import * as sides from './core/sides';
import { TOWERS } from './core/towers';
import * as constants from './core/constants';
import { MAP_ORDER, ARCHETYPES } from './core/maps';
import { Game } from './game';
import { Controls } from './input/controls';
import { Ui } from './ui/ui';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;

function fatal(message: string, detail?: string): void {
  const body = document.getElementById('ov-body');
  const title = document.getElementById('ov-title');
  const tag = document.getElementById('ov-tag');
  const overlay = document.getElementById('overlay');
  const primary = document.getElementById('ov-primary') as HTMLButtonElement | null;
  if (title) title.textContent = 'BUILD FAILED';
  if (tag) tag.textContent = 'SOMETHING BROKE';
  if (body) body.innerHTML = `<p>${message}</p>${detail ? `<p style="opacity:.6">${detail}</p>` : ''}`;
  overlay?.classList.remove('hidden');
  if (primary) {
    primary.textContent = 'RELOAD';
    primary.onclick = () => window.location.reload();
  }
}

if (!canvas) {
  fatal('The game canvas is missing from the page.');
} else {
  boot(canvas);
}

function boot(target: HTMLCanvasElement): void {
  // Cheap WebGL probe so a dead context shows a message instead of a blank page.
  const probe = document.createElement('canvas');
  const hasGl =
    probe.getContext('webgl2') ?? probe.getContext('webgl') ?? probe.getContext('experimental-webgl');
  if (!hasGl) {
    fatal('This browser cannot start WebGL, so the 3D board cannot render.', 'Try Chrome, Edge, Firefox or Safari.');
    return;
  }

  let game: Game;
  let ui: Ui;
  let controls: Controls;

  try {
    game = new Game(target);
    ui = new Ui(game);
    controls = new Controls(target, game);
    controls.pauseToggle = () => ui.togglePause();
  } catch (error) {
    console.error(error);
    fatal('The scene failed to initialise.', String(error));
    return;
  }

  // Camera shake when the fortress takes a hit.
  on('shake', (amount) => {
    if (amount > 0) game.stage.addShake(amount);
  });

  // Sound: the bus is the only channel gameplay code uses. The context is
  // attempted at load (it lands in `suspended` unless the browser permits
  // autoplay) and then resumed on the first gesture, which is the moment
  // browsers actually allow audio.
  on('sfx', ({ name, pitch }) => audio.play(name as SoundName, pitch));
  audio.start();

  const soundHint = document.getElementById('sound-hint');
  const syncHint = () => {
    soundHint?.classList.toggle('is-hidden', audio.ready || !audio.enabled);
  };
  audio.onStateChange = syncHint;
  syncHint();

  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(ev, () => audio.unlock(), { passive: true });
  }

  // Music follows the game: calm while you build, driving while a wave runs.
  const MOOD_BY_PHASE: Record<GamePhase, MusicMood> = {
    menu: 'menu',
    building: 'building',
    wave: 'battle',
    paused: 'building',
    won: 'victory',
    lost: 'defeat',
  };
  on('phase:changed', () => audio.music.setMood(MOOD_BY_PHASE[game.phase]));
  audio.music.setMood(MOOD_BY_PHASE[game.phase]);

  const onResize = () => game.stage.resize();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // Pause automatically when the tab is hidden so you never come back to a
  // fortress that fell while you were away.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.isPlaying) ui.togglePause();
  });

  on('game:started', () => controls.setEnabled(true));

  let last = performance.now();
  let raf = 0;

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
  // Let the first frames settle, then pick a quality tier that holds 60.
  window.setTimeout(() => game.stage.autoTune(), 600);

    // Clamp so a tab switch or a long GC pause cannot teleport the horde.
    const raw = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dt = raw * game.state.speed;

    controls.update(raw);
    controls.syncCursor();

    if (game.phase === 'menu') game.idle(raw);
    else game.step(dt);

    game.stage.update(raw);
    game.stage.render();
    ui.tick();
  };

  raf = requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => cancelAnimationFrame(raf));

  // Small handle for automated smoke tests and for tuning from the console.
  (window as unknown as Record<string, unknown>)['holdTheBrick'] = {
    game,
    ui,
    controls,
    constants,
    isPathCell: constants.isPathCell,
    mapOrder: MAP_ORDER,
    mapSpecs: ARCHETYPES,
    audio,
    enemies: ENEMIES,
    towers: TOWERS,
    sides,
    stats: () => ({ ...game.state.stats, wave: game.state.wave, phase: game.phase }),
    renderInfo: () => ({ ...game.stage.renderer.info.render }),
    boundsOf: (name: string) => game.stage.boundsOf(name),
  };

  // Surface runtime errors instead of dying silently behind the canvas.
  window.addEventListener('error', (e) => {
    console.error(e.error ?? e.message);
  });
}