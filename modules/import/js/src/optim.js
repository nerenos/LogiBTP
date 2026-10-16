import { lireZip } from './zip.js';
import { analyserXml, enfant, enfants, feuilles } from './xml.js';
import { rtfEnHtml, estRtf } from './rtf.js';

// Import d'un devis OptimBTP (.optim : archive zip contenant Devis.xml). Le fichier est lu dans le navigateur et
// converti en un devis neutre (entête, intervenants, lignes) que l'application traduit dans son modèle de document.
// Chaque champ du fichier a un sort documenté (CHAMPS_*) : repris, recalculé par LogiBTP (servant au contrôle des
// totaux) ou non repris ; le rapport liste les champs non repris qui ont une valeur dans le fichier, pour décider
// s'il faut les garder.
//
// Lignes OptimBTP : TypeLigne 4 phase, 3 sous-phase (→ titres), 2 ouvrage (sous-détail), 1 article (→ élément) ;
// IsVideTexte → texte ; IsSousDetail → composante d'ouvrage (quantité par unité du parent) ; IsFA → branche des
// globalisations (frais répartis sur les prix par PGU) : non reprise, son coût est inclus dans le déboursé des lignes.
// Prix : déboursé PAU × (1 + PctFG) (+ PGU, part de globalisation), vente × (1 + PctVte) du prix de la ligne de prix
// (les composantes reçoivent le coefficient de vente de leur ligne de prix : calcul « somme des PV » de LogiBTP).

/** Statuts des champs. */
export const SORTS = Object.freeze({
  REPRIS: 'repris',
  RECALCULE: 'recalculé',
  NON_REPRIS: 'non repris',
});
const R = SORTS.REPRIS, C = SORTS.RECALCULE, N = SORTS.NON_REPRIS;

/** Entête : champ → [sort, destination ou motif]. */
export const CHAMPS_ENTETE = {
  Chantier: [R, 'Propriété « Chantier » du devis'],
  PosteTvx: [N, 'Poste de travaux (pas d\'équivalent)'],
  Client: [R, 'Nom du client, à rattacher à l\'annuaire'],
  Redacteur: [R, "Rédacteur (individu de l'annuaire de notre société)"],
  CAff: [N, 'Chargé d\'affaires'],
  Metreur: [N, 'Métreur'],
  Reference: [R, "Référence d'origine (traçabilité) ; notre référence si « Nos références » est vide"],
  RefUnique: [N, 'Référence sans indice'],
  Indice: [N, 'Indice OptimBTP'],
  Version: [N, 'Version OptimBTP'],
  IsVersionRef: [N, 'Version de référence'],
  DateDoc: [R, 'Date du document'],
  Annee: [C, 'Déduit de la date'],
  Mois: [C, 'Déduit de la date'],
  Exercice: [C, 'Déduit de la date'],
  IsCde: [N, 'Devis transformé en commande'],
  RefExt: [R, 'Référence externe'],
  NosRef: [R, 'Notre référence'],
  RefExtMarche: [N, 'Référence du marché'],
  Libelle: [R, 'Objet du document'],
  LibelleRTF: [C, 'Objet mis en forme (l\'objet est repris en texte)'],
  Observation: [N, 'Observations'],
  ModeReglCode: [R, 'Propriété « Mode de règlement » si correspondance'],
  ModeReglLib: [R, 'Propriété « Mode de règlement » si correspondance'],
  TotNbH: [N, 'Total des heures'],
  PAT: [C, 'Total déboursé sec (contrôle)'],
  MtFG: [C, 'Total des frais généraux (contrôle)'],
  PRT: [C, 'Total prix de revient (contrôle)'],
  MtHT: [C, 'Total HT (contrôle)'],
  MtHTNet: [C, 'Total HT net (contrôle)'],
  TxTVA_Def: [R, 'Taux de TVA des lignes sans taux'],
  MtTVA: [C, 'Total TVA (contrôle)'],
  MtTTC: [C, 'Total TTC (contrôle)'],
  MtTTCNet: [C, 'Net TTC (contrôle)'],
  MtHT_Option: [N, 'Total HT des options'],
  ZoneDeplacement: [N, 'Zone de déplacement'],
};

