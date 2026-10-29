# Tasks: 2-Player Online XO

- [x] 1. Engine: `src/examples/xo/xo.ts` (pure) and `xo.test.ts` (R1.x)
- [x] 2. Messages: `src/examples/xo/messages.ts` typed union, validation, typed send/on (R2.x), `messages.test.ts`
- [x] 3. Controller: `src/examples/xo/controller.ts` host-authoritative protocol, sync, reconnect, host change, forfeit (R3.x, R5.x), `controller.test.ts`
- [x] 4. Helpers: `src/examples/xo/roles.ts` (also holds `GameView`) and `src/examples/xo/errors.ts`, `roles.test.ts`
- [x] 5. React binding: `src/examples/xo/useGame.ts`
- [x] 6. Screens: `Lobby.tsx`, `Board.tsx`, `GameScreen.tsx`, `ResultScreen.tsx`, `XoGame.tsx` with all required `data-testid`s (R4.x), `screens.test.tsx`
- [x] 7. Styles appended to `styles.css` (board, cells, win highlight, banners, phone width)
- [x] 8. `App.tsx`: render `XoGame` instead of `RoomPlayground`, keep sign-in flow (R0.3)
- [x] 9. Verify: `npm run build`, `npm test` (102 tests passing)
- [x] 10. End-to-end check against the local realtime server with two clients (R7.3): full game, guest drop and resync, host drop and resync, forfeit on leave, lobby error codes. Temporary test file removed.
- [x] 11. Document how to play locally in `frontend/README.md`
