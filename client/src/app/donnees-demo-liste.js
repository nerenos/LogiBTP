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
  return completerSalaries(Array.from({ length: n }, (_, i) => {
    const service = choix(r, services);
    const salaire = Math.round((1900 + r() * 3600) * 100) / 100;
    const actif = r() > 0.08;
    const statut = choix(r, CONTRATS);
    return {
      id: i + 1, type_element: statut === 'INTERIM' ? 'interim' : 'salarie', matricule: `S${String(i + 1).padStart(5, '0')}`, nom: choix(r, NOMS),
      prenom: choix(r, PRENOMS), service, poste: choix(r, SERVICES[service]), statut, date_entree: date(r, 2005, 7600), salaire_brut: salaire,
      heures_mois: 151.67, actif,
      date_naissance: date(r, 1962, 15000), num_secu: null, email: null, telephone: `06 ${[0, 0, 0, 0].map(() => String(10 + Math.floor(r() * 90))).join(' ')}`,
      adresse: `${1 + Math.floor(r() * 120)} rue ${choix(r, ['des Lilas', 'Victor-Hugo', 'de la République', 'Garibaldi', 'des Érables'])}`,
      code_postal: choix(r, ['69003', '69100', '69200', '42000', '38000', '01000']), ville: null, proprietes: {},
      commentaire: r() > 0.85 ? 'Habilitation électrique\nCACES R482 cat. A' : r() > 0.9 ? 'Temps partiel 80 %' : '',
    };
  }));
}

const VILLES_CP = { '69003': 'Lyon', '69100': 'Villeurbanne', '69200': 'Vénissieux', '42000': 'Saint-Étienne', '38000': 'Grenoble', '01000': 'Bourg-en-Bresse' };
const sansAccent = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').replace(/œ/g, 'oe').toLowerCase().replace(/[^a-z]/g, '');

/** Champs dérivés des salariés de démonstration : ville, e-mail, numéro de sécurité sociale. */
function completerSalaries(salaries) {
  for (const s of salaries) {
    s.ville = VILLES_CP[s.code_postal];
    s.agence = ['Lyon', 'Lyon', 'Saint-Étienne', 'Grenoble', 'Bourg-en-Bresse'][s.id % 5];
    s.type_mo = s.service === 'Chantier' || s.service === 'Atelier' ? 'OUVRIER' : ['Directeur', 'Conducteur de travaux'].includes(s.poste) ? 'CADRE' : 'ETAM';
    s.telephone_perso = `07 ${[13, 29, 43, 61].map((k) => String((s.id * k) % 100).padStart(2, '0')).join(' ')}`;
    s.email_perso = null;
    s.contact_nom = s.id % 3 === 0 ? null : `${['Marie', 'Pierre', 'Sophie', 'Julien'][s.id % 4]} ${s.nom} (${['conjoint(e)', 'parent', 'frère / sœur'][s.id % 3]})`;
    s.contact_telephone = s.id % 3 === 0 ? null : `06 ${String((s.id * 17) % 100).padStart(2, '0')} 45 67 ${String((s.id * 7) % 100).padStart(2, '0')}`;
    s.note_perso = null;
    s.email = `${sansAccent(s.prenom)}.${sansAccent(s.nom)}${s.id}@exemple.fr`;
    // Code et matricule de paie : même règle que db/203 (initiale du prénom, trois lettres du nom, numéro).
    s.code = `${sansAccent(s.prenom).slice(0, 1)}${sansAccent(s.nom).slice(0, 3)}`.toUpperCase() + s.id;
    s.matricule_paie = `P${String(s.id).padStart(6, '0')}`;
    const [a, m] = s.date_naissance.split('-');
    s.num_secu = `${s.id % 2 ? 1 : 2} ${a.slice(2)} ${m} 69 ${String(100 + (s.id % 900)).padStart(3, '0')} ${String(s.id % 1000).padStart(3, '0')} ${String(10 + (s.id % 89)).padStart(2, '0')}`;
  }
  return salaries;
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
      marque: choix(r, ['Kubota', 'Manitou', 'Liebherr', 'Bosch', 'Renault Trucks', 'JCB', 'Hilti']), numero_serie: `SN${(100000 + i * 7919) % 999983}`, proprietes: {},
    };
  });
}

