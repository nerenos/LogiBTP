// Module Facturation électronique, émission (plans/facturation-electronique.md, lot 16) : contrôle de complétude d'une
// facture avant son écriture. Règle miroir : ReglesCompletude.cs (jeu tests/cas/05_completude.json). Entrée : le modèle
// sémantique de ModeleFacture.cs en JSON (propriétés en camelCase, montants en nombre ou en chaîne, dates AAAA-MM-JJ).
// Règles : françaises du schematron BR-FR-Flux2 (FNFE 1.4.0.04), sommes EN16931 (BR-CO-10 à 17), profil et cadre écrits
// par LogiBTP. Résultat : liste { regle, niveau, donnee, ligne } dans l'ordre des contrôles ; niveau BLOQUANT (règle
// fatale du schematron, facture à transmettre : tiers B2B / B2G, Q5) ou AVERTISSEMENT (option bloquant à faux, BR-CO-17).

import { D, Dz, ZERO, arrondir } from '@logibtp/socle';
import {
  CADRE_FACTURATION, CATEGORIE_TVA, CODE_NOTE, NIVEAU_COMPLETUDE, PROFIL_FACTURE, REGLE_COMPLETUDE, SCHEMA_IDENTIFIANT,
  SOUS_TYPE_LIGNE, TRAITEMENT, TYPE_FACTURE, TYPE_PIECE_JOINTE,
} from './codes.js';

const R = REGLE_COMPLETUDE;
const T = TYPE_FACTURE;
const C = CADRE_FACTURATION;

/** Cadres non émis par LogiBTP : multi-vendeurs (8) et facturation bidirectionnelle (9). */
export const CADRES_NON_EMIS = Object.freeze([C.B8, C.S8, C.M8, C.B9, C.S9, C.M9]);
/** Autofactures (BR-FR-21 / 22 : l'adresse électronique contrôlée est celle du vendeur). */
export const TYPES_AUTOFACTURE = Object.freeze([T.AUTOFACTURE, T.AUTOFACTURE_AFFACTUREE, T.ACOMPTE_AUTOFACTURE,
  T.RECTIFICATIVE_AUTOFACTUREE, T.RECTIFICATIVE_AUTOFACTUREE_AFFACTUREE, T.AVOIR_AUTOFACTURE, T.AVOIR_AUTOFACTURE_AFFACTURE]);
/** Factures rectificatives (BR-FR-CO-04 : une seule facture antérieure). */
export const TYPES_RECTIFICATIFS = Object.freeze([T.RECTIFICATIVE, T.RECTIFICATIVE_AUTOFACTUREE, T.RECTIFICATIVE_AFFACTUREE,
  T.RECTIFICATIVE_AUTOFACTUREE_AFFACTUREE]);
/** Avoirs (BR-FR-CO-05 : facture antérieure en entête ou sur chaque ligne de détail). */
export const TYPES_AVOIR = Object.freeze([T.AVOIR_AUTOFACTURE, T.AVOIR, T.AVOIR_AFFACTURE, T.AVOIR_AUTOFACTURE_AFFACTURE, T.AVOIR_ACOMPTE]);
/** Acomptes (BR-FR-CO-07 / 08). */
export const TYPES_ACOMPTE = Object.freeze([T.ACOMPTE, T.ACOMPTE_AUTOFACTURE, T.AVOIR_ACOMPTE]);
/** Taux de TVA admis (BR-FR-16), comparés en valeur. */
export const TAUX_TVA_ADMIS = Object.freeze(['0', '10', '13', '20', '8.5', '19.6', '2.1', '5.5', '7', '20.6', '1.05', '0.9', '1.75', '9.2', '9.6']);

const CADRES_PAYES = [C.B2, C.S2, C.M2];
const CADRES_DEFINITIFS = [C.B4, C.S4, C.M4];
const CADRES_BIDIRECTIONNELS = [C.B9, C.S9, C.M9];
const LONGUEUR_NUMERO = 35;
const LONGUEUR_ADRESSE = 125;
const LONGUEUR_ROUTAGE = 100;
const CHIFFRES_MAX = 19;
const CHIFFRES_TAUX = 4;
const DEVISE_FRANCE = 'EUR';

