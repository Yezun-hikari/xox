import { accountUrl, currentUser, isConfigured, loginUrl, NOT_CONFIGURED, onAuthChange, ready } from '@yezun/konto';
import type { Screen } from '../ui/router.ts';
import { loadNickname, loadRating, nicknameForm, notConfigured, ratingText } from './api.ts';

/**
 * Compact account screen: status, rating and nickname. Login, registration, password and account deletion
 * live on the central account page (https://yezun.de/konto/), which sends the user back here afterwards.
 * The session is shared via localStorage, so it is picked up on the fresh page load after the redirect.
 */
export const accountScreen: Screen = {
  title: 'Konto',
  mount(root) {
    if (!isConfigured()) return notConfigured(root, 'Konto', NOT_CONFIGURED);
    root.innerHTML = `
      <section class="panel">
        <a class="back" href="#/">← Menü</a>
        <h1 tabindex="-1">Konto</h1>
        <div data-body><p class="muted">Lädt …</p></div>
      </section>`;
    const body = root.querySelector<HTMLElement>('[data-body]')!;
    let gen = 0; // ignore stale async renders

    async function render(): Promise<void> {
      const my = ++gen;
      await ready;
      const user = currentUser();
      let nick: string | null = null;
      let rating = null;
      if (user) {
        try {
          [nick, rating] = await Promise.all([loadNickname(user.id), loadRating(user.id)]);
        } catch {
          /* offline: show what we can */
        }
      }
      if (my !== gen) return;
      body.replaceChildren();

      // status + links to the central account page (return to this page afterwards)
      const status = card('Status');
      const p = document.createElement('p');
      p.textContent = !user ? 'Gast (noch nicht online gespielt)' : user.isGuest ? 'Gast' : `Angemeldet als ${user.username}`;
      status.append(p);
      if (rating) {
        const r = document.createElement('p');
        r.className = 'stats';
        r.textContent = ratingText(rating);
        status.append(r);
      }
      if (!user || user.isGuest) {
        status.append(
          note(
            user
              ? 'Du spielst als Gast. Mit einem Konto kannst du dich auf anderen Geräten anmelden – dein Gast-Fortschritt (Elo, Spitzname) wird übernommen.'
              : 'Du kannst ohne Konto als Gast spielen. Mit einem Konto kannst du dich auf anderen Geräten anmelden.',
          ),
          link(loginUrl(), 'Anmelden oder registrieren', 'btn primary'),
          link('#/online', 'Als Gast spielen', 'btn'),
        );
      } else {
        status.append(
          note('Passwort ändern, Wiederherstellungs-E-Mail, Abmelden und Konto löschen: auf der Konto-Seite von yezun.de.'),
          link(accountUrl(), 'Konto verwalten', 'btn primary'),
        );
      }
      body.append(status);

      body.append(card('Spitzname', nicknameForm(nick, () => {})));
    }

    let shown: string | undefined;
    // token refreshes also fire auth events: only re-render (and wipe typed input) when the user really changed
    const unsub = onAuthChange((u) => {
      const key = u ? `${u.id}:${u.username}` : '';
      if (key !== shown) (shown = key), void render();
    });
    return () => {
      gen++;
      unsub();
    };
  },
};

function card(title: string, ...children: Node[]): HTMLElement {
  const s = document.createElement('section');
  s.className = 'card';
  const h = document.createElement('h2');
  h.textContent = title;
  s.append(h, ...children);
  return s;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = text;
  return p;
}

function link(href: string, text: string, className: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = className;
  a.href = href;
  a.textContent = text;
  return a;
}
