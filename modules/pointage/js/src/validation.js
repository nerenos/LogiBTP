// Validation des pointages, règle répliquée dans ReglesValidation.cs (jeu modules/pointage/tests/cas/02_validation.json) :
// état d'un jour d'après les validations qui le couvrent (simple : RH ; double : chef de service puis RH, le RH pouvant
// valider sans le chef), contrôle des actions (valider, dévalider avec motif), exceptions d'une semaine pour la
// synthèse par exceptions (ANALYSE-MODULE-POINTAGE.md M11, M12, M17, § 6).

export const ETATS_VALIDATION = {
  NON_VALIDE: { libelle: 'À valider', icone: '○' },
  VALIDE_CHEF: { libelle: 'Validé par le chef', icone: '◐' },
  VALIDE: { libelle: 'Validé', icone: '●' },
};

export const MESSAGES_VALIDATION = {
  VAL_CHEF_SIMPLE: 'Validation simple : seul le service RH valide',
  VAL_DEJA: 'Déjà validé',
  VAL_RH_FAIT: 'Déjà validé par le service RH',
  DEV_MOTIF: 'Motif obligatoire pour dévalider',
  DEV_RIEN: 'Rien à dévalider',
  DEV_RH_FAIT: 'Validé par le service RH : seul le RH peut dévalider',
  EXC_CORRECTION: 'Demande de correction en attente',
  EXC_SANS_POINTAGE: 'Jour travaillé sans pointage',
  EXC_NON_CONFORMITE: 'Non-conformité signalée',
  EXC_HEURES_SUP: 'Heures supplémentaires',
  EXC_CONTROLE: 'Contrôle à vérifier (amplitude, chantier clos…)',
  EXC_ZONE: 'Zone de déplacement à valider (chantier sans zone pour l\'agence)',
  EXC_MODIFIE: 'Corrigé par rapport à la saisie',
};

const couvre = (v, date) => !v.annule && v.du <= date && date <= v.au;

/** État d'un jour : validé (RH), validé par le chef (double validation seulement) ou à valider. */
export function etatValidation({ mode = 'SIMPLE', date, validations = [] }) {
  const c = validations.filter((v) => couvre(v, date));
  if (c.some((v) => v.niveau === 'RH')) return 'VALIDE';
  if (mode === 'DOUBLE' && c.some((v) => v.niveau === 'CHEF')) return 'VALIDE_CHEF';
  return 'NON_VALIDE';
}

/** Un jour validé (à un niveau ou un autre) n'est plus modifiable par la saisie. */
export const estBloque = (etat) => etat !== 'NON_VALIDE';

/**
 * Contrôle d'une action sur des jours (états de ces jours) : `action` VALIDER ou DEVALIDER, `role` CHEF ou RH,
 * `mode` SIMPLE ou DOUBLE ; dévalidation : motif obligatoire. Codes dans l'ordre de la règle.
 */
export function controlerAction({ action, role, mode = 'SIMPLE', etats = [], motif = '' }) {
  const r = [];
  if (action === 'VALIDER') {
    if (role === 'CHEF' && mode === 'SIMPLE') r.push('VAL_CHEF_SIMPLE');
    else if (role === 'CHEF' && etats.some((e) => e === 'VALIDE')) r.push('VAL_RH_FAIT');
    else if (etats.length && etats.every((e) => e === (role === 'CHEF' ? 'VALIDE_CHEF' : 'VALIDE'))) r.push('VAL_DEJA');
  } else {
    if (!String(motif ?? '').trim()) r.push('DEV_MOTIF');
    if (etats.every((e) => e === 'NON_VALIDE')) r.push('DEV_RIEN');
    else if (role === 'CHEF' && etats.some((e) => e === 'VALIDE')) r.push('DEV_RH_FAIT');
  }
  return r;
}

/**
 * Exceptions d'une semaine d'un salarié (synthèse par exceptions) : demande de correction, jour travaillé sans
 * pointage, non-conformité, heures au-delà du seuil hebdomadaire, avertissement des contrôles, couche validée
 * différente de la saisie, zone de déplacement manquante (chantier sans zone pour l'agence du salarié). `pointages` [{ date, minutes, non_conformite }] retenus (validés sinon saisis).
 */
export function exceptionsSemaine({ jours_travailles = [], pointages = [], seuil_semaine = 2100, avertissements = 0, corrections = 0, modifie = false, zones_manquantes = 0 }) {
  const r = [];
  if (corrections > 0) r.push('EXC_CORRECTION');
  if (jours_travailles.some((d) => !pointages.some((p) => p.date === d && p.minutes > 0))) r.push('EXC_SANS_POINTAGE');
  if (pointages.some((p) => p.non_conformite)) r.push('EXC_NON_CONFORMITE');
  if (seuil_semaine > 0 && pointages.reduce((s, p) => s + (p.minutes > 0 ? p.minutes : 0), 0) > seuil_semaine) r.push('EXC_HEURES_SUP');
  if (avertissements > 0) r.push('EXC_CONTROLE');
  if (zones_manquantes > 0) r.push('EXC_ZONE');
  if (modifie) r.push('EXC_MODIFIE');
  return r;
}
