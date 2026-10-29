import { Amplify } from 'aws-amplify';

const env = import.meta.env;

export const config = {
  projectName: env.VITE_PROJECT_NAME ?? 'App',
  apiUrl: (env.VITE_API_URL ?? '').replace(/\/$/, ''),
  region: env.VITE_REGION ?? '',
  userPoolId: env.VITE_USER_POOL_ID ?? '',
  userPoolClientId: env.VITE_USER_POOL_CLIENT_ID ?? '',
  /** Realtime rooms WebSocket URL (stack output WebSocketUrl). Empty when realtime is disabled. */
  wsUrl: env.VITE_WS_URL ?? '',
  /**
   * Local development without Cognito: sign-in is skipped and a per-tab dev identity is used.
   * Requires the Vite dev server (import.meta.env.DEV), so it can never be active in a production build.
   */
  devAuth: env.DEV === true && env.VITE_DEV_AUTH === 'true',
};

/** Names of required settings that are still empty. */
export const missingConfig: string[] = config.devAuth
  ? config.wsUrl
    ? []
    : ['VITE_WS_URL']
  : Object.entries({
      VITE_API_URL: config.apiUrl,
      VITE_USER_POOL_ID: config.userPoolId,
      VITE_USER_POOL_CLIENT_ID: config.userPoolClientId,
    })
      .filter(([, value]) => !value)
      .map(([name]) => name);

export function configureAuth(): void {
  if (config.devAuth || missingConfig.length > 0) return;
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
      },
    },
  });
}
