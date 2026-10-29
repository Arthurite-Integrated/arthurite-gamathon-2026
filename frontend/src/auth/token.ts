import { fetchAuthSession } from 'aws-amplify/auth';
import { config } from '../config';

export interface DevIdentity {
  id: string;
  name: string;
}

/**
 * Local-only identity for testing multiplayer without Cognito. Each browser tab gets its own
 * identity (kept in sessionStorage), so two tabs are two players. Use ?as=alice to pick a name.
 * Only active when `npm run dev:local` is used; production builds ignore it (see config.devAuth).
 */
export function getDevIdentity(): DevIdentity {
  const asParam = new URLSearchParams(window.location.search).get('as');
  try {
    const stored = sessionStorage.getItem('devIdentity');
    if (stored && !asParam) return JSON.parse(stored) as DevIdentity;
  } catch {
    /* sessionStorage can be unavailable; fall through to a fresh identity */
  }
  const suffix = Math.random().toString(36).slice(2, 6);
  const clean = (asParam ?? `player-${suffix}`).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || `player-${suffix}`;
  const identity = { id: clean, name: clean };
  try {
    sessionStorage.setItem('devIdentity', JSON.stringify(identity));
  } catch {
    /* ignore */
  }
  return identity;
}

/** The token the realtime server expects: a Cognito ID token, or a dev token in local mode. */
export async function getAuthToken(): Promise<string> {
  if (config.devAuth) {
    const { id, name } = getDevIdentity();
    return `dev:${id}:${name}`;
  }
  const { tokens } = await fetchAuthSession();
  const token = tokens?.idToken?.toString();
  if (!token) throw new Error('Not signed in');
  return token;
}
