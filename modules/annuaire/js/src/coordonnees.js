import { texte, icone, pairesParCode, textesParCode } from '@logibtp/socle/dictionnaire';
import { emailValide } from './identifiants.js';

// Coordonnées partagées (adresses, téléphones, e-mails, web) : natures, usages, contrôles et plan d'enregistrement.
// Réplique de PlanCoordonnees.cs (jeu partagé modules/annuaire/tests/cas/02_coordonnees.json).
//
// Usage d'une coordonnée par une fiche (forme des champs gérés « coordonnees ») :
//   { uco_id, coo_id, nature, usage, libelle, principal, ligne1, ligne2, ligne3, code_postal, ville, pays, valeur, reseau,
//     origine: { valeurs lues }, partages: [{ type, id, libelle, usage }], choix: 'MODIFICATION' | 'AUTRE' }
// origine : valeurs de la coordonnée à la lecture (ou à la reprise d'une coordonnée d'une autre fiche) ; elle sert à
// savoir si l'utilisateur a changé la coordonnée, et au serveur à détecter une modification faite entre-temps.

const nature = (code, nomIcone, usages) => ({
  code, libelle: texte(`annuaire.natures.${code}.libelle`), un: texte(`annuaire.natures.${code}.un`), icone: icone(nomIcone),
  usages: pairesParCode(`annuaire.natures.${code}.usages`, usages),
});

export const NATURES = [
  nature('ADRESSE', 'annuaire_adresse', ['PRINCIPALE', 'SIEGE', 'FACTURATION', 'COMMANDE', 'LIVRAISON', 'PERSONNELLE', 'AUTRE']),
  nature('TELEPHONE', 'annuaire_telephone', ['FIXE', 'PORTABLE', 'PRO', 'PERSO', 'STANDARD', 'FAX', 'AUTRE']),
  nature('EMAIL', 'annuaire_email', ['PRO', 'PERSO', 'FACTURATION', 'COMMANDE', 'AUTRE']),
  nature('WEB', 'annuaire_web', ['SITE', 'PAGE', 'RESEAU', 'PSEUDO', 'AUTRE']),
];

