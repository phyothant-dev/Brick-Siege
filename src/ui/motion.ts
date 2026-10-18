import { animate, stagger } from 'motion';

/**
 * Motion-powered flourishes for the DOM shell (overlay, pickers, toasts).
 * Purely cosmetic: every helper bails out under `prefers-reduced-motion` so the
 * UI stays instant and accessible, and none of them touch game state.
 */
const prefersReduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * Drop the overlay panel in, then cascade its sections. Used for every overlay
 * (menu, pause, results), so children always animate.
 */
export function overlayEnter(box: HTMLElement): void {
  if (prefersReduced()) return;

  animate(box, { opacity: [0, 1], scale: [0.94, 1], y: [16, 0] }, { duration: 0.36, ease: EASE_OUT });

  const parts = box.querySelectorAll<HTMLElement>(
    '.overlay__title, .overlay__tag, .overlay__body, .overlay__controls, .overlay__actions, .overlay__stats',
  );
  if (!parts.length) return;
  animate(parts, { opacity: [0, 1], y: [12, 0] }, { duration: 0.34, delay: stagger(0.05, { startDelay: 0.12 }), ease: 'easeOut' });
}

/** Stagger a card grid (map / theme / side pickers) into view. */
export function cardsEnter(root: ParentNode, selector: string): void {
  if (prefersReduced()) return;
  const cards = root.querySelectorAll<HTMLElement>(selector);
  if (!cards.length) return;
  animate(cards, { opacity: [0, 1], scale: [0.9, 1], y: [8, 0] }, { duration: 0.3, delay: stagger(0.04), ease: 'easeOut' });
}

/** Toast drops in from the right. */
export function toastDrop(el: HTMLElement): void {
  if (prefersReduced()) return;
  animate(el, { opacity: [0, 1], x: [28, 0], scale: [0.92, 1] }, { duration: 0.28, ease: EASE_OUT });
}

/** Toast lifts out; resolves once it has left the screen so the node can be removed. */
export function toastLift(el: HTMLElement): Promise<void> {
  if (prefersReduced()) {
    el.classList.add('is-out');
    return new Promise((resolve) => window.setTimeout(resolve, 320));
  }
  return animate(el, { opacity: 0, x: 28, scale: 0.9 }, { duration: 0.2, ease: 'easeIn' }).finished;
}

/** Squash-and-stretch tap feedback for a button or card. */
export function pressPop(el: HTMLElement): void {
  if (prefersReduced()) return;
  animate(el, { scale: [1, 0.9, 1] }, { duration: 0.24, ease: 'easeOut' });
}

/** Victory burst: little brick chips arc out of the result panel. */
export function brickBurst(host: HTMLElement, count = 24): void {
  if (prefersReduced()) return;
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const colors = ['#e5352b', '#f6c445', '#2f6fd0', '#3fa34d', '#e08a1e', '#ffffff'];
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height * 0.35;

  for (let i = 0; i < count; i++) {
    const chip = document.createElement('span');
    chip.style.cssText =
      `position:fixed;left:${originX}px;top:${originY}px;width:10px;height:10px;` +
      `background:${colors[i % colors.length]};border:2px solid #000;border-radius:2px;` +
      'pointer-events:none;z-index:80;will-change:transform,opacity;';
    document.body.append(chip);

    const dx = (Math.random() - 0.5) * rect.width * 1.3;
    const up = -(rect.height * (0.35 + Math.random() * 0.5));
    const rot = (Math.random() - 0.5) * 720;
    animate(
      chip,
      { x: [0, dx], y: [0, up, up + 160], rotate: [0, rot], opacity: [1, 1, 0] },
      { duration: 0.9 + Math.random() * 0.5, delay: Math.random() * 0.15, ease: 'easeOut' },
    ).finished.then(() => chip.remove());
  }
}
