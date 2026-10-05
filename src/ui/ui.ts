import { audio } from '../audio/audio';
import { ELEMENTS } from '../core/types';
import {
  ARCHETYPES,
  COMBINE_RANGE,
  GRID,
  ELEMENT_LABEL,
  FORTRESS_CELLS,
  MAP_ORDER,
  SELL_REFUND,
  currentMap,
} from '../core/constants';
import { generateLayout } from '../core/maps';
import type { Layout, MapId } from '../core/maps';
import { ENEMIES, UNLOCK_WAVE, resistanceLabel } from '../core/enemies';
import { on, sfx } from '../core/events';
import { MAX_TIER, TOWER_ORDER, TOWERS, tierSpec, towerDps } from '../core/towers';
import type { ElementId, EnemyId, TowerId } from '../core/types';
import { TOTAL_WAVES } from '../core/waves';
import {
  ATTACKER_COST,
  ATTACKER_ORDER,
  SIDE_CTA,
  SIDE_INFO,
  SIDES,
  type Side,
} from '../core/sides';
import type { Game } from '../game';
import { ENEMY_ICONS, TOWER_ICONS } from './icons';
import { THEMES, THEME_ORDER } from '../scene/themes';
import type { ThemeId } from '../scene/themes';

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

/**
 * All DOM: status bar, build palette, tower inspector, toasts, codex and the
 * start/pause/end overlays. Reads game state, never mutates it directly.
 */
export class Ui {
  private game: Game;

  private goldEl = $('stat-gold');
  private waveEl = $('stat-wave');
  private hpEl = $('stat-hp');
  private hpFill = $('stat-hp-fill');
  private threatEl = $('stat-threat');

  private speedBtn = $<HTMLButtonElement>('btn-speed');
  private pauseBtn = $<HTMLButtonElement>('btn-pause');
  private soundBtn = $<HTMLButtonElement>('btn-sound');
  private mapGrid = $('map-grid');
  private mapBlurb = $('map-blurb');

  private shopBar = $('shop-bar');
  private buildButtons = new Map<TowerId, HTMLButtonElement>();
  private waveBtn = $<HTMLButtonElement>('btn-start-wave');
  private waveLabel = $('wave-btn-label');
  private waveTimer = $('wave-timer');

  private inspector = $('inspector');
  private inspName = $('insp-name');
  private inspTier = $('insp-tier');
  private inspStats = $('insp-stats');
  private inspElem = $('insp-elem');
  private combineBtn = $<HTMLButtonElement>('btn-combine');
  private sellBtn = $<HTMLButtonElement>('btn-sell');

  private toasts = $('toasts');
  private overlay = $('overlay');
  private overlayBox = document.querySelector<HTMLElement>('.overlay__box')!;
  private ovTitle = $('ov-title');
  private ovTag = $('ov-tag');
  private ovBody = $('ov-body');
  private ovPrimary = $<HTMLButtonElement>('ov-primary');

  private ovMenu = $<HTMLButtonElement>('ov-menu');
  private codex = $('codex');
  private codexBody = $('codex-body');
  private codexEnemies = $('codex-enemies');

  private overlayMode: 'intro' | 'menu' | 'paused' | 'won' | 'lost' = 'intro';
  private lastThreat = '';

  constructor(game: Game) {
    this.game = game;
    this.buildShop();
    this.buildCodex();
    this.buildEnemyCodex();
    this.buildSidePicker();
    this.buildAttackPalette();
    this.buildThemePicker();
    this.refreshSideUi();
    this.wireButtons();
    this.wireEvents();

    this.showOverlay('intro');
    this.refreshHud();
  }

  // ----------------------------------------------------------------- wiring

  private buildShop(): void {
    for (const btn of Array.from(this.shopBar.querySelectorAll<HTMLButtonElement>('.build-btn[data-tower]'))) {
      const type = btn.dataset['tower'] as TowerId;
      this.buildButtons.set(type, btn);

      const icon = btn.querySelector<HTMLElement>('.build-btn__icon');
      if (icon) icon.innerHTML = TOWER_ICONS[type];

      btn.addEventListener('click', () => {
        this.game.armPlacing(this.game.placing === type ? null : type);
      });
    }
    this.refreshShop();
  }

