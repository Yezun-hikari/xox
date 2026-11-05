/**
 * Hash router: `#/<id>?key=value`. Unknown ids fall back to 'home'.
 *
 * Extension points (online play / login):
 * - `registerScreen(id, screen)` adds or replaces a screen. Built-ins: 'home', 'local'.
 *   'online' and 'account' show a "Bald verfügbar" placeholder until a module registers them.
 * - `navigate(id, params?)` switches screens; links work too: `<a href="#/online">`.
 * - `src/online/index.ts` is auto-imported by `src/main.ts` if it exists (import.meta.glob),
 *   before the router starts. Import from this file ('../ui/router.ts'), not from main.ts.
 * - Reusable UI: `createBoard` (ui/board.ts), `createScoreboard` (ui/scoreboard.ts),
 *   `describeEvents` (ui/events.ts), `announce`/`toast` (ui/announce.ts), `openRules` (ui/rules-dialog.ts).
 * - A screen's `mount` may return a cleanup function (unsubscribe realtime, timers, ...).
 */
export interface Screen {
  /** Document title suffix. */
  title: string;
  mount(root: HTMLElement, params: URLSearchParams): void | (() => void);
}

const screens = new Map<string, Screen>();
let outlet: HTMLElement | null = null;
let currentId = '';
let cleanup: void | (() => void);

export function registerScreen(id: string, screen: Screen): void {
  screens.set(id, screen);
  if (outlet && id === currentId) render();
}

export const hasScreen = (id: string): boolean => screens.has(id);

export function navigate(id: string, params?: Record<string, string>): void {
  const q = params ? '?' + new URLSearchParams(params) : '';
  location.hash = `#/${id}${q}`;
}

function render(): void {
  if (!outlet) return;
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  currentId = screens.has(path) ? path : 'home';
  const screen = screens.get(currentId)!;
  cleanup?.();
  outlet.replaceChildren();
  document.title = currentId === 'home' ? 'XOX' : `${screen.title} · XOX`;
  cleanup = screen.mount(outlet, new URLSearchParams(query));
  // Move focus to the new screen's heading so screen readers follow the change.
  outlet.querySelector<HTMLElement>('h1, h2')?.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

export function startRouter(el: HTMLElement): void {
  outlet = el;
  window.addEventListener('hashchange', render);
  render();
}
