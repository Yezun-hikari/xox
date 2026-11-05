// Screen-reader live region + visual toast. Both elements live in index.html.

export function announce(text: string): void {
  const live = document.getElementById('live');
  if (!live) return;
  // Clear first so repeating the same text is announced again.
  live.textContent = '';
  setTimeout(() => (live.textContent = text), 50);
}

let toastTimer = 0;

/** Visual-only toast (aria-hidden); pair it with announce() for screen readers. */
export function toast(text: string, ms = 2200): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}
