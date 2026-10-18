// Codes-barres et QR codes (§ 3.14).
// Code 39 : police Libre Barcode 39 ; la donnée est contrôlée (chiffres, majuscules, espace, - . $ / + %) et
// encadrée de « * ». QR : matrice calculée en JS (qrcode-generator), dessinée en carrés vectoriels par les rendus.
import qrcode from 'qrcode-generator';

const CODE39 = /^[0-9A-Z \-.$/+%]*$/;

/** { texte (à écrire dans la police), donnee } ou { erreur }. Les minuscules passent en majuscules. */
export function code39(valeur) {
  const donnee = String(valeur ?? '').trim().toUpperCase();
  if (!donnee) return { erreur: 'Code 39 : donnée vide' };
  if (!CODE39.test(donnee)) {
    const interdits = [...new Set([...donnee].filter((c) => !CODE39.test(c)))].join(' ');
    return { erreur: `Code 39 : caractère(s) non admis « ${interdits} » (chiffres, A-Z, espace, - . $ / + %)` };
  }
  return { texte: `*${donnee}*`, donnee };
}

/** Chaîne JS → octets UTF-8 sous forme de chaîne binaire (un caractère par octet) pour qrcode-generator. */
function utf8(s) {
  let r = '';
  for (const c of String(s)) {
    const cp = c.codePointAt(0);
    if (cp < 0x80) r += String.fromCharCode(cp);
    else if (cp < 0x800) r += String.fromCharCode(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) r += String.fromCharCode(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else r += String.fromCharCode(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return r;
}

/**
 * Matrice d'un QR code : { taille (modules, zone blanche de 4 modules comprise), rangees: ['0110…'] }.
 * Correction L, M (défaut), Q ou H.
 */
export function matriceQr(texte, correction = 'M') {
  const q = qrcode(0, ['L', 'M', 'Q', 'H'].includes(correction) ? correction : 'M');
  q.addData(utf8(texte), 'Byte');
  q.make();
  const n = q.getModuleCount();
  const marge = 4;
  const rangees = [];
  for (let r = -marge; r < n + marge; r++) {
    let s = '';
    for (let c = -marge; c < n + marge; c++) s += r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c) ? '1' : '0';
    rangees.push(s);
  }
  return { taille: n + 2 * marge, rangees };
}

/** Rectangles noirs d'une matrice (suites horizontales fusionnées) : [{ x, y, l }] en modules. */
export function rectanglesQr(rangees) {
  const res = [];
  rangees.forEach((s, y) => {
    let x = 0;
    while (x < s.length) {
      if (s[x] !== '1') { x++; continue; }
      let f = x;
      while (f < s.length && s[f] === '1') f++;
      res.push({ x, y, l: f - x });
      x = f;
    }
  });
  return res;
}
