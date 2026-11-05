import {
  AuthFailure,
  changePassword,
  currentUser,
  deleteAccount,
  isConfigured,
  login,
  logout,
  MIN_PASSWORD,
  NOT_CONFIGURED,
  onAuthChange,
  ready,
  register,
} from '../auth/index.ts';
import { announce } from '../ui/announce.ts';
import type { Screen } from '../ui/router.ts';
import { errorText, loadNickname, loadRating, nicknameForm, notConfigured, ratingText, setMsg } from './api.ts';

const PW = `minlength="${MIN_PASSWORD}" maxlength="72" required`;

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

      // status
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
      body.append(status);

      body.append(card('Spitzname', nicknameForm(nick, () => {})));

      if (!user || user.isGuest) {
        const reg = card('Registrieren');
        reg.append(
          note(
            user
              ? 'Dein Gast-Fortschritt (Elo, Spitzname) wird in das neue Konto übernommen.'
              : 'Mit einem Konto kannst du dich auf anderen Geräten anmelden.',
          ),
          note('Es gibt kein Zurücksetzen des Passworts: Wir speichern keine E-Mail-Adresse. Merke dir dein Passwort gut.', true),
          form(
            `<label class="field"><span>Benutzername <small>(3–20 Zeichen: a–z, 0–9, _)</small></span>
               <input name="u" autocomplete="username" maxlength="20" required pattern="[A-Za-z0-9_]{3,20}"></label>
             <label class="field"><span>Passwort <small>(mind. ${MIN_PASSWORD} Zeichen)</small></span>
               <input name="p" type="password" autocomplete="new-password" ${PW}></label>
             <label class="field"><span>Passwort wiederholen</span>
               <input name="p2" type="password" autocomplete="new-password" ${PW}></label>`,
            'Konto erstellen',
            async (f) => {
              if (f.p !== f.p2) throw new AuthFailure('Die Passwörter stimmen nicht überein.');
              await register(f.u, f.p);
              announce('Konto erstellt.');
            },
          ),
        );
        body.append(reg);

        const log = card('Anmelden');
        if (user) {
          log.append(
            note('Achtung: Wenn du dich in ein bestehendes Konto einloggst, wird dieses Gastkonto mit seiner Wertung gelöscht.', true),
          );
        }
        log.append(
          form(
            `<label class="field"><span>Benutzername</span>
               <input name="u" autocomplete="username" maxlength="20" required></label>
             <label class="field"><span>Passwort</span>
               <input name="p" type="password" autocomplete="current-password" maxlength="72" required></label>`,
            'Anmelden',
            async (f) => {
              await login(f.u, f.p);
              announce('Angemeldet.');
            },
          ),
        );
        body.append(log);
      } else {
        const out = card('Sitzung');
        const btn = document.createElement('button');
        btn.className = 'btn';
        btn.type = 'button';
        btn.textContent = 'Abmelden';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await logout().catch(() => {});
          announce('Abgemeldet.');
        });
        out.append(btn);
        body.append(out);

        body.append(
          card(
            'Passwort ändern',
            form(
              `<label class="field"><span>Aktuelles Passwort</span>
                 <input name="old" type="password" autocomplete="current-password" maxlength="72" required></label>
               <label class="field"><span>Neues Passwort <small>(mind. ${MIN_PASSWORD} Zeichen)</small></span>
                 <input name="p" type="password" autocomplete="new-password" ${PW}></label>
               <label class="field"><span>Neues Passwort wiederholen</span>
                 <input name="p2" type="password" autocomplete="new-password" ${PW}></label>`,
              'Passwort ändern',
              async (f, el) => {
                if (f.p !== f.p2) throw new AuthFailure('Die Passwörter stimmen nicht überein.');
                await changePassword(f.old, f.p);
                el.reset();
                return 'Passwort geändert.';
              },
            ),
          ),
        );
      }

      if (user) {
        const del = card('Konto löschen');
        del.append(note('Löscht dein Konto, deinen Spitznamen, deine Wertung und deine Partien endgültig.'));
        const btn = document.createElement('button');
        btn.className = 'btn danger';
        btn.type = 'button';
        btn.textContent = 'Konto löschen …';
        btn.addEventListener('click', () => confirmDelete(!user.isGuest));
        del.append(btn);
        body.append(del);
      }
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

function note(text: string, warn = false): HTMLElement {
  const p = document.createElement('p');
  p.className = warn ? 'note warn' : 'note';
  p.textContent = text;
  return p;
}

/**
 * Form with a static (trusted) field template, a status line and a submit button.
 * onSubmit gets the field values; a thrown AuthFailure/ApiError message is shown, a returned string is shown as success.
 */
function form(
  fields: string,
  label: string,
  onSubmit: (values: Record<string, string>, el: HTMLFormElement) => Promise<string | void>,
): HTMLFormElement {
  const f = document.createElement('form');
  f.className = 'form';
  f.innerHTML = `${fields}<p class="msg" role="status"></p><button class="btn primary" type="submit"></button>`;
  const btn = f.querySelector('button')!;
  btn.textContent = label;
  const msg = f.querySelector<HTMLElement>('.msg')!;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v)]));
    btn.disabled = true;
    setMsg(msg, '', false);
    try {
      const ok = await onSubmit(values, f);
      if (ok) setMsg(msg, ok, false);
    } catch (err) {
      setMsg(msg, errorText(err), true);
    } finally {
      btn.disabled = false;
    }
  });
  return f;
}

function confirmDelete(needsPassword: boolean): void {
  const d = document.createElement('dialog');
  d.className = 'rules';
  d.setAttribute('aria-labelledby', 'del-title');
  d.innerHTML = `
    <form class="rules-inner form">
      <h2 id="del-title">Konto wirklich löschen?</h2>
      <p>Das kann nicht rückgängig gemacht werden. Laufende Partien werden als verloren gewertet.</p>
      ${
        needsPassword
          ? `<label class="field"><span>Passwort zur Bestätigung</span>
               <input name="p" type="password" autocomplete="current-password" maxlength="72" required></label>`
          : ''
      }
      <p class="msg" role="status"></p>
      <div class="end">
        <button class="btn" type="button" value="cancel" autofocus>Abbrechen</button>
        <button class="btn danger" type="submit">Endgültig löschen</button>
      </div>
    </form>`;
  const f = d.querySelector('form')!;
  const msg = d.querySelector<HTMLElement>('.msg')!;
  const submit = d.querySelector<HTMLButtonElement>('button[type=submit]')!;
  d.querySelector('button[value=cancel]')!.addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    submit.disabled = true;
    try {
      await deleteAccount(needsPassword ? String(new FormData(f).get('p') ?? '') : undefined);
      d.close();
      announce('Konto gelöscht.');
    } catch (err) {
      setMsg(msg, errorText(err), true);
      submit.disabled = false;
    }
  });
  document.body.append(d);
  d.showModal();
}
