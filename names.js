// Display-name rules shared by the server (authoritative) and the page (instant feedback).
// Cleans control/invisible characters, limits length, and rejects slurs and profanity, including
// spaced-out, repeated-letter and look-alike spellings (f.u.c.k, fuuuck, 5h1t). Not perfect; reports can still be handled by hand.
(function (root) {
  'use strict';
  // Rejected anywhere inside a name (distinctive enough not to hit ordinary words).
  const ANYWHERE = ['nigg', 'faggot', 'fagot', 'retard', 'tranny', 'hitler', 'rapist', 'molest', 'cocksuck', 'motherfuck', 'fuck', 'shit',
    'bitch', 'whore', 'cunt', 'asshole', 'bastard', 'dickhead', 'pussy', 'blowjob', 'handjob', 'jizz', 'wanker', 'kkk', 'heil', 'nazis',
    'porn', 'hentai', 'semen', 'dildo', 'paedo', 'pedophile', 'beaner', 'wetback', 'chingchong', 'raghead', 'towelhead', 'sandnigg'];
  // Rejected as a whole word (these letters also appear inside ordinary names and words).
  const WORDS = ['ass', 'arse', 'dick', 'cock', 'cum', 'sex', 'tit', 'tits', 'boob', 'boobs', 'spic', 'chink', 'coon', 'kike', 'gook', 'nazi',
    'pedo', 'rape', 'slut', 'anal', 'fag', 'dyke', 'twat', 'wank', 'prick', 'piss', 'negro', 'homo', 'nonce', 'isis', 'jihad', 'sieg'];
  const pattern = w => w.split('').map(c => c + '+').join('');
  const anywhere = new RegExp('(' + ANYWHERE.map(pattern).join('|') + ')');
  const whole = new RegExp('^(' + WORDS.map(pattern).join('|') + ')$');
  const LEET = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't', '(': 'c' };
  const INVISIBLE = new RegExp('[' + [[0, 31], [127, 159], [173, 173], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]]
    .map(([a, b]) => String.fromCharCode(a) + (b > a ? '-' + String.fromCharCode(b) : '')).join('').replace(/[\]\\^-]/g, m => m === '-' ? '-' : '\\' + m) + ']', 'g');
  const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'); // accents, so 'Fück' reads as 'Fuck'
  function clean(x) { return String(x == null ? '' : x).normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().slice(0, 24); }
  function forms(name) {
    const base = name.toLowerCase().normalize('NFKD').replace(MARKS, '');
    return ['i', 'l'].map(one => base.replace(/[0-9@$!|+(]/g, c => c === '1' ? one : LEET[c] || c));
  }
  function offensive(name) {
    for (const f of forms(name)) {
      if (anywhere.test(f.replace(/[^a-z]/g, ''))) return true;
      for (const tok of f.split(/[^a-z]+/)) if (tok && whole.test(tok)) return true;
    }
    return false;
  }
  // Returns { ok, name } or { ok: false, error }; name is the cleaned name, or an error message when not ok.
  function check(x) {
    const name = clean(x);
    if (name.length < 2) return { ok: false, error: 'Name must be at least 2 characters.' };
    if (!/[\p{L}\p{N}]/u.test(name)) return { ok: false, error: 'Name needs a letter or number.' };
    if (offensive(name)) return { ok: false, error: 'Please choose a different name.' };
    return { ok: true, name };
  }
  const api = { clean, check, offensive };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.Names = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
