// Nickname validation + profanity filter. Pure TS, no imports: runs in the browser (Vite) and in Deno Edge Functions.

export type NicknameResult = { ok: true; nickname: string } | { ok: false; reason: 'invalid' | 'profane' };

const ALLOWED = /^[A-Za-z0-9äöüÄÖÜß_\- ]{3,16}$/;

// Matched as substring of the joined, normalized name. Unambiguous words only. Umlauts written as ae/oe/ue/ss.
const STRONG = [
  // DE insults / obscenities
  'hurensohn', 'wichser', 'fotze', 'fick', 'arschloch', 'schlampe', 'nutte', 'bastard', 'penner', 'vollidiot',
  'missgeburt', 'scheiss', 'drecksau', 'titten', 'pimmel', 'kacke', 'muschi', 'wixer', 'spastiker', 'behindert',
  'mongoloid', 'krueppel', 'schwuchtel', 'kanake', 'neger', 'zigeuner',
  // Nazi
  'hitler', 'siegheil', 'judensau', 'gaskammer', 'holocaust', 'auschwitz',
  // EN
  'fuck', 'shit', 'pussy', 'whore', 'faggot', 'retard', 'nigger', 'nigga', 'asshole', 'bitch', 'wanker',
  'porno', 'penis', 'vagina', 'dildo', 'blowjob', 'jizz', 'tranny', 'pedophile', 'paedophile', 'motherf',
];

// Matched only as a whole token (or the whole joined name): short words that hide inside harmless names.
const TOKEN = [
  'ass', 'sex', 'fag', 'dick', 'cock', 'cunt', 'anal', 'anus', 'tit', 'tits', 'cum', 'slut', 'rape', 'rapist',
  'porn', 'twat', 'dyke', 'kike', 'spic', 'chink', 'negro', 'homo', 'boobs', 'bimbo', 'pedo', 'paedo',
  'hure', 'arsch', 'spast', 'spasti', 'spacko', 'behindi', 'mongo', 'opfer', 'idiot', 'kot', 'schwanz',
  'nazi', 'nazis', 'adolf', 'heil', 'ss', 'hh', '88',
];

// Each letter may repeat ("fuuuck"), but a doubled letter in the word stays required ("nutte" != "minute").
const stretch = (w: string) => w.split('').map((c) => c + '+').join('');
const STRONG_RE = STRONG.map((w) => new RegExp(stretch(w)));
const TOKEN_RE = TOKEN.map((w) => new RegExp('^' + stretch(w) + '$'));

const LEET: Record<string, string> = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

// All spellings worth checking: two umlaut foldings x two readings of '1'.
function variants(name: string): string[] {
  const lower = name.toLowerCase().replace(/ß/g, 'ss');
  const folds = [
    lower.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'),
    lower.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u'),
  ];
  const out: string[] = [];
  for (const f of folds) {
    const base = f.replace(/[03457@$]/g, (c) => LEET[c]);
    out.push(base.replace(/1/g, 'i'), base.replace(/1/g, 'l'));
  }
  return out;
}

function isProfane(name: string): boolean {
  for (const v of variants(name)) {
    const tokens = v.split(/[\s_.\-]+/).filter(Boolean);
    const joined = tokens.join('');
    if (STRONG_RE.some((re) => re.test(joined))) return true;
    if ([...tokens, joined].some((t) => TOKEN_RE.some((re) => re.test(t)))) return true;
  }
  return false;
}

export function checkNickname(raw: string): NicknameResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid' };
  const nickname = raw.trim();
  if (!ALLOWED.test(nickname) || nickname.includes('  ')) return { ok: false, reason: 'invalid' };
  if (isProfane(nickname)) return { ok: false, reason: 'profane' };
  return { ok: true, nickname };
}

// ---------------------------------------------------------------- chat messages

export type ChatResult = { ok: true; text: string } | { ok: false; reason: 'empty' | 'too_long' | 'profane' | 'link' };

const CHAT_MAX = 200;

// Control, format (zero-width, bidi) and lone surrogate characters, plus blank "letters" (Hangul fillers, braille blank).
const INVISIBLE = /[\p{Cf}\p{Cs}͏ᅟᅠ឴឵⠀ㅤﾠ]|(?!\s)\p{Cc}/gu;

// Fine to ban in a name, but normal in a sentence: "heil geblieben", "aus HH", "Elo 88", "Feld 5 5".
const NOT_IN_CHAT = ['ss', 'hh', '88', 'heil'];
const CHAT_TOKEN_RE = TOKEN.filter((w) => !NOT_IN_CHAT.includes(w)).map((w) => new RegExp('^' + stretch(w) + '$'));
const STRONG_WHOLE_RE = STRONG.map((w) => new RegExp('^' + stretch(w) + '$'));

// "Du bist ein Ass" (ace) and "ich aß" (ate) are not the English insult.
const HARMLESS_ASS = /(?<!\p{L})(?:(?:ein|einem|einen|das|dem|kein|wie)\s+ass|aß)(?!\p{L})/gu;

const NON_WORD = /[^\p{L}\p{N}@$]+/u; // @ and $ are leetspeak letters

