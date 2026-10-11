// Données de démonstration des listes hors ligne : générateur déterministe (mêmes données à chaque
// lancement), volumineux pour éprouver le chargement par lots. Côté base : db/120_listes.sql.

function alea(graine) {
  let s = graine >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PRENOMS = ['Hélène', 'Gaëlle', 'Jérôme', 'Lœtitia', 'François', 'Zoé', 'Noël', 'Agnès', 'Benoît', 'Céline', 'Loïc', 'Maëlys',
  'Thomas', 'Inès', 'Raphaël', 'Chloé', 'Jean-Marc', 'Anaïs', 'Mathéo', 'Léa', 'Ophélie', 'Grégoire', 'Nadège', 'Frédéric'];
const NOMS = ['Martin', 'Bernard', 'Dubois', 'Lefèvre', 'Moreau', 'Laurent', 'Garçon', 'Roux', 'Fournier', 'Girard', 'Bonnet',
  'Dupré', 'Lambert', 'Fontaine', 'Rousseau', 'Vincent', 'Müller', 'Faure', 'André', 'Mercier', 'Blanc', 'Guérin', 'Boyer', 'Chevalier'];
const SERVICES = { Chantier: ['Maçon', 'Chef d\'équipe', 'Coffreur', 'Manœuvre', 'Grutier'], Bureau: ['Conducteur de travaux', 'Métreur', 'Assistante', 'Comptable'],
  Atelier: ['Mécanicien', 'Magasinier'], Direction: ['Directeur', 'Responsable QSE'] };
const CONTRATS = ['CDI', 'CDI', 'CDI', 'CDD', 'INTERIM'];
const FAMILLES = { Engins: ['Mini-pelle 2,5 t', 'Chargeuse compacte', 'Tractopelle', 'Pelle sur chenilles 14 t'],
  Levage: ['Grue à tour', 'Nacelle ciseaux', 'Chariot télescopique'], Outillage: ['Bétonnière 350 l', 'Marteau-piqueur', 'Scie à sol', 'Groupe électrogène'],
  Véhicules: ['Fourgon 3,5 t', 'Camion benne', 'Utilitaire léger'], Coffrage: ['Banches métalliques', 'Étais tirants'] };
const ETATS = ['DISPO', 'DISPO', 'CHANTIER', 'CHANTIER', 'CHANTIER', 'PANNE', 'REBUT'];
const CHANTIERS = ['Maison Martin – Lyon', 'Résidence Les Érables', 'École Jean-Moulin', 'Pont de la Saône', 'Entrepôt Sud – Vénissieux', null];
const OBSERVATIONS = ['', '', 'Pneus à changer', 'Fuite hydraulique signalée\nDevis réparation demandé', 'Contrôle VGP à planifier', 'Rayures carrosserie'];

const date = (r, debut, jours) => new Date(Date.UTC(debut, 0, 1) + Math.floor(r() * jours) * 86400000).toISOString().slice(0, 10);
const choix = (r, t) => t[Math.floor(r() * t.length)];

export function salariesDemo(n = 5000) {
  const r = alea(42);
  const services = Object.keys(SERVICES);
  return Array.from({ length: n }, (_, i) => {
    const service = choix(r, services);
    const salaire = Math.round((1900 + r() * 3600) * 100) / 100;
    const actif = r() > 0.08;
    return {
      id: i + 1, matricule: `S${String(i + 1).padStart(5, '0')}`, nom: choix(r, NOMS), prenom: choix(r, PRENOMS), service,
      poste: choix(r, SERVICES[service]), statut: choix(r, CONTRATS), date_entree: date(r, 2005, 7600), salaire_brut: salaire,
      heures_mois: 151.67, actif, commentaire: r() > 0.85 ? 'Habilitation électrique\nCACES R482 cat. A' : r() > 0.9 ? 'Temps partiel 80 %' : '',
    };
  });
}

export function materielsDemo(n = 3000) {
  const r = alea(7);
  const familles = Object.keys(FAMILLES);
  return Array.from({ length: n }, (_, i) => {
    const famille = choix(r, familles);
    const etat = choix(r, ETATS);
    const revision = 250 * (1 + Math.floor(r() * 8));
    return {
      id: i + 1, code: `M${String(i + 1).padStart(5, '0')}`, designation: `${choix(r, FAMILLES[famille])} n° ${100 + (i % 900)}`, famille, etat,
      chantier: etat === 'CHANTIER' ? choix(r, CHANTIERS.filter(Boolean)) : null, valeur_achat: Math.round(800 + r() * 180000),
      date_achat: date(r, 2012, 5000), heures_utilisation: Math.floor(revision * (0.4 + r() * 0.8)), heures_revision: revision,
      controle_ok: r() > 0.2, observations: choix(r, OBSERVATIONS),
    };
  });
}

const TYPES_DOC = [['V_DEVIS', 'Devis client', 'V'], ['V_COMMANDE', 'Commande client', 'V'], ['V_FACTURE', 'Facture', 'V'], ['A_COMMANDE', 'Commande fournisseur', 'A']];
const STATUTS = ['Brouillon', 'Validé', 'Validé', 'Accepté', 'Facturé', 'Soldé', 'Annulé'];

/** Documents de démonstration : le devis du mode hors ligne (ID 0) puis des documents fictifs. */
export function documentsDemo(demo, n = 400) {
  const r = alea(2026);
  const d = demo.document;
  const lignes = [{
    id: d.ent_id, type_element: 'V_DEVIS', type_document: 'Devis client', famille: 'V', numero: d.ent_numero, indice: 'A',
    date_document: d.ent_date, objet: d.ent_objet, chantier: d.ent_proprietes?.chantier ?? null, statut: 'Brouillon', tiers: d.ent_tiers_id,
    total_ht: null, total_ttc: null, net_a_payer: null, reference: true, verrouille: false, modifie_le: null,
  }];
  for (let i = 1; i <= n; i++) {
    const [code, libelle, famille] = choix(r, TYPES_DOC);
    const ht = Math.round(r() * 250000) / 100;
    lignes.push({
      id: i, type_element: code, type_document: libelle, famille, numero: `${code.slice(2, 4)}${String(2026)}-${String(i).padStart(5, '0')}`,
      indice: r() > 0.9 ? 'B' : 'A', date_document: date(r, 2025, 640), objet: `${choix(r, ['Rénovation', 'Extension', 'Ravalement', 'Terrassement', 'Gros œuvre'])} – ${choix(r, NOMS)}`,
      chantier: choix(r, CHANTIERS), statut: choix(r, STATUTS), tiers: 1 + Math.floor(r() * 300), total_ht: ht,
      total_ttc: Math.round(ht * 120) / 100, net_a_payer: Math.round(ht * 114) / 100, reference: true, verrouille: false, modifie_le: null,
    });
  }
  return lignes;
}
