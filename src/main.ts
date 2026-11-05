import './style.css';
import { hasScreen, registerScreen, startRouter } from './ui/router.ts';
import { homeScreen, localScreen, placeholderScreen } from './ui/screens.ts';
import { initTheme } from './ui/theme.ts';
import { openRules } from './ui/rules-dialog.ts';

// Public API for other modules (online play, login). Prefer importing from './ui/router.ts' directly.
export { registerScreen, navigate } from './ui/router.ts';

// Optional online module: registers its screens at import time. Missing file = no-op.
import.meta.glob('./online/index.ts', { eager: true });

registerScreen('home', homeScreen);
registerScreen('local', localScreen);
if (!hasScreen('online')) registerScreen('online', placeholderScreen('Online spielen'));
if (!hasScreen('account')) registerScreen('account', placeholderScreen('Konto'));

initTheme(document.querySelector<HTMLButtonElement>('#theme-toggle')!);
document.querySelector('#help')!.addEventListener('click', openRules);
startRouter(document.querySelector<HTMLElement>('#app')!);
