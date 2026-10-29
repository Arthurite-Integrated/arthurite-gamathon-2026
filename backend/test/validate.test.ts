import { generateCode } from '../src/shared/rooms';
import { parseClientMessage, sanitizeDisplayName } from '../src/shared/validate';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

describe('parseClientMessage', () => {
  it('parses each action', () => {
    expect(parseClientMessage('{"action":"createRoom"}')).toEqual({ action: 'createRoom', maxPlayers: 2, displayName: undefined });
    expect(parseClientMessage('{"action":"joinRoom","code":" abcd "}')).toMatchObject({ code: 'ABCD' });
    expect(parseClientMessage('{"action":"send","type":"move"}')).toEqual({ action: 'send', type: 'move', payload: {}, to: undefined });
    expect(parseClientMessage('{"action":"start"}')).toEqual({ action: 'start', settings: {} });
  });

  it('rejects bad input with a stable error code', () => {
    expect(code(() => parseClientMessage(undefined))).toBe('invalid_message');
    expect(code(() => parseClientMessage('not json'))).toBe('invalid_message');
    expect(code(() => parseClientMessage('[1,2]'))).toBe('invalid_message');
    expect(code(() => parseClientMessage('{"action":"nope"}'))).toBe('unknown_action');
    expect(code(() => parseClientMessage('{"action":"joinRoom","code":"AB"}'))).toBe('invalid_message');
    expect(code(() => parseClientMessage('{"action":"createRoom","maxPlayers":1}'))).toBe('invalid_message');
    expect(code(() => parseClientMessage('{"action":"createRoom","maxPlayers":2.5}'))).toBe('invalid_message');
    expect(code(() => parseClientMessage('{"action":"send","type":"room.x"}'))).toBe('invalid_message');
    expect(code(() => parseClientMessage('{"action":"send","type":"error"}'))).toBe('invalid_message');
    expect(code(() => parseClientMessage('{"action":"send","type":"ok","payload":[1]}'))).toBe('invalid_message');
    expect(code(() => parseClientMessage(JSON.stringify({ action: 'send', type: 'x', payload: { a: 'y'.repeat(9000) } })))).toBe('message_too_large');
  });
});

describe('helpers', () => {
  it('sanitizes display names', () => {
    expect(sanitizeDisplayName('  Ada\u0000 Lovelace  ', 'x')).toBe('Ada Lovelace');
    expect(sanitizeDisplayName('y'.repeat(40), 'x')).toHaveLength(24);
    expect(sanitizeDisplayName('   ', 'fallback')).toBe('fallback');
    expect(sanitizeDisplayName(42, 'fallback')).toBe('fallback');
  });

  it('generates 4-letter codes without I or O', () => {
    for (let i = 0; i < 200; i++) expect(generateCode(Math.random)).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
});
