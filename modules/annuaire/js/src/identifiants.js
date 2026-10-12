// Identifiants des personnes (facturation électronique, règlement) : SIREN, SIRET, TVA intracommunautaire, IBAN, BIC.
// Réplique de Identifiants.cs (jeu partagé modules/annuaire/tests/cas/01_identifiants.json).

/** Texte sans espaces, points, tirets ni barres, en majuscules. */
export const compacter = (v) => String(v ?? '').replace(/[\s.\-/]/g, '').toUpperCase();

const vide = (v) => v === null || v === undefined || String(v).trim() === '';

/** Clé de Luhn valide (somme des chiffres, un sur deux doublé depuis la droite, multiple de 10). */
export function luhn(chiffres) {
  if (!/^[0-9]+$/.test(chiffres)) return false;
  let somme = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let n = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    somme += n;
  }
  return somme % 10 === 0;
}

/** SIREN : 9 chiffres, clé de Luhn (La Poste, 356000000, fait exception). */
export const sirenValide = (s) => /^[0-9]{9}$/.test(s) && (s === '356000000' || luhn(s));

/** SIRET : 14 chiffres, clé de Luhn (La Poste, SIREN 356000000 : somme des chiffres multiple de 5, sauf le siège). */
export function siretValide(s) {
  if (!/^[0-9]{14}$/.test(s)) return false;
  if (s.startsWith('356000000')) return s === '35600000000048' || [...s].reduce((a, c) => a + Number(c), 0) % 5 === 0;
  return luhn(s);
}

/** Clé de TVA française d'un SIREN : (12 + 3 × (SIREN mod 97)) mod 97, sur 2 chiffres. */
export function cleTva(siren) {
  return String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0');
}

export const tvaDepuisSiren = (siren) => (sirenValide(siren) ? `FR${cleTva(siren)}${siren}` : null);

/** Préfixes de TVA intracommunautaire (Grèce : EL ; Irlande du Nord : XI). */
export const PAYS_TVA = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI'];

/** Format d'un numéro de TVA intracommunautaire ; France : clé contrôlée si numérique. */
export function tvaValide(tva) {
  const t = compacter(tva);
  if (t.startsWith('FR')) {
    const m = /^FR([0-9A-Z]{2})([0-9]{9})$/.exec(t);
    if (!m) return false;
    return /^[0-9]{2}$/.test(m[1]) ? m[1] === cleTva(m[2]) : true;
  }
  return PAYS_TVA.includes(t.slice(0, 2)) && /^[0-9A-Z+*]{2,13}$/.test(t.slice(2));
}

/** IBAN : 15 à 34 caractères, pays, clé modulo 97 (= 1). */
export function ibanValide(iban) {
  const t = compacter(iban);
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]{11,30}$/.test(t)) return false;
  const r = t.slice(4) + t.slice(0, 4);
  let reste = 0;
  for (const c of r) {
    const n = /[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55);
    for (const d of n) reste = (reste * 10 + Number(d)) % 97;
  }
  return reste === 1;
}

export const bicValide = (bic) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compacter(bic));

export const emailValide = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());

/** IBAN affiché par groupes de 4 caractères. */
export const formaterIban = (v) => compacter(v).replace(/(.{4})(?=.)/g, '$1 ');

/** Téléphone français à 10 chiffres affiché par paires (06 12 34 56 78) ; autre numéro inchangé. */
export function formaterTelephone(v) {
  const s = String(v ?? '').trim();
  const c = s.replace(/[\s.\-]/g, '');
  if (/^0[1-9][0-9]{8}$/.test(c)) return c.replace(/(\d{2})(?=\d)/g, '$1 ');
  if (/^\+33[1-9][0-9]{8}$/.test(c)) return `+33 ${c[3]} ${c.slice(4).replace(/(\d{2})(?=\d)/g, '$1 ')}`;
  return s;
}

export const MESSAGES_IDENTIFIANTS = {
  SIREN: 'SIREN invalide (9 chiffres, clé de contrôle)',
  SIRET: 'SIRET invalide (14 chiffres, clé de contrôle)',
  SIRET_SIREN: 'Le SIRET ne commence pas par le SIREN',
  TVA: 'Numéro de TVA intracommunautaire invalide',
  TVA_SIREN: 'Le numéro de TVA ne correspond pas au SIREN',
  IBAN: 'IBAN invalide',
  BIC: 'BIC invalide',
  PAYS: 'Code pays sur 2 lettres (ISO)',
};

/**
 * Contrôles des identifiants d'une personne : [{ champ, code, message }]. En France, SIREN et SIRET sont contrôlés
 * (clé) et cohérents entre eux et avec la TVA ; hors France, ils ne sont pas attendus (identifiant étranger).
 * Valeurs : { pays, siren, siret, tva_intra, iban, bic }.
 */
export function erreursIdentifiants(v) {
  const erreurs = [];
  const e = (champ, code) => erreurs.push({ champ, code, message: MESSAGES_IDENTIFIANTS[code] });
  const pays = vide(v.pays) ? 'FR' : String(v.pays).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(pays)) e('pays', 'PAYS');
  const siren = compacter(v.siren), siret = compacter(v.siret);
  if (!vide(v.siren) && !sirenValide(siren)) e('siren', 'SIREN');
  if (!vide(v.siret)) {
    if (!siretValide(siret)) e('siret', 'SIRET');
    else if (!vide(v.siren) && sirenValide(siren) && !siret.startsWith(siren)) e('siret', 'SIRET_SIREN');
  }
  if (!vide(v.tva_intra)) {
    const tva = compacter(v.tva_intra);
    const base = sirenValide(siren) ? siren : siretValide(siret) ? siret.slice(0, 9) : null;
    if (!tvaValide(tva)) e('tva_intra', 'TVA');
    else if (tva.startsWith('FR') && base && tva.slice(4) !== base) e('tva_intra', 'TVA_SIREN');
  }
  if (!vide(v.iban) && !ibanValide(v.iban)) e('iban', 'IBAN');
  if (!vide(v.bic) && !bicValide(v.bic)) e('bic', 'BIC');
  return erreurs;
}
