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
