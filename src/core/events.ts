/**
 * Tiny synchronous event bus. Keeps the DOM UI decoupled from the simulation
 * without threading a giant context object through every module.
 */

export type GameEvents = {
  'hud:changed': void;
  'selection:changed': void;
  'placing:changed': void;
  toast: { text: string; tone: 'gold' | 'bad' | 'info' };
  'game:over': { won: boolean };
  'game:started': void;
  'phase:changed': void;
  shake: number;
  'inspector:open': void;
  'side:changed': import('./sides').Side;
  /** Sound requests. The audio engine listens to this so gameplay code
   *  never has to know that WebAudio exists. */
  sfx: { name: string; pitch?: number };
};

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

const handlers = new Map<string, Set<(p: unknown) => void>>();

export function on<K extends keyof GameEvents>(event: K, handler: Handler<K>): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as (p: unknown) => void);
  return () => set!.delete(handler as (p: unknown) => void);
}

type PayloadArgs<K extends keyof GameEvents> = [GameEvents[K]] extends [void]
  ? [payload?: GameEvents[K]]
  : [payload: GameEvents[K]];

export function emit<K extends keyof GameEvents>(
  event: K,
  ...args: PayloadArgs<K>
): void {
  const set = handlers.get(event);
  if (!set) return;
  const payload = args[0] as GameEvents[K];
  for (const handler of set) handler(payload as unknown);
}

/** Fire-and-forget sound request. */
export function sfx(name: string, pitch?: number): void {
  emit('sfx', { name, pitch });
}

export function clearEvents(): void {
  handlers.clear();
}