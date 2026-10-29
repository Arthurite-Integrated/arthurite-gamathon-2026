# Realtime rooms protocol

The backend provides generic multiplayer rooms for any app: create a room, share a 4-letter code, join, start, and relay messages between players. It never reads your app messages, so game rules (scoring, win conditions, anti-cheat) live in your frontend.

Frontends should use `RoomClient` (`frontend/src/realtime/RoomClient.ts`) and never talk to the WebSocket directly. This document is the reference for what `RoomClient` sends and receives.

## Connecting

```
wss://<api-id>.execute-api.<region>.amazonaws.com/prod?token=<Cognito ID token>
```

- The token is a Cognito **ID token**. A Lambda authorizer verifies it before the socket opens. A missing or invalid token is refused with HTTP 403.
- The token is in the URL because browsers cannot set headers on WebSockets. It is never logged by this project. Do not log the URL in your own code.
- Local development uses `ws://localhost:8787?token=dev:<userId>:<displayName>` (see "Local server" below).
- The player's identity is the token's `sub` (the `userId` in every message). The display name comes from the `name` claim, or the part of the email before `@`.

## Messages you send

Every message is a JSON object with an `action`. Frames are limited to 8 KB and each connection to 30 messages per second (configurable).

| action | fields | what happens |
| --- | --- | --- |
| `createRoom` | `maxPlayers` (2 to 8, default 2), `displayName` (optional) | Creates a room, you become host. Replies `room.created`. |
| `joinRoom` | `code` (4 letters, any case), `displayName` (optional) | Joins a waiting room, or takes your seat back after a drop. Replies `room.joined`. |
| `leaveRoom` | none | Leaves. Replies `room.left`. |
| `start` | `settings` (optional object) | Host only, needs 2+ connected players. Everyone receives `game.started`. |
| `send` | `type`, `payload` (object), `to` (optional userId) | Relays to everyone else in the room, or to one player. |
| `ping` | none | Keeps the connection alive and cleans up players who timed out. Replies `pong`. `RoomClient` does this every 20 seconds. |

App message `type` must be 1 to 64 characters (letters, digits, `_ . : -`), starting with a letter. These are reserved for the system: anything starting with `room.`, `player.`, `host.`, `game.`, `system.`, and the exact names `error` and `pong`.

## Messages you receive

Every message is `{ "type": string, "payload": object, "from"?: string }`. `from` is the sender's `userId`, present only on app messages relayed from another player.

| type | payload | when |
| --- | --- | --- |
| `room.created` | `{ room, you }` | Reply to `createRoom` |
| `room.joined` | `{ room, you, reconnected }` | Reply to `joinRoom`. `reconnected` is true when you took your old seat back. |
| `room.left` | `{ code }` | Reply to `leaveRoom` |
| `player.joined` | `{ userId, displayName, room }` | Someone joined |
| `player.left` | `{ userId, reason }` | Someone left. `reason` is `left` or `timeout`. |
| `player.disconnected` | `{ userId, graceMs }` | Someone's connection dropped. They keep their seat for `graceMs` (30 seconds). |
| `player.reconnected` | `{ userId }` | A dropped player came back |
| `host.changed` | `{ userId }` | The host left or timed out. The next player in join order is host. |
| `game.started` | `{ seed, room, settings }` | The host started. **Every player gets the same `seed`** (an integer from 0 to 2^32-1). |
| `pong` | `{ t }` | Reply to `ping` |
| `error` | `{ code, message }` | An action failed. The connection stays open. |
| _your own types_ | whatever the sender put in `payload` | Relayed from another player, with `from` set |

`room` is `{ code, maxPlayers, status ("waiting" | "playing"), hostId, players: [{ userId, displayName, connected, isHost }] }`.

## Error codes

| code | meaning |
| --- | --- |
| `invalid_message` | Bad JSON, bad field, bad room code, or a reserved `type` |
| `unknown_action` | `action` is not one of the six above |
| `message_too_large` | Frame over 8 KB |
| `rate_limited` | Too many messages in one second |
| `not_connected` | The server lost your connection record. Reconnect. |
| `room_not_found` | No room with that code (or everyone left) |
| `room_full` | The room has `maxPlayers` already |
| `room_locked` | The game already started and you were not in the room |
| `not_in_room` | You tried to send, leave or start without being in a room |
| `already_in_room` | This connection holds a seat in a room. Leave it first. A connection whose room was deleted, or whose seat the same account took over on another connection (a second tab, a refreshed page), is not blocked: its stale room is forgotten. |
| `not_host` | Only the host can start |
| `not_enough_players` | Fewer than 2 connected players |
| `player_not_found` | The `to` player is not in the room |
| `internal_error` | Unexpected server problem. Try again. |

## Room lifecycle

1. **waiting**: players can join until `maxPlayers`. The host can start with 2 or more connected players.
2. **playing**: the room is locked. Nobody new can join. Players who dropped can still come back.
3. A room is deleted when its last player leaves. Anything left over is removed by a DynamoDB TTL after 24 hours.

## Drops and reconnecting

A dropped connection does not remove the player. They are marked disconnected and keep their seat for 30 seconds (`realtimeGraceSeconds` in `backend/cdk.json`). To come back, connect again and send `joinRoom` with the same code. `RoomClient` does this automatically, with backoff for up to 25 seconds, and emits `client.reconnecting`, `client.reconnected` and `client.closed`.

The backend does **not** replay messages a player missed while away. Your app must resync itself after `client.reconnected` or `player.reconnected`, for example by having each player send a full state snapshot.

After the grace period, the player is removed (`player.left` with reason `timeout`). Cleanup happens the next time anyone in the room sends a message, pings, joins or starts, so it relies on at least one active player. `RoomClient` pings every 20 seconds, so in practice a dropped player is removed 30 to 50 seconds after the drop (sooner in a busy game, where messages arrive constantly). If every player is gone, nothing is left to notify, and the leftover rows expire by TTL.

## Things your app must know

- **No ordering guarantee.** Messages from one player can occasionally arrive out of order under load. If order matters (moves in a game), put an incrementing counter in the payload and ignore anything older than the latest you applied.
- **No cheating protection.** The backend trusts what players send. A modified client can lie about its own score or state. For a workshop or casual game this is fine. If fairness matters, add a server-side rules handler.
- **Throttle high-frequency messages.** Send state updates a few times per second, not every frame. The limit is 30 messages per second per player, and every message costs a Lambda invocation.
- **Connections last at most 2 hours** (an API Gateway limit). `RoomClient` reconnects and rejoins automatically.

## Local server

`cd backend && npm run local:realtime` starts `ws://localhost:8787`. It runs the same room logic as production against an in-memory DynamoDB emulator, so rooms, grace periods, limits and errors behave the same. Only authentication differs: it accepts `?token=dev:<userId>:<displayName>` and nothing else. The deployed API only accepts real Cognito tokens.

The frontend side is `cd frontend && npm run dev:local`. It skips sign-in and gives each browser tab its own identity (`http://localhost:5173/?as=alice`), so two tabs are two players. This bypass only works in the Vite dev server and is compiled out of production builds.
