import { AGENCES_SALARIES } from './donnees.js';

// Démonstration hors ligne : chaque salarié est un individu de l'annuaire rattaché à l'agence de notre société, avec ses
// coordonnées professionnelles sur le rattachement (même règle que db/142_annuaire_salaries.sql ; les données privées
// restent dans la fiche salarié). Identifiants : individu et rattachement = 1000 + id ; coordonnées = 100000 + 2 × id (+ 1).

const ROLE_POSTE = { 'Conducteur de travaux': 'CONDUCTEUR', "Chef d'équipe": 'CHEF_CHANTIER', Métreur: 'CHIFFREUR' };

/** Rôles de l'individu d'un salarié (statut et poste). */
export const rolesSalarie = (s) => [s.statut === 'INTERIM' ? 'INTERIMAIRE' : 'SALARIE', ROLE_POSTE[s.poste]].filter(Boolean);

/** Individus, rattachements et coordonnées des salariés ; renseigne ind_id sur chaque salarié. */
export function annuaireDesSalaries(salaries) {
  const individus = [], rattachements = [], coordonnees = [], usages = [];
  let usage = 100000;
  for (const s of salaries) {
    const id = 1000 + s.id;
    s.ind_id = id;
    individus.push({ id, civilite: null, nom: s.nom, prenom: s.prenom, date_naissance: s.date_naissance ?? null, pays: 'FR', roles: rolesSalarie(s), utilisateur: null,
      actif: s.actif !== false, commentaire: `Salarié ${s.matricule}`, proprietes: {} });
    rattachements.push({ id, ind_id: id, per_id: AGENCES_SALARIES[s.agence] ?? 1, fonction: `${s.poste}${s.statut === 'INTERIM' ? ' (intérim)' : ''}`, service: s.service,
      principal: false, titulaire: false, debut: s.date_entree ?? null, fin: null, actif: s.actif !== false, commentaire: null });
    for (const [k, nature, u] of [[0, 'EMAIL', 'PRO'], [1, 'TELEPHONE', 'PORTABLE']]) {
      const valeur = nature === 'EMAIL' ? s.email : s.telephone;
      if (!valeur) continue;
      const cooId = 100000 + 2 * s.id + k;
      coordonnees.push({ id: cooId, nature, valeur, ligne1: null, ligne2: null, ligne3: null, code_postal: null, ville: null, pays: null, reseau: null, modifie_le: null, modifie_par: 'demo' });
      usages.push({ id: ++usage, coo_id: cooId, per_id: null, ind_id: null, rat_id: id, usage: u, libelle: null, principal: true, ordre: 0 });
    }
  }
  return { individus, rattachements, coordonnees, usages };
}

/** Personne de l'agence d'un salarié (même règle que db/142 : « LogiBTP Démo », « LogiBTP Démo – Agence de … »). */
const libelleAgence = (agence) => (!agence || agence === 'Lyon' ? 'LogiBTP Démo' : `LogiBTP Démo – Agence de ${agence}`);

/**
 * Salarié enregistré : son individu reprend l'identité (nom, prénom, naissance, actif), le rôle salarié ou intérimaire
 * et son rattachement à l'agence (fonction = poste, service, date d'entrée). Même règle que SalariesAnnuaire.cs.
 */
export function synchroniserSalarie(annuaire, s) {
  const i = annuaire.individus.find((x) => x.id === Number(s.ind_id));
  if (!i) return;
  const contrat = s.statut === 'INTERIM' ? 'INTERIMAIRE' : 'SALARIE';
  Object.assign(i, {
    nom: s.nom, prenom: s.prenom, date_naissance: s.date_naissance ?? i.date_naissance, actif: s.actif !== false,
    roles: [contrat, ...(i.roles ?? []).filter((r) => r !== 'SALARIE' && r !== 'INTERIMAIRE')],
  });
  const agence = annuaire.personnes.find((p) => p.raison_sociale === libelleAgence(s.agence));
  const interne = new Set(annuaire.personnes.filter((p) => p.raison_sociale.startsWith('LogiBTP Démo')).map((p) => p.id));
  const valeurs = { fonction: `${s.poste}${s.statut === 'INTERIM' ? ' (intérim)' : ''}`, service: s.service ?? null, debut: s.date_entree ?? null, actif: s.actif !== false };
  const r = annuaire.rattachements.find((x) => x.ind_id === i.id && interne.has(x.per_id));
  if (r) Object.assign(r, valeurs, agence ? { per_id: agence.id } : {});
  else if (agence) annuaire.rattachements.push({ id: Math.max(0, ...annuaire.rattachements.map((x) => x.id)) + 1, ind_id: i.id, per_id: agence.id, principal: false, titulaire: false, fin: null, commentaire: null, ...valeurs });
  annuaire.deriver();
}
