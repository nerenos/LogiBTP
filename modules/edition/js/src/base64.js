// Base64 sans atob / btoa (absents de Jint) : échange d'octets avec le serveur.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function base64VersOctets(s) {
  const t = String(s ?? '').replace(/[^A-Za-z0-9+/]/g, '');
  const res = new Uint8Array(Math.floor((t.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < t.length; i += 4) {
    const a = INDEX.get(t[i]) ?? 0; const b = INDEX.get(t[i + 1]) ?? 0;
    const c = INDEX.get(t[i + 2]); const d = INDEX.get(t[i + 3]);
    res[j++] = (a << 2) | (b >> 4);
    if (c !== undefined) res[j++] = ((b & 15) << 4) | (c >> 2);
    if (d !== undefined) res[j++] = ((c & 3) << 6) | d;
  }
  return res.slice(0, j);
}

export function octetsVersBase64(o) {
  let r = '';
  for (let i = 0; i < o.length; i += 3) {
    const a = o[i]; const b = o[i + 1]; const c = o[i + 2];
    r += ALPHABET[a >> 2] + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]
      + (b === undefined ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : ALPHABET[c & 63]);
  }
  return r;
}