  /** Side picker: DEFENDER / ATTACKER, mirroring the theme picker. */
  private buildSidePicker(): void {
    const row = $('side-row');
    row.innerHTML = SIDES.map((id) => {
      const info = SIDE_INFO[id];
      return `<button class="side-btn" data-side="${id}" title="${info.blurb}">
          <span class="side-btn__name">${info.name}</span>
        </button>`;
    }).join('');

    row.querySelectorAll<HTMLButtonElement>('button[data-side]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.setSide(btn.dataset['side'] as Side);
        this.refreshSidePicker();
        this.refreshSideUi();
      });
    });
    this.refreshSidePicker();
  }

  private refreshSidePicker(): void {
    const cur = this.game.side;
    $('side-row')
      .querySelectorAll<HTMLButtonElement>('button[data-side]')
      .forEach((btn) => btn.classList.toggle('is-active', btn.dataset['side'] === cur));
    const blurb = $('side-blurb');
    if (blurb) blurb.textContent = SIDE_INFO[cur].blurb;
  }

  /** Attacker unit palette. Replaces the tower shop while attacking. */
  private buildAttackPalette(): void {
    const row = $('attack-row');
    row.innerHTML = ATTACKER_ORDER.map((id) => {
      const spec = ENEMIES[id];
      return `<button class="build-btn" data-unit="${id}" title="${spec.name}">
          <span class="build-btn__key">${ATTACKER_ORDER.indexOf(id) + 1}</span>
          <span class="build-btn__icon" data-icon="${id}"></span>
          <span class="build-btn__name">${spec.name}</span>
          <span class="build-btn__meta"><em>HP ${spec.hp}</em><b class="cost">${ATTACKER_COST[id]}</b></span>
        </button>`;
    }).join('');

    row.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
      const id = el.dataset.icon as EnemyId;
      el.innerHTML = ENEMY_ICONS[id] ?? '';
    });

    row.querySelectorAll<HTMLButtonElement>('button[data-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset['unit'] as EnemyId;
        this.game.armDeploying(id);
        this.refreshAttackPalette();
      });
    });
    this.refreshAttackPalette();
  }

  private refreshAttackPalette(): void {
    $('attack-row')
      .querySelectorAll<HTMLButtonElement>('button[data-unit]')
      .forEach((btn) => {
        const id = btn.dataset['unit'] as EnemyId;
        const armed = this.game.deploying === id;
        btn.classList.toggle('is-active', armed);
        const poor = this.game.state.gold < ATTACKER_COST[id];
        btn.classList.toggle('is-poor', poor);
        btn.disabled = false;
      });
    const hint = $('attack-hint');
    if (hint) {
      hint.textContent = this.game.deploying
        ? `TAP A LANE TILE TO DEPLOY ${ENEMIES[this.game.deploying].name}`
        : 'PICK A UNIT, THEN TAP A LANE TILE';
    }
  }

  /** Swap the tower shop for the unit palette, and relabel the HUD. */
  refreshSideUi(): void {
    const attacking = this.game.side === 'attacker';
    this.shopBar.classList.toggle('is-hidden', attacking);
    $('attack-bar')?.classList.toggle('is-hidden', !attacking);
    document.body.dataset['side'] = this.game.side;

    // Both sides get a visible clock: the defender counts to the next wave, the
    // attacker counts down its own assault.
    const threatLabel = this.threatEl.previousElementSibling as HTMLElement | null;
    if (threatLabel) threatLabel.textContent = attacking ? 'TIME LEFT' : 'NEXT WAVE';
    const waveLabel = this.waveEl.previousElementSibling as HTMLElement | null;
    if (waveLabel) waveLabel.textContent = attacking ? 'ASSAULT' : 'WAVE';
    if (this.overlayMode === 'menu') this.ovPrimary.textContent = SIDE_CTA[this.game.side];

    this.refreshAttackPalette();
    this.refreshHud();
  }

  private buildCodex(): void {
    const towerCards = TOWER_ORDER.map((id) => {
      const spec = TOWERS[id];
      const t1 = spec.tiers[0];
      const t3 = spec.tiers[spec.tiers.length - 1];
      const hex = spec.accent.toString(16).padStart(6, '0');
      const support = id === 'support';
      const lines = support
        ? `<p>Neighbours take <b>+${Math.round(t1.buffDamage * 100)}%</b> damage and fire
             <b>${Math.round(t1.buffHaste * 100)}%</b> faster (MKIII
             +${Math.round(t3.buffDamage * 100)}% / ${Math.round(t3.buffHaste * 100)}%).
             Radius ${t1.buffRadius} studs.</p>`
        : `<p>RNG <b>${t1.range}</b> &middot; DMG <b>${t1.damage}</b> &middot;
             EVERY <b>${t1.cooldown}s</b>${
               t1.splash ? ` &middot; SPLASH <b>${t1.splash}</b>` : ''
             }${t1.slow ? ` &middot; SLOW <b>${Math.round(t1.slow * 100)}%</b>` : ''}${
               t1.poisonDps ? ` &middot; POISON <b>${t1.poisonDps}/s</b>` : ''
             }${t1.chain ? ` &middot; CHAIN <b>${t1.chain}</b>` : ''}</p>
           <p style="margin-top:4px;color:rgba(255,255,255,.4)">
             MKIII: RNG ${t3.range} &middot; DMG ${t3.damage} &middot; EVERY ${t3.cooldown}s
           </p>`;
      return `<div class="codex-card" style="border-left-color:#${hex}">
          <div class="codex-card__head">
            <span class="codex-card__icon">${TOWER_ICONS[id]}</span>
            <h4>${spec.name}</h4>
          </div>
          <p>${spec.blurb}</p>
          ${lines}
          <p style="margin-top:6px;color:rgba(255,255,255,.45)">
            COST <b>${spec.cost}</b> &middot; KEY <b>${spec.hotkey}</b> &middot;
            ${support ? 'SUPPORT' : ELEMENT_LABEL[spec.element]}
          </p>
        </div>`;
    }).join('');

    this.codexBody.innerHTML = `
      <p>Towers only reach MKII and MKIII by <b>combining two matching ones</b>.
         Each tier costs more but hits harder, so combine rather than sprawl.</p>
      <div class="codex-grid">${towerCards}</div>`;

    // Tab switching between the tower manual and the enemy chart.
    const tabs = document.querySelectorAll<HTMLButtonElement>('.codex-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const towers = tab.dataset['tab'] === 'towers';
        tabs.forEach((t) => t.classList.toggle('is-active', t === tab));
        this.codexBody.classList.toggle('is-hidden', !towers);
        this.codexEnemies.classList.toggle('is-hidden', towers);
      });
    });
  }

  private buildEnemyCodex(): void {
    const cards = Object.values(ENEMIES)
      .map((spec) => {
        const chips = ELEMENTS.map((el) => {
          const { text, cls } = resistanceLabel(spec.resistance[el]);
          return `<span class="codex-chip ${cls}">${ELEMENT_LABEL[el]} ${text}</span>`;
        }).join('');
        const hex = spec.color.toString(16).padStart(6, '0');
        const icon = ENEMY_ICONS[spec.id] ?? '';
        return `<div class="codex-card" style="border-left-color:#${hex}">
            <div class="codex-card__head">
              <span class="codex-card__icon">${icon}</span>
              <h4>${spec.name}</h4>
            </div>
            <p>${spec.blurb}</p>
            <div class="codex-res">${chips}</div>
            <p style="margin-top:6px;color:rgba(255,255,255,.45)">
              HP ${spec.hp} &middot; SPEED ${spec.speed.toFixed(2)} &middot; BOUNTY ${spec.reward}
              &middot; LEAK ${spec.leak}
              ${UNLOCK_WAVE[spec.id] <= TOTAL_WAVES ? `&middot; FROM WAVE ${UNLOCK_WAVE[spec.id]}` : ''}
            </p>
          </div>`;
      })
      .join('');

    this.codexEnemies.innerHTML = `
      <p>No single element wins everything. Read the chart and swap bricks between waves.</p>
      <div class="codex-grid">${cards}</div>
      <div class="codex-note">
        <strong>COMBINING:</strong> select a tower, press <strong>COMBINE</strong>, then click another
        tower of the same type and tier within ${COMBINE_RANGE} studs. The pair collapses into one
        higher-tier tower. Tier ${MAX_TIER} is the ceiling.<br>
        <strong>SELLING:</strong> refunds ${Math.round(SELL_REFUND * 100)}% of everything poured into it.<br>
        <strong>EARLY CALL:</strong> start a wave before the timer ends to bank bonus bricks.
      </div>`;
  }

  private wireButtons(): void {
    // Every brick button gets a click, so UI feedback is consistent.
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.brick-btn, .build-btn')) {
      btn.addEventListener('click', () => sfx('click'));
    }

    this.speedBtn.addEventListener('click', () => {
      const next = this.game.state.speed === 1 ? 2 : 1;
      this.game.setSpeed(next);
      this.speedBtn.textContent = `${next}\u00d7`;
      this.speedBtn.classList.toggle('is-on', next > 1);
    });

    this.pauseBtn.addEventListener('click', () => this.togglePause());
    const hudToggle = document.getElementById('hud-toggle');
    hudToggle?.addEventListener('click', () => {
      document.body.classList.toggle('hud-hidden');
    });


    this.mapGrid?.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.map-card');
      const id = card?.dataset.map as MapId | undefined;
      if (!id) return;
      this.pickMap(id);
    });
    $('btn-sound').addEventListener('click', () => {
      const on = audio.toggle();
      this.soundBtn.classList.toggle('is-off', !on);
    });

    $('btn-restart').addEventListener('click', () => {
      this.game.restart();
      this.showOverlay(null);
    });

    $('btn-codex').addEventListener('click', () => this.codex.classList.toggle('hidden'));
    $('codex-close').addEventListener('click', () => this.codex.classList.add('hidden'));

    $('insp-close').addEventListener('click', () => this.game.select(null));
    this.combineBtn.addEventListener('click', () => this.game.startCombining());
    this.sellBtn.addEventListener('click', () => this.game.sellSelected());

    this.waveBtn.addEventListener('click', () => {
      if (this.game.phase === 'building') this.game.callWaveEarly();
    });

    // Back to the main screen: only escape hatch for changing map or side.
    this.ovMenu.addEventListener('click', () => {
      sfx('click');
      // Restart first so the menu always shows a fresh, unstarted board rather
      // than a half-finished run.
      this.game.restart();
      this.showOverlay('intro');
    });

    this.ovPrimary.addEventListener('click', () => {
      if (this.overlayMode === 'menu') {
        this.game.begin();
        this.showOverlay(null);
      } else if (this.overlayMode === 'paused') {
        this.game.setPaused(false);
        this.showOverlay(null);
      } else {
        this.game.restart();
        this.showOverlay(null);
      }
    });

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay && this.overlayMode === 'paused') {
        this.game.setPaused(false);
        this.showOverlay(null);
      }
    });
  }

  private wireEvents(): void {
    on('hud:changed', () => this.refreshHud());
    on('selection:changed', () => this.refreshInspector());
    on('placing:changed', () => {
      this.refreshShop();
      this.refreshInspector();
    });
    on('side:changed', () => {
      this.refreshSideUi();
      this.refreshHud();
    });

    on('phase:changed', () => {
      this.refreshHud();
      if (this.game.phase === 'paused') this.showOverlay('paused');
    });
    on('toast', (payload) => this.pushToast(payload.text, payload.tone));
    on('game:over', ({ won }) => this.showOverlay(won ? 'won' : 'lost'));
  }

  /** Switch map and regenerate its lane, then redraw the cards. */
  private pickMap(id: MapId): void {
    this.game.chooseMap(id);
    this.refreshMapCards();
  }

  /**
   * Build the background theme buttons. Themes only restyle the scenery around
   * the baseplate, so switching one mid-run is safe and instant.
   */
  private buildThemePicker(): void {
    const row = $('theme-row');
    const blurb = $('theme-blurb');
    row.innerHTML = THEME_ORDER.map((id) => {
      const t = THEMES[id];
      const sky = `#${t.sky.toString(16).padStart(6, '0')}`;
      const grd = `#${t.ground.toString(16).padStart(6, '0')}`;
      return `<button class="theme-btn" data-theme="${id}" title="${t.blurb}">
          <span class="theme-btn__swatch" style="background:linear-gradient(135deg,${sky} 50%,${grd} 50%)"></span>
          <span>${t.name}</span>
        </button>`;
    }).join('');

    row.querySelectorAll<HTMLButtonElement>('button[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.game.applyTheme(btn.dataset.theme as ThemeId);
        this.refreshThemePicker();
      });
    });
    this.refreshThemePicker();
    if (blurb) blurb.textContent = THEMES[this.game.theme].blurb;
  }

  private refreshThemePicker(): void {
    const cur = this.game.theme;
    $('theme-row')
      .querySelectorAll<HTMLButtonElement>('button[data-theme]')
      .forEach((b) => b.classList.toggle('is-active', b.dataset.theme === cur));
    const blurb = $('theme-blurb');
    if (blurb) blurb.textContent = THEMES[cur].blurb;
  }

  /**
   * Redraw the five map cards. Each thumbnail is drawn straight from the
   * generated lane, so the preview is the real map rather than a stock icon.
   */
  private refreshMapCards(): void {
    if (!this.mapGrid) return;
    this.mapGrid.innerHTML = '';

    // Read the live map rather than a mirrored field, so the highlight cannot
    // drift from what is actually on the board.
    const activeId = currentMap().id;

    for (const id of MAP_ORDER) {
      const spec = ARCHETYPES[id];
      const card = document.createElement('button');
      card.className = 'map-card' + (id === activeId ? ' is-active' : '');
      card.dataset.map = id;
      card.title = spec.blurb;

      const mini = document.createElement('canvas');
      mini.className = 'map-card__mini';
      mini.width = GRID;
      mini.height = GRID;
      this.drawMapThumb(mini, id);
      card.appendChild(mini);
      card.appendChild(document.createTextNode(spec.name));

      this.mapGrid.appendChild(card);
    }

    const active = ARCHETYPES[activeId];
    if (this.mapBlurb) this.mapBlurb.textContent = active.blurb;
  }

  /**
   * Draw a GRID x GRID top-down preview of a map type's lane.
   *
   * This calls the pure generator directly rather than `setMap`, so drawing a
   * thumbnail can never disturb the live layout the board was built from.
   */
  private drawMapThumb(canvas: HTMLCanvasElement, id: MapId): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let layout: Layout;
    try {
      // Each card must use its OWN seed. Using the active map's seed drew four
      // of the five previews with the wrong lane, so they visibly changed the
      // moment the player selected that map.
      layout = generateLayout(id, ARCHETYPES[id].seed, GRID, FORTRESS_CELLS);
    } catch {
      return;
    }

    // Fixed high resolution, scaled down by CSS. Avoids depending on layout
    // being ready, which is not guaranteed when the menu first renders.
    const w = GRID * 14;
    const h = GRID * 14;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.imageSmoothingEnabled = false;

    // The play area is inset so the compass labels live in a margin and can
    // never be drawn on top of a lane tile.
    const pad = Math.round(Math.min(w, h) * 0.11);
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    const u = iw / GRID;

    // Base ground: light, like a real baseplate.
    ctx.fillStyle = '#eceae4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a3730';
    ctx.fillRect(pad, pad, iw, ih);

    // Lane: dark slate blocks, deliberately high contrast against the light
    // ground so the route is obvious at a glance.
    for (const [gx, gy] of layout.cells) {
      ctx.fillStyle = '#3f4650';
      ctx.fillRect(pad + gx * u, pad + gy * u, u, u);
    }
    // Dark outline separates neighbouring blocks into readable tiles.
    ctx.fillStyle = '#1d2126';
    for (const [gx, gy] of layout.cells) {
      const x0 = Math.round(pad + gx * u);
      const y0 = Math.round(pad + gy * u);
      const x1 = Math.round(pad + (gx + 1) * u);
      const y1 = Math.round(pad + (gy + 1) * u);
      ctx.fillRect(x0, y0, x1 - x0, 1);
      ctx.fillRect(x0, y1 - 1, x1 - x0, 1);
      ctx.fillRect(x0, y0, 1, y1 - y0);
      ctx.fillRect(x1 - 1, y0, 1, y1 - y0);
    }

    // The fortress in the middle.
    for (const [gx, gy] of FORTRESS_CELLS) {
      ctx.fillStyle = '#d0011b';
      ctx.fillRect(pad + gx * u, pad + gy * u, u, u);
    }
    ctx.strokeStyle = '#7d0014';
    ctx.lineWidth = Math.max(1, Math.round(u * 0.18));
    ctx.strokeRect(
      pad + Math.min(...FORTRESS_CELLS.map((c) => c[0])) * u,
      pad + Math.min(...FORTRESS_CELLS.map((c) => c[1])) * u,
      2 * u,
      2 * u,
    );

    // Spawn marker at the start of every lane. FOUR PATHS has four, so drawing
    // only lane 0 would misrepresent the map.
    ctx.fillStyle = '#00b8d9';
    for (const lane of layout.lanes) {
      const start = lane.cells[0];
      ctx.fillRect(pad + start[0] * u, pad + start[1] * u, u, u);
    }

    // Orientation cues sit in the margin, so the preview can never be read
    // upside down or mirrored.
    ctx.fillStyle = '#9a9284';
    ctx.font = `bold ${Math.round(Math.min(w, h) * 0.075)}px 'Ubuntu Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', w / 2, pad / 2);
    ctx.fillText('S', w / 2, h - pad / 2);
    ctx.fillText('W', pad / 2, h / 2);
    ctx.fillText('E', w - pad / 2, h / 2);

  }

  // ------------------------------------------------------------------ render

  refreshHud(): void {
    const s = this.game.state;
    this.goldEl.textContent = String(s.gold);
    // "Wave 3 / 25" means nothing to an attacker, so that slot counts the units
    // they have on the board instead.
    this.waveEl.textContent =
      this.game.side === 'attacker'
        ? String(s.enemies.filter((e) => e.alive).length)
        : `${s.wave} / ${TOTAL_WAVES}`;

    const hpRatio = s.fortressHp / s.fortressMaxHp;
    this.hpEl.textContent = `${s.fortressHp} / ${s.fortressMaxHp}`;
    this.hpFill.style.width = `${Math.max(0, hpRatio * 100)}%`;
    this.hpFill.classList.toggle('is-critical', hpRatio <= 0.34);

    this.refreshShop();
    this.refreshInspector();
  }

  private refreshShop(): void {
    const s = this.game.state;
    for (const [type, btn] of this.buildButtons) {
      const cost = s.towerCost(type);
      const price = btn.querySelector<HTMLElement>('.cost');
      if (price) price.textContent = String(cost);
      btn.classList.toggle('is-active', this.game.placing === type);
      btn.classList.toggle('is-affordable', s.gold >= cost);
      const spec = TOWERS[type];
      btn.title = `${spec.name} \u2014 ${spec.blurb}`;
    }

    const playing = this.game.isPlaying;
    this.waveBtn.disabled = !playing || this.game.phase !== 'building';
    this.waveBtn.classList.toggle('is-rushing', this.game.phase === 'building');
  }

  private refreshInspector(): void {
    const tower = this.game.selected;
    if (!tower) {
      this.inspector.classList.add('hidden');
      this.fxHideRangeWhenIdle();
      return;
    }

    const spec = TOWERS[tower.type];
    const tier = tierSpec(tower.type, tower.tier);
    this.inspector.classList.remove('hidden');

    this.inspName.textContent = spec.name;
    this.inspTier.innerHTML = Array.from(
      { length: MAX_TIER },
      (_, i) => `<span class="tier-pip ${i < tower.tier ? 'is-on' : ''}"></span>`,
    ).join('');

    const hpPct = Math.max(0, Math.round((tower.hp / tower.maxHp) * 100));
    const rows: Array<[string, string]> = [
      ['LEVEL', `MK${'I'.repeat(tower.tier)}`],
      ['HULL', `${Math.max(0, tower.hp)} / ${tower.maxHp} (${hpPct}%)`],
      ['DAMAGE', `${(tier.damage * tier.burst).toFixed(1)} ${ELEMENT_LABEL[spec.element]}`],
      ['RATE', `${tier.cooldown.toFixed(2)}s`],
      ['RANGE', `${tier.range.toFixed(1)} studs`],
      ['DPS', towerDps(tower.type, tower.tier).toFixed(1)],
    ];
    if (tier.splash > 0) rows.push(['BLAST', `${tier.splash.toFixed(2)} studs`]);
    if (tier.slow > 0) rows.push(['SLOW', `-${Math.round(tier.slow * 100)}%`]);
    if (tier.poisonDps > 0) rows.push(['POISON', `${tier.poisonDps}/s`]);
    if (tier.chain > 0) rows.push(['CHAIN', `${tier.chain + 1} targets`]);
    rows.push(['KILLS', String(tower.kills)]);
    rows.push(['DEALT', String(Math.round(tower.damage))]);

    this.inspStats.innerHTML = rows
      .map(([k, v]) => `<span>${k}</span><b>${v}</b>`)
      .join('');

    this.inspElem.innerHTML = `<strong>${ELEMENT_LABEL[spec.element]}</strong> \u2014 ${weaknessHint(spec.element)}`;

    const partner = this.game.state.findCombinePartner(tower);
    this.combineBtn.disabled = !partner;
    this.combineBtn.textContent =
      tower.tier >= MAX_TIER ? 'MAX TIER' : partner ? 'COMBINE' : 'NO PARTNER';
    this.combineBtn.classList.toggle('is-active', this.game.combining);
    this.sellBtn.textContent = `SELL +${Math.floor(tower.invested * SELL_REFUND)}`;
  }

  private fxHideRangeWhenIdle(): void {
    if (!this.game.placing && !this.game.combining) this.game.fx.hideRange();
  }

  /** Per-frame refresh for the countdown and live wave counter. */
  tick(): void {
    const g = this.game;

    // The attacker has no wave, so the threat slot carries the assault clock
    // instead: the same always-visible "you are about to run out" warning the
    // defender gets from its build timer.
    if (g.side === 'attacker') {
      const left = g.assaultTimeLeft;
      const m = Math.floor(left / 60);
      const sec = Math.floor(left % 60);
      this.threatEl.textContent = `${m}:${String(sec).padStart(2, '0')}`;
      this.threatEl.classList.toggle('is-critical', left <= 30);
      this.waveLabel.textContent =
        g.phase === 'won' ? 'FORTRESS DESTROYED' : g.phase === 'lost' ? 'ASSAULT FAILED' : 'ASSAULT';
      this.waveTimer.textContent = `${g.state.enemies.filter((e) => e.alive).length} UNITS`;
      return;
    }

    this.threatEl.classList.remove('is-critical');
    if (g.phase === 'building') {
      const t = Math.max(0, g.timeRemaining);
      this.waveLabel.textContent =
        g.state.wave >= TOTAL_WAVES ? 'ALL WAVES CLEARED' : `START WAVE ${g.state.wave + 1}`;
      this.waveTimer.textContent = `${Math.ceil(t)}s`;
      this.threatEl.textContent = 'BUILD PHASE';
    } else if (g.phase === 'wave') {
      const left = g.state.queueRemaining + g.state.enemies.length;
      this.waveLabel.textContent = `WAVE ${g.state.wave} INCOMING`;
      this.waveTimer.textContent = `${left} LEFT`;
      this.threatEl.textContent = `WAVE ${g.state.wave} OF ${TOTAL_WAVES}`;
    } else if (g.phase === 'paused') {
      this.threatEl.textContent = 'PAUSED';
    } else if (g.phase === 'won') {
      this.threatEl.textContent = 'FORTRESS HELD';
    } else if (g.phase === 'lost') {
      this.threatEl.textContent = 'BREACHED';
    }

    const text = this.threatEl.textContent ?? '';
    if (text !== this.lastThreat) {
      this.lastThreat = text;
      this.waveBtn.classList.toggle('is-rushing', g.phase === 'building');
      this.waveBtn.disabled = !g.isPlaying || g.phase !== 'building';
    }
  }

  // ----------------------------------------------------------------- toasts

  private pushToast(text: string, tone: 'gold' | 'bad' | 'info'): void {
    const el = document.createElement('div');
    el.className = `toast toast--${tone}`;
    el.textContent = text;
    this.toasts.append(el);

    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();

    window.setTimeout(() => {
      el.classList.add('is-out');
      window.setTimeout(() => el.remove(), 320);
    }, 1700);
  }

  // --------------------------------------------------------------- overlays

  togglePause(): void {
    if (this.game.phase === 'paused') {
      this.game.setPaused(false);
      this.showOverlay(null);
    } else if (this.game.isPlaying) {
      this.game.setPaused(true);
    }
  }

  /** Compact stat block so pause and result screens say something useful. */
  private runSummary(): string {
    const s = this.game.state;
    const attacking = this.game.side === 'attacker';
    const elapsed = s.stats.startTime
      ? Math.max(0, Math.round((performance.now() - s.stats.startTime) / 1000))
      : 0;

    const mm = Math.floor(elapsed / 60);
    const ss = String(elapsed % 60).padStart(2, '0');
    const rows: Array<[string, string, string?]> = [
      ['Elapsed', `${mm}:${ss}`],
      ['Bricks', String(s.gold)],
    ];

    if (attacking) {
      const left = this.game.assaultTimeLeft;
      const lm = Math.floor(left / 60);
      const ls = String(Math.floor(left % 60)).padStart(2, '0');
      rows.push(['Time left', `${lm}:${ls}`, left <= 30 ? 'is-critical' : '']);
      rows.push(['Units deployed', String(this.game.deployCount)]);
    } else {
      rows.push(['Wave', `${s.wave} / ${TOTAL_WAVES}`]);
      rows.push(['Turrets built', String(s.stats.built)]);
    }
    rows.push(['Kills', String(s.stats.kills)]);
    rows.push([attacking ? 'Fortress HP' : 'Leaks', attacking
      ? `${s.fortressHp} / ${s.fortressMaxHp}`
      : String(s.stats.leaked)]);

    return `<div class="overlay__stats">${rows
      .map(([k, v, cls]) =>
        `<div class="overlay__stat${cls ? ` ${cls}` : ''}${k === 'Time left' ? ' overlay__stat--clock' : ''}">
           <span>${k}</span><b>${v}</b></div>`)
      .join('')}</div>`;
  }

  showOverlay(mode: 'intro' | 'menu' | 'paused' | 'won' | 'lost' | null): void {
    if (!mode) {
      this.overlay.classList.add('hidden');
      this.overlayMode = 'menu';
      return;
    }

    this.overlayMode = mode;
    this.overlay.classList.remove('hidden');
    // Only the menu needs the wide frame; pause and result screens are a
    // handful of lines and looked lost inside it.
    this.overlayBox.classList.toggle('overlay__box--compact', mode !== 'menu');

    // The map / side / theme pickers belong to the menu only. Leaving them on
    // the pause screen made it 736px tall and let you switch map mid-run.
    const menuOnly = mode === 'menu';
    // The main menu button is the only way back to the pickers, so it appears on
    // every screen except the menu itself, where it would be a no-op.
    this.ovMenu.hidden = menuOnly;
    $('map-picker')?.classList.toggle('hidden', !menuOnly);
    this.overlayBox.querySelector('.side-picker')?.classList.toggle('is-hidden', !menuOnly);
    this.overlayBox.querySelector('.theme-picker')?.classList.toggle('is-hidden', !menuOnly);

    if (mode === 'intro') {
      this.ovMenu.hidden = true;
      this.overlayBox.querySelector('.side-picker')?.classList.toggle('is-hidden', true);
      this.overlayBox.querySelector('.theme-picker')?.classList.toggle('is-hidden', true);
      $('map-picker')?.classList.toggle('hidden', true);
      this.overlayBox.classList.remove('overlay__box--compact');
      this.overlayBox.classList.add('intro-anim');
      this.ovTitle.textContent = 'BRICK SIEGE';
      this.ovTag.textContent = 'TOWER DEFENSE';
      this.ovBody.innerHTML = `<p style="margin-bottom:12px; opacity:.9">Fortify the keep, stop the horde.</p>`;
      this.ovPrimary.textContent = 'PLAY';
      this.ovPrimary.onclick = () => { this.ovPrimary.onclick = null; this.overlayBox.classList.remove('intro-anim'); this.showOverlay('menu'); };
      return;
    }

    if (mode === 'menu') {
      this.ovTitle.textContent = 'BRICK SIEGE';
      this.ovTag.textContent = 'MASTER BUILDER DEFENSE';
      this.ovBody.innerHTML = `
        <p>Choose your side. Defend against <strong>${TOTAL_WAVES} waves</strong>, or lead the assault from the gates.</p>
        <ul>
          <li>Pick a brick (1-5) and click an empty stud to build</li>
          <li>Click a built tower, then <strong>COMBINE</strong> two matching ones to tier up</li>
          <li>Every enemy resists something \u2014 read the codex (H)</li>
          <li>Press <strong>SPACE</strong> to call a wave early for bonus bricks</li>
        </ul>`;
      this.ovPrimary.textContent = SIDE_CTA[this.game.side];
      this.refreshMapCards();
      return;
    }

    if (mode === 'paused') {
      this.ovTitle.textContent = 'BUILD PAUSED';
      this.ovTag.textContent = 'TAKE A BREATHER';
      this.ovBody.innerHTML = this.runSummary() +
        `<p style="margin-top:10px">Click below or press <strong>ESC</strong> to get back to it.
         Want a different map or side? Use <strong>MAIN MENU</strong>.</p>`;
      this.ovPrimary.textContent = 'RESUME';
      return;
    }

    const s = this.game.state;
    const minutes = Math.max(0, Math.round(((s.stats.endTime ?? performance.now()) - s.stats.startTime) / 60000));
    const won = mode === 'won';
    const attacking = this.game.side === 'attacker';

    this.ovBody.innerHTML = this.runSummary();
    if (attacking) {
      this.ovTitle.textContent = won ? 'FORTRESS BREACHED' : 'FORTRESS HELD';
      this.ovTag.textContent = won ? 'ASSAULT SUCCEEDED' : 'ASSAULT REPULSED';
    } else {
      this.ovTitle.textContent = won ? 'FORTRESS HELD' : 'FORTRESS BREACHED';
      this.ovTag.textContent = won
        ? `ALL ${TOTAL_WAVES} WAVES SURVIVED`
        : `OVERRUN ON WAVE ${s.wave}`;
    }

    this.ovBody.innerHTML = `
      <div class="result-grid">
        <div class="result-cell"><span>WAVES</span><b>${s.wave}</b></div>
        <div class="result-cell"><span>KILLS</span><b>${s.stats.kills}</b></div>
        <div class="result-cell"><span>LEAKS</span><b>${s.stats.leaked}</b></div>
        <div class="result-cell"><span>TOWERS</span><b>${s.stats.built}</b></div>
        <div class="result-cell"><span>COMBINES</span><b>${s.stats.combined}</b></div>
        <div class="result-cell"><span>SHOTS</span><b>${s.stats.shotsFired}</b></div>
        <div class="result-cell"><span>EARNED</span><b>${s.stats.goldEarned}</b></div>
        <div class="result-cell"><span>MINUTES</span><b>${minutes}</b></div>
      </div>
      <p>${
        attacking
          ? (won ? 'The gate is down. The assault succeeded.' : 'The fortress held firm. The assault was repulsed.')
          : (won ? 'The horde never got past the gate. Nobody has to rebuild the wall.' : 'The gate fell. Swap in ice against the big ones and try the combo timing again.')
      }</p>`;

    this.ovPrimary.textContent = won ? 'BUILD AGAIN' : 'REBUILD';
  }
}

function weaknessHint(element: ElementId): string {
  switch (element) {
    case 'ice':
      return 'zombies and demons take double, skeletons resist it';
    case 'poison':
      return 'strong on ghosts and slimes, useless vs zombies and skeletons';
    case 'lightning':
      return 'the answer to ghosts, decent everywhere else';
    default:
      return 'skeletons love it, everything else shrugs';
  }
}

