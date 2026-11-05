import { describe, it, expect } from 'vitest';
import { checkChat, checkNickname } from './profanity.ts';

describe('checkChat', () => {
  it('cleans whitespace, control and zero-width characters', () => {
    expect(checkChat('  gut \n\t gespielt  ')).toEqual({ ok: true, text: 'gut gespielt' });
    expect(checkChat('g​g﻿   w‍p\u0007')).toEqual({ ok: true, text: 'gg wp' });
    expect(checkChat('a \u0001 b')).toEqual({ ok: true, text: 'a b' });
    expect(checkChat('hi\uD800')).toEqual({ ok: true, text: 'hi' }); // lone surrogate would fail in Postgres
    expect(checkChat('hi\u0000!')).toEqual({ ok: true, text: 'hi!' }); // NUL too
    expect(checkChat('gg 😀 ä ß')).toEqual({ ok: true, text: 'gg 😀 ä ß' });
  });

  it.each(['', '   ', '\n\t', '​‍﻿', '\u0007', 'ㅤ', '⠀ '])('rejects empty %j', (t) =>
    expect(checkChat(t)).toEqual({ ok: false, reason: 'empty' }),
  );

  it('rejects non-string input', () => {
    for (const t of [null, undefined, 42, {}, ['gg']]) {
      expect(checkChat(t as unknown as string)).toEqual({ ok: false, reason: 'empty' });
    }
  });

  it('limits the cleaned length to 200', () => {
    expect(checkChat('a'.repeat(200))).toEqual({ ok: true, text: 'a'.repeat(200) });
    expect(checkChat('a'.repeat(201))).toEqual({ ok: false, reason: 'too_long' });
    expect(checkChat('  ' + 'a'.repeat(200) + '​  ').ok).toBe(true);
    expect(checkChat('a '.repeat(100) + 'a')).toEqual({ ok: false, reason: 'too_long' });
    expect(checkChat('😀'.repeat(101))).toEqual({ ok: false, reason: 'too_long' }); // never above the DB check
  });

  it.each([
    // plain, inflected, case, umlauts, repeats, leetspeak
    'du arsch', 'Arschloch!', 'HURENSOHN', 'du hurensöhn', 'Scheiße', 'scheisse', 'so ein Wichser', 'W1chs3r', 'fuuuuck',
    'fuck you', 'you ass', 'kiss my ass', 'Bitch', 'b1tch', 'sh1t', '$hit', '@rschl0ch', 'du Fotze', 'Krüppel', 'Nutte',
    'du Opfer', 'Idiot', 'du spast', 'Schlampe', 'Heil Hitler', 'H1tl3r', 'Missgeburt',
    // split with spaces
    'a r s c h', 'A R S C H', 'du a r s c h du', 'h u r e n s o h n', 'f u c k', 'a s s', 'f u c k   y o u', 's 3 x',
    'a - r - s - c - h', 'sieg heil', 'Sieg  Heil', 'arsch loch', 'hurens ohn', 'fu ck', 'fi ck dich',
    // split with other characters
    'h.u.r.e.n.s.o.h.n', 'a.r.s.c.h', 'a-r-s-c-h', 'a_r_s_c_h', 'f.u.c.k', 'f-u-c-k', 'f,u,c,k', 'a/r/s/c/h', 'a🙂r🙂s🙂c🙂h',
    'hur-ens-ohn', 'arsch-loch', 'arsch,du', 'gut,arsch', 's-hit',
    // invisible and lookalike tricks
    'a​r​s​c​h', 'fㅤuck', 'ｆｕｃｋ', 'f̶u̶c̶k̶', 'fúck', 'Äｒsch',
    // star masks
    'f*ck', 'sh*t', 'f**ck', 'b*tch',
  ])('rejects profane %j', (t) => expect(checkChat(t)).toEqual({ ok: false, reason: 'profane' }));

  it.each([
    // greetings and the game
    'gg', 'GG', 'gg wp', 'wp', 'good game', 'Good game!', 'nice move', 'well played', 'rematch?', 'glhf', 'ez', 'hi', 'Hallo',
    'Schöner Zug', 'schöner zug!', 'Gut gespielt', 'Danke für das Spiel', 'Noch eine Runde?', 'Viel Glück', 'Oh nein',
    // spec sentences and words that hide a listed word
    'das hat ich nicht', 'das hit war gut', 'was hit', 'Assist', 'Klasse', 'Analyse', 'klasse Zug', 'Massive', 'Pass auf',
    'dass du gewinnst', 'Ich hasse verlieren', 'Hass', 'Das passt', 'in der Mitte', 'in der Minute', 'mit ten players',
    'Therapist', 'Scunthorpe', 'Cocktail', 'Hitchcock', 'Mongolei', 'Nazareth', 'Dickens', 'Grape', 'Bass', 'Fagott',
    'Nass-Hitze', 'E-Mail', 'T-Shirt', 'Sussex', 'Spaß', 'class', 'assume', 'grass', 'titel', 'Kotflügel',
    // sentences that only look dangerous when the words run together
    'sie sehe ich nicht', 'so hat er es gemacht', 'du hast es drauf', 'an al dem', 'as soon as possible',
    'he is it', 'I will win', 'a good one', 'a b c', 'i a o', 'Du bist ein Ass', 'das Ass', 'wie ein Ass', 'Ich aß gerade',
    // chat-only exceptions to the name filter
    'heil geblieben', 'aus HH', 'Elo 88', 'Feld 5 und 5', '5 5', '7 1 7', 'Platz 1', '3 in a row', '1 2 3',
    // abbreviations and punctuation
    'z.B. oben', 'd.h. nein', 'u.a. das', 'k.o.', 'o.k.', 'usw.', 'Schade.Es war gut', 'Hallo.Wie geht es', 'gut,danke', ':)', '😀😀',
    'Elo 1200', 'von 1200 auf 1300', '10 Uhr', '12:30', '<b>hi</b>',
  ])('accepts harmless %j', (t) => expect(checkChat(t).ok).toBe(true));

  it.each([
    'http://foo.de', 'https://example.com/a?b=c', 'HTTPS://EXAMPLE.COM', 'ftp://x', 'hxxp://x', 'www.foo', 'WWW . foo',
    'foo.de', 'schau auf foo.de vorbei', 'FOO.DE', 'foo.com/bar', 'müller.de', 'foo-bar.net', 'discord.gg/abc', 't.me/foo',
    'x.com', 'foo.co.uk', 'foo . de', 'foo. com', 'foo[.]de', 'foo(.)com', 'foo (dot) com', 'foo[dot]de', 'foo dot com', 'foo punkt de',
    'ｆｏｏ．ｄｅ', 'foo。de', 'f​oo.de',
    'tim@example.com', 'tim.m+x@mail.example.org', 'tim @ example.com', 'tim (at) example.com', 'tim[at]example.com', 'a@b.xy',
    '0151 2345678', '+49 151 2345678', '+49(0)151/234-56-78', '1234567', '1 2 3 4 5 6 7', '192.168.0.1', '０１５１２３４５６７８',
  ])('rejects link or contact data %j', (t) => expect(checkChat(t)).toEqual({ ok: false, reason: 'link' }));

  it('does not treat 6 digits as a phone number', () => {
    expect(checkChat('123456').ok).toBe(true);
  });

  it('needs a letter in the label of an address', () => {
    expect(checkChat('a1-2.de')).toEqual({ ok: false, reason: 'link' });
    expect(checkChat('1a2.de')).toEqual({ ok: false, reason: 'link' });
    expect(checkChat('Platz 3.de').ok).toBe(true);
  });

  it('stays fast on inputs that NFKC expands (U+3316 becomes 6 letters)', () => {
    const start = performance.now();
    for (const t of ['㌖'.repeat(200), 'ﷲ'.repeat(200), 'a'.repeat(200)]) checkChat(t);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

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

describe('checkChat numbers and contact data', () => {
  it.each(['Elo 455', 'Elo 717', 'Platz 455', 'discord ist cool', 'Spiel #1234 war gut'])('allows %s', (t) => {
    expect(checkChat(t).ok).toBe(true);
  });
  it.each(['foo.ai', 'foo.pw', '@tim_123', 'insta: tim_123', 'discord: tim', 'tim#1234'])('rejects %s as contact data', (t) => {
    expect(checkChat(t)).toEqual({ ok: false, reason: 'link' });
  });
  it('still catches leetspeak with letters', () => {
    expect(checkChat('4rsch')).toEqual({ ok: false, reason: 'profane' });
  });
});