const FORMAT_NUMERO = /^[A-Za-z0-9+\-_/]+$/;
const FORMAT_ADRESSE = /^[A-Za-z0-9+\-_.]+$/;
const FORMAT_SIREN = /^[0-9]{9}$/;
const FORMAT_SIRET = /^[0-9]{14}$/;
const FORMAT_DATE = /^([0-9]{4})-[0-9]{2}-[0-9]{2}$/;

/**
 * Parties contrôlées (BR-FR-09, 23, 24, 25, 26, 32), dans cet ordre : propriété du modèle, terme du SIRET, terme du SIREN
 * (groupe à défaut de terme), terme de l'adresse électronique, code de routage contrôlé (vendeur et acheteur seulement).
 */
const PARTIES = [
  ['vendeur', 'BT-29', 'BT-30', 'BT-34', true],
  ['acheteur', 'BT-46', 'BT-47', 'BT-49', true],
  ['beneficiaire', 'BT-60', 'BT-61', 'EXT-FR-FE-29', false],
  ['agentAcheteur', 'EXT-FR-FE-06', 'EXT-FR-FE-BG-01', 'EXT-FR-FE-12', false],
  ['payeur', 'EXT-FR-FE-46', 'EXT-FR-FE-BG-02', 'EXT-FR-FE-52', false],
  ['agentVendeur', 'EXT-FR-FE-69', 'EXT-FR-FE-BG-03', 'EXT-FR-FE-75', false],
];

const liste = (x) => (Array.isArray(x) ? x : []);
const present = (x) => x !== null && x !== undefined;
const chaine = (x) => (present(x) ? String(x) : '');
const annee = (d) => {
  const m = FORMAT_DATE.exec(chaine(d));
  return m ? Number.parseInt(m[1], 10) : null;
};
/** Nombre de décimales significatives et de chiffres (partie entière et décimales, sans signe ni zéros de fin). */
const decimales = (v) => D(v).decimalPlaces();
const chiffres = (v) => {
  const d = D(v).abs();
  return d.truncated().toFixed().length + d.decimalPlaces();
};
const egal = (a, b) => Dz(a).eq(Dz(b));

/**
 * Contrôle de complétude d'une facture (modèle sémantique en JSON). Option bloquant (vrai par défaut) : niveau des règles
 * fatales du schematron (BLOQUANT pour une facture transmise à un tiers B2B / B2G, AVERTISSEMENT sinon). BR-CO-17 reste un
 * avertissement. Résultat : [{ regle, niveau, donnee, ligne }] (ligne : identifiant BT-126, ou null).
 */
