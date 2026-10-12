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
      // Peu d'onglets, des groupes de champs : informations liées à l'entreprise, puis données privées (RGPD).
      sections: [
        {
          code: 'entreprise', titre: 'Entreprise',
          groupes: [
            { titre: 'Identité', champs: ['matricule', 'nom', 'prenom', 'ind_id'] },
            { titre: 'Emploi', champs: ['agence', 'service', 'poste', 'type_mo', 'statut', 'date_entree', 'actif'] },
            { titre: 'Coordonnées professionnelles', champs: ['email', 'telephone'] },
            { titre: 'Rémunération', champs: ['salaire_brut', 'heures_mois'] },
            { titre: 'Note professionnelle', champs: ['commentaire'], largeur: 'plein' },
          ],
        },
        {
          code: 'prive', titre: 'Privé (RGPD)',
          groupes: [
            { titre: 'État civil', champs: ['date_naissance', 'num_secu'] },
            { titre: 'Coordonnées personnelles', champs: ['adresse', 'code_postal', 'ville', 'telephone_perso', 'email_perso'] },
            { titre: 'Personne à prévenir', champs: ['contact_nom', 'contact_telephone'] },
            { titre: 'Note personnelle', champs: ['note_perso'], largeur: 'plein' },
          ],
        },
      ],
      champs: [
        c('matricule', 'Matricule', 'sal_matricule', 'texte', { obligatoire: true, longueur: 10, saisie: 'creation', non_copie: true, aide: 'Identifiant unique, saisi à la création' }),
        c('nom', 'Nom', 'sal_nom', 'texte', { obligatoire: true, longueur: 60 }),
        c('ind_id', 'Individu (annuaire)', 'sal_ind_id', 'nombre', { reference: 'individu', non_copie: true, aide: "Fiche de l'individu dans l'annuaire : identité et coordonnées partagées avec les autres modules" }),
        c('prenom', 'Prénom', 'sal_prenom', 'texte', { obligatoire: true, longueur: 60 }),
        c('date_naissance', 'Date de naissance', 'sal_date_naissance', 'date', { confidentiel: true }),
        c('num_secu', 'N° de sécurité sociale', 'sal_num_secu', 'texte', {
          confidentiel: true, non_copie: true, longueur: 21, format: 'regex:^[12] ?[0-9]{2} ?[0-9]{2} ?[0-9]{2} ?[0-9]{3} ?[0-9]{3} ?[0-9]{2}$',
          aide: '13 chiffres + clé (espaces acceptés)',
        }),
        c('service', 'Service', 'sal_service', 'liste', { obligatoire: true, options: options('Chantier', 'Bureau', 'Atelier', 'Direction') }),
        c('poste', 'Poste', 'sal_poste', 'texte', { obligatoire: true, longueur: 60 }),
        c('agence', 'Agence', 'sal_agence', 'liste', { options: options('Lyon', 'Saint-Étienne', 'Grenoble', 'Bourg-en-Bresse') }),
        c('type_mo', 'Type de main-d\'œuvre', 'sal_type_mo', 'liste', {
          options: options(['OUVRIER', 'Ouvrier'], ['ETAM', 'ETAM'], ['CADRE', 'Ingénieur et cadre']), aide: 'Catégorie conventionnelle BTP',
        }),
        c('statut', 'Contrat', 'sal_statut', 'liste', { obligatoire: true, options: options('CDI', 'CDD', ['INTERIM', 'Intérim']) }),
        c('date_entree', "Date d'entrée", 'sal_date_entree', 'date', { obligatoire: true }),
        c('actif', 'Actif', 'sal_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('email', 'E-mail professionnel', 'sal_email', 'texte', { longueur: 100, format: 'email', non_copie: true }),
        c('telephone', 'Téléphone professionnel', 'sal_telephone', 'texte', { longueur: 20, format: 'telephone' }),
        // Données privées (RGPD) : confidentielles, affichées à la demande.
        c('adresse', 'Adresse', 'sal_adresse', 'zone', { longueur: 200, confidentiel: true, largeur: 'plein' }),
        c('code_postal', 'Code postal', 'sal_code_postal', 'texte', { longueur: 5, format: 'code_postal', confidentiel: true }),
        c('ville', 'Ville', 'sal_ville', 'texte', { longueur: 60, confidentiel: true }),
        c('telephone_perso', 'Téléphone personnel', 'sal_telephone_perso', 'texte', { longueur: 20, format: 'telephone', confidentiel: true }),
        c('email_perso', 'E-mail personnel', 'sal_email_perso', 'texte', { longueur: 100, format: 'email', confidentiel: true, non_copie: true }),
        c('contact_nom', 'Nom et lien', 'sal_contact_nom', 'texte', { longueur: 100, confidentiel: true, aide: 'Ex. Marie Martin (conjointe)' }),
        c('contact_telephone', 'Téléphone', 'sal_contact_telephone', 'texte', { longueur: 20, format: 'telephone', confidentiel: true }),
        c('note_perso', 'Note personnelle', 'sal_note_perso', 'zone', { confidentiel: true }),
        c('salaire_brut', 'Salaire brut mensuel', 'sal_salaire', 'nombre', { obligatoire: true, confidentiel: true, format: '99999.99' }),
        c('heures_mois', 'Heures mensuelles', 'sal_heures_mois', 'nombre', { obligatoire: true, format: '999.99', defaut: 151.67 }),
        c('commentaire', 'Note professionnelle', 'sal_commentaire', 'zone'),
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
        {
          code: 'informations', titre: 'Informations',
          groupes: [
            { titre: 'Identification', champs: ['code', 'designation', 'famille', 'marque', 'numero_serie'] },
            { titre: 'Exploitation', champs: ['etat', 'chantier', 'heures_utilisation', 'heures_revision', 'controle_ok'] },
            { titre: 'Achat', champs: ['valeur_achat', 'date_achat'] },
            { titre: 'Observations', champs: ['observations'], largeur: 'plein' },
          ],
        },
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
  // Élément de bibliothèque (module Bibliothèque) : l'onglet Article vient de la définition ; Prix, Unités, Tarifs,
  // Composition (ouvrage) et Image et notices sont des onglets spécifiques de FicheElement. Les prix calculés (PA, PR,
  // PV net…) sont écrits par le serveur (SpecialisationFicheBtp) ; les champs json sont des colonnes jsonb.
  element: {
    libelle: 'Élément', table: 'element', cle: 'ele_id', colonne_proprietes: 'ele_proprietes',
    definition: {
      libelle: 'Élément de bibliothèque',
      titre: '[code] – [libelle]',
      sous_titre: '[bib_code] · [famille]',
      sections: [
        {
          code: 'article', titre: 'Article',
          groupes: [
            { titre: 'Identification', champs: ['bib_id', 'code', 'type', 'actif'] },
            { titre: 'Classement', champs: ['fam_id', 'nat_id', 'gestion'] },
            { titre: 'Libellé', champs: ['libelle_html'], largeur: 'plein' },
            { titre: 'Données techniques (par unité de stock)', champs: ['poids', 'surface', 'surface_peinture', 'volume', 'hauteur', 'largeur', 'epaisseur'], largeur: 'plein' },
            { code: 'isolation', titre: 'Isolation', champs: ['isolant_epaisseur', 'isolant_lambda', 'isolant_r', 'isolant_u'] },
          ],
        },
      ],
      champs: [
        c('bib_id', 'Bibliothèque', 'ele_bib_id', 'nombre', { obligatoire: true, saisie: 'creation', reference: 'bibliotheque' }),
        c('code', 'Code', 'ele_code', 'texte', { obligatoire: true, longueur: 30, non_copie: true, format: 'regex:^[^:\\s][^:]*$', aide: "Unique dans la bibliothèque ; sans « : » (réservé à l'appel BIB:CODE)" }),
        c('type', 'Type', 'ele_type', 'liste', { obligatoire: true, defaut: 'ARTICLE', saisie: 'creation', options: options(['ARTICLE', 'Article'], ['OUVRAGE', 'Ouvrage']) }),
        c('actif', 'Actif', 'ele_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('libelle_html', 'Libellé', 'ele_libelle_html', 'html', { obligatoire: true }),
        c('libelle', 'Libellé (texte brut)', 'ele_libelle', 'texte', { lecture_seule: true }),
        c('fam_id', 'Famille', 'ele_fam_id', 'nombre', { reference: 'famille' }),
        c('nat_id', 'Nature', 'ele_nat_id', 'nombre', { reference: 'nature' }),
        c('gestion', 'Type de gestion', 'ele_gestion', 'liste', {
          obligatoire: true, defaut: 'NON_GERE', options: options(['STOCK', 'Stock'], ['ACHAT', 'Achat'], ['SOUS_TRAITANCE', 'Sous-traitance'], ['NON_GERE', 'Non géré']),
        }),
        c('unite_stock', 'Unité de stock', 'ele_unt_stock', 'texte', { obligatoire: true, longueur: 10 }),
        c('unite_achat', "Unité d'achat", 'ele_unt_achat', 'texte', { longueur: 10 }),
        c('unite_vente', 'Unité de vente', 'ele_unt_vente', 'texte', { longueur: 10 }),
        c('unites', "Correspondances d'unités", 'ele_unites', 'json'),
        c('scenario_pa', "Scénario de prix d'achat", 'ele_scenario_pa', 'liste', {
          obligatoire: true, defaut: 'FIXE', options: options('FIXE', 'FOURNISSEUR_PRINCIPAL', 'DERNIER_PA', 'MEILLEUR_MIN', 'MEILLEUR_MAX', 'PMP'),
        }),
        c('scenarios', 'Scénarios autorisés', 'ele_scenarios', 'json'),
        c('pa_fixe', 'Prix fixe', 'ele_pa_fixe', 'nombre'),
        c('dernier_pa', "Dernier prix d'achat", 'ele_dernier_pa', 'nombre'),
        c('pmp', 'Prix moyen pondéré', 'ele_pmp', 'nombre'),
        c('pa', "Prix d'achat", 'ele_pa', 'nombre', { lecture_seule: true }),
        c('coef_fg', 'Coef. frais généraux', 'ele_coef_fg', 'nombre', { obligatoire: true, defaut: '1.1', aide: 'Imposé, sinon celui de la nature ou global en vigueur' }),
        c('coef_fg_impose', 'Frais généraux imposés', 'ele_coef_fg_impose', 'booleen', { obligatoire: true, defaut: false }),
        c('coef_benef_impose', 'Bénéfice imposé', 'ele_coef_benef_impose', 'booleen', { obligatoire: true, defaut: false }),
        c('pr', 'Prix de revient', 'ele_pr', 'nombre', { lecture_seule: true }),
        c('coef_benef', 'Coef. bénéfice', 'ele_coef_benef', 'nombre', { obligatoire: true, defaut: '1.2' }),
        c('pv', 'Prix de vente', 'ele_pv', 'nombre'),
        c('pv_fixe', 'PV fixe', 'ele_pv_fixe', 'booleen', { obligatoire: true, defaut: false }),
        c('coef_remise', 'Coef. de remise', 'ele_coef_remise', 'nombre', { obligatoire: true, defaut: '1' }),
        c('pv_net', 'PV net', 'ele_pv_net', 'nombre', { lecture_seule: true }),
        c('composition', 'Composition', 'ele_composition', 'json'),
        c('image_ged', 'Image', 'ele_image_ged', 'nombre'),
        // Données techniques par unité de stock (dimensions en mm) : formules de correspondance d'unités ({{poids}}…).
        c('poids', 'Poids (kg)', 'ele_poids', 'nombre', { format: '99999999.999999' }),
        c('surface', 'Surface (m²)', 'ele_surface', 'nombre', { format: '99999999.999999' }),
        c('surface_peinture', 'Surface à peindre (m²)', 'ele_surface_peinture', 'nombre', { format: '99999999.999999' }),
        c('volume', 'Volume (m³)', 'ele_volume', 'nombre', { format: '99999999.999999' }),
        c('hauteur', 'Hauteur (mm)', 'ele_hauteur', 'nombre', { format: '999999999.999' }),
        c('largeur', 'Largeur (mm)', 'ele_largeur', 'nombre', { format: '999999999.999' }),
        c('epaisseur', 'Épaisseur (mm)', 'ele_epaisseur', 'nombre', { format: '999999999.999' }),
        // Isolation (nature isolant) : l'épaisseur est celle des données techniques, reprise pour lecture.
        c('isolant_epaisseur', 'Épaisseur (mm)', null, 'nombre', { lecture_seule: true, aide: 'Épaisseur des données techniques' }),
        c('isolant_lambda', 'Conductivité λ (W/m.K)', 'ele_isolant_lambda', 'nombre', { format: '99999.99999' }),
        c('isolant_r', 'Résistance thermique R (m².K/W)', 'ele_isolant_r', 'nombre', { format: '999999.9999', aide: 'R = épaisseur (m) / λ' }),
        c('isolant_u', 'Coefficient U (W/m².K)', 'ele_isolant_u', 'nombre', { format: '999999.9999', aide: 'U ≈ 1 / R (paroi seule)' }),
        c('commentaire_prix', 'Commentaire de la modification de prix', 'ele_commentaire_prix', 'texte', { longueur: 500 }),
        c('maj_par', 'Modifié par', 'ele_maj_par', 'texte', { lecture_seule: true }),
      ],
    },
  },
  // Annuaire (module Annuaire) : personnes (morales à un niveau de la hiérarchie, ou particuliers) et individus. Les
  // coordonnées, rattachements et liens sont des champs gérés (hors table, partagés entre fiches) : onglets spécifiques
  // de FichePersonne et FicheIndividu. Les groupes de l'onglet « Par relation » ne s'affichent que pour les relations
  // de la personne (client, fournisseur… : « casquettes » dans le code).
  personne: {
    libelle: 'Personne', table: 'personne', cle: 'per_id', colonne_proprietes: 'per_proprietes',
    definition: {
      libelle: 'Personne',
      titre: '[raison_sociale]',
      sous_titre: '[code]',
      sections: [
        {
          code: 'identite', titre: 'Identité',
          groupes: [
            { titre: 'Identification', champs: ['niveau', 'raison_sociale', 'nom_commercial', 'sigle', 'code', 'parent_id', 'actif', 'societe_base'] },
            { code: 'casquettes', titre: 'Relations avec nous', champs: ['casquettes'], largeur: 'plein' },
            { code: 'entreprise', titre: 'Entreprise', champs: ['pays', 'siren', 'siret', 'tva_intra', 'identifiant_etranger', 'naf', 'forme_juridique', 'forme_libelle',
              'capital', 'rcs', 'date_creation', 'effectif', 'etat_administratif', 'siege', 'service_public'] },
            { titre: 'Notes', champs: ['commentaire'], largeur: 'plein' },
          ],
        },
        {
          code: 'facturation', titre: 'Facturation et règlement',
          groupes: [
            { code: 'facturation_electronique', titre: 'Facturation électronique', champs: ['fe_format', 'fe_plateforme', 'fe_adresse', 'fe_code_routage', 'fe_code_service', 'fe_engagement'] },
            { titre: 'Règlement', champs: ['mode_reglement', 'delai_paiement', 'devise', 'iban', 'bic'] },
          ],
        },
        {
          code: 'casquettes', titre: 'Par relation',
          groupes: [
            { code: 'client', titre: 'Client', champs: ['cli_compte', 'cli_categorie', 'cli_encours_max', 'cli_remise'] },
            { code: 'fournisseur', titre: 'Fournisseur', champs: ['fou_compte', 'fou_numero_client', 'fou_franco', 'fou_delai_livraison'] },
            { code: 'sous_traitant', titre: 'Sous-traitant', champs: ['st_corps_etat', 'st_qualifications', 'st_autoliquidation', 'st_decennale_assureur', 'st_decennale_police', 'st_decennale_fin'] },
            { code: 'interim', titre: "Agence d'intérim", champs: ['int_garantie_financiere', 'int_coefficient'] },
            { code: 'architecte', titre: 'Architecte', champs: ['arc_numero_ordre'] },
            { code: 'controle', titre: 'Bureau de contrôle', champs: ['bc_agrement', 'bc_missions'] },
          ],
        },
      ],
      champs: [
        c('code', 'Code', 'per_code', 'texte', { longueur: 20, non_copie: true, aide: 'Code du tiers : T000123 par défaut' }),
        c('niveau', 'Niveau', 'per_niv_code', 'texte', { obligatoire: true, defaut: 'SOCIETE', reference: 'niveau' }),
        c('raison_sociale', 'Raison sociale ou nom', 'per_raison_sociale', 'texte', { obligatoire: true, longueur: 150 }),
        c('nom_commercial', 'Nom commercial (enseigne)', 'per_nom_commercial', 'texte', { longueur: 150 }),
        c('sigle', 'Sigle', 'per_sigle', 'texte', { longueur: 30 }),
        c('parent_id', 'Niveau supérieur', 'per_parent_id', 'nombre', { reference: 'personne', aide: 'Groupe d\'une société, société d\'un établissement, d\'une agence…' }),
        c('casquettes', 'Relations', 'per_casquettes', 'json', { aide: 'Client, fournisseur, sous-traitant… : une personne peut en avoir plusieurs' }),
        c('actif', 'Actif', 'per_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('societe_base', 'Société de cette base', 'per_societe_base', 'booleen', { obligatoire: true, defaut: false, non_copie: true, aide: 'Notre société (une seule par base)' }),
        c('pays', 'Pays', 'per_pays', 'texte', { obligatoire: true, defaut: 'FR', longueur: 2, format: 'regex:^[A-Za-z]{2}$', aide: 'Code ISO à 2 lettres (FR, BE, DE…)' }),
        c('siren', 'SIREN', 'per_siren', 'texte', { longueur: 11, non_copie: true }),
        c('siret', 'SIRET', 'per_siret', 'texte', { longueur: 17, non_copie: true, aide: 'Unique : un établissement n\'est enregistré qu\'une fois' }),
        c('tva_intra', 'N° de TVA intracommunautaire', 'per_tva_intra', 'texte', { longueur: 20, non_copie: true }),
        c('identifiant_etranger', 'Identifiant hors France', 'per_identifiant_etranger', 'texte', { longueur: 40, non_copie: true, aide: 'N° d\'enregistrement national (entreprise étrangère)' }),
        c('naf', 'Code NAF (APE)', 'per_naf', 'texte', { longueur: 6 }),
        c('forme_juridique', 'Catégorie juridique (code)', 'per_forme_juridique', 'texte', { longueur: 10 }),
        c('forme_libelle', 'Forme juridique', 'per_forme_libelle', 'texte', { longueur: 100 }),
        c('capital', 'Capital', 'per_capital', 'nombre', { format: '9999999999999999.99' }),
        c('rcs', 'RCS', 'per_rcs', 'texte', { longueur: 60 }),
        c('date_creation', 'Date de création', 'per_date_creation', 'date'),
        c('effectif', 'Effectif', 'per_effectif', 'texte', { longueur: 40 }),
        c('etat_administratif', 'État administratif', 'per_etat_administratif', 'liste', { options: options(['A', 'Actif'], ['F', 'Fermé']) }),
        c('siege', 'Siège', 'per_siege', 'booleen'),
        c('service_public', 'Service public (Chorus Pro)', 'per_service_public', 'booleen', { obligatoire: true, defaut: false }),
        c('fe_format', 'Format de facture', 'per_fe_format', 'liste', { options: options(['FACTURX', 'Factur-X'], ['UBL', 'UBL'], ['CII', 'CII']) }),
        c('fe_plateforme', 'Plateforme de réception (PA)', 'per_fe_plateforme', 'texte', { longueur: 100, aide: 'Plateforme agréée choisie par le destinataire' }),
        c('fe_adresse', 'Adresse de facturation électronique', 'per_fe_adresse', 'texte', { longueur: 150, aide: 'Identifiant de l\'annuaire de facturation (SIREN, SIREN_SUFFIXE…)' }),
        c('fe_code_routage', 'Code de routage', 'per_fe_code_routage', 'texte', { longueur: 100 }),
        c('fe_code_service', 'Code service (Chorus Pro)', 'per_fe_code_service', 'texte', { longueur: 100 }),
        c('fe_engagement', 'N° d\'engagement obligatoire', 'per_fe_engagement', 'booleen', { obligatoire: true, defaut: false }),
        c('mode_reglement', 'Mode de règlement', 'per_mode_reglement', 'liste', {
          options: options(['VIREMENT', 'Virement'], ['PRELEVEMENT', 'Prélèvement'], ['CHEQUE', 'Chèque'], ['LCR', 'LCR'], ['CB', 'Carte bancaire'], ['ESPECES', 'Espèces']),
        }),
        c('delai_paiement', 'Délai de paiement', 'per_delai_paiement', 'liste', {
          options: options(['COMPTANT', 'Comptant'], ['30J', '30 jours'], ['30JFM', '30 jours fin de mois'], ['45JFM', '45 jours fin de mois'], ['60J', '60 jours']),
        }),
        c('devise', 'Devise', 'per_devise', 'texte', { obligatoire: true, defaut: 'EUR', longueur: 3 }),
        c('iban', 'IBAN', 'per_iban', 'texte', { longueur: 42, non_copie: true }),
        c('bic', 'BIC', 'per_bic', 'texte', { longueur: 11 }),
        c('commentaire', 'Notes', 'per_commentaire', 'zone'),
        // Champs déverrouillés par les relations (groupes de l'onglet Par relation).
        c('cli_compte', 'Compte client', 'per_cli_compte', 'texte', { longueur: 20, aide: 'Compte auxiliaire (411…)' }),
        c('cli_categorie', 'Catégorie tarifaire', 'per_cli_categorie', 'texte', { longueur: 40 }),
        c('cli_encours_max', 'Encours autorisé (€)', 'per_cli_encours_max', 'nombre', { format: '999999999999.99' }),
        c('cli_remise', 'Remise habituelle (%)', 'per_cli_remise', 'nombre', { format: '999.999' }),
        c('fou_compte', 'Compte fournisseur', 'per_fou_compte', 'texte', { longueur: 20, aide: 'Compte auxiliaire (401…)' }),
        c('fou_numero_client', 'Notre n° de client', 'per_fou_numero_client', 'texte', { longueur: 40 }),
        c('fou_franco', 'Franco de port (€ HT)', 'per_fou_franco', 'nombre', { format: '999999999999.99' }),
        c('fou_delai_livraison', 'Délai de livraison (jours)', 'per_fou_delai_livraison', 'nombre', { format: '9999' }),
        c('st_corps_etat', 'Corps d\'état', 'per_st_corps_etat', 'texte', { longueur: 100 }),
        c('st_qualifications', 'Qualifications (Qualibat…)', 'per_st_qualifications', 'texte', { longueur: 200 }),
        c('st_autoliquidation', 'Autoliquidation de la TVA', 'per_st_autoliquidation', 'booleen', { obligatoire: true, defaut: true }),
        c('st_decennale_assureur', 'Assureur décennale', 'per_st_decennale_assureur', 'texte', { longueur: 100 }),
        c('st_decennale_police', 'N° de police décennale', 'per_st_decennale_police', 'texte', { longueur: 50 }),
        c('st_decennale_fin', 'Décennale valable jusqu\'au', 'per_st_decennale_fin', 'date'),
        c('int_garantie_financiere', 'Garantie financière (organisme)', 'per_int_garantie_financiere', 'texte', { longueur: 100 }),
        c('int_coefficient', 'Coefficient de facturation', 'per_int_coefficient', 'nombre', { format: '9999.9999' }),
        c('arc_numero_ordre', 'N° d\'inscription à l\'Ordre', 'per_arc_numero_ordre', 'texte', { longueur: 30 }),
        c('bc_agrement', 'N° d\'agrément', 'per_bc_agrement', 'texte', { longueur: 50 }),
        c('bc_missions', 'Missions (L, SEI, PS…)', 'per_bc_missions', 'texte', { longueur: 100 }),
        // Champs gérés par l'annuaire (hors table).
        c('coordonnees', 'Coordonnées', null, 'json', { gere: true }),
        c('rattachements', 'Contacts', null, 'json', { gere: true, aide: 'Lus par page ; seuls les contacts modifiés, ajoutés ou retirés sont enregistrés' }),
        c('nb_rattachements', 'Nombre de contacts', null, 'nombre', { gere: true, lecture_seule: true }),
        c('liens', 'Liens', null, 'json', { gere: true }),
        c('enfants', 'Niveaux inférieurs', null, 'json', { gere: true, lecture_seule: true }),
      ],
    },
  },
  individu: {
    libelle: 'Individu', table: 'individu', cle: 'ind_id', colonne_proprietes: 'ind_proprietes',
    definition: {
      libelle: 'Individu',
      titre: '[civilite] [prenom] [nom]',
      sections: [
        {
          code: 'identite', titre: 'Identité',
          groupes: [
            { titre: 'Identité', champs: ['civilite', 'prenom', 'nom', 'date_naissance', 'pays', 'actif'] },
            { code: 'roles', titre: 'Dans notre société', champs: ['roles', 'utilisateur'], largeur: 'plein' },
            { titre: 'Notes', champs: ['commentaire'], largeur: 'plein' },
          ],
        },
      ],
      champs: [
        c('civilite', 'Civilité', 'ind_civilite', 'liste', { options: options('M.', 'Mme') }),
        c('nom', 'Nom', 'ind_nom', 'texte', { obligatoire: true, longueur: 80 }),
        c('prenom', 'Prénom', 'ind_prenom', 'texte', { longueur: 80 }),
        c('date_naissance', 'Date de naissance', 'ind_date_naissance', 'date', { confidentiel: true }),
        c('pays', 'Pays', 'ind_pays', 'texte', { obligatoire: true, defaut: 'FR', longueur: 2, format: 'regex:^[A-Za-z]{2}$' }),
        c('roles', 'Rôles', 'ind_roles', 'json', { aide: 'Chargé d\'affaires, chiffreur, salarié, intérimaire, utilisateur… : repris par les autres modules' }),
        c('utilisateur', 'Identifiant de connexion', 'ind_utilisateur', 'texte', { longueur: 50, non_copie: true, aide: 'Pour le futur module des droits' }),
        c('actif', 'Actif', 'ind_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('commentaire', 'Notes', 'ind_commentaire', 'zone'),
        c('coordonnees', 'Coordonnées', null, 'json', { gere: true }),
        c('rattachements', 'Rattachements', null, 'json', { gere: true }),
        c('nb_rattachements', 'Nombre de rattachements', null, 'nombre', { gere: true, lecture_seule: true }),
        // Fiche salarié liée (module salariés du cœur) : lue par la spécialisation, jamais écrite.
        c('salarie', 'Salarié', null, 'json', { gere: true, lecture_seule: true }),
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
  ...['VOIR', 'MODIFIER', 'DEBLOQUER'].map((action) => ({ profil: 'ADMIN', type: 'element', action })),
  { profil: 'SAISIE', type: 'element', action: 'VOIR' }, { profil: 'SAISIE', type: 'element', action: 'MODIFIER' },
  // Annuaire : la date de naissance des individus est confidentielle.
  ...['personne', 'individu'].flatMap((type) => ['VOIR', 'MODIFIER', 'DEBLOQUER'].map((action) => ({ profil: 'ADMIN', type, action }))),
  { profil: 'ADMIN', type: 'individu', action: 'CONFIDENTIEL' },
  ...['personne', 'individu'].flatMap((type) => ['VOIR', 'MODIFIER'].map((action) => ({ profil: 'SAISIE', type, action }))),
];

/** Paramétrage de démonstration : un champ du programme rendu obligatoire, des champs supplémentaires. */
export const PARAMETRAGE_FICHE = {
  // Champs supplémentaires des éléments : également utilisables dans les formules de correspondance d'unités.
  element: {
    obligatoires: [],
    supplementaires: [
      { code: 'reference_fabricant', libelle: 'Référence fabricant', type: 'texte', longueur: 40, ordre: 10 },
      { code: 'masse_volumique', libelle: 'Masse volumique (kg/m³)', type: 'nombre', format: '99999', ordre: 20 },
    ].map((x) => ({ ...x, actif: true })),
  },
  salarie: {
    obligatoires: ['telephone'],
    supplementaires: [
      { code: 'taille_vetement', libelle: 'Taille de vêtement', type: 'liste', options: options('S', 'M', 'L', 'XL', 'XXL'), ordre: 10 },
      { code: 'pointure', libelle: 'Pointure', type: 'nombre', format: '99', ordre: 20 },
      { code: 'permis_c', libelle: 'Permis C', type: 'booleen', ordre: 30 },
      { code: 'mutuelle', libelle: 'Mutuelle', type: 'texte', longueur: 60, confidentiel: true, ordre: 50 },
    ].map((x) => ({ ...x, actif: true })),
  },
  personne: {
    obligatoires: [],
    supplementaires: [
      { code: 'origine', libelle: 'Origine du contact', type: 'liste', options: options('Recommandation', 'Salon', 'Internet', 'Appel d\'offres'), ordre: 10 },
      { code: 'chiffre_affaires', libelle: 'Chiffre d\'affaires annuel (€)', type: 'nombre', format: '999999999999', ordre: 20 },
    ].map((x) => ({ ...x, actif: true })),
  },
  individu: {
    obligatoires: [],
    supplementaires: [
      { code: 'langue', libelle: 'Langue', type: 'liste', options: options('Français', 'Anglais', 'Italien', 'Espagnol', 'Allemand'), ordre: 10 },
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
  if (type === 'element') return { type: 'element', id };
  if (type === 'personne' || type === 'individu') return { type, id };
  return null;
}