const METIERS = ['Électricité', 'Plomberie', 'Charpente', 'Étanchéité', 'Plâtrerie', 'Peinture', 'Menuiserie', 'Terrassement'];
const VILLES = ['Lyon', 'Villeurbanne', 'Vénissieux', 'Saint-Étienne', 'Grenoble', 'Bourg-en-Bresse'];

/**
 * Ressources : union des équipes, salariés, intérimaires, matériels et sous-traitants (comme v_liste_ressources).
 * L'identifiant est préfixé par le type : il reste unique dans l'union.
 */
export function ressourcesDemo(salaries, materiels) {
  const r = alea(99);
  const equipes = Array.from({ length: 12 }, (_, i) => {
    const effectif = 3 + Math.floor(r() * 6);
    return {
      id: `EQU-${i + 1}`, type_element: 'equipe', code: `E${String(i + 1).padStart(3, '0')}`,
      libelle: `Équipe ${['gros œuvre', 'second œuvre', 'VRD', 'finitions'][i % 4]} ${1 + Math.floor(i / 4)}`, categorie: ['Gros œuvre', 'Second œuvre', 'VRD', 'Finitions'][i % 4],
      statut: `Chef : ${choix(r, PRENOMS)} ${choix(r, NOMS)}`, disponible: r() > 0.3, cout_horaire: effectif * 42, chantier: r() > 0.3 ? choix(r, CHANTIERS.filter(Boolean)) : null,
      observations: `Effectif ${effectif}`,
    };
  });
  const sousTraitants = Array.from({ length: 40 }, (_, i) => {
    const metier = choix(r, METIERS);
    const agree = r() > 0.25;
    return {
      id: `SST-${i + 1}`, type_element: 'sous_traitant', code: `ST${String(i + 1).padStart(3, '0')}`, libelle: `${choix(r, NOMS)} ${metier}`,
      categorie: metier, statut: agree ? 'Agréé' : 'Agrément en cours', disponible: agree, cout_horaire: Math.round((38 + r() * 30) * 100) / 100,
      chantier: null, observations: `${choix(r, VILLES)}${agree ? '' : '\nAttestation URSSAF à fournir'}`,
    };
  });
  return [
    ...equipes,
    ...salaries.map((s) => ({
      id: `SAL-${s.id}`, type_element: s.type_element, code: s.matricule, libelle: `${s.prenom} ${s.nom}`, categorie: s.service, statut: s.poste,
      disponible: s.actif, cout_horaire: Math.round((s.salaire_brut * 1.45 / 151.67) * 100) / 100, chantier: null, observations: s.commentaire,
    })),
    ...materiels.map((m) => ({
      id: `MAT-${m.id}`, type_element: 'materiel', code: m.code, libelle: m.designation, categorie: m.famille, statut: m.etat,
      disponible: m.etat === 'DISPO', cout_horaire: Math.round(m.valeur_achat / 20) / 100, chantier: m.chantier, observations: m.observations,
    })),
    ...sousTraitants,
  ];
}

const TYPES_DOC = [['V_DEVIS', 'Devis client', 'V'], ['V_COMMANDE', 'Commande client', 'V'], ['V_FACTURE', 'Facture', 'V'], ['V_AVOIR', 'Avoir', 'V'],
  ['A_COMMANDE', 'Commande fournisseur', 'A'], ['A_DEVIS', 'Demande de prix fournisseur', 'A'], ['A_FACTURE', 'Facture fournisseur', 'A']];
const STATUTS = ['Brouillon', 'Validé', 'Validé', 'Accepté', 'Facturé', 'Soldé', 'Annulé'];

/** Documents fictifs des listes hors ligne (aucun ne s'ouvre : les documents se lisent dans la base). */
export function documentsDemo(n = 400) {
  const r = alea(2026);
  const lignes = [];
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