/** Lignes : champ → [sort, destination ou motif]. */
export const CHAMPS_LIGNE = {
  Identifiant: [R, 'Arborescence'],
  IdentifiantParent: [R, 'Arborescence'],
  IsFA: [N, 'Branche des globalisations (coût réparti dans les prix par PGU)'],
  IsVideTexte: [R, 'Ligne de texte'],
  IsSousDetail: [R, 'Composante d\'ouvrage'],
  IsOption: [N, 'Ligne en option'],
  IsNonCalcul: [N, 'Ligne non calculée'],
  IsNonEdite: [R, 'Ligne non éditée'],
  IsSautPageAvant: [R, 'Saut de page avant la ligne'],
  CHT_Code: [N, 'Chantier de la ligne'],
  PTV_Code: [N, 'Poste de travaux de la ligne'],
  TRS_ID: [N, 'Tiers de la ligne'],
  Ordre: [R, 'Ordre des lignes'],
  Niveau: [C, 'Déduit de l\'arborescence'],
  TypeLigne: [R, 'Type de ligne (titre, ouvrage, élément)'],
  IsST: [N, 'Ligne sous-traitée'],
  IsAjustement: [N, 'Ligne d\'ajustement'],
  FTY_Code: [R, 'Nature (par code, libellé ou regroupement)'],
  FTY_Libelle: [R, 'Nature (par code, libellé ou regroupement)'],
  FTY_LibelleRgp: [R, 'Nature (par code, libellé ou regroupement)'],
  Hierarchie: [C, 'Numérotation'],
  NumLigne: [R, 'Numérotation (départs de séquence)'],
  Code: [R, 'Code de la ligne'],
  Libelle: [R, 'Libellé (texte, si pas de RTF)'],
  LibelleRTF: [R, 'Libellé mis en forme'],
  LibUnite: [R, 'Unité (si connue)'],
  QteInit: [C, 'Quantité avant cadence et perte (la quantité finale est reprise)'],
  CoefPerte: [C, 'Inclus dans la quantité reprise'],
  QteCadence: [C, 'Inclus dans la quantité reprise'],
  Cadence: [C, 'Incluse dans la quantité reprise'],
  Qte: [R, 'Quantité'],
  QteFixe: [R, 'Quantité absolue dans l\'ouvrage'],
  QteTot: [C, 'Quantité totale'],
  IdentifiantPrixIdem: [N, 'Prix identique à une autre ligne (le prix est repris)'],
  CouleurPrixIdem: [N, 'Couleur du prix identique'],
  PAU: [R, 'Prix d\'achat (déboursé sec unitaire)'],
  PAT: [C, 'Déboursé sec total'],
  PctFG: [R, 'Coefficient de frais généraux'],
  PRU: [C, 'Prix de revient unitaire (contrôle)'],
  PRT: [C, 'Prix de revient total'],
  PGU: [R, 'Part de globalisation incluse dans le déboursé'],
  PGT: [C, 'Globalisation totale'],
  PFIU: [N, 'Frais indirects unitaires'],
  PFIT: [N, 'Frais indirects totaux'],
  PctVte: [R, 'Coefficient de bénéfice'],
  PVU: [C, 'Prix de vente unitaire (contrôle ; repris si montant fixe)'],
  MntHT: [C, 'Montant HT (contrôle)'],
  IsMntFixe: [R, 'Prix de vente fixe'],
  IsMntForce: [N, 'Montant forcé'],
  TxTVA: [R, 'Taux de TVA'],
  NbHU: [N, 'Heures unitaires'],
  NbHTot: [N, 'Heures totales'],
  CheminImage: [N, 'Image de la ligne'],
  Couleur: [R, 'Étiquette de couleur (paramètres COUL_xx)'],
  VDL_Tiers: [N, 'Tiers de la ligne'],
  IsCoefVteDefaut: [N, 'Coefficient de vente par défaut'],
  CoefVteDefaut: [N, 'Coefficient de vente par défaut'],
  IsAtelier: [N, 'Ligne atelier (quantité, cadence, jours)'],
  QteAtelier: [N, 'Atelier : quantité'],
  CadenceAtelier: [N, 'Atelier : cadence'],
  NbJourAtelier: [N, 'Atelier : jours'],
  IsGlobalisation: [N, 'Ligne de globalisation'],
  CouleurGlobalisation: [N, 'Couleur de globalisation'],
  NbJourGlobalisation: [N, 'Globalisation : jours'],
  MntChiffrageGlobalisation: [N, 'Globalisation : montant chiffré'],
  NbLigneGlobalisation: [N, 'Globalisation : lignes'],
  RatioGlobalisation: [N, 'Globalisation : ratio'],
  Globalisations: [N, 'Répartition des globalisations (PU estimé, quantité, PGU)'],
};