// All digits is a number ("Elo 455"), not leetspeak.
const hits = (word: string, res: RegExp[]) =>
  !/^\p{N}+$/u.test(word) && variants(word).some((v) => res.some((re) => re.test(v)));

function hasProfaneWord(s: string): boolean {
  const words = s.split(/\s+/).map((chunk) => chunk.split(NON_WORD).filter(Boolean)).filter((parts) => parts.length);
  const joined = words.map((parts) => parts.join(''));

  for (const [i, parts] of words.entries()) {
    if (parts.some((p) => hits(p, STRONG_RE)) || hits(joined[i], STRONG_WHOLE_RE)) return true;
    if (parts.concat(joined[i]).some((p) => hits(p, CHAT_TOKEN_RE))) return true;
    // "h.u.r.e", "s-hit": tiny fragments are obfuscation. "Nass-Hitze" has none and must not read as "shit".
    if (parts.some((p) => p.length <= 2) && hits(joined[i], STRONG_RE)) return true;
  }

  // "a r s c h": a run of single characters is one word. All digits ("7 1 7") is not.
  let run = '';
  for (const w of [...joined, '']) {
    if ([...w].length === 1) {
      run += w;
      continue;
    }
    if ([...run].length >= 3 && /[\p{L}@$]/u.test(run) && (hits(run, STRONG_RE) || hits(run, CHAT_TOKEN_RE))) return true;
    run = '';
  }

  // "sieg heil", "fu ck": neighbours that are exactly a listed word. Never a substring, so "das hit" is not "shit".
  for (let i = 0; i < joined.length; i++) {
    for (let n = 2; n <= 4 && i + n <= joined.length; n++) {
      if (hits(joined.slice(i, i + n).join(''), STRONG_WHOLE_RE)) return true;
    }
  }
  return false;
}

function isProfaneChat(text: string): boolean {
  // Width and accent tricks fold to plain letters. Umlauts and ß stay for variants().
  const s = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^äöüß]/gu, (c) => c.normalize('NFD').replace(/\p{Mn}/gu, ''))
    .replace(HARMLESS_ASS, ' ');
  if (hasProfaneWord(s)) return true;
  // "f*ck": a star inside a word hides one vowel.
  return /\p{L}\*+\p{L}/u.test(s) && [...'aeiou'].some((v) => hasProfaneWord(s.replace(/(?<=\p{L})\*+(?=\p{L})/gu, v)));
}

// shortcut: leaves out TLDs that are everyday words after a missing space ("Schade.Es war gut"), so foo.es only
// counts with a scheme or www. Add more if abuse shows up.
const TLD =
  'de|com|net|org|info|biz|eu|at|ch|uk|fr|nl|pl|ru|tr|it|be|me|to|io|co|tv|gg|ly|cc|ws|su|cn|br|tk|app|dev|xyz|site|online|shop|club|link|ai|pw|xxx|lol|top|vip|live|cloud|tech';
// The end of a label that has a letter ("Platz 3.de" is no address worth a false alarm). Only the end: matching the whole
// label backtracks cubically, and NFKC turns 200 characters into 1200 letters (7 s of CPU).
const LABEL = '\\p{L}[\\p{N}-]*';
const LINK = [
  /[a-z][a-z0-9+.-]*:\/\//, // any scheme
  /(?<![\p{L}\p{N}])www\s*\./u,
  /[\p{L}\p{N}._%+-]+\s*(?:@|\(at\)|\[at\])\s*[\p{L}\p{N}-]+\s*\.\s*\p{L}{2,}/u, // e-mail
  new RegExp(`${LABEL}\\.(?:${TLD})(?![\\p{L}\\p{N}])`, 'u'), // foo.de
  // "foo . de", "foo[.]com", "foo dot com": only unambiguous TLDs, since a sentence can end before "It" or "To".
  new RegExp(`${LABEL}\\s*(?:\\.|[\\[(](?:\\.|dot|punkt)[\\])]|\\s(?:dot|punkt)\\s)\\s*(?:de|com|net|org)(?![\\p{L}\\p{N}])`, 'u'),
  /(?:\p{Nd}[\s\-./()+]*){7,}/u, // phone numbers, IP addresses
  /(?<![\p{L}\p{N}])@[\p{L}\p{N}_.]{3,}/u, // @handle
  /(?<![\p{L}\p{N}])(?:insta|instagram|snap|snapchat|discord|telegram|whatsapp|tiktok)\s*:\s*\S/u, // insta: name
  /\S#\d{4}(?!\p{N})/u, // name#1234
];

const hasLink = (text: string) => {
  const s = text.normalize('NFKC').toLowerCase().replace(/。/g, '.');
  return LINK.some((re) => re.test(s));
};

/** Cleans and moderates a chat message. The returned text is what gets stored; render it as text, never as HTML. */
export function checkChat(raw: string): ChatResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
  const text = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > CHAT_MAX) return { ok: false, reason: 'too_long' };
  if (isProfaneChat(text)) return { ok: false, reason: 'profane' };
  if (hasLink(text)) return { ok: false, reason: 'link' };
  return { ok: true, text };
}
