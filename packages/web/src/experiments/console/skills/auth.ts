/**
 * Web-auth status.
 *
 * Auth is OFF by default (solo installs), and when it is off there is no
 * session to end — so this exists to let a panel decide whether it should
 * render at all, rather than to show a sign-out control that does nothing.
 */
import { requestJson } from '../lib/http';

export interface AuthStatus {
  enabled: boolean;
  signup: 'allowlist' | 'open' | 'disabled';
}

export async function getAuthStatus(): Promise<AuthStatus> {
  return requestJson<AuthStatus>('/api/auth/status');
}