/** Intervenants (Annuaires) : champ → [sort, destination ou motif]. */
export const CHAMPS_INTERVENANT = {
  TRS_NomReduit: [R, 'Recherche dans l\'annuaire'],
  RoleTiers: [R, 'Rôle'],
  IsProjetCh: [R, 'Rôle : projet ou chantier'],
  IsClient: [R, 'Rôle : client'],
  IsDestinataire: [R, 'Rôle : destinataire'],
  IsTiersPayeur: [R, 'Rôle : payeur'],
  IsCompteGestion: [N, 'Compte de gestion'],
  IsTitulaire: [R, 'Rôle : titulaire'],
  IsSTraitant: [R, 'Rôle : sous-traitant'],
  Commentaire: [N, 'Commentaire'],
  ADR_RaisonSociale: [R, 'Recherche dans l\'annuaire'],
  ADR_Ligne1: [N, 'Adresse (celle de l\'annuaire est utilisée)'],
  ADR_Ligne2: [N, 'Adresse'], ADR_Ligne3: [N, 'Adresse'], ADR_Ligne4: [N, 'Adresse'],
  ADR_CP: [N, 'Adresse'], ADR_Ville: [N, 'Adresse'], ADR_Cedex: [N, 'Adresse'], ADR_Pays: [N, 'Adresse'],
  Interlocuteur: [N, 'Interlocuteur'], Fonction: [N, 'Fonction de l\'interlocuteur'],
  Email: [N, 'Coordonnées'], NumTel: [N, 'Coordonnées'], NumFax: [N, 'Coordonnées'], NumPort: [N, 'Coordonnées'], EmailFacture: [N, 'Coordonnées'],
};

/** Valeur « vide » d'un champ (non signalée dans le rapport). */
const estVide = (v) => v === undefined || v === null || v.trim() === '' || v.trim() === '0' || v.trim() === '-1';
const nombre = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };
const arr = (x, d = 6) => Math.round(x * 10 ** d) / 10 ** d;
const decimales = (x) => { const s = String(arr(x)); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };
const echapper = (t) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Couleur Windows (COLORREF : 0x00BBGGRR) en #rrggbb. */
export const couleurWindows = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  const h = (x) => x.toString(16).padStart(2, '0');
  return `#${h(v & 0xff)}${h((v >> 8) & 0xff)}${h((v >> 16) & 0xff)}`;
};
// Paramètres repris (non signalés) : couleurs des lignes, validité de l'offre.
const PARAMETRES_REPRIS = new Set(['VALIDITE_OFFRE']);
const dateIso = (v) => (/^\d{8}$/.test(v ?? '') ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);

/** Lit un fichier .optim (archive) ou directement le XML du devis. octets : ArrayBuffer ou Uint8Array. */
export async function lireFichierOptim(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let xml;
  if (o[0] === 0x50 && o[1] === 0x4b) {
    const fichiers = lireZip(o);
    const f = fichiers.find((x) => /\.xml$/i.test(x.nom));
    if (!f) throw new Error('Archive OptimBTP sans fichier XML');
    xml = new TextDecoder().decode(await f.lire());
  } else {
    xml = new TextDecoder().decode(o);
  }
  return convertirOptim(xml);
}

/**
 * Devis neutre depuis le XML OptimBTP :
 * { entete, intervenants, lignes, complements, parametres, non_repris, avertissements }.
 * Lignes : { id, parent, ordre, type (TITRE, OUVRAGE, ELEMENT, TEXTE, SAUT_PAGE), numero, num_depart, code, libelle_html,
 * unite, qte, qte_absolue, precision_qte, prix_achat, coef_fg, coef_benef, pv_fixe, pv_unitaire (PVU d'origine), taux_tva, nature, non_editee,
 * composante, controle { pru, pvu, montant_ht }, source (identifiant OptimBTP) }.
 */
