// Types de fiches du cœur : table, clé, colonne JSONB des champs supplémentaires et définition (sections, champs).
// Les codes de champs reprennent les colonnes des vues de liste (la démo hors ligne partage les mêmes lignes) ;
// « colonne » est la colonne de la table, utilisée par le serveur. Ces définitions alimentent aussi le script
// db/131_fiches_parametrage.sql (généré par client/scripts/generer-vues-liste.mjs).

const c = (code, libelle, colonne, type, extra = {}) => ({ code, libelle, colonne, type, ...extra });
const options = (...v) => v.map((x) => (Array.isArray(x) ? { valeur: x[0], libelle: x[1] } : { valeur: x, libelle: x }));

export const TYPES_FICHE = {
  salarie: {
    libelle: 'Salarié', table: 'demo_salarie', cle: 'sal_id', colonne_proprietes: 'sal_proprietes',
    definition: {
      libelle: 'Salarié',
      titre: '[prenom] [nom]',
      sous_titre: '[matricule] · [poste]',
      sections: [
        { code: 'identite', titre: 'Identité', champs: ['matricule', 'nom', 'prenom', 'date_naissance', 'num_secu'] },
        { code: 'emploi', titre: 'Emploi', champs: ['service', 'poste', 'statut', 'date_entree', 'actif'] },
        { code: 'coordonnees', titre: 'Coordonnées', champs: ['email', 'telephone', 'adresse', 'code_postal', 'ville'] },
        { code: 'remuneration', titre: 'Rémunération', champs: ['salaire_brut', 'heures_mois'] },
        { code: 'notes', titre: 'Notes', champs: ['commentaire'] },
      ],
      champs: [
        c('matricule', 'Matricule', 'sal_matricule', 'texte', { obligatoire: true, longueur: 10, saisie: 'creation', non_copie: true, aide: 'Identifiant unique, saisi à la création' }),
        c('nom', 'Nom', 'sal_nom', 'texte', { obligatoire: true, longueur: 60 }),
        c('prenom', 'Prénom', 'sal_prenom', 'texte', { obligatoire: true, longueur: 60 }),
        c('date_naissance', 'Date de naissance', 'sal_date_naissance', 'date', { confidentiel: true }),
        c('num_secu', 'N° de sécurité sociale', 'sal_num_secu', 'texte', {
          confidentiel: true, non_copie: true, longueur: 21, format: 'regex:^[12] ?[0-9]{2} ?[0-9]{2} ?[0-9]{2} ?[0-9]{3} ?[0-9]{3} ?[0-9]{2}$',
          aide: '13 chiffres + clé (espaces acceptés)',
        }),
        c('service', 'Service', 'sal_service', 'liste', { obligatoire: true, options: options('Chantier', 'Bureau', 'Atelier', 'Direction') }),
        c('poste', 'Poste', 'sal_poste', 'texte', { obligatoire: true, longueur: 60 }),
        c('statut', 'Contrat', 'sal_statut', 'liste', { obligatoire: true, options: options('CDI', 'CDD', ['INTERIM', 'Intérim']) }),
        c('date_entree', "Date d'entrée", 'sal_date_entree', 'date', { obligatoire: true }),
        c('actif', 'Actif', 'sal_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('email', 'E-mail', 'sal_email', 'texte', { longueur: 100, format: 'email', non_copie: true }),
        c('telephone', 'Téléphone', 'sal_telephone', 'texte', { longueur: 20, format: 'telephone' }),
        c('adresse', 'Adresse', 'sal_adresse', 'zone', { longueur: 200 }),
        c('code_postal', 'Code postal', 'sal_code_postal', 'texte', { longueur: 5, format: 'code_postal' }),
        c('ville', 'Ville', 'sal_ville', 'texte', { longueur: 60 }),
        c('salaire_brut', 'Salaire brut mensuel', 'sal_salaire', 'nombre', { obligatoire: true, confidentiel: true, format: '99999.99' }),
        c('heures_mois', 'Heures mensuelles', 'sal_heures_mois', 'nombre', { obligatoire: true, format: '999.99', defaut: 151.67 }),
        c('commentaire', 'Commentaire', 'sal_commentaire', 'zone'),
      ],
    },
  },
  materiel: {
    libelle: 'Matériel', table: 'demo_materiel', cle: 'mat_id', colonne_proprietes: 'mat_proprietes',
    definition: {
      libelle: 'Matériel',
      titre: '[designation]',
      sous_titre: '[code] · [famille]',
      sections: [
        { code: 'identification', titre: 'Identification', champs: ['code', 'designation', 'famille', 'marque', 'numero_serie'] },
        { code: 'exploitation', titre: 'Exploitation', champs: ['etat', 'chantier', 'heures_utilisation', 'heures_revision', 'controle_ok'] },
        { code: 'achat', titre: 'Achat', champs: ['valeur_achat', 'date_achat'] },
        { code: 'notes', titre: 'Notes', champs: ['observations'] },
      ],
      champs: [
        c('code', 'Code', 'mat_code', 'texte', { obligatoire: true, longueur: 10, non_copie: true }),
        c('designation', 'Désignation', 'mat_designation', 'texte', { obligatoire: true, longueur: 100, largeur: 'plein' }),
        c('famille', 'Famille', 'mat_famille', 'liste', { obligatoire: true, options: options('Engins', 'Levage', 'Outillage', 'Véhicules', 'Coffrage') }),
        c('marque', 'Marque', 'mat_marque', 'texte', { longueur: 60 }),
        c('numero_serie', 'N° de série', 'mat_numero_serie', 'texte', { longueur: 40, non_copie: true }),
        c('etat', 'État', 'mat_etat', 'liste', {
          obligatoire: true, defaut: 'DISPO',
          options: options(['DISPO', 'Disponible'], ['CHANTIER', 'En chantier'], ['PANNE', 'En panne'], ['REBUT', 'Rebut']),
        }),
        c('chantier', 'Chantier', 'mat_chantier', 'texte', { longueur: 100 }),
        c('heures_utilisation', "Heures d'utilisation", 'mat_heures', 'nombre', { obligatoire: true, format: '99999', defaut: 0 }),
        c('heures_revision', 'Révision tous les (heures)', 'mat_heures_revision', 'nombre', { obligatoire: true, format: '99999', defaut: 500 }),
        c('controle_ok', 'Contrôle réglementaire à jour', 'mat_controle_ok', 'booleen', { obligatoire: true, defaut: false }),
        c('valeur_achat', "Valeur d'achat", 'mat_valeur_achat', 'nombre', { obligatoire: true, format: '9999999.99' }),
        c('date_achat', "Date d'achat", 'mat_date_achat', 'date', { obligatoire: true }),
        c('observations', 'Observations', 'mat_observations', 'zone'),
      ],
    },
  },
};

/** Droits par profil : ADMIN tout ; SAISIE consulte et modifie, sans confidentiel ni reprise de main sur les salariés. */
export const DROITS_FICHE = [
  ...['salarie', 'materiel'].flatMap((type) => ['VOIR', 'MODIFIER', 'DEBLOQUER', 'CONFIDENTIEL'].map((action) => ({ profil: 'ADMIN', type, action }))),
  { profil: 'SAISIE', type: 'salarie', action: 'VOIR' }, { profil: 'SAISIE', type: 'salarie', action: 'MODIFIER' },
  { profil: 'SAISIE', type: 'materiel', action: 'VOIR' }, { profil: 'SAISIE', type: 'materiel', action: 'MODIFIER' },
  { profil: 'SAISIE', type: 'materiel', action: 'DEBLOQUER' },
];

/** Paramétrage de démonstration : un champ du programme rendu obligatoire, des champs supplémentaires. */
export const PARAMETRAGE_FICHE = {
  salarie: {
    obligatoires: ['telephone'],
    supplementaires: [
      { code: 'taille_vetement', libelle: 'Taille de vêtement', type: 'liste', options: options('S', 'M', 'L', 'XL', 'XXL'), ordre: 10 },
      { code: 'pointure', libelle: 'Pointure', type: 'nombre', format: '99', ordre: 20 },
      { code: 'permis_c', libelle: 'Permis C', type: 'booleen', ordre: 30 },
      { code: 'contact_urgence', libelle: "Téléphone en cas d'urgence", type: 'texte', format: 'telephone', longueur: 20, confidentiel: true, ordre: 40 },
      { code: 'mutuelle', libelle: 'Mutuelle', type: 'texte', longueur: 60, confidentiel: true, ordre: 50 },
    ].map((x) => ({ ...x, actif: true })),
  },
  materiel: {
    obligatoires: [],
    supplementaires: [
      { code: 'immatriculation', libelle: 'Immatriculation', type: 'texte', longueur: 9, format: 'regex:^[A-Z]{2}-[0-9]{3}-[A-Z]{2}$', aide: 'AA-123-AA', ordre: 10 },
      { code: 'assureur', libelle: 'Assureur', type: 'texte', longueur: 60, ordre: 20 },
      { code: 'puissance_kw', libelle: 'Puissance (kW)', type: 'nombre', format: '9999.9', ordre: 30 },
    ].map((x) => ({ ...x, actif: true })),
  },
};

/** Type de fiche et ID à partir d'une ligne de liste (types d'élément, ID préfixés de la vue Ressources). */
export function ficheDeLigne({ type, id }) {
  const m = /^(SAL|MAT)-(\d+)$/.exec(String(id));
  if (m) return { type: m[1] === 'SAL' ? 'salarie' : 'materiel', id: Number(m[2]) };
  if (type === 'salarie' || type === 'interim') return { type: 'salarie', id };
  if (type === 'materiel') return { type: 'materiel', id };
  return null;
}
