import { texte, couleurTheme } from '@logibtp/socle/dictionnaire';
import { associerUnite, associerNature, associerTaux, associerOption, normaliser } from '@logibtp/import';
import { TL } from '../../calcul/index.js';

// Traduction d'un devis neutre (module Import) dans le modèle du devis BTP : lignes de saisie (ID négatifs) sous une
// section, unités, natures et taux de TVA rapprochés des référentiels, propriétés de l'entête. Calcul en bordereau (B) :
// les ouvrages (et leurs composantes) gardent le PV unitaire du logiciel d'origine en PV fixe, sans ventilation sur le
// sous-détail, pour ne pas dépendre des différences de calcul entre les deux logiciels ; chaque composante porte aussi le
// coefficient de vente de sa ligne de prix, comme dans le logiciel d'origine.

const TYPES = { TITRE: TL.TITRE, OUVRAGE: TL.OUVRAGE, ELEMENT: TL.ELEMENT, TEXTE: TL.TEXTE, SAUT_PAGE: TL.SAUT_PAGE };

/** Ligne de saisie avec les valeurs par défaut du DDL (comme EditeurDevisBtp.nouvelleLigne). */
const ligne = (o) => ({
  lig_ent_id: 0, lig_numerotation: null, lig_num_depart: null, lig_num_manuelle: false, lig_libelle_html: '',
  lig_qte: null, lig_qte_type: null, lig_precision_qte: 2, lig_pv: null, lig_coef_remise: 1, lig_precision_pv: 2,
  lig_type_prix: 'V', lig_pied_mode: null, lig_pied_base: null, lig_pied_sens: null, lig_pied_valeur: null, lig_tva_id: null,
  lig_is_non_editee: false, lig_proprietes: {}, lig_qte_source: 'S', lig_coef_perte: 1, lig_pa: null, lig_coef_fg: 1,
  lig_coef_benef: 1, lig_coef_prorata: 1, lig_pv_fixe: false, lig_pv_affiche_fixe: false, lig_is_ecart_arrondi: false,
  lig_pied_is_fa: false, lig_code: null, lig_unt_code: null, lig_nat_id: null, ...o,
});

/**
 * Saisie du devis : { document (valeurs d'entête à appliquer), lignes, correspondances (rapport des rapprochements),
 * controles (lig_id → montants du logiciel d'origine) }.
 * ref : { definition (définition du devis : unités, taux de TVA, propriétés, étiquettes), natures ([{ id, code, libelle,
 * regroupement }]), redacteurs ([{ valeur (ind_id), libelle }] : individus de notre société) }.
 */
