import { useCallback, useEffect, useState } from 'react';
import { getCurrentUser, signOut } from 'aws-amplify/auth';
import { AuthPanel } from './auth/AuthPanel';
import { getMe, type MeResponse } from './api/client';
import { config, missingConfig } from './config';
import { getDevIdentity } from './auth/token';
import { RoomPlayground } from './RoomPlayground';
// A finished 2-player game built on the rooms layer. To try it, import { XoGame } from './examples/xo/XoGame'
// and render <XoGame /> in place of <RoomPlayground /> below (see src/examples/xo/README.md).

export default function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(config.devAuth ? true : null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = config.projectName;
  }, []);

  useEffect(() => {
    if (missingConfig.length > 0 || config.devAuth) return;
    getCurrentUser()
      .then(() => setSignedIn(true))
      .catch(() => setSignedIn(false));
  }, []);

  const callMe = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setMe(await getMe());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  if (missingConfig.length > 0) {
    return (
      <main>
        <h1>{config.projectName}</h1>
        <div className="card">
          <h2>Setup needed</h2>
          <p>These settings are empty: <code>{missingConfig.join(', ')}</code></p>
          <p className="muted">
            Deploy the backend, then run <code>npm run env:frontend</code> in <code>/backend</code> to generate{' '}
            <code>frontend/.env.local</code>, and restart <code>npm run dev</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>{config.projectName}</h1>
        {signedIn && !config.devAuth && (
          <button
            className="link"
            onClick={async () => {
              await signOut();
              setSignedIn(false);
              setMe(null);
            }}
          >
            Sign out
          </button>
        )}
      </header>

      {config.devAuth && (
        <p className="muted" data-testid="dev-banner">
          Local dev mode: sign-in is skipped. You are <code>{getDevIdentity().id}</code> (add <code>?as=name</code> to the URL to change).
        </p>
      )}

      {signedIn === null && <p className="muted">Loading…</p>}

      {signedIn === false && <AuthPanel onSignedIn={() => setSignedIn(true)} />}

      {signedIn && !config.devAuth && (
        <div className="card">
          <h2>Check authentication</h2>
          <p className="muted">Calls the protected <code>GET /me</code> endpoint with your Cognito token.</p>
          <button onClick={callMe} disabled={loading}>
            {loading ? 'Calling…' : 'Call GET /me'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
          {me && <pre>{JSON.stringify(me, null, 2)}</pre>}
        </div>
      )}

      {signedIn && config.wsUrl && <RoomPlayground />}

      {/* Add your own pages and components here. Add one typed function per route in src/api/client.ts. */}
    </main>
  );
}