export function convertirOptim(xml) {
  const racine = analyserXml(xml);
  if (racine.nom !== 'Devis') throw new Error(`Fichier OptimBTP inattendu : racine <${racine.nom}> au lieu de <Devis>`);
  const e = feuilles(enfant(racine, 'Entete'));
  const nonRepris = new Map();
  const avertissements = [];
  const signaler = (zone, champ, valeur, motif, ligne = null) => {
    const cle = `${zone}.${champ}`;
    const x = nonRepris.get(cle) ?? { zone, champ, motif, valeurs: [], nombre: 0 };
    x.nombre++;
    if (x.valeurs.length < 3 && !x.valeurs.includes(valeur)) x.valeurs.push(valeur);
    if (ligne && !x.lignes) x.lignes = [];
    if (ligne && x.lignes.length < 5) x.lignes.push(ligne);
    nonRepris.set(cle, x);
  };
  const controler = (zone, valeurs, champs, ligne = null) => {
    for (const [k, v] of Object.entries(valeurs)) {
      if (estVide(v)) continue;
      const def = champs[k];
      if (!def) signaler(zone, k, v.slice(0, 80), 'Champ inconnu du module d\'import', ligne);
      else if (def[0] === N) signaler(zone, k, v.slice(0, 80), def[1], ligne);
    }
  };
  controler('Entête', e, CHAMPS_ENTETE);

  const parametres = enfants(enfant(racine, 'Parametres'), 'Parametre').map((p) => feuilles(p));
  // Durée de validité de l'offre (en mois) → jours.
  const validite = parametres.find((p) => p.Code === 'VALIDITE_OFFRE');
  const mois = validite ? nombre(validite.Num1) : 0;
  // Couleurs des lignes (COUL_xx) : étiquettes, rapprochées de celles de l'application par libellé ou couleur.
  const couleurs = parametres.filter((p) => p.TypeParam === 'Couleur' || /^COUL_\d+$/.test(p.Code ?? ''))
    .map((p) => ({ code: p.Code, libelle: p.Libelle || p.Code, couleur: couleurWindows(p.Num1), image: p.Txt1 || null }));
  const entete = {
    reference: e.Reference || null,
    notre_reference: e.NosRef || e.Reference || null,
    reference_externe: e.RefExt || null,
    redacteur: e.Redacteur || null,
    validite_jours: mois > 0 ? Math.round(mois * 30) : null,
    date: dateIso(e.DateDoc),
    objet: (e.Libelle || (estRtf(e.LibelleRTF) ? rtfEnHtml(e.LibelleRTF).replace(/<[^>]+>/g, ' ') : '')).trim() || null,
    chantier: e.Chantier || null,
    client: e.Client || null,
    mode_reglement: e.ModeReglCode || e.ModeReglLib ? { code: e.ModeReglCode || null, libelle: e.ModeReglLib || null } : null,
    taux_tva_defaut: e.TxTVA_Def ? arr(nombre(e.TxTVA_Def) * 100, 4) : null,
    controle: {
      deboursé_sec: nombre(e.PAT), frais_generaux: nombre(e.MtFG), prix_revient: nombre(e.PRT),
      total_ht: nombre(e.MtHT), total_tva: nombre(e.MtTVA), total_ttc: nombre(e.MtTTC), net_ttc: nombre(e.MtTTCNet),
    },
  };

  const intervenants = [];
  for (const a of enfants(enfant(racine, 'Annuaires'), 'Annuaire')) {
    const v = feuilles(a);
    const roles = [['IsClient', 'CLIENT'], ['IsDestinataire', 'DESTINATAIRE'], ['IsTiersPayeur', 'PAYEUR'], ['IsTitulaire', 'TITULAIRE'], ['IsSTraitant', 'SOUS_TRAITANT'], ['IsProjetCh', 'PROJET']]
      .filter(([k]) => v[k] === '1').map(([, r]) => r);
    const nom = v.ADR_RaisonSociale || v.TRS_NomReduit || null;
    if (!nom && !v.Interlocuteur) continue;
    controler(`Intervenant ${nom ?? ''}`.trim(), v, CHAMPS_INTERVENANT);
    intervenants.push({
      nom, nom_reduit: v.TRS_NomReduit || null, role: v.RoleTiers || null, roles,
      adresse: [v.ADR_Ligne1, v.ADR_Ligne2, v.ADR_Ligne3, v.ADR_Ligne4].filter(Boolean).join('\n') || null,
      code_postal: v.ADR_CP || null, ville: v.ADR_Ville || null, pays: v.ADR_Pays || null,
      interlocuteur: v.Interlocuteur || null, email: v.Email || null, telephone: v.NumTel || v.NumPort || null,
    });
  }
  if (!intervenants.some((i) => i.roles.includes('CLIENT'))) avertissements.push('Aucun client renseigné dans le fichier : à choisir dans l\'annuaire du document');

  // Compléments de pied : la ventilation de TVA est recalculée ; les autres (remises, retenues…) sont signalés.
  const complements = enfants(enfant(racine, 'Complements'), 'Complement').map((c) => feuilles(c));
  for (const c of complements) {
    if (c.TypeComplement === 'VTLTVA') continue;
    signaler('Pied', c.TypeComplement || 'Complément', `${c.Libelle ?? ''} : base ${c.Base}, taux ${c.Taux}, montant ${c.Montant}`, 'Complément de pied (remise, retenue, prorata…)');
  }
  for (const p of parametres) {
    if (PARAMETRES_REPRIS.has(p.Code) || couleurs.some((c) => c.code === p.Code)) continue;
    const valeurs = ['Txt1', 'Txt2', 'Num1', 'Num2', 'Num3', 'Num4', 'Num5', 'Bool1', 'Bool2', 'Bool3', 'Date1', 'Date2', 'Date3']
      .filter((k) => !estVide(p[k])).map((k) => `${k} ${p[k]}`);
    if (valeurs.length || !estVide(p.TextRTF)) signaler('Paramètres', p.Code, `${p.Libelle} : ${valeurs.join(', ') || 'texte'}`, 'Paramètre du devis OptimBTP');
  }

  // Lignes.
  const brutes = enfants(enfant(racine, 'Lignes'), 'Ligne').map((l) => ({ v: feuilles(l), globalisations: enfant(l, 'Globalisations') }));
  const parId = new Map(brutes.map((b) => [b.v.Identifiant, b]));
  const enfantsDe = new Map();
  for (const b of brutes) {
    const p = b.v.IdentifiantParent && b.v.IdentifiantParent !== '0' && parId.has(b.v.IdentifiantParent) ? b.v.IdentifiantParent : null;
    b.parent = p;
    if (!enfantsDe.has(p)) enfantsDe.set(p, []);
    enfantsDe.get(p).push(b);
  }
  for (const liste of enfantsDe.values()) liste.sort((a, b) => nombre(a.v.Ordre) - nombre(b.v.Ordre));

  const lignes = [];
  let exclues = 0;
  const parcourir = (parentSource, parentNeutre, coefLigneDePrix) => {
    let rangAttendu = 0;
    for (const b of enfantsDe.get(parentSource) ?? []) {
      const v = b.v;
      const id = v.Identifiant;
      if (v.IsFA === '1' && !parentNeutre?.composante && parentNeutre?.type !== 'OUVRAGE') {
        // Branche des globalisations : frais répartis sur les lignes de prix (PGU), non reprise.
        const compter = (x) => { exclues++; for (const y of enfantsDe.get(x.v.Identifiant) ?? []) compter(y); };
        compter(b);
        continue;
      }
      const libre = { ...v };
      controler('Lignes', libre, CHAMPS_LIGNE, id);
      if (b.globalisations) signaler('Lignes', 'Globalisations', `${enfants(b.globalisations, 'Globalisation').length} répartition(s)`, CHAMPS_LIGNE.Globalisations[1], id);
      if (v.IsSautPageAvant === '1') {
        lignes.push({ id: `${id}-saut`, parent: parentNeutre?.id ?? null, type: 'SAUT_PAGE', libelle_html: '', source: id });
      }
      const composante = v.IsSousDetail === '1';
      const type = v.IsVideTexte === '1' ? 'TEXTE' : { 4: 'TITRE', 3: 'TITRE', 2: 'OUVRAGE', 1: 'ELEMENT' }[v.TypeLigne] ?? null;
      if (!type) { avertissements.push(`Ligne ${id} : type de ligne ${v.TypeLigne} inconnu, reprise en texte`); }
      const libelle = estRtf(v.LibelleRTF) ? rtfEnHtml(v.LibelleRTF) : echapper(v.Libelle ?? '');
      const l = {
        id, parent: parentNeutre?.id ?? null, type: type ?? 'TEXTE', source: id, composante,
        code: v.Code || null, libelle_html: libelle || echapper(v.Libelle ?? ''),
        non_editee: v.IsNonEdite === '1',
      };
      if (!estVide(v.Couleur)) {
        const c = v.Couleur.trim();
        l.etiquette = couleurs.find((x) => x.code === c || x.image === c || c.startsWith(`${x.code}.`) || String(couleurWindows(c)) === x.couleur && /^\d+$/.test(c))
          ?? { code: /^\d+$/.test(c) ? `COUL_${c}` : c, libelle: `Couleur ${couleurWindows(c) ?? c}`, couleur: couleurWindows(c) };
      }
      // Numérotation : départ de séquence quand le numéro OptimBTP ne suit pas le rang attendu.
      if (v.NumLigne && l.type !== 'TEXTE') {
        const dernier = v.NumLigne.split('.').pop();
        const rang = /^\d+$/.test(dernier) ? Number(dernier) : null;
        rangAttendu++;
        l.numero = v.NumLigne;
        if (rang !== null && rang !== rangAttendu) { l.num_depart = String(rang); rangAttendu = rang; }
      }
      let coefVente = coefLigneDePrix;
      if (l.type === 'ELEMENT' || l.type === 'OUVRAGE') {
        const qte = nombre(v.Qte);
        l.unite = v.LibUnite || null;
        l.qte = arr(qte);
        if (composante && v.QteFixe === '1' && parentNeutre?.qte) {
          // Quantité fixe : quantité pour une unité de l'ouvrage parent → quantité absolue pour l'ouvrage.
          l.qte = arr(qte * parentNeutre.qte);
          l.qte_absolue = true;
        }
        l.precision_qte = Math.min(Math.max(decimales(l.qte), 2), 6);
        const pctVte = nombre(v.PctVte);
        if (!composante) coefVente = pctVte > -1 ? arr(1 + pctVte, 6) : 1;
        l.coef_benef = coefVente ?? 1;
        l.nature = v.FTY_Code || v.FTY_Libelle || v.FTY_LibelleRgp ? { code: v.FTY_Code || null, libelle: v.FTY_Libelle || null, regroupement: v.FTY_LibelleRgp || null } : null;
        l.taux_tva = v.TxTVA !== '' && v.TxTVA !== undefined ? arr(nombre(v.TxTVA) * 100, 4) : null;
        l.controle = { pru: nombre(v.PRU), pgu: nombre(v.PGU), pvu: nombre(v.PVU), montant_ht: nombre(v.MntHT) };
        if (l.type === 'ELEMENT') {
          const pau = nombre(v.PAU);
          const cout = nombre(v.PRU) + nombre(v.PGU);
          if (pau > 0) { l.prix_achat = pau; l.coef_fg = arr(cout / pau, 6); } else { l.prix_achat = arr(cout, 6); l.coef_fg = 1; }
        }
        if (v.IsMntFixe === '1' && !composante) l.pv_fixe = nombre(v.PVU);
        // PV unitaire d'origine (absent ou nul : null) : le cœur l'impose aux ouvrages et composantes (mode bordereau).
        l.pv_unitaire = estVide(v.PVU) ? null : nombre(v.PVU);
      }
      lignes.push(l);
      parcourir(id, l, coefVente);
    }
  };
  parcourir(null, null, null);
  if (exclues) avertissements.push(`${exclues} ligne(s) de globalisation non reprises : leur coût est réparti dans le déboursé des lignes de prix`);

  return {
    format: 'OptimBTP', entete, intervenants, lignes, complements, parametres, couleurs,
    non_repris: [...nonRepris.values()], avertissements,
  };
}
