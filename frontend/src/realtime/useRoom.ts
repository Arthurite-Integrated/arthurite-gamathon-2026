import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { getAuthToken } from '../auth/token';
import { config } from '../config';
import { ClientSnapshot, RoomClient } from './RoomClient';

/** Re-renders the component whenever the client's connection or room changes. */
export function useRoomSnapshot(client: RoomClient): ClientSnapshot {
  return useSyncExternalStore(client.subscribe, client.getSnapshot);
}

/**
 * Creates one RoomClient for the component's lifetime, connects it, and disconnects on unmount.
 * Use it in the screen that owns the multiplayer session and pass `client` down to children.
 * `error` is set if the first connection fails (for example a bad token or the server being down).
 */
export function useRoom(): { client: RoomClient; snapshot: ClientSnapshot; error: string | null } {
  const client = useMemo(() => new RoomClient({ url: config.wsUrl, getToken: getAuthToken }), []);
  const snapshot = useRoomSnapshot(client);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    client.connect().catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : 'Could not connect');
    });
    return () => {
      active = false;
      client.disconnect();
    };
  }, [client]);

  return { client, snapshot, error };
}
