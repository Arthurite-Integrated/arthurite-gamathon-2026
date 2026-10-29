import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { RoomClient } from '../../realtime/RoomClient';
import { GameController } from './controller';
import type { GameView } from './roles';

/**
 * Creates the GameController for a RoomClient, keeps it listening while the component is mounted,
 * and re-renders when the game view changes.
 */
export function useGame(client: RoomClient): { controller: GameController; view: GameView } {
  const controller = useMemo(() => new GameController(client), [client]);
  useEffect(() => controller.attach(), [controller]);
  const view = useSyncExternalStore(controller.subscribe, controller.getView);
  return { controller, view };
}
