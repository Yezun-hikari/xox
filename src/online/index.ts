// Auto-imported by src/main.ts (import.meta.glob). Registers the online + account screens.
import { configure, onAuthChange } from '@yezun/konto';
import { registerScreen } from '../ui/router.ts';
import { accountScreen } from './account.ts';
import { onlineScreen } from './play.ts';

// Optional (e.g. local dev): point loginUrl()/accountUrl() at another account page than https://yezun.de/konto/.
// Must run before the first SDK call; otherwise the SDK reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY itself.
const kontoUrl = import.meta.env.VITE_KONTO_URL as string | undefined;
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
if (kontoUrl && url && anonKey) configure({ url, anonKey, accountUrl: kontoUrl });

// Coming back from the account page with the browser's Back button can restore this page from the
// back/forward cache with a stale session in memory: reload so the shared localStorage session is read again.
// (A normal redirect back is a fresh page load; other open tabs are updated by supabase-js' BroadcastChannel.)
addEventListener('pageshow', (e) => {
  if (e.persisted) location.reload();
});

registerScreen('online', onlineScreen);
registerScreen('account', accountScreen);

// Header account entry: "Anmelden" for guests and logged-out visitors, the username once logged in.
// The username is untrusted: textContent / setAttribute only.
const accountLink = document.querySelector<HTMLAnchorElement>('#account-link');
if (accountLink) {
  const label = accountLink.querySelector<HTMLElement>('.account-name')!;
  onAuthChange((u) => {
    const name = u && !u.isGuest ? u.username : null;
    label.textContent = name ?? 'Anmelden';
    if (name) {
      accountLink.setAttribute('aria-label', `Konto: angemeldet als ${name}`);
      accountLink.title = 'Konto';
    } else {
      accountLink.removeAttribute('aria-label');
      accountLink.removeAttribute('title');
    }
  });
}
