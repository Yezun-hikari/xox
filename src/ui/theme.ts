type Mode = 'system' | 'light' | 'dark';

const KEY = 'xox-theme';
const ORDER: Mode[] = ['system', 'light', 'dark'];
const BG = { light: '#ffffff', dark: '#222224' }; // header colour (theme-color)
const LABEL = { system: 'System', light: 'Hell', dark: 'Dunkel' };
const ICON = {
  system:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
};

function read(): Mode {
  try {
    const v = localStorage.getItem(KEY) as Mode | null;
    return v && ORDER.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function initTheme(btn: HTMLButtonElement): void {
  let mode = read();
  const apply = () => {
    const root = document.documentElement;
    if (mode === 'system') delete root.dataset.theme;
    else root.dataset.theme = mode;
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      m.content = mode === 'system' ? (m.media.includes('dark') ? BG.dark : BG.light) : BG[mode];
    });
    btn.innerHTML = ICON[mode];
    btn.setAttribute('aria-label', `Farbschema: ${LABEL[mode]} (wechseln)`);
    btn.title = `Farbschema: ${LABEL[mode]}`;
  };
  btn.addEventListener('click', () => {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* storage blocked: keep for this session only */
    }
    apply();
  });
  apply();
}
