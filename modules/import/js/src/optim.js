import { texte, textesParCode } from '@logibtp/socle/dictionnaire';
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
export const SORTS = textesParCode('import.sorts', ['REPRIS', 'RECALCULE', 'NON_REPRIS']);
const R = SORTS.REPRIS, C = SORTS.RECALCULE, N = SORTS.NON_REPRIS;

/** Entête : champ → [sort, destination ou motif]. */
export const CHAMPS_ENTETE = {
  Chantier: [R, texte('import.champs.entete.Chantier')],
  PosteTvx: [N, texte('import.champs.entete.PosteTvx')],
  Client: [R, texte('import.champs.entete.Client')],
  Redacteur: [R, texte('import.champs.entete.Redacteur')],
  CAff: [N, texte('import.champs.entete.CAff')],
  Metreur: [N, texte('import.champs.entete.Metreur')],
  Reference: [R, texte('import.champs.entete.Reference')],
  RefUnique: [N, texte('import.champs.entete.RefUnique')],
  Indice: [N, texte('import.champs.entete.Indice')],
  Version: [N, texte('import.champs.entete.Version')],
  IsVersionRef: [N, texte('import.champs.entete.IsVersionRef')],
  DateDoc: [R, texte('import.champs.entete.DateDoc')],
  Annee: [C, texte('import.champs.entete.Annee')],
  Mois: [C, texte('import.champs.entete.Mois')],
  Exercice: [C, texte('import.champs.entete.Exercice')],
  IsCde: [N, texte('import.champs.entete.IsCde')],
  RefExt: [R, texte('import.champs.entete.RefExt')],
  NosRef: [R, texte('import.champs.entete.NosRef')],
  RefExtMarche: [N, texte('import.champs.entete.RefExtMarche')],
  Libelle: [R, texte('import.champs.entete.Libelle')],
  LibelleRTF: [C, texte('import.champs.entete.LibelleRTF')],
  Observation: [N, texte('import.champs.entete.Observation')],
  ModeReglCode: [R, texte('import.champs.entete.ModeReglCode')],
  ModeReglLib: [R, texte('import.champs.entete.ModeReglLib')],
  TotNbH: [N, texte('import.champs.entete.TotNbH')],
  PAT: [C, texte('import.champs.entete.PAT')],
  MtFG: [C, texte('import.champs.entete.MtFG')],
  PRT: [C, texte('import.champs.entete.PRT')],
  MtHT: [C, texte('import.champs.entete.MtHT')],
  MtHTNet: [C, texte('import.champs.entete.MtHTNet')],
  TxTVA_Def: [R, texte('import.champs.entete.TxTVA_Def')],
  MtTVA: [C, texte('import.champs.entete.MtTVA')],
  MtTTC: [C, texte('import.champs.entete.MtTTC')],
  MtTTCNet: [C, texte('import.champs.entete.MtTTCNet')],
  MtHT_Option: [N, texte('import.champs.entete.MtHT_Option')],
  ZoneDeplacement: [N, texte('import.champs.entete.ZoneDeplacement')],
};