export function controlerCompletude(facture, { bloquant = true } = {}) {
  const f = facture ?? {};
  const niveau = bloquant ? NIVEAU_COMPLETUDE.BLOQUANT : NIVEAU_COMPLETUDE.AVERTISSEMENT;
  const ecarts = [];
  const ecart = (regle, donnee, ligne = null, n = niveau) => ecarts.push({ regle, niveau: n, donnee, ligne: ligne ?? null });

  const type = chaine(f.typeFacture);
  const cadre = chaine(f.cadreFacturation);
  const notes = liste(f.notes);
  const anterieures = liste(f.facturesAnterieures);
  const lignes = liste(f.lignes);
  const remisesCharges = liste(f.remisesCharges);
  const details = liste(f.detailsTva);
  const totaux = f.totaux ?? {};
  const barres = notes.filter((n) => n?.codeSujet === CODE_NOTE.TRAITEMENT);
  const traitement = barres.length > 0 ? chaine(barres[0]?.texte) : null;
  const b2b = traitement === TRAITEMENT.B2B;

  // LogiBTP : cadre émis, profil écrit (EN16931 ou EXTENDED-CTC-FR), extensions EXT-FR-FE seulement en EXTENDED-CTC-FR.
  if (CADRES_NON_EMIS.includes(cadre)) ecart(R.CADRE, 'BT-23');
  const profil = f.profil ?? PROFIL_FACTURE.EN16931;
  if (profil !== PROFIL_FACTURE.EN16931 && profil !== PROFIL_FACTURE.EXTENDED_CTC_FR) ecart(R.PROFIL, 'BT-24');
  if (profil !== PROFIL_FACTURE.EXTENDED_CTC_FR) {
    if (present(f.agentAcheteur)) ecart(R.PROFIL, 'EXT-FR-FE-BG-01');
    if (present(f.payeur)) ecart(R.PROFIL, 'EXT-FR-FE-BG-02');
    if (present(f.agentVendeur)) ecart(R.PROFIL, 'EXT-FR-FE-BG-03');
    if (anterieures.some((a) => present(a?.type))) ecart(R.PROFIL, 'EXT-FR-FE-02');
    for (const l of lignes) {
      if (present(l?.ligneParente)) ecart(R.PROFIL, 'EXT-FR-FE-162', l.identifiant);
      if (present(l?.sousType)) ecart(R.PROFIL, 'EXT-FR-FE-163', l.identifiant);
      if (present(l?.factureAnterieure)) ecart(R.PROFIL, 'EXT-FR-FE-BG-06', l.identifiant);
    }
  }

  // BR-FR-01 / 02 : numéros (≤ 35 caractères ; lettres, chiffres, + - _ /).
  const numero = (valeur, donnee, ligne = null) => {
    const v = chaine(valeur);
    if (v.length > LONGUEUR_NUMERO) ecart(R.BR_FR_01, donnee, ligne);
    if (!FORMAT_NUMERO.test(v)) ecart(R.BR_FR_02, donnee, ligne);
  };
  numero(f.numero, 'BT-1');
  for (const a of anterieures) numero(a?.numero, 'BT-25');
  for (const l of lignes) if (present(l?.factureAnterieure)) numero(l.factureAnterieure.numero, 'EXT-FR-FE-136', l.identifiant);

  // BR-FR-03 : années entre 2000 et 2099.
  const date = (valeur, donnee, ligne = null) => {
    if (!present(valeur)) return;
    const a = annee(valeur);
    if (a === null || a < 2000 || a > 2099) ecart(R.BR_FR_03, donnee, ligne);
  };
  date(f.dateEmission, 'BT-2');
  date(f.dateExigibiliteTva, 'BT-7');
  date(f.dateEcheance, 'BT-9');
  for (const a of anterieures) date(a?.date, 'BT-26');
  date(f.livraison?.date, 'BT-72');
  date(f.periode?.debut, 'BT-73');
  date(f.periode?.fin, 'BT-74');
  for (const l of lignes) {
    date(l?.factureAnterieure?.date, 'EXT-FR-FE-138', l?.identifiant);
    date(l?.periode?.debut, 'BT-134', l?.identifiant);
    date(l?.periode?.fin, 'BT-135', l?.identifiant);
  }

  // BR-FR-04 : types de facture admis.
  const types = Object.values(T);
  if (!types.includes(type)) ecart(R.BR_FR_04, 'BT-3');
  for (const a of anterieures) if (present(a?.type) && !types.includes(a.type)) ecart(R.BR_FR_04, 'EXT-FR-FE-02');
  for (const l of lignes) {
    const t = l?.factureAnterieure?.type;
    if (present(t) && !types.includes(t)) ecart(R.BR_FR_04, 'EXT-FR-FE-137', l.identifiant);
  }

  // BR-FR-05 / 06 : notes PMT, PMD, AAB obligatoires, une fois chacune (TXD une fois au plus) ; BR-FR-20 / 31 : note BAR.
  const nombre = (code) => notes.filter((n) => n?.codeSujet === code).length;
  for (const code of [CODE_NOTE.INDEMNITE_RECOUVREMENT, CODE_NOTE.PENALITES, CODE_NOTE.ESCOMPTE]) if (nombre(code) === 0) ecart(R.BR_FR_05, code);
  for (const code of [CODE_NOTE.INDEMNITE_RECOUVREMENT, CODE_NOTE.PENALITES, CODE_NOTE.ESCOMPTE, CODE_NOTE.MENTION_TAXE]) {
    if (nombre(code) > 1) ecart(R.BR_FR_06, code);
  }
  for (const n of barres) if (!Object.values(TRAITEMENT).includes(chaine(n?.texte))) ecart(R.BR_FR_20, 'BT-22');
  if (barres.length > 1) ecart(R.BR_FR_31, 'BT-21');

  // BR-FR-08 : cadre de facturation.
  if (!Object.values(C).includes(cadre)) ecart(R.BR_FR_08, 'BT-23');

  // BR-FR-10 à 13, 21, 22 : SIREN et adresses électroniques du vendeur et de l'acheteur.
  const vendeur = f.vendeur ?? {};
  const acheteur = f.acheteur ?? {};
  if (!FORMAT_SIREN.test(chaine(vendeur.siren))) ecart(R.BR_FR_10, 'BT-30');
  if (b2b && !FORMAT_SIREN.test(chaine(acheteur.siren))) ecart(R.BR_FR_11, 'BT-47');
  if (chaine(acheteur.adresseElectronique?.valeur) === '') ecart(R.BR_FR_12, 'BT-49');
  if (chaine(vendeur.adresseElectronique?.valeur) === '') ecart(R.BR_FR_13, 'BT-34');
  const routee = (partie) => chaine(partie.adresseElectronique?.valeur).startsWith(chaine(partie.siren))
    && partie.adresseElectronique?.schema === SCHEMA_IDENTIFIANT.ADRESSE_ELECTRONIQUE;
  const autofacture = TYPES_AUTOFACTURE.includes(type);
  if (b2b && !autofacture && !routee(acheteur)) ecart(R.BR_FR_21, 'BT-49');
  if (b2b && autofacture && !routee(vendeur)) ecart(R.BR_FR_22, 'BT-34');

  // Parties : BR-FR-09 (SIRET), 32 (SIREN), 23 / 25 (adresse électronique), 24 / 26 (code de routage).
  for (const [cle, termeSiret, termeSiren, termeAdresse, routage] of PARTIES) {
    const p = f[cle];
    if (!present(p)) continue;
    const identifiants = liste(p.identifiants);
    const siret = identifiants.find((i) => i?.schema === SCHEMA_IDENTIFIANT.SIRET);
    if (siret && !(FORMAT_SIRET.test(chaine(siret.valeur)) && chaine(siret.valeur).slice(0, 9) === chaine(p.siren))) ecart(R.BR_FR_09, termeSiret);
    if (present(p.siren) && !FORMAT_SIREN.test(chaine(p.siren))) ecart(R.BR_FR_32, termeSiren);
    for (const i of identifiants) if (i?.schema === SCHEMA_IDENTIFIANT.SIREN && !FORMAT_SIREN.test(chaine(i.valeur))) ecart(R.BR_FR_32, termeSiret);
    const adresse = p.adresseElectronique;
    if (present(adresse)) {
      if (adresse.schema === SCHEMA_IDENTIFIANT.ADRESSE_ELECTRONIQUE && !FORMAT_ADRESSE.test(chaine(adresse.valeur))) ecart(R.BR_FR_23, termeAdresse);
      if (chaine(adresse.valeur).length > LONGUEUR_ADRESSE) ecart(R.BR_FR_25, termeAdresse);
    }
    if (routage) {
      for (const i of identifiants.filter((x) => x?.schema === SCHEMA_IDENTIFIANT.CODE_ROUTAGE)) {
        if (!FORMAT_ADRESSE.test(chaine(i.valeur))) ecart(R.BR_FR_24, termeSiret);
        if (chaine(i.valeur).length > LONGUEUR_ROUTAGE) ecart(R.BR_FR_26, termeSiret);
      }
    }
  }

  // BR-FR-15 / 16 : catégories et taux de TVA.
  const categories = Object.values(CATEGORIE_TVA);
  const tauxAdmis = (t) => TAUX_TVA_ADMIS.some((x) => D(x).eq(D(t)));
  for (const r of remisesCharges) {
    if (present(r?.categorieTva) && !categories.includes(r.categorieTva)) ecart(R.BR_FR_15, r.charge ? 'BT-102' : 'BT-95');
    if (present(r?.tauxTva) && !tauxAdmis(r.tauxTva)) ecart(R.BR_FR_16, r.charge ? 'BT-103' : 'BT-96');
  }
  for (const d of details) {
    if (!categories.includes(d?.categorie)) ecart(R.BR_FR_15, 'BT-118');
    if (present(d?.taux) && !tauxAdmis(d.taux)) ecart(R.BR_FR_16, 'BT-119');
  }
  for (const l of lignes) {
    const facultative = l?.sousType === SOUS_TYPE_LIGNE.GROUPE || l?.sousType === SOUS_TYPE_LIGNE.INFORMATION;
    if (present(l?.categorieTva) ? !categories.includes(l.categorieTva) : !facultative) ecart(R.BR_FR_15, 'BT-151', l?.identifiant);
    if (present(l?.tauxTva) && !tauxAdmis(l.tauxTva)) ecart(R.BR_FR_16, 'BT-152', l?.identifiant);
  }

  // BR-FR-17 / 18 : pièces jointes typées, un seul LISIBLE.
  const piecesJointes = liste(f.piecesJointes);
  for (const p of piecesJointes) if (present(p?.description) && !Object.values(TYPE_PIECE_JOINTE).includes(p.description)) ecart(R.BR_FR_17, 'BT-123');
  if (piecesJointes.filter((p) => p?.description === TYPE_PIECE_JOINTE.LISIBLE).length > 1) ecart(R.BR_FR_18, 'BT-123');

  // BR-FR-CO-03 à 12 : avoir de remise globale, rectificative, avoir, échéance, acompte, facture déjà payée, devise.
  if (type === T.AVOIR_REMISE_GLOBALE && !(chaine(f.references?.contrat) !== '' && present(f.periode?.debut) && present(f.periode?.fin))) {
    ecart(R.BR_FR_CO_03, 'BT-3');
  }
  if (TYPES_RECTIFICATIFS.includes(type) && anterieures.length !== 1) ecart(R.BR_FR_CO_04, 'BT-3');
  if (TYPES_AVOIR.includes(type)) {
    const datee = (a) => present(a) && chaine(a.numero) !== '' && present(a.date);
    const entete = anterieures.some(datee);
    const detail = lignes.filter((l) => !present(l?.sousType) || l.sousType === SOUS_TYPE_LIGNE.DETAIL).every((l) => datee(l.factureAnterieure));
    if (!entete && !detail) ecart(R.BR_FR_CO_05, 'BT-3');
  }
  if (present(f.dateEcheance) && !TYPES_ACOMPTE.includes(type) && !CADRES_PAYES.includes(cadre)
    && chaine(f.dateEcheance) < chaine(f.dateEmission)) ecart(R.BR_FR_CO_07, 'BT-9');
  if (CADRES_DEFINITIFS.includes(cadre) && TYPES_ACOMPTE.includes(type)) ecart(R.BR_FR_CO_08, 'BT-23');
  if (CADRES_PAYES.includes(cadre)) {
    if (!present(totaux.dejaPaye) || !egal(totaux.dejaPaye, totaux.totalTtc)) ecart(R.BR_FR_CO_09, 'BT-113');
    if (!egal(totaux.netAPayer, ZERO)) ecart(R.BR_FR_CO_09, 'BT-115');
    if (!present(f.dateEcheance)) ecart(R.BR_FR_CO_09, 'BT-9');
  }
  if (chaine(f.devise || DEVISE_FRANCE) !== DEVISE_FRANCE) {
    if (f.deviseTva !== DEVISE_FRANCE) ecart(R.BR_FR_CO_12, 'BT-6');
    if (!present(totaux.totalTvaComptable)) ecart(R.BR_FR_CO_12, 'BT-111');
  }

  // BR-FR-DEC-01 à 04 : montants 2 décimales, quantités 4, prix 6 (positifs hors cadre 9), taux 2 (positifs, 4 chiffres).
  const format = (regle, valeur, max, donnee, ligne = null, { positif = false, chiffresMax = CHIFFRES_MAX } = {}) => {
    if (!present(valeur)) return;
    if (decimales(valeur) > max || chiffres(valeur) > chiffresMax || (positif && D(valeur).isNegative())) ecart(regle, donnee, ligne);
  };
  for (const r of remisesCharges) {
    format(R.BR_FR_DEC_01, r?.montant, 2, r?.charge ? 'BT-99' : 'BT-92');
    format(R.BR_FR_DEC_01, r?.assiette, 2, r?.charge ? 'BT-100' : 'BT-93');
  }
  for (const [cle, terme] of [['totalLignes', 'BT-106'], ['totalRemises', 'BT-107'], ['totalCharges', 'BT-108'], ['totalHt', 'BT-109'],
    ['totalTva', 'BT-110'], ['totalTvaComptable', 'BT-111'], ['totalTtc', 'BT-112'], ['dejaPaye', 'BT-113'], ['arrondi', 'BT-114'],
    ['netAPayer', 'BT-115']]) format(R.BR_FR_DEC_01, totaux[cle], 2, terme);
  for (const d of details) {
    format(R.BR_FR_DEC_01, d?.base, 2, 'BT-116');
    format(R.BR_FR_DEC_01, d?.montant, 2, 'BT-117');
  }
  for (const l of lignes) {
    format(R.BR_FR_DEC_01, l?.montantNet, 2, 'BT-131', l?.identifiant);
    for (const r of liste(l?.remisesCharges)) {
      format(R.BR_FR_DEC_01, r?.montant, 2, r?.charge ? 'BT-141' : 'BT-136', l.identifiant);
      format(R.BR_FR_DEC_01, r?.assiette, 2, r?.charge ? 'BT-142' : 'BT-137', l.identifiant);
    }
  }
  for (const l of lignes) {
    format(R.BR_FR_DEC_02, l?.quantite, 4, 'BT-129', l?.identifiant);
    format(R.BR_FR_DEC_02, l?.quantiteBase, 4, 'BT-149', l?.identifiant);
  }
  const prixSignes = CADRES_BIDIRECTIONNELS.includes(cadre);
  for (const l of lignes) {
    format(R.BR_FR_DEC_03, l?.prixNet, 6, 'BT-146', l?.identifiant, { positif: !prixSignes });
    format(R.BR_FR_DEC_03, l?.rabais, 6, 'BT-147', l?.identifiant, { positif: !prixSignes });
    format(R.BR_FR_DEC_03, l?.prixBrut, 6, 'BT-148', l?.identifiant, { positif: !prixSignes });
  }
  const taux = { positif: true, chiffresMax: CHIFFRES_TAUX };
  for (const r of remisesCharges) format(R.BR_FR_DEC_04, r?.tauxTva, 2, r?.charge ? 'BT-103' : 'BT-96', null, taux);
  for (const d of details) format(R.BR_FR_DEC_04, d?.taux, 2, 'BT-119', null, taux);
  for (const l of lignes) format(R.BR_FR_DEC_04, l?.tauxTva, 2, 'BT-152', l?.identifiant, taux);

  // Sommes EN16931 (BR-CO-10 à 16) ; BR-CO-17 : TVA d'une ventilation = base × taux arrondie (avertissement).
  const somme = (valeurs) => arrondir(valeurs.reduce((s, v) => s.plus(Dz(v)), ZERO), 2);
  const detailLignes = lignes.filter((l) => !present(l?.sousType) || l.sousType === SOUS_TYPE_LIGNE.DETAIL);
  if (!egal(totaux.totalLignes, somme(detailLignes.map((l) => l.montantNet)))) ecart(R.BR_CO_10, 'BT-106');
  const remises = remisesCharges.filter((r) => !r?.charge);
  const charges = remisesCharges.filter((r) => r?.charge);
  if ((remises.length > 0 || present(totaux.totalRemises))
    && !(present(totaux.totalRemises) && egal(totaux.totalRemises, somme(remises.map((r) => r.montant))))) ecart(R.BR_CO_11, 'BT-107');
  if ((charges.length > 0 || present(totaux.totalCharges))
    && !(present(totaux.totalCharges) && egal(totaux.totalCharges, somme(charges.map((r) => r.montant))))) ecart(R.BR_CO_12, 'BT-108');
  if (!egal(totaux.totalHt, arrondir(Dz(totaux.totalLignes).minus(Dz(totaux.totalRemises)).plus(Dz(totaux.totalCharges)), 2))) ecart(R.BR_CO_13, 'BT-109');
  if (present(totaux.totalTva) && !egal(totaux.totalTva, somme(details.map((d) => d?.montant)))) ecart(R.BR_CO_14, 'BT-110');
  if (!egal(totaux.totalTtc, Dz(totaux.totalHt).plus(Dz(totaux.totalTva)))) ecart(R.BR_CO_15, 'BT-112');
  if (!egal(totaux.netAPayer, Dz(totaux.totalTtc).minus(Dz(totaux.dejaPaye)).plus(Dz(totaux.arrondi)))) ecart(R.BR_CO_16, 'BT-115');
  for (const d of details) {
    if (present(d?.taux) && !egal(d.montant, arrondir(Dz(d.base).times(D(d.taux)).dividedBy(100), 2))) {
      ecart(R.BR_CO_17, 'BT-117', null, NIVEAU_COMPLETUDE.AVERTISSEMENT);
    }
  }
  return ecarts;
}

/** Vrai si un écart du contrôle de complétude est bloquant. */
export const completudeBloquante = (ecarts) => liste(ecarts).some((e) => e?.niveau === NIVEAU_COMPLETUDE.BLOQUANT);
