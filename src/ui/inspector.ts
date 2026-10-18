/**
 * Makes the tower inspector a free-floating panel: drag it by its header to
 * move it anywhere, and it is kept clamped inside the viewport so it can never
 * be pushed under the top bar or the bottom shop — or off-screen. The position
 * is remembered between sessions.
 *
 * The panel stays where the CSS media queries put it until the player drags it;
 * after that its own `left`/`top` win, and every resize / content change
 * re-clamps it back into view.
 */
const POS_KEY = 'bs.inspector.pos';
const PAD = 8;

interface Saved {
  x: number;
  y: number;
}

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved>;
    if (typeof v.x !== 'number' || typeof v.y !== 'number') return null;
    return { x: v.x, y: v.y };
  } catch {
    return null;
  }
}

function save(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  try {
    localStorage.setItem(POS_KEY, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) }));
  } catch {
    /* storage unavailable; position still applies for this session */
  }
}

/** Move to left/top (from whatever anchor CSS used) so drag math is uniform. */
function toLeftTop(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  el.style.left = `${r.left}px`;
  el.style.top = `${r.top}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

/** Place the panel at x/y, clamped so it stays fully on screen. */
function move(el: HTMLElement, x: number, y: number): void {
  const r = el.getBoundingClientRect();
  const maxX = Math.max(PAD, window.innerWidth - r.width - PAD);
  const maxY = Math.max(PAD, window.innerHeight - r.height - PAD);
  el.style.left = `${Math.min(Math.max(PAD, x), maxX)}px`;
  el.style.top = `${Math.min(Math.max(PAD, y), maxY)}px`;
}

function clamp(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  move(el, r.left, r.top);
}

export function enableInspectorDrag(): void {
  const el = document.getElementById('inspector');
  const head = el?.querySelector<HTMLElement>('.inspector__head');
  if (!el || !head) return;

  const saved = readSaved();
  if (saved) {
    el.style.left = `${saved.x}px`;
    el.style.top = `${saved.y}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  let drag: { id: number; dx: number; dy: number } | null = null;

  head.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Let the close (and any future) button receive its own taps.
    if ((e.target as HTMLElement).closest('button')) return;
    if (el.classList.contains('hidden')) return;

    toLeftTop(el);
    const r = el.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.classList.add('is-dragging');
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  head.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    move(el, e.clientX - drag.dx, e.clientY - drag.dy);
  });

  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    el.classList.remove('is-dragging');
    try {
      head.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    save(el);
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);

  // Double-click the header to snap back to the CSS default.
  head.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    try {
      localStorage.removeItem(POS_KEY);
    } catch {
      /* ignore */
    }
  });

  const reflow = (): void => {
    if (!drag && !el.classList.contains('hidden') && el.style.left) clamp(el);
  };
  window.addEventListener('resize', reflow);
  window.addEventListener('orientationchange', reflow);
  // Content differs per tower, so the panel grows/shrinks; keep it in view.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reflow).observe(el);
}
