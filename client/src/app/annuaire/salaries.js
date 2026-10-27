// Individu de l'annuaire d'un salarié : rôles déduits du statut et du poste (même règle que SalariesAnnuaire.cs).

const ROLE_POSTE = { 'Conducteur de travaux': 'CONDUCTEUR', "Chef d'équipe": 'CHEF_CHANTIER', Métreur: 'CHIFFREUR' };

/** Rôles de l'individu d'un salarié (statut et poste). */
export const rolesSalarie = (s) => [s.statut === 'INTERIM' ? 'INTERIMAIRE' : 'SALARIE', ROLE_POSTE[s.poste]].filter(Boolean);