/** Lignes : champ → [sort, destination ou motif]. */
export const CHAMPS_LIGNE = {
  Identifiant: [R, texte('import.champs.ligne.Identifiant')],
  IdentifiantParent: [R, texte('import.champs.ligne.IdentifiantParent')],
  IsFA: [N, texte('import.champs.ligne.IsFA')],
  IsVideTexte: [R, texte('import.champs.ligne.IsVideTexte')],
  IsSousDetail: [R, texte('import.champs.ligne.IsSousDetail')],
  IsOption: [N, texte('import.champs.ligne.IsOption')],
  IsNonCalcul: [N, texte('import.champs.ligne.IsNonCalcul')],
  IsNonEdite: [R, texte('import.champs.ligne.IsNonEdite')],
  IsSautPageAvant: [R, texte('import.champs.ligne.IsSautPageAvant')],
  CHT_Code: [N, texte('import.champs.ligne.CHT_Code')],
  PTV_Code: [N, texte('import.champs.ligne.PTV_Code')],
  TRS_ID: [N, texte('import.champs.ligne.TRS_ID')],
  Ordre: [R, texte('import.champs.ligne.Ordre')],
  Niveau: [C, texte('import.champs.ligne.Niveau')],
  TypeLigne: [R, texte('import.champs.ligne.TypeLigne')],
  IsST: [N, texte('import.champs.ligne.IsST')],
  IsAjustement: [N, texte('import.champs.ligne.IsAjustement')],
  FTY_Code: [R, texte('import.champs.ligne.FTY_Code')],
  FTY_Libelle: [R, texte('import.champs.ligne.FTY_Libelle')],
  FTY_LibelleRgp: [R, texte('import.champs.ligne.FTY_LibelleRgp')],
  Hierarchie: [C, texte('import.champs.ligne.Hierarchie')],
  NumLigne: [R, texte('import.champs.ligne.NumLigne')],
  Code: [R, texte('import.champs.ligne.Code')],
  Libelle: [R, texte('import.champs.ligne.Libelle')],
  LibelleRTF: [R, texte('import.champs.ligne.LibelleRTF')],
  LibUnite: [R, texte('import.champs.ligne.LibUnite')],
  QteInit: [C, texte('import.champs.ligne.QteInit')],
  CoefPerte: [C, texte('import.champs.ligne.CoefPerte')],
  QteCadence: [C, texte('import.champs.ligne.QteCadence')],
  Cadence: [C, texte('import.champs.ligne.Cadence')],
  Qte: [R, texte('import.champs.ligne.Qte')],
  QteFixe: [R, texte('import.champs.ligne.QteFixe')],
  QteTot: [C, texte('import.champs.ligne.QteTot')],
  IdentifiantPrixIdem: [N, texte('import.champs.ligne.IdentifiantPrixIdem')],
  CouleurPrixIdem: [N, texte('import.champs.ligne.CouleurPrixIdem')],
  PAU: [R, texte('import.champs.ligne.PAU')],
  PAT: [C, texte('import.champs.ligne.PAT')],
  PctFG: [R, texte('import.champs.ligne.PctFG')],
  PRU: [C, texte('import.champs.ligne.PRU')],
  PRT: [C, texte('import.champs.ligne.PRT')],
  PGU: [R, texte('import.champs.ligne.PGU')],
  PGT: [C, texte('import.champs.ligne.PGT')],
  PFIU: [N, texte('import.champs.ligne.PFIU')],
  PFIT: [N, texte('import.champs.ligne.PFIT')],
  PctVte: [R, texte('import.champs.ligne.PctVte')],
  PVU: [C, texte('import.champs.ligne.PVU')],
  MntHT: [C, texte('import.champs.ligne.MntHT')],
  IsMntFixe: [R, texte('import.champs.ligne.IsMntFixe')],
  IsMntForce: [N, texte('import.champs.ligne.IsMntForce')],
  TxTVA: [R, texte('import.champs.ligne.TxTVA')],
  NbHU: [N, texte('import.champs.ligne.NbHU')],
  NbHTot: [N, texte('import.champs.ligne.NbHTot')],
  CheminImage: [N, texte('import.champs.ligne.CheminImage')],
  Couleur: [R, texte('import.champs.ligne.Couleur')],
  VDL_Tiers: [N, texte('import.champs.ligne.VDL_Tiers')],
  IsCoefVteDefaut: [N, texte('import.champs.ligne.IsCoefVteDefaut')],
  CoefVteDefaut: [N, texte('import.champs.ligne.CoefVteDefaut')],
  IsAtelier: [N, texte('import.champs.ligne.IsAtelier')],
  QteAtelier: [N, texte('import.champs.ligne.QteAtelier')],
  CadenceAtelier: [N, texte('import.champs.ligne.CadenceAtelier')],
  NbJourAtelier: [N, texte('import.champs.ligne.NbJourAtelier')],
  IsGlobalisation: [N, texte('import.champs.ligne.IsGlobalisation')],
  CouleurGlobalisation: [N, texte('import.champs.ligne.CouleurGlobalisation')],
  NbJourGlobalisation: [N, texte('import.champs.ligne.NbJourGlobalisation')],
  MntChiffrageGlobalisation: [N, texte('import.champs.ligne.MntChiffrageGlobalisation')],
  NbLigneGlobalisation: [N, texte('import.champs.ligne.NbLigneGlobalisation')],
  RatioGlobalisation: [N, texte('import.champs.ligne.RatioGlobalisation')],
  Globalisations: [N, texte('import.champs.ligne.Globalisations')],
};