export function saisieDevisImporte(devis, { definition, natures, redacteurs = [] }) {
  const unites = (definition.unites ?? []).map((u) => ({ code: u.unt_code, libelle: u.unt_libelle, synonymes: u.unt_synonymes ?? [] }));
  const taux = (definition.taux_tva ?? []).map((t) => ({ id: t.ttv_id, taux: t.ttv_taux, categorie: t.ttv_categorie }));
  const natureOuvrage = natures.find((n) => n.code === 'OUV') ?? natures.find((n) => n.regroupement === 'VENTE') ?? null;
  const tvaDefaut = associerTaux(devis.entete.taux_tva_defaut, taux);
  const unitesInconnues = new Map();
  const naturesAbsentes = new Map();
  const ids = new Map();
  let prochain = -1;
  const idDe = (source) => { if (!ids.has(source)) ids.set(source, prochain--); return ids.get(source); };
  const section = ligne({ lig_id: idDe('section'), lig_parent_id: null, lig_ordre: 0, lig_tyl_id: TL.SECTION, lig_libelle_html: `<b>${(devis.entete.objet ?? 'Devis importé').replace(/[<&>]/g, '')}</b>` });
  // Étiquettes de couleur : étiquette de l'application de même libellé (ou de même couleur), sinon étiquette propre au document.
  const globales = definition.etiquettes ?? [];
  const etiquettesDocument = [];
  const etiquetteDe = (e) => {
    if (!e) return null;
    const trouvee = globales.find((g) => normaliser(g.libelle) === normaliser(e.libelle))
      ?? (e.couleur ? globales.find((g) => String(g.couleur).toLowerCase() === e.couleur) : null);
    if (trouvee) return trouvee.code;
    const code = `${normaliser(devis.format).slice(0, 5)}_${String(e.code).toUpperCase()}`.slice(0, 20); // lig_etiquette : 20 caractères
    if (!etiquettesDocument.some((x) => x.code === code)) etiquettesDocument.push({ code, libelle: e.libelle, couleur: e.couleur ?? couleurTheme('--import-etiquette-defaut', '#94a3b8') });
    return code;
  };
  const ordres = new Map();
  const controles = new Map();
  const lignes = [section];
  const parents = new Set(devis.lignes.map((l) => l.parent));
  for (const l of devis.lignes) {
    const parent = l.parent === null ? section.lig_id : idDe(l.parent);
    const ordre = (ordres.get(parent) ?? 0) + 1;
    ordres.set(parent, ordre);
    const x = ligne({
      lig_id: idDe(l.id), lig_parent_id: parent, lig_ordre: ordre, lig_tyl_id: TYPES[l.type] ?? TL.TEXTE,
      lig_libelle_html: l.libelle_html ?? '', lig_code: l.code ?? null, lig_num_depart: l.num_depart ?? null,
      lig_is_non_editee: Boolean(l.non_editee), lig_etiquette: etiquetteDe(l.etiquette),
    });
    if (l.type === 'ELEMENT' || l.type === 'OUVRAGE') {
      x.lig_qte = l.qte ?? null;
      x.lig_qte_type = l.composante ? (l.qte_absolue ? 'A' : 'R') : null;
      x.lig_precision_qte = l.precision_qte ?? 2;
      x.lig_coef_benef = l.coef_benef ?? 1;
      if (l.type === 'ELEMENT') { x.lig_pa = l.prix_achat ?? 0; x.lig_coef_fg = l.coef_fg ?? 1; }
      // PV fixe : prix fixe d'origine, sinon PV unitaire imposé aux ouvrages (avec composantes) et aux composantes.
      const impose = (l.type === 'OUVRAGE' && parents.has(l.id)) || (l.composante && l.type !== 'OUVRAGE');
      const pvFixe = l.pv_fixe ?? (impose ? l.pv_unitaire ?? null : null);
      if (pvFixe !== undefined && pvFixe !== null) { x.lig_pv_fixe = true; x.lig_pv = pvFixe; }
      if (l.unite) {
        x.lig_unt_code = associerUnite(l.unite, unites);
        if (!x.lig_unt_code) unitesInconnues.set(l.unite, (unitesInconnues.get(l.unite) ?? 0) + 1);
      }
      x.lig_nat_id = associerNature(l.nature, natures) ?? (l.type === 'OUVRAGE' ? natureOuvrage?.id ?? null : null);
      if (!x.lig_nat_id) {
        const cle = l.nature ? [l.nature.code, l.nature.libelle, l.nature.regroupement].filter(Boolean).join(' / ') : '(sans nature)';
        naturesAbsentes.set(cle, (naturesAbsentes.get(cle) ?? 0) + 1);
      }
      if (!l.composante) x.lig_tva_id = associerTaux(l.taux_tva, taux) ?? tvaDefaut;
      if (!l.composante && l.controle) controles.set(x.lig_id, { ...l.controle, source: l.source, numero: l.numero ?? null });
    }
    lignes.push(x);
  }
  const proprietes = {};
  // Chantier obligatoire : à défaut, l'objet du devis (signalé dans les correspondances).
  const chantierParDefaut = !devis.entete.chantier && definition.proprietes?.some((p) => p.prd_code === 'chantier' && p.prd_obligatoire);
  if (devis.entete.chantier) proprietes.chantier = devis.entete.chantier;
  else if (chantierParDefaut) proprietes.chantier = devis.entete.objet ?? texte('import_btp.devis.a_preciser');
  const defMode = definition.proprietes?.find((p) => p.prd_code === 'mode_reglement');
  const mode = defMode ? associerOption(devis.entete.mode_reglement, defMode.prd_options ?? []) : null;
  if (mode) proprietes.mode_reglement = mode;
  // Rédacteur : individu de notre société de même nom (prénom nom ou nom prénom).
  const nomRedacteur = normaliser(devis.entete.redacteur);
  const mots = (t) => String(t ?? '').split(/\s+/).map(normaliser).filter(Boolean).sort().join(' ');
  const redacteur = nomRedacteur ? redacteurs.find((r) => normaliser(r.libelle) === nomRedacteur || mots(r.libelle) === mots(devis.entete.redacteur)) ?? null : null;
  return {
    document: {
      ent_date: devis.entete.date ?? undefined, ent_objet: devis.entete.objet ?? texte('import_btp.devis.objet'), ent_mode_calcul_ouvrage: 'B',
      ent_notre_reference: devis.entete.notre_reference ?? null, ent_reference_externe: devis.entete.reference_externe ?? null,
      ent_validite_jours: devis.entete.validite_jours ?? definition.type?.tyd_validite_jours ?? null,
      ent_redacteur_id: redacteur?.valeur ?? null, ent_etiquettes: etiquettesDocument,
      ent_num_format: { separateur: '.', niveaux: [{ style: '1' }] }, ent_proprietes: proprietes,
    },
    lignes,
    controles,
    correspondances: {
      unites_inconnues: [...unitesInconnues].map(([unite, nombre]) => ({ unite, nombre })),
      natures_absentes: [...naturesAbsentes].map(([nature, nombre]) => ({ nature, nombre })),
      mode_reglement: devis.entete.mode_reglement ? { source: devis.entete.mode_reglement, code: mode } : null,
      chantier_par_defaut: chantierParDefaut ? proprietes.chantier : null,
      redacteur: devis.entete.redacteur ? { nom: devis.entete.redacteur, id: redacteur?.valeur ?? null } : null,
      etiquettes_ajoutees: etiquettesDocument,
    },
  };
}

/** Écarts entre le calcul LogiBTP et les montants du logiciel d'origine (lignes de prix et total HT), au centime. */
export function ecartsImport(resultat, controles, totalOrigine) {
  const lignes = [];
  for (const l of resultat.lignes) {
    const c = controles.get(l.lig_id);
    if (!c) continue;
    const ecart = Math.round((Number(l.lig_montant_ht ?? 0) - c.montant_ht) * 100) / 100;
    if (Math.abs(ecart) >= 0.01) lignes.push({ lig_id: l.lig_id, numero: l.lig_numerotation ?? c.numero, origine: c.montant_ht, calcule: Number(l.lig_montant_ht ?? 0), ecart });
  }
  const total = Number(resultat.document.ent_total_ht ?? 0);
  return { total_origine: totalOrigine, total_calcule: total, ecart_total: Math.round((total - totalOrigine) * 100) / 100, lignes };
}