export const RESEAUX = pairesParCode('annuaire.reseaux', ['LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'X', 'YOUTUBE', 'TIKTOK', 'AUTRE']);

/** Champs de valeur d'une coordonnée selon sa nature. */
export const CHAMPS_NATURE = {
  ADRESSE: ['ligne1', 'ligne2', 'ligne3', 'code_postal', 'ville', 'pays'],
  TELEPHONE: ['valeur'],
  EMAIL: ['valeur'],
  WEB: ['valeur', 'reseau'],
};

export const CHOIX = { MODIFICATION: 'MODIFICATION', AUTRE: 'AUTRE' };

const nettoye = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Valeurs normalisées d'une coordonnée (textes sans espaces de bord, vides à null, pays d'une adresse : FR par défaut). */
export function valeursCoordonnee(c) {
  const v = {};
  for (const k of CHAMPS_NATURE[c.nature] ?? []) v[k] = nettoye(c[k]);
  if (c.nature === 'ADRESSE') v.pays = (v.pays ?? 'FR').toUpperCase();
  if (c.nature === 'EMAIL' && v.valeur) v.valeur = v.valeur.toLowerCase();
  return v;
}

/** Coordonnée sans valeur saisie (ligne proposée par défaut et laissée vide). */
export function estVide(c) {
  const v = valeursCoordonnee(c);
  return Object.entries(v).every(([k, x]) => x === null || (k === 'pays' || k === 'reseau'));
}

export const memesValeurs = (a, b) => {
  const x = valeursCoordonnee(a), y = valeursCoordonnee({ ...b, nature: a.nature });
  return Object.keys(x).every((k) => x[k] === y[k]);
};

/** Texte affichable d'une coordonnée (adresse sur une ligne). */
export function texteCoordonnee(c) {
  const v = valeursCoordonnee(c);
  if (c.nature !== 'ADRESSE') return v.valeur ?? '';
  return [v.ligne1, v.ligne2, v.ligne3, [v.code_postal, v.ville].filter(Boolean).join(' '), v.pays !== 'FR' ? v.pays : null].filter(Boolean).join(', ');
}

export const MESSAGES_COORDONNEES = textesParCode('annuaire.coordonnees.erreurs', ['ADRESSE', 'PAYS', 'EMAIL', 'TELEPHONE', 'WEB', 'NATURE', 'CHOIX']);

/** Contrôle d'une coordonnée non vide : { champ, code } ou null. */
export function erreurCoordonnee(c) {
  if (!CHAMPS_NATURE[c.nature]) return { champ: 'nature', code: 'NATURE' };
  const v = valeursCoordonnee(c);
  switch (c.nature) {
    case 'ADRESSE':
      if (!v.ligne1 && !v.ville) return { champ: 'ligne1', code: 'ADRESSE' };
      if (!/^[A-Z]{2}$/.test(v.pays)) return { champ: 'pays', code: 'PAYS' };
      return null;
    case 'EMAIL': return emailValide(v.valeur) ? null : { champ: 'valeur', code: 'EMAIL' };
    case 'TELEPHONE': return /^\+?[0-9 .\-()]{6,25}$/.test(v.valeur ?? '') && (v.valeur.match(/[0-9]/g) ?? []).length >= 6 ? null : { champ: 'valeur', code: 'TELEPHONE' };
    default: return v.valeur ? null : { champ: 'valeur', code: 'WEB' };
  }
}

/**
 * Plan d'enregistrement des coordonnées d'une fiche.
 *  existantes : uco_id des usages actuels de la fiche (base) ;
 *  saisies    : usages saisis (forme ci-dessus), dans l'ordre d'affichage ;
 *  partages   : { coo_id: nombre d'usages de la coordonnée par d'autres fiches (ou par un autre usage de la fiche) }.
 *
 * Règles : une saisie vide est ignorée (un usage existant vidé est supprimé) ; une coordonnée modifiée et partagée
 * demande un choix (MODIFICATION : la coordonnée partagée est modifiée ; AUTRE : une nouvelle coordonnée remplace
 * celle-ci pour cette fiche seulement) ; par nature, un seul usage principal (le premier coché, sinon le premier) ;
 * ordre = rang dans la nature.
 *
 * Résultat : { operations, erreurs: [{ index, champ, code, message }], choix_requis: [{ index, coo_id, partages }] } ;
 * operations : { op: 'SUPPRIMER', uco_id } puis, par saisie, { op: 'AJOUTER' | 'MAJ', index, uco_id, coo_id,
 * coordonnee: 'GARDER' | 'MODIFIER' | 'NOUVELLE', valeurs (MODIFIER, NOUVELLE), nature, usage, libelle, principal, ordre }.
 */
export function planifierCoordonnees({ existantes = [], saisies = [], partages = {} }) {
  const erreurs = [], choix = [], operations = [];
  const retenues = saisies.map((s, index) => ({ s, index })).filter(({ s }) => !estVide(s));
  const connus = new Set(existantes.map(Number));

  // Usage principal et ordre par nature.
  const parNature = new Map();
  for (const r of retenues) {
    if (!parNature.has(r.s.nature)) parNature.set(r.s.nature, []);
    parNature.get(r.s.nature).push(r);
  }
  for (const liste of parNature.values()) {
    const principal = liste.find((r) => r.s.principal === true) ?? liste[0];
    liste.forEach((r, i) => { r.principal = r === principal; r.ordre = i; });
  }

  const gardes = new Set(retenues.filter(({ s }) => s.uco_id !== null && s.uco_id !== undefined && connus.has(Number(s.uco_id))).map(({ s }) => Number(s.uco_id)));
  for (const id of existantes) if (!gardes.has(Number(id))) operations.push({ op: 'SUPPRIMER', uco_id: Number(id) });

  for (const r of retenues) {
    const { s, index } = r;
    const err = erreurCoordonnee(s);
    if (err) { erreurs.push({ index, ...err, message: MESSAGES_COORDONNEES[err.code] }); continue; }
    const existant = s.uco_id !== null && s.uco_id !== undefined && connus.has(Number(s.uco_id));
    const cooId = s.coo_id === null || s.coo_id === undefined ? null : Number(s.coo_id);
    const usage = { nature: s.nature, usage: nettoye(s.usage), libelle: nettoye(s.libelle), principal: r.principal, ordre: r.ordre };
    let coordonnee = 'NOUVELLE';
    if (cooId !== null) {
      const change = !memesValeurs(s, s.origine ?? s);
      const autres = Number(partages[cooId] ?? 0);
      if (!change) coordonnee = 'GARDER';
      else if (autres === 0) coordonnee = 'MODIFIER';
      else if (s.choix === CHOIX.MODIFICATION) coordonnee = 'MODIFIER';
      else if (s.choix === CHOIX.AUTRE) coordonnee = 'NOUVELLE';
      else { choix.push({ index, coo_id: cooId, partages: autres }); continue; }
    }
    const op = {
      op: existant ? 'MAJ' : 'AJOUTER', index, uco_id: existant ? Number(s.uco_id) : null, coo_id: coordonnee === 'NOUVELLE' ? null : cooId,
      coordonnee, ...(coordonnee === 'GARDER' ? {} : { valeurs: valeursCoordonnee(s) }), ...usage,
    };
    operations.push(op);
  }
  return { operations, erreurs, choix_requis: choix };
}

/** Coordonnées par défaut d'une nouvelle fiche : une adresse, un téléphone, un e-mail (principaux, vides). */
export function coordonneesParDefaut({ telephone = 'FIXE', email = 'PRO', adresse = 'PRINCIPALE' } = {}) {
  return [
    { uco_id: null, coo_id: null, nature: 'ADRESSE', usage: adresse, principal: true, pays: 'FR' },
    { uco_id: null, coo_id: null, nature: 'TELEPHONE', usage: telephone, principal: true },
    { uco_id: null, coo_id: null, nature: 'EMAIL', usage: email, principal: true },
  ];
}

/** Coordonnée principale d'une nature parmi des usages (texte), ou null. */
export function principale(usages, nature) {
  const l = (usages ?? []).filter((u) => u.nature === nature && !estVide(u));
  const p = l.find((u) => u.principal) ?? l[0];
  return p ? texteCoordonnee(p) : null;
}