/** Intervenants (Annuaires) : champ → [sort, destination ou motif]. */
export const CHAMPS_INTERVENANT = {
  TRS_NomReduit: [R, texte('import.champs.intervenant.TRS_NomReduit')],
  RoleTiers: [R, texte('import.champs.intervenant.RoleTiers')],
  IsProjetCh: [R, texte('import.champs.intervenant.IsProjetCh')],
  IsClient: [R, texte('import.champs.intervenant.IsClient')],
  IsDestinataire: [R, texte('import.champs.intervenant.IsDestinataire')],
  IsTiersPayeur: [R, texte('import.champs.intervenant.IsTiersPayeur')],
  IsCompteGestion: [N, texte('import.champs.intervenant.IsCompteGestion')],
  IsTitulaire: [R, texte('import.champs.intervenant.IsTitulaire')],
  IsSTraitant: [R, texte('import.champs.intervenant.IsSTraitant')],
  Commentaire: [N, texte('import.champs.intervenant.Commentaire')],
  ADR_RaisonSociale: [R, texte('import.champs.intervenant.ADR_RaisonSociale')],
  ADR_Ligne1: [N, texte('import.champs.intervenant.ADR_Ligne1')],
  ADR_Ligne2: [N, texte('import.champs.intervenant.adresse')], ADR_Ligne3: [N, texte('import.champs.intervenant.adresse')], ADR_Ligne4: [N, texte('import.champs.intervenant.adresse')],
  ADR_CP: [N, texte('import.champs.intervenant.adresse')], ADR_Ville: [N, texte('import.champs.intervenant.adresse')], ADR_Cedex: [N, texte('import.champs.intervenant.adresse')], ADR_Pays: [N, texte('import.champs.intervenant.adresse')],
  Interlocuteur: [N, texte('import.champs.intervenant.Interlocuteur')], Fonction: [N, texte('import.champs.intervenant.Fonction')],
  Email: [N, texte('import.champs.intervenant.coordonnees')], NumTel: [N, texte('import.champs.intervenant.coordonnees')], NumFax: [N, texte('import.champs.intervenant.coordonnees')], NumPort: [N, texte('import.champs.intervenant.coordonnees')], EmailFacture: [N, texte('import.champs.intervenant.coordonnees')],
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
    if (!f) throw new Error(texte('import.optim.sans_xml'));
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
  if (racine.nom !== 'Devis') throw new Error(texte('import.optim.racine', { racine: racine.nom }));
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
      if (!def) signaler(zone, k, v.slice(0, 80), texte('import.optim.champ_inconnu'), ligne);
      else if (def[0] === N) signaler(zone, k, v.slice(0, 80), def[1], ligne);
    }
  };
  controler(texte('import.zones.entete'), e, CHAMPS_ENTETE);

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
  if (!intervenants.some((i) => i.roles.includes('CLIENT'))) avertissements.push(texte('import.optim.sans_client'));

  // Compléments de pied : la ventilation de TVA est recalculée ; les autres (remises, retenues…) sont signalés.
  const complements = enfants(enfant(racine, 'Complements'), 'Complement').map((c) => feuilles(c));
  for (const c of complements) {
    if (c.TypeComplement === 'VTLTVA') continue;
    signaler(texte('import.zones.pied'), c.TypeComplement || texte('import.optim.complement'), texte('import.optim.complement_valeur', { libelle: c.Libelle ?? '', base: c.Base, taux: c.Taux, montant: c.Montant }), texte('import.optim.complement_motif'));
  }
  for (const p of parametres) {
    if (PARAMETRES_REPRIS.has(p.Code) || couleurs.some((c) => c.code === p.Code)) continue;
    const valeurs = ['Txt1', 'Txt2', 'Num1', 'Num2', 'Num3', 'Num4', 'Num5', 'Bool1', 'Bool2', 'Bool3', 'Date1', 'Date2', 'Date3']
      .filter((k) => !estVide(p[k])).map((k) => `${k} ${p[k]}`);
    if (valeurs.length || !estVide(p.TextRTF)) signaler(texte('import.zones.parametres'), p.Code, texte('import.optim.parametre_valeur', { libelle: p.Libelle, valeurs: valeurs.join(', ') || texte('import.optim.texte') }), texte('import.optim.parametre_motif'));
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
      controler(texte('import.zones.lignes'), libre, CHAMPS_LIGNE, id);
      if (b.globalisations) signaler('Lignes', 'Globalisations', `${enfants(b.globalisations, 'Globalisation').length} répartition(s)`, CHAMPS_LIGNE.Globalisations[1], id);
      if (v.IsSautPageAvant === '1') {
        lignes.push({ id: `${id}-saut`, parent: parentNeutre?.id ?? null, type: 'SAUT_PAGE', libelle_html: '', source: id });
      }
      const composante = v.IsSousDetail === '1';
      const type = v.IsVideTexte === '1' ? 'TEXTE' : { 4: 'TITRE', 3: 'TITRE', 2: 'OUVRAGE', 1: 'ELEMENT' }[v.TypeLigne] ?? null;
      if (!type) { avertissements.push(texte('import.optim.type_inconnu', { ligne: id, type: v.TypeLigne })); }
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
  if (exclues) avertissements.push(texte('import.optim.globalisations', { nombre: exclues }));

  return {
    format: 'OptimBTP', entete, intervenants, lignes, complements, parametres, couleurs,
    non_repris: [...nonRepris.values()], avertissements,
  };
}
