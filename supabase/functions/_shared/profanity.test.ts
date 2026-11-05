import { describe, it, expect } from 'vitest';
import { checkNickname } from './profanity.ts';

describe('checkNickname', () => {
  it('accepts valid names and trims them', () => {
    expect(checkNickname('  Tim  ')).toEqual({ ok: true, nickname: 'Tim' });
    for (const n of ['Max_123', 'Lisa-Marie', 'Jürgen', 'Größe', 'Mia', 'Anna Lena', 'abcdefghijklmnop']) {
      expect(checkNickname(n)).toEqual({ ok: true, nickname: n });
    }
  });

  it.each(['', 'ab', '   ab  ', 'abcdefghijklmnopq', 'Tim😀', 'Tim  Max', '<script>', 'a@b.de', 'Tim.', 'Tim\tMax'])(
    'rejects invalid %j',
    (n) => expect(checkNickname(n)).toEqual({ ok: false, reason: 'invalid' }),
  );

  it('rejects non-string input', () => {
    for (const n of [null, undefined, 42, {}, ['Tim']]) {
      expect(checkNickname(n as unknown as string)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it.each([
    'Hitler', 'H1tl3r', 'Hiiitler', 'Hur3n_S0hn', 'Hurensöhn', 'f u c k', 'Fuuuuck', 'W1chs3r', 'Fotze', 'spast',
    'N1gg3r', 'Missgeburt', 'arschl0ch', 'Schwuchtel', 'SiegHeil', 'Sieg Heil', 'Penner', 'xX_Nazi_Xx', 'Max ss',
    'Scheiße', 'Krüppel', 'big dick', 'Opfer', 'ficken123', 'Faggot', 'Retard', 'Arsch',
  ])('rejects profane %j', (n) => expect(checkNickname(n)).toEqual({ ok: false, reason: 'profane' }));

  it.each([
    'Hansi', 'Klassiker', 'Cassandra', 'Scunthorpe', 'Sussex', 'Matthias', 'Analena', 'Dickens', 'Hancock',
    'Grape', 'Therapist', 'Assassin', 'Bass', 'Glas', 'Tim', 'Nazareth', 'Hitchcock', 'Cocktail', 'Minute',
    'Niger', 'Fagott', 'Janus', 'Barsch', 'Mongolei',
  ])('accepts harmless %j', (n) => expect(checkNickname(n).ok).toBe(true));
});
