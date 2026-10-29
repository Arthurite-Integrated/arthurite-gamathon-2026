import { RoomClientError } from '../../realtime/RoomClient';

/** Plain-language text for the error codes in docs/REALTIME-PROTOCOL.md. */
const MESSAGES: Readonly<Record<string, string>> = {
  room_full: 'That room is full. Two players are already in it.',
  room_not_found: "We couldn't find a room with that code. Check the code and try again.",
  room_locked: 'That game has already started, so nobody new can join.',
  not_host: 'Only the player who created the room can start the game.',
  not_enough_players: 'You need two players, both connected, to start. Wait for your opponent to join.',
  already_in_room: "You're already in a room. Leave it first.",
  not_in_room: "You're not in a room any more. Go back to the lobby.",
  invalid_message: "That room code doesn't look right. Room codes are 4 letters.",
  rate_limited: "You're doing that too fast. Wait a moment and try again.",
  timeout: 'The server took too long to answer. Try again.',
  not_connected: 'You are not connected right now. Wait for the connection to come back.',
  connect_failed: "Couldn't reach the game server.",
  internal_error: 'Something went wrong on the server. Try again.',
};

export function describeError(error: unknown): string {
  if (error instanceof RoomClientError) return MESSAGES[error.code] ?? 'Something went wrong. Try again.';
  return 'Something went wrong. Try again.';
}
