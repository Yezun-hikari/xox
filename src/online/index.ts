// Auto-imported by src/main.ts (import.meta.glob). Registers the online + account screens.
import { registerScreen } from '../ui/router.ts';
import { accountScreen } from './account.ts';
import { onlineScreen } from './play.ts';

registerScreen('online', onlineScreen);
registerScreen('account', accountScreen);
