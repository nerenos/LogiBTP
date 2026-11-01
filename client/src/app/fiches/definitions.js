// Types de fiches du cœur : table, clé, colonne JSONB des champs supplémentaires et définition (sections, champs).
// Les codes de champs reprennent les colonnes des vues de liste ;
// « colonne » est la colonne de la table, utilisée par le serveur. Ces définitions alimentent aussi le script
// db/131_fiches_parametrage.sql (généré par client/scripts/generer-vues-liste.mjs).
import { GESTION_ELEMENT, GESTIONS, GENRE_POSTE } from '@logibtp/bibliotheque';

const c = (code, libelle, colonne, type, extra = {}) => ({ code, libelle, colonne, type, ...extra });
// Chrono du code (module Fiche) : format par défaut, remplaçable dans Paramètres › Référentiels communs ; le code
// prévisionnel s'affiche à la création, le code calculé est attribué à l'enregistrement (compteur jamais remis à zéro :
// J, ou chaque exercice : A).
const chrono = (prefixe, format, raz = 'J', extra = {}) => ({ champ: 'code', prefixe, format, raz, ...extra });
const options = (...v) => v.map((x) => (Array.isArray(x) ? { valeur: x[0], libelle: x[1] } : { valeur: x, libelle: x }));

// Comptes collectifs du plan comptable (module Comptabilité) : surcharge du collectif d'un tiers par relation.
// Référentiels paramétrables (Paramètres › Référentiels communs, Paramètres › Documents).
const REQUETE_MODES_REGLEMENT = 'SELECT mre_code, mre_libelle FROM mode_reglement WHERE mre_actif ORDER BY mre_ordre, mre_code';
const REQUETE_CONDITIONS_PAIEMENT = 'SELECT cpa_code, cpa_libelle FROM condition_paiement WHERE cpa_actif ORDER BY cpa_ordre, cpa_code';
// Types de matériel à deux niveaux : regroupement › type (les regroupements se choisissent aussi).
const REQUETE_TYPES_MATERIEL = "SELECT v.lva_code, CASE WHEN p.lva_code IS NULL THEN v.lva_libelle ELSE p.lva_libelle || ' › ' || v.lva_libelle END FROM liste_valeur v LEFT JOIN liste_valeur p ON p.lva_liste = v.lva_liste AND p.lva_code = v.lva_parent WHERE v.lva_liste = 'TYPE_MATERIEL' AND v.lva_actif ORDER BY coalesce(p.lva_ordre, v.lva_ordre), coalesce(p.lva_code, v.lva_code), v.lva_parent NULLS FIRST, v.lva_ordre";
// État d'utilisation des fiches (db/228) : ne plus utiliser = plus proposé pour un nouveau choix, en sommeil = masqué
// par défaut dans les listes (avant archivage) ; « actif » suit (en sommeil = inactif).
const USAGE = {
  obligatoire: true, defaut: 'A', options: options(['A', 'En service'], ['N', 'Ne plus utiliser'], ['S', 'En sommeil']),
  aide: 'Ne plus utiliser : les documents en cours se terminent, plus de nouveau choix ; en sommeil : masquée par défaut dans les listes',
};
// Individus de notre société (rattachement actif à la société de la base ou à l'un de ses niveaux inférieurs).
const REQUETE_INDIVIDUS_STRUCTURE = "WITH RECURSIVE s AS (SELECT per_id FROM personne WHERE per_societe_base UNION SELECT p.per_id FROM personne p JOIN s ON p.per_parent_id = s.per_id) SELECT DISTINCT ON (i.ind_nom, i.ind_prenom, i.ind_id) i.ind_id, concat_ws(' ', i.ind_prenom, i.ind_nom) FROM individu i JOIN rattachement r ON r.rat_ind_id = i.ind_id AND r.rat_actif JOIN s ON s.per_id = r.rat_per_id WHERE i.ind_actif ORDER BY i.ind_nom, i.ind_prenom, i.ind_id";
const REQUETE_COLLECTIFS = "SELECT cpt_code, cpt_code || ' – ' || cpt_libelle FROM compte_comptable WHERE cpt_actif AND cpt_type = 'COLLECTIF' ORDER BY cpt_code";
// Comptes généraux de produits (classe 7) et de charges (classe 6) : compte des lignes d'un tiers (ventilation).
const requeteComptesClasse = (classe) => `SELECT cpt_code, cpt_code || ' – ' || cpt_libelle FROM compte_comptable WHERE cpt_actif AND cpt_type = 'GENERAL' AND cpt_code LIKE '${classe}%' ORDER BY cpt_code`;

export const TYPES_FICHE = {
  salarie: {
    libelle: 'Salarié', table: 'salarie', cle: 'sal_id', colonne_proprietes: 'sal_proprietes',
    definition: {
      libelle: 'Salarié',
      titre: '[prenom] [nom]',
      chrono: chrono('S', '{P}{N:5}'),
      sous_titre: '[code] · [poste]',
      // Peu d'onglets, des groupes de champs : informations liées à l'entreprise, puis données privées (RGPD).
      sections: [
        {
          code: 'entreprise', titre: 'Entreprise',
          groupes: [
            { titre: 'Identité', champs: ['code', 'matricule_paie', 'nom', 'prenom', 'ind_id'] },
            { titre: 'Emploi', champs: ['agence', 'service', 'poste', 'qualification', 'type_mo', 'statut', 'date_entree', 'date_sortie', 'usage'] },
            { titre: 'Coordonnées professionnelles', champs: ['email', 'telephone'] },
            { titre: 'Rémunération', champs: ['salaire_brut', 'heures_mois', 'cout_horaire'] },
            { titre: 'Horaires', champs: ['cal_id'] },
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
        // Le code est l'identifiant du salarié (plus de matricule saisi, db/251) ; le matricule de paie n'est demandé que
        // s'il diffère du code.
        c('code', 'Code', 'sal_code', 'texte', { obligatoire: true, longueur: 10, non_copie: true, aide: 'Identifiant unique du salarié : recherche rapide, homonymes' }),
        c('matricule_paie', 'Matricule de paie', 'sal_matricule_paie', 'texte', { longueur: 30, non_copie: true, aide: 'Matricule du logiciel de paie (export des variables de paie) ; vide : le code' }),
        c('nom', 'Nom', 'sal_nom', 'texte', { obligatoire: true, longueur: 60 }),
        c('ind_id', 'Individu (annuaire)', 'sal_ind_id', 'nombre', { reference: 'individu', non_copie: true, aide: "Fiche de l'individu dans l'annuaire : identité et coordonnées partagées avec les autres modules" }),
        c('prenom', 'Prénom', 'sal_prenom', 'texte', { obligatoire: true, longueur: 60 }),
        c('date_naissance', 'Date de naissance', 'sal_date_naissance', 'date', { confidentiel: true }),
        c('num_secu', 'N° de sécurité sociale', 'sal_num_secu', 'texte', { exemple: '1 85 05 69 123 456 78',
          confidentiel: true, non_copie: true, longueur: 21, format: 'regex:^[12] ?[0-9]{2} ?[0-9]{2} ?[0-9]{2} ?[0-9]{3} ?[0-9]{3} ?[0-9]{2}$',
          aide: '13 chiffres + clé (espaces acceptés)',
        }),
        // Service principal du référentiel des services (db/193) : tenu aligné sur service_membre par db/226.
        c('service', 'Service', 'sal_service', 'liste', {
          obligatoire: true,
          requete: "SELECT s.srv_code, CASE WHEN p.srv_id IS NULL THEN s.srv_libelle ELSE p.srv_libelle || ' › ' || s.srv_libelle END FROM service s LEFT JOIN service p ON p.srv_id = s.srv_parent_id WHERE s.srv_actif ORDER BY coalesce(p.srv_ordre, s.srv_ordre), coalesce(p.srv_code, s.srv_code), s.srv_parent_id NULLS FIRST, s.srv_ordre",
          aide: 'Service principal (planning, pointage, exécution) ; les autres appartenances se gèrent dans Paramètres › Services',
        }),
        c('poste', 'Poste', 'sal_poste', 'texte', { longueur: 60 }),
        // Agence = notre société ou l'un de ses niveaux inférieurs dans l'annuaire (db/251) : une agence ajoutée dans
        // l'annuaire est proposée d'office.
        c('agence', 'Agence', 'sal_agence_per_id', 'liste', {
          requete: 'SELECT per_id, nom FROM v_agences_societe WHERE actif ORDER BY profondeur, nom',
          aide: "Notre société ou l'un de ses niveaux inférieurs dans l'annuaire (agences, établissements)",
        }),
        c('type_mo', 'Type de main-d\'œuvre', 'sal_type_mo', 'liste', {
          options: options(['OUVRIER', 'Ouvrier'], ['ETAM', 'ETAM'], ['CADRE', 'Ingénieur et cadre']), aide: 'Catégorie conventionnelle BTP',
        }),
        c('statut', 'Contrat', 'sal_statut', 'liste', { options: options('CDI', 'CDD', ['INTERIM', 'Intérim']) }),
        c('date_entree', "Date d'entrée", 'sal_date_entree', 'date'),
        c('actif', 'Actif', 'sal_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('usage', 'Utilisation', 'sal_usage', 'liste', USAGE),
        c('email', 'E-mail professionnel', 'sal_email', 'texte', { exemple: 'prenom.nom@entreprise.fr', longueur: 100, format: 'email', non_copie: true }),
        c('telephone', 'Téléphone professionnel', 'sal_telephone', 'texte', { exemple: '06 12 34 56 78', longueur: 20, format: 'telephone' }),
        // Données privées (RGPD) : confidentielles, affichées à la demande.
        c('adresse', 'Adresse', 'sal_adresse', 'zone', { longueur: 200, confidentiel: true, largeur: 'plein' }),
        c('code_postal', 'Code postal', 'sal_code_postal', 'texte', { longueur: 5, format: 'code_postal', confidentiel: true }),
        c('ville', 'Ville', 'sal_ville', 'texte', { longueur: 60, confidentiel: true }),
        c('telephone_perso', 'Téléphone personnel', 'sal_telephone_perso', 'texte', { longueur: 20, format: 'telephone', confidentiel: true }),
        c('email_perso', 'E-mail personnel', 'sal_email_perso', 'texte', { longueur: 100, format: 'email', confidentiel: true, non_copie: true }),
        c('contact_nom', 'Nom et lien', 'sal_contact_nom', 'texte', { longueur: 100, confidentiel: true, aide: 'Ex. Marie Martin (conjointe)' }),
        c('contact_telephone', 'Téléphone', 'sal_contact_telephone', 'texte', { longueur: 20, format: 'telephone', confidentiel: true }),
        c('note_perso', 'Note personnelle', 'sal_note_perso', 'zone', { confidentiel: true }),
        c('salaire_brut', 'Salaire brut mensuel', 'sal_salaire', 'nombre', { confidentiel: true, format: '99999.99' }),
        c('heures_mois', 'Heures mensuelles', 'sal_heures_mois', 'nombre', { format: '999.99', defaut: 151.67 }),
        c('commentaire', 'Note professionnelle', 'sal_commentaire', 'zone'),
        // Référentiel des ressources (db/195).
        c('qualification', 'Qualification', 'sal_qualification', 'texte', { longueur: 60, aide: 'Ex. N3P2 (convention collective), compagnon professionnel' }),
        c('date_sortie', 'Date de sortie', 'sal_date_sortie', 'date', { non_copie: true, aide: "Le compte de connexion est désactivé quand le salarié n'est plus actif" }),
        c('cal_id', 'Calendrier de travail', 'sal_cal_id', 'liste', { requete: 'SELECT cal_id, cal_libelle FROM calendrier WHERE cal_actif ORDER BY cal_defaut DESC, cal_code', aide: 'Vide : calendrier du service principal, sinon le calendrier par défaut' }),
        c('cout_horaire', 'Coût horaire chargé', 'sal_cout_horaire', 'nombre', { confidentiel: true, format: '9999.99', aide: 'Vide : estimé depuis le salaire (× 1,45 / heures mensuelles)' }),
      ],
    },
  },
  materiel: {
    libelle: 'Matériel', table: 'materiel', cle: 'mat_id', colonne_proprietes: 'mat_proprietes',
    definition: {
      libelle: 'Matériel',
      titre: '[designation]',
      chrono: chrono('MAT', '{P}{N:5}'),
      sous_titre: '[code] · [marque] [modele]',
      sections: [
        {
          code: 'informations', titre: 'Informations',
          groupes: [
            { titre: 'Identification', champs: ['code', 'designation', 'famille', 'marque', 'modele', 'numero_serie', 'immatriculation', 'energie', 'usage'] },
            { titre: 'Dates', champs: ['date_entree', 'date_mise_service', 'fin_garantie', 'date_sortie'] },
            { titre: 'Poids et dimensions', champs: ['poids', 'longueur', 'largeur', 'hauteur'] },
            { titre: 'Location', champs: ['loueur_id', 'location_ent_id', 'fin_location'] },
            { titre: 'Exploitation', champs: ['etat', 'condition', 'chantier', 'compteurs', 'heures_utilisation', 'kilometres', 'controle_ok'] },
            { titre: 'Planification', champs: ['mode', 'quantite', 'unite', 'srv_id', 'cal_id'] },
            { titre: 'Achat et coût', champs: ['valeur_achat', 'date_achat', 'cout_horaire'] },
            { titre: 'Observations', champs: ['observations'], largeur: 'plein' },
          ],
        },
      ],
      champs: [
        c('code', 'Code', 'mat_code', 'texte', { obligatoire: true, longueur: 10, non_copie: true }),
        c('designation', 'Désignation', 'mat_designation', 'texte', { obligatoire: true, longueur: 100, largeur: 'plein' }),
        c('famille', 'Type', 'mat_famille', 'liste', { obligatoire: true, requete: REQUETE_TYPES_MATERIEL, aide: 'Types de matériel regroupés (Paramètres › Référentiels communs)' }),
        c('marque', 'Marque', 'mat_marque', 'texte', { longueur: 60 }),
        c('numero_serie', 'N° de série', 'mat_numero_serie', 'texte', { longueur: 40, non_copie: true }),
        // Disponibilité et condition (db/252) : chaque changement est tracé avec son motif (onglet Historique).
        c('etat', 'Disponibilité', 'mat_etat', 'liste', {
          obligatoire: true, defaut: 'DISPO',
          options: options(['DISPO', 'Disponible'], ['CHANTIER', 'En chantier'], ['PANNE', 'En panne'], ['REBUT', 'Rebut']),
        }),
        c('condition', 'Condition', 'mat_condition', 'liste', {
          obligatoire: true, defaut: 'BON',
          requete: "SELECT lva_code, lva_libelle FROM liste_valeur WHERE lva_liste = 'ETAT_MATERIEL' AND lva_actif ORDER BY lva_ordre, lva_code",
          aide: 'État physique du matériel (Paramètres › Référentiels communs) ; aussi saisi au retour d\'une affectation',
        }),
        c('etat_motif', 'Motif du changement d\'état', 'mat_etat_motif', 'texte', { longueur: 200, non_copie: true }),
        c('etat_par', 'Changement d\'état par', 'mat_etat_par', 'texte', { longueur: 50, lecture_seule: true, non_copie: true }),
        c('chantier', 'Chantier', 'mat_chantier', 'texte', { longueur: 100 }),
        // Compteurs (db/252) : saisis à la création (relevé initial), puis par relevés et rectifications (onglet Compteurs).
        c('heures_utilisation', "Heures d'utilisation", 'mat_heures', 'nombre', { saisie: 'creation', format: '99999', aide: 'Saisi à la création (relevé initial) ; ensuite : onglet Compteurs (relevé ou rectification)' }),
        c('controle_ok', 'Contrôle réglementaire à jour', 'mat_controle_ok', 'booleen', { defaut: false }),
        c('valeur_achat', "Valeur d'achat", 'mat_valeur_achat', 'nombre', { format: '9999999.99' }),
        c('date_achat', "Date d'achat", 'mat_date_achat', 'date'),
        // Rentabilité des chantiers (db/261) : heures pointées et planifiées du matériel valorisées à ce coût.
        c('cout_horaire', 'Coût moyen horaire', 'mat_cout_horaire', 'nombre', { format: '9999.99', aide: "Valorise les heures pointées et planifiées du matériel dans la rentabilité des chantiers ; vide : coût de son type (Paramètres › Rentabilité)" }),
        c('observations', 'Observations', 'mat_observations', 'zone'),
        // Référentiel des ressources (db/195) : matériel identifié (engin, véhicule) ou par nombre (banches, étais).
        c('usage', 'Utilisation', 'mat_usage', 'liste', USAGE),
        c('mode', 'Gestion', 'mat_mode', 'liste', { obligatoire: true, defaut: 'IDENTIFIE', options: options(['IDENTIFIE', 'Identifié (un engin)'], ['NOMBRE', 'Par nombre (stock)']) }),
        c('quantite', 'Quantité disponible', 'mat_quantite', 'nombre', { obligatoire: true, defaut: 1, format: '999999.999', aide: 'Matériel par nombre : le planning avertit au-delà ; matériel identifié : toujours 1' }),
        c('unite', 'Unité', 'mat_unite', 'texte', { longueur: 10 }),
        c('cal_id', 'Calendrier', 'mat_cal_id', 'liste', { requete: 'SELECT cal_id, cal_libelle FROM calendrier WHERE cal_actif ORDER BY cal_defaut DESC, cal_code', aide: 'Vide : calendrier du service' }),
        // Lot 5a des demandes du 25/10/2026 (db/230).
        c('modele', 'Modèle', 'mat_modele', 'texte', { longueur: 60 }),
        c('immatriculation', 'Immatriculation', 'mat_immatriculation', 'texte', { exemple: 'AA-123-AA', longueur: 20, non_copie: true, aide: 'Unique : un véhicule immatriculé ou un EPI marqué' }),
        c('energie', 'Énergie', 'mat_energie', 'liste', { requete: "SELECT lva_code, lva_libelle FROM liste_valeur WHERE lva_liste = 'ENERGIE' AND lva_actif ORDER BY lva_ordre, lva_code" }),
        // Lot 5c-2 (db/233) : compteurs suivis, valeurs = derniers relevés.
        c('compteurs', 'Compteurs', 'mat_compteurs', 'liste', { obligatoire: true, defaut: 'H', options: options(['H', 'Heures'], ['KM', 'Kilomètres'], ['H_KM', 'Heures et kilomètres'], ['AUCUN', 'Aucun']) }),
        c('kilometres', 'Kilométrage', 'mat_kilometres', 'nombre', { saisie: 'creation', format: '9999999', aide: 'Saisi à la création (relevé initial) ; ensuite : onglet Compteurs (relevé ou rectification)' }),
        c('date_entree', "Date d'entrée", 'mat_date_entree', 'date'),
        c('date_mise_service', 'Mise en service', 'mat_date_mise_service', 'date'),
        c('fin_garantie', 'Fin de garantie', 'mat_fin_garantie', 'date'),
        c('date_sortie', 'Date de sortie', 'mat_date_sortie', 'date', { non_copie: true }),
        c('poids', 'Poids (kg)', 'mat_poids', 'nombre', { format: '999999999.999' }),
        c('longueur', 'Longueur (m)', 'mat_longueur', 'nombre', { format: '9999999.999' }),
        c('largeur', 'Largeur (m)', 'mat_largeur', 'nombre', { format: '9999999.999' }),
        c('hauteur', 'Hauteur (m)', 'mat_hauteur', 'nombre', { format: '9999999.999' }),
        c('loueur_id', 'Loueur', 'mat_loueur_id', 'liste', { requete: "SELECT per_id, per_raison_sociale || coalesce(' (' || per_code || ')', '') FROM personne WHERE per_actif AND (per_casquettes ? 'LOUEUR' OR per_casquettes ? 'FOURNISSEUR') ORDER BY per_raison_sociale", aide: "Matériel loué : le loueur (relation Loueur ou Fournisseur de l'annuaire)" }),
        c('location_ent_id', 'Commande de location', 'mat_location_ent_id', 'liste', { requete: "SELECT d.ent_id, coalesce(d.ent_numero, 'Brouillon') || ' – ' || coalesce(d.ent_objet, '') FROM document d JOIN type_document t ON t.tyd_id = d.ent_tyd_id WHERE t.tyd_code = 'A_COMMANDE' AND d.ent_is_reference ORDER BY d.ent_id DESC" }),
        c('fin_location', 'Fin de location', 'mat_fin_location', 'date', { non_copie: true }),
        c('srv_id', 'Service', 'mat_srv_id', 'liste', { requete: 'SELECT srv_id, srv_libelle FROM service WHERE srv_actif ORDER BY srv_ordre, srv_code', aide: 'Service qui planifie ce matériel' }),
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
      // Un compteur par bibliothèque ; le code se change ensuite pour un appel rapide (HEA100…).
      chrono: chrono('ELE', '{P}{N:6}', 'J', { portee: 'bib_id' }),
      sous_titre: '[bib_code] · [famille]',
      sections: [
        {
          code: 'article', titre: 'Article',
          groupes: [
            { titre: 'Identification', champs: ['bib_id', 'code', 'type', 'usage', 'code_barre'] },
            { titre: 'Classement', champs: ['fam_id', 'nat_id', 'gestion', 'delai_livraison'] },
            { titre: 'Libellé', champs: ['libelle_html'], largeur: 'plein' },
            { code: 'recherche', titre: 'Recherche', champs: ['mots_cles'], largeur: 'plein' },
            { code: 'description', titre: 'Description technique', champs: ['description_html'], largeur: 'plein' },
            { code: 'techniques', titre: 'Données techniques (par unité de stock)', champs: ['poids', 'surface', 'surface_peinture', 'volume', 'hauteur', 'largeur', 'epaisseur', 'longueur'], largeur: 'plein' },
            { code: 'isolation', titre: 'Isolation', champs: ['isolant_epaisseur', 'isolant_lambda', 'isolant_r', 'isolant_u'] },
            // Poste de pied (type POSTE_PIED seulement) : inséré dans le pied des documents depuis la bibliothèque.
            { code: 'poste', titre: 'Poste de pied', champs: ['pied_niveau', 'pied_genre', 'pied_mode', 'pied_base', 'pied_sens', 'pied_valeur', 'pied_retenue', 'cpt_code', 'tva_code'] },
          ],
        },
      ],
      champs: [
        c('bib_id', 'Bibliothèque', 'ele_bib_id', 'nombre', { obligatoire: true, saisie: 'creation', reference: 'bibliotheque' }),
        c('code', 'Code', 'ele_code', 'texte', { obligatoire: true, longueur: 30, non_copie: true, format: 'regex:^[^:\\s][^:]*$', aide: "Unique dans la bibliothèque ; sans « : » (réservé à l'appel BIB:CODE)" }),
        c('type', 'Type', 'ele_type', 'liste', { obligatoire: true, defaut: 'ARTICLE', saisie: 'creation', options: options(['ARTICLE', 'Article'], ['OUVRAGE', 'Ouvrage'], ['ENSEMBLE', 'Ensemble'], ['POSTE_PIED', 'Poste de pied'], ['TEXTE', 'Texte']),
          aide: 'Ensemble : structure de lignes réutilisable (lignes vendues, options, variantes) paramétrée par sa tranche ; poste de pied : retenue, compte prorata, remise… pour le pied des documents ; texte : ligne de texte ou texte de l\'édition (introduction, conclusion)' }),
        c('actif', 'Actif', 'ele_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('usage', 'Utilisation', 'ele_usage', 'liste', USAGE),
        c('libelle_html', 'Libellé', 'ele_libelle_html', 'html', { obligatoire: true }),
        c('libelle', 'Libellé (texte brut)', 'ele_libelle', 'texte', { lecture_seule: true }),
        c('fam_id', 'Famille', 'ele_fam_id', 'nombre', { reference: 'famille' }),
        c('nat_id', 'Nature', 'ele_nat_id', 'nombre', { reference: 'nature' }),
        c('gestion', 'Type de gestion', 'ele_gestion', 'liste', {
          obligatoire: true, defaut: GESTION_ELEMENT.NON_GERE, options: options(...GESTIONS),
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
        c('longueur', 'Longueur (mm)', 'ele_longueur', 'nombre', { format: '999999999.999', aide: 'Longueur de barre, de rouleau… (recopiée en mètres sur la ligne du document)' }),
        // Isolation (nature isolant) : l'épaisseur est celle des données techniques, reprise pour lecture.
        c('isolant_epaisseur', 'Épaisseur (mm)', null, 'nombre', { lecture_seule: true, aide: 'Épaisseur des données techniques' }),
        c('isolant_lambda', 'Conductivité λ (W/m.K)', 'ele_isolant_lambda', 'nombre', { format: '99999.99999' }),
        c('isolant_r', 'Résistance thermique R (m².K/W)', 'ele_isolant_r', 'nombre', { format: '999999.9999', aide: 'R = épaisseur (m) / λ' }),
        c('isolant_u', 'Coefficient U (W/m².K)', 'ele_isolant_u', 'nombre', { format: '999999.9999', aide: 'U ≈ 1 / R (paroi seule)' }),
        c('commentaire_prix', 'Commentaire de la modification de prix', 'ele_commentaire_prix', 'texte', { longueur: 500 }),
        c('maj_par', 'Modifié par', 'ele_maj_par', 'texte', { lecture_seule: true }),
        // Poste de pied (POSTE_PIED) : niveau, mode, base, sens et valeur repris par la ligne de pied du document.
        c('pied_niveau', 'Niveau', 'ele_pied_niveau', 'liste', { options: options(['HT', 'Poste HT (avant TVA)'], ['TTC', 'Poste TTC (après TVA)']) }),
        c('pied_mode', 'Mode', 'ele_pied_mode', 'liste', { options: options(['P', 'Pourcentage'], ['M', 'Montant'], ['C', 'Coefficient']) }),
        c('pied_base', 'Base', 'ele_pied_base', 'liste', {
          options: options(['CUMUL', 'Cumul (total au point du poste)'], ['TOTAL_HT', 'Total HT'], ['HT_NET', 'Total HT net'], ['TOTAL_TTC', 'Total TTC']),
          aide: 'Pourcentage ou coefficient : montant de référence',
        }),
        c('pied_sens', 'Sens', 'ele_pied_sens', 'liste', { options: options(['DEDUCTION', 'Déduction'], ['AJOUT', 'Ajout']) }),
        c('pied_valeur', 'Valeur', 'ele_pied_valeur', 'nombre', { aide: 'Pourcentage (5 = 5 %), montant ou coefficient selon le mode' }),
        c('pied_retenue', 'Retenue de garantie', 'ele_pied_retenue', 'booleen', { defaut: false }),
        c('pied_genre', 'Genre', 'ele_pied_genre', 'liste', {
          options: options([GENRE_POSTE.REMISE, 'Remise'], [GENRE_POSTE.PRORATA, 'Compte prorata'], [GENRE_POSTE.ACOMPTE, 'Acompte'],
            [GENRE_POSTE.PAIEMENT_DIRECT, 'Paiement direct'], [GENRE_POSTE.RETENUE, 'Retenue de garantie'], [GENRE_POSTE.AUTRE, 'Autre']),
          aide: 'Recopié sur la ligne de pied : compte du poste dans le type comptable (Comptabilité)',
        }),
        c('cpt_code', 'Compte comptable', 'ele_cpt_code', 'texte', { longueur: 20 }),
        c('tva_code', 'Code TVA', 'ele_tva_code', 'texte', { longueur: 10, aide: 'Code du taux de TVA du poste (T20…), vide : TVA du document' }),
        // Lot 7 des demandes du 25/10/2026 (module 064).
        c('mots_cles', 'Mots-clés', 'ele_mots_cles', 'texte', { longueur: 500, largeur: 'plein', aide: 'Mots de recherche séparés par des virgules (domino, sucre, connecteur rapide…) : appel F3 et listes' }),
        c('code_barre', 'Code-barres', 'ele_code_barre', 'texte', { longueur: 50, non_copie: true, aide: 'EAN… unique dans la bibliothèque ; lu au lecteur dans la colonne Code d\'un document' }),
        c('description_html', 'Description technique', 'ele_description_html', 'html', { aide: 'Reprise par les éditions (lignes[].description_html)' }),
        c('delai_livraison', 'Délai de livraison (jours)', 'ele_delai_livraison', 'nombre', { format: '9999', aide: 'Délai global de l\'élément' }),
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
      chrono: chrono('T', '{P}{N:6}'),
      sous_titre: '[code]',
      sections: [
        {
          code: 'identite', titre: 'Identité',
          groupes: [
            { titre: 'Identification', champs: ['niveau', 'raison_sociale', 'nom_commercial', 'sigle', 'code', 'parent_id', 'usage', 'societe_base'] },
            { code: 'casquettes', titre: 'Relations avec nous', champs: ['casquettes'], largeur: 'plein' },
            { code: 'activites', titre: 'Activités', champs: ['activites'], largeur: 'plein' },
            { code: 'entreprise', titre: 'Entreprise', champs: ['pays', 'siren', 'siret', 'tva_intra', 'identifiant_etranger', 'naf', 'forme_juridique', 'forme_libelle',
              'capital', 'rcs', 'date_creation', 'effectif', 'etat_administratif', 'siege', 'service_public'] },
            { titre: 'Notes', champs: ['commentaire'], largeur: 'plein' },
          ],
        },
        {
          code: 'facturation', titre: 'Facturation et règlement',
          groupes: [
            { code: 'facturation_electronique', titre: 'Facturation électronique', champs: ['fe_type', 'assujetti_tva', 'fe_format', 'fe_plateforme', 'fe_adresse', 'fe_code_routage', 'fe_code_service', 'fe_engagement'] },
            { titre: 'Règlement', champs: ['mode_reglement', 'delai_paiement', 'devise', 'iban', 'bic'] },
          ],
        },
        {
          code: 'casquettes', titre: 'Par relation',
          groupes: [
            { code: 'client', titre: 'Client', champs: ['cli_charge_ind_id', 'cli_mode_reglement', 'cli_delai_paiement', 'cli_compte', 'cli_collectif', 'cli_compte_produit', 'cli_categorie', 'cli_encours_max', 'cli_remise'] },
            { code: 'fournisseur', titre: 'Fournisseur', champs: ['fou_mode_reglement', 'fou_delai_paiement', 'fou_tva_intracom', 'fou_compte', 'fou_collectif', 'fou_compte_charge', 'fou_numero_client', 'fou_franco', 'fou_delai_livraison'] },
            { code: 'sous_traitant', titre: 'Sous-traitant', champs: ['st_compte', 'st_collectif', 'st_compte_charge', 'st_corps_etat', 'st_qualifications', 'st_autoliquidation', 'st_decennale_assureur', 'st_decennale_police', 'st_decennale_fin'] },
            { code: 'interim', titre: "Agence d'intérim", champs: ['int_garantie_financiere', 'int_coefficient'] },
            { code: 'architecte', titre: 'Architecte', champs: ['arc_numero_ordre'] },
            { code: 'controle', titre: 'Bureau de contrôle', champs: ['bc_agrement', 'bc_missions'] },
          ],
        },
      ],
      champs: [
        c('code', 'Code', 'per_code', 'texte', { longueur: 20, non_copie: true, aide: 'Code du tiers : vide à la création = chrono (T000123 par défaut)' }),
        c('niveau', 'Niveau', 'per_niv_code', 'texte', { obligatoire: true, defaut: 'SOCIETE', reference: 'niveau' }),
        c('raison_sociale', 'Raison sociale ou nom', 'per_raison_sociale', 'texte', { obligatoire: true, longueur: 150 }),
        c('nom_commercial', 'Nom commercial (enseigne)', 'per_nom_commercial', 'texte', { longueur: 150 }),
        c('sigle', 'Sigle', 'per_sigle', 'texte', { longueur: 30 }),
        c('parent_id', 'Niveau supérieur', 'per_parent_id', 'nombre', { reference: 'personne', aide: 'Groupe d\'une société, société d\'un établissement, d\'une agence…' }),
        c('casquettes', 'Relations', 'per_casquettes', 'json', { aide: 'Client, fournisseur, sous-traitant… : une personne peut en avoir plusieurs' }),
        c('actif', 'Actif', 'per_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('usage', 'Utilisation', 'per_usage', 'liste', USAGE),
        c('societe_base', 'Société de cette base', 'per_societe_base', 'booleen', { obligatoire: true, defaut: false, non_copie: true, aide: 'Notre société (une seule par base)' }),
        c('pays', 'Pays', 'per_pays', 'texte', { defaut: 'FR', longueur: 2, format: 'regex:^[A-Za-z]{2}$', aide: 'Code ISO à 2 lettres (FR, BE, DE…)' }),
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
        c('service_public', 'Service public (Chorus Pro)', 'per_service_public', 'booleen', { defaut: false }),
        c('fe_format', 'Format de facture', 'per_fe_format', 'liste', { options: options(['FACTURX', 'Factur-X'], ['UBL', 'UBL'], ['CII', 'CII']) }),
        c('fe_plateforme', 'Plateforme de réception (PA)', 'per_fe_plateforme', 'texte', { longueur: 100, aide: 'Plateforme agréée choisie par le destinataire' }),
        c('fe_adresse', 'Adresse de facturation électronique', 'per_fe_adresse', 'texte', { longueur: 150, aide: 'Identifiant de l\'annuaire de facturation (SIREN, SIREN_SUFFIXE…)' }),
        c('fe_code_routage', 'Code de routage', 'per_fe_code_routage', 'texte', { longueur: 100 }),
        c('fe_code_service', 'Code service (Chorus Pro)', 'per_fe_code_service', 'texte', { longueur: 100 }),
        c('fe_engagement', 'N° d\'engagement obligatoire', 'per_fe_engagement', 'booleen', { defaut: false }),
        // Modes de règlement et conditions de paiement paramétrables (module Document : mode_reglement, condition_paiement).
        c('mode_reglement', 'Mode de règlement (par défaut)', 'per_mode_reglement', 'liste', { requete: REQUETE_MODES_REGLEMENT, aide: 'Repli quand le mode du client ou du fournisseur (onglet Par relation) est vide' }),
        c('delai_paiement', 'Délai de paiement (par défaut)', 'per_delai_paiement', 'liste', { requete: REQUETE_CONDITIONS_PAIEMENT, aide: 'Repli quand le délai du client ou du fournisseur (onglet Par relation) est vide' }),
        // Lot 4 des demandes du 25/10/2026 (db/229).
        c('fe_type', 'Type de tiers (facture électronique)', 'per_fe_type', 'liste', { options: options(['B2B', 'Entreprise (B2B)'], ['B2C', 'Particulier (B2C)'], ['B2G', 'Administration (B2G)'], ['INTERNATIONAL', 'International']) }),
        c('assujetti_tva', 'Assujetti à la TVA', 'per_assujetti_tva', 'booleen', { defaut: true }),
        c('activites', 'Activités', 'per_activites', 'json', { aide: 'Plusieurs activités, à deux niveaux (Paramètres › Référentiels communs)' }),
        c('image_ged', 'Logo', 'per_image_ged', 'nombre', { non_copie: true }),
        c('cli_charge_ind_id', "Chargé d'affaires", 'per_cli_charge_ind_id', 'liste', { requete: REQUETE_INDIVIDUS_STRUCTURE, aide: 'Suivi du client : individu de notre société' }),
        c('cli_mode_reglement', 'Mode de règlement (client)', 'per_cli_mode_reglement', 'liste', { requete: REQUETE_MODES_REGLEMENT }),
        c('cli_delai_paiement', 'Délai de paiement (client)', 'per_cli_delai_paiement', 'liste', { requete: REQUETE_CONDITIONS_PAIEMENT }),
        c('fou_mode_reglement', 'Mode de règlement (fournisseur)', 'per_fou_mode_reglement', 'liste', { requete: REQUETE_MODES_REGLEMENT }),
        c('fou_delai_paiement', 'Délai de paiement (fournisseur)', 'per_fou_delai_paiement', 'liste', { requete: REQUETE_CONDITIONS_PAIEMENT }),
        c('fou_tva_intracom', 'TVA intracommunautaire', 'per_fou_tva_intracom', 'booleen', { defaut: false, aide: "Fournisseur de l'Union européenne : TVA autoliquidée sur ses factures" }),
        c('devise', 'Devise', 'per_devise', 'texte', { defaut: 'EUR', longueur: 3 }),
        c('iban', 'IBAN', 'per_iban', 'texte', { longueur: 42, non_copie: true }),
        c('bic', 'BIC', 'per_bic', 'texte', { longueur: 11 }),
        c('commentaire', 'Notes', 'per_commentaire', 'zone'),
        // Champs déverrouillés par les relations (groupes de l'onglet Par relation).
        c('cli_compte', 'Compte client', 'per_cli_compte', 'texte', { longueur: 20, aide: 'Compte auxiliaire (411…)' }),
        c('cli_collectif', 'Collectif client', 'per_cli_collectif', 'liste', { requete: REQUETE_COLLECTIFS, aide: 'Vide : collectif du type (professionnel ou particulier), module Comptabilité' }),
        c('cli_compte_produit', 'Compte de produit', 'per_cli_compte_produit', 'liste', { requete: requeteComptesClasse(7),
          aide: 'Compte des lignes vendues à ce client, avant la ventilation par nature (distinct du compte auxiliaire)' }),
        c('cli_categorie', 'Catégorie tarifaire', 'per_cli_categorie', 'texte', { longueur: 40 }),
        c('cli_encours_max', 'Encours autorisé (€)', 'per_cli_encours_max', 'nombre', { format: '999999999999.99' }),
        c('cli_remise', 'Remise habituelle (%)', 'per_cli_remise', 'nombre', { format: '999.999' }),
        c('fou_compte', 'Compte fournisseur', 'per_fou_compte', 'texte', { longueur: 20, aide: 'Compte auxiliaire (401…)' }),
        c('fou_collectif', 'Collectif fournisseur', 'per_fou_collectif', 'liste', { requete: REQUETE_COLLECTIFS, aide: 'Vide : collectif des fournisseurs, module Comptabilité' }),
        c('fou_compte_charge', 'Compte de charge', 'per_fou_compte_charge', 'liste', { requete: requeteComptesClasse(6),
          aide: 'Compte des lignes achetées à ce fournisseur, avant la ventilation par nature (ex. carburant : 60614) ; distinct du compte auxiliaire' }),
        c('fou_numero_client', 'Notre n° de client', 'per_fou_numero_client', 'texte', { longueur: 40 }),
        c('fou_franco', 'Franco de port (€ HT)', 'per_fou_franco', 'nombre', { format: '999999999999.99' }),
        c('fou_delai_livraison', 'Délai de livraison (jours)', 'per_fou_delai_livraison', 'nombre', { format: '9999' }),
        c('st_compte', 'Compte sous-traitant', 'per_st_compte', 'texte', { longueur: 20, aide: 'Vide : compte fournisseur ; à saisir pour un compte auxiliaire propre' }),
        c('st_collectif', 'Collectif sous-traitant', 'per_st_collectif', 'liste', { requete: REQUETE_COLLECTIFS, aide: 'Vide : collectif des sous-traitants, module Comptabilité' }),
        c('st_compte_charge', 'Compte de charge (sous-traitance)', 'per_st_compte_charge', 'liste', { requete: requeteComptesClasse(6),
          aide: 'Vide : compte de charge du fournisseur ; distinct du compte auxiliaire' }),
        c('st_corps_etat', 'Corps d\'état', 'per_st_corps_etat', 'texte', { longueur: 100 }),
        c('st_qualifications', 'Qualifications (Qualibat…)', 'per_st_qualifications', 'texte', { longueur: 200 }),
        c('st_autoliquidation', 'Autoliquidation de la TVA', 'per_st_autoliquidation', 'booleen', { defaut: true }),
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
            { titre: 'Identité', champs: ['civilite', 'prenom', 'nom', 'date_naissance', 'pays', 'usage'] },
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
        c('pays', 'Pays', 'ind_pays', 'texte', { defaut: 'FR', longueur: 2, format: 'regex:^[A-Za-z]{2}$' }),
        c('roles', 'Rôles', 'ind_roles', 'json', { aide: 'Chargé d\'affaires, chiffreur, salarié, intérimaire, utilisateur… : repris par les autres modules' }),
        c('utilisateur', 'Identifiant de connexion', 'ind_utilisateur', 'texte', { longueur: 50, non_copie: true, aide: 'Pour le futur module des droits' }),
        c('actif', 'Actif', 'ind_actif', 'booleen', { obligatoire: true, defaut: true }),
        c('usage', 'Utilisation', 'ind_usage', 'liste', USAGE),
        c('commentaire', 'Notes', 'ind_commentaire', 'zone'),
        c('coordonnees', 'Coordonnées', null, 'json', { gere: true }),
        c('rattachements', 'Rattachements', null, 'json', { gere: true }),
        c('nb_rattachements', 'Nombre de rattachements', null, 'nombre', { gere: true, lecture_seule: true }),
        // Fiche salarié liée (module salariés du cœur) : lue par la spécialisation, jamais écrite.
        c('salarie', 'Salarié', null, 'json', { gere: true, lecture_seule: true }),
      ],
    },
  },
  // Structure des affaires (db/160_structure.sql) : projets (chiffrage), affaires (regroupement de chantiers ou affaire de
  // gestion), chantiers (ouverts quand un projet est obtenu), marchés (ouverts à la validation d'une commande client).
  projet: {
    libelle: 'Projet', table: 'projet', cle: 'prj_id', colonne_proprietes: 'prj_proprietes',
    definition: {
      libelle: 'Projet', titre: '[code] – [libelle]', sous_titre: '[ville]', chrono: chrono('PRJ-', '{P}{AAAA}-{N:3}', 'A'),
      sections: [{
        code: 'informations', titre: 'Projet',
        groupes: [
          { titre: 'Identification', champs: ['code', 'libelle', 'tiers_id', 'client_libre'] },
          { titre: 'Suivi commercial', champs: ['statut', 'priorite', 'evaluation', 'date_remise', 'date_decision', 'responsable_ind_id', 'metreur_ind_id'] },
          { titre: 'Estimation', champs: ['montant_estime', 'debut_prevu', 'fin_prevue', 'duree_estimee', 'duree_unite'] },
          { titre: 'Adresse des travaux', champs: ['adresse', 'code_postal', 'ville', 'zone'] },
          { titre: 'Commentaire', champs: ['commentaire', 'responsable'], largeur: 'plein' },
        ],
      }, {
        code: 'intervenants', titre: 'Intervenants',
        groupes: [{ titre: 'Petit annuaire', champs: ['intervenants'], largeur: 'plein' }],
      }],
      champs: [
        c('intervenants', 'Intervenants', null, 'json', { gere: true, largeur: 'plein', aide: 'Tiers et contacts de l\'annuaire avec leur fonction (client, architecte, sous-traitant, payeur…)' }),
        c('code', 'Code', 'prj_code', 'texte', { obligatoire: true, longueur: 20, non_copie: true }),
        c('libelle', 'Libellé', 'prj_libelle', 'texte', { obligatoire: true, longueur: 150, largeur: 'plein' }),
        c('tiers_id', 'Client', 'prj_tiers_id', 'nombre', { reference: 'tiers', aide: "Client de l'annuaire ; ＋ : nouveau prospect (tiers provisoire)" }),
        c('client_libre', 'Client (saisie libre)', 'prj_client_libre', 'texte', { longueur: 300, largeur: 'plein', aide: "Avant la création du client dans l'annuaire : nom, contact, téléphone…" }),
        c('priorite', 'Priorité', 'prj_priorite', 'liste', { requete: "SELECT lva_code, lva_libelle FROM liste_valeur WHERE lva_liste = 'PRIORITE_PROJET' AND lva_actif ORDER BY lva_ordre, lva_code", aide: 'Liste paramétrable (Paramètres › Référentiels communs)' }),
        c('evaluation', 'Évaluation', 'prj_evaluation', 'liste', { requete: "SELECT lva_code, lva_libelle FROM liste_valeur WHERE lva_liste = 'EVALUATION_PROJET' AND lva_actif ORDER BY lva_ordre, lva_code", aide: "Chances d'obtenir le projet (liste paramétrable)" }),
        c('responsable_ind_id', 'Responsable', 'prj_responsable_ind_id', 'nombre', { reference: 'individu_societe', aide: "Individu de notre société ou de l'une de ses agences" }),
        c('metreur_ind_id', 'Métreur', 'prj_metreur_ind_id', 'nombre', { reference: 'individu_societe', aide: "Individu de notre société ou de l'une de ses agences" }),
        c('debut_prevu', 'Début des travaux estimé', 'prj_debut_prevu', 'date'),
        c('fin_prevue', 'Fin des travaux estimée', 'prj_fin_prevue', 'date'),
        c('duree_estimee', 'Durée estimée', 'prj_duree_estimee', 'nombre', { format: '99999999.9' }),
        c('duree_unite', 'Unité de durée', 'prj_duree_unite', 'liste', { obligatoire: true, defaut: 'H', options: options(['H', 'Heures'], ['J', 'Jours']) }),
        c('adresse', 'Adresse', 'prj_adresse', 'texte', { longueur: 200, largeur: 'plein' }),
        c('code_postal', 'Code postal', 'prj_code_postal', 'texte', { longueur: 10 }),
        c('zone', 'Zone de déplacement', 'prj_zone', 'nombre', { format: '9', aide: 'Zone estimée (0 à 9), comme les zones du Pointage' }),
        c('statut', 'Statut', 'prj_statut', 'liste', {
          obligatoire: true, defaut: 'EN_COURS',
          options: options(['EN_COURS', 'En cours de chiffrage'], ['REMIS', 'Offre remise'], ['OBTENU', 'Obtenu'], ['PERDU', 'Perdu'], ['ABANDONNE', 'Abandonné']),
          aide: 'Obtenu : propose d\'ouvrir le chantier',
        }),
        c('date_remise', 'Date de remise', 'prj_date_remise', 'date'),
        c('date_decision', 'Date de décision', 'prj_date_decision', 'date'),
        c('montant_estime', 'Montant estimé HT', 'prj_montant_estime', 'nombre', { format: '999999999999.99' }),
        c('responsable', 'Responsable (ancienne saisie)', 'prj_responsable', 'texte', { longueur: 100, lecture_seule: true, aide: "Texte d'avant le lot 6 : choisir le responsable dans la liste des individus" }),
        c('ville', 'Ville', 'prj_ville', 'texte', { longueur: 100 }),
        c('commentaire', 'Commentaire', 'prj_commentaire', 'zone'),
      ],
    },
  },
  affaire: {
    libelle: 'Affaire', table: 'affaire', cle: 'aff_id', colonne_proprietes: 'aff_proprietes',
    definition: {
      libelle: 'Affaire', titre: '[code] – [libelle]', chrono: chrono('AFF-', '{P}{AAAA}-{N:3}', 'A'),
      sections: [{
        code: 'informations', titre: 'Affaire',
        groupes: [
          { titre: 'Identification', champs: ['code', 'libelle', 'nature', 'tiers_id'] },
          { titre: 'Suivi', champs: ['statut', 'date_ouverture', 'date_cloture', 'responsable_ind_id'] },
          { titre: 'Commentaire', champs: ['commentaire', 'responsable'], largeur: 'plein' },
        ],
      }, {
        code: 'intervenants', titre: 'Intervenants',
        groupes: [{ titre: 'Petit annuaire', champs: ['intervenants'], largeur: 'plein' }],
      }],
      champs: [
        c('intervenants', 'Intervenants', null, 'json', { gere: true, largeur: 'plein', aide: 'Tiers et contacts de l\'annuaire avec leur fonction (client, architecte, sous-traitant, payeur…)' }),
        c('code', 'Code', 'aff_code', 'texte', { obligatoire: true, longueur: 20, non_copie: true }),
        c('libelle', 'Libellé', 'aff_libelle', 'texte', { obligatoire: true, longueur: 150, largeur: 'plein' }),
        c('nature', 'Nature', 'aff_nature', 'liste', {
          obligatoire: true, defaut: 'C', options: options(['C', 'Regroupement de chantiers'], ['G', 'Gestion (frais hors chantier)']),
        }),
        c('tiers_id', 'Client', 'aff_tiers_id', 'nombre', { reference: 'tiers' }),
        c('statut', 'Statut', 'aff_statut', 'liste', { obligatoire: true, defaut: 'OUVERTE', options: options(['OUVERTE', 'Ouverte'], ['CLOSE', 'Close']) }),
        c('date_ouverture', 'Ouverture', 'aff_date_ouverture', 'date'),
        c('date_cloture', 'Clôture', 'aff_date_cloture', 'date'),
        c('responsable_ind_id', 'Chargé d\'affaires', 'aff_responsable_ind_id', 'nombre', { reference: 'individu_societe', aide: "Individu de notre société ou de l'une de ses agences" }),
        c('responsable', 'Responsable (ancienne saisie)', 'aff_responsable', 'texte', { longueur: 100, lecture_seule: true, aide: "Texte d'avant le lot 0 du module Rentabilité : choisir le chargé d'affaires dans la liste des individus" }),
        c('commentaire', 'Commentaire', 'aff_commentaire', 'zone'),
      ],
    },
  },
  chantier: {
    libelle: 'Chantier', table: 'chantier', cle: 'cha_id', colonne_proprietes: 'cha_proprietes',
    definition: {
      libelle: 'Chantier', titre: '[code] – [libelle]', sous_titre: '[ville]', chrono: chrono('CH-', '{P}{AAAA}-{N:3}', 'A'),
      sections: [{
        code: 'informations', titre: 'Chantier',
        groupes: [
          { titre: 'Identification', champs: ['code', 'libelle', 'aff_id', 'prj_id', 'tiers_id'] },
          { titre: 'Adresse', champs: ['adresse', 'code_postal', 'ville', 'contact_ind_id'] },
          { titre: 'Suivi', champs: ['statut', 'date_ouverture', 'code_analytique'] },
          { titre: 'Travaux', champs: ['debut_prevu', 'date_fin_prevue', 'debut_reel', 'fin_reelle'] },
          { titre: 'Équipe', champs: ['charge_ind_id', 'conducteur_ind_id', 'chef_ind_id'] },
          { titre: 'Stock', champs: ['depot', 'stock_tenu'] },
          { titre: 'Commentaire', champs: ['commentaire'], largeur: 'plein' },
        ],
      }, {
        code: 'intervenants', titre: 'Intervenants',
        groupes: [{ titre: 'Petit annuaire', champs: ['intervenants'], largeur: 'plein' }],
      }],
      champs: [
        c('intervenants', 'Intervenants', null, 'json', { gere: true, largeur: 'plein', aide: 'Tiers et contacts de l\'annuaire avec leur fonction (client, architecte, sous-traitant, payeur…)' }),
        c('code', 'Code', 'cha_code', 'texte', { obligatoire: true, longueur: 20, non_copie: true }),
        c('libelle', 'Libellé', 'cha_libelle', 'texte', { obligatoire: true, longueur: 150, largeur: 'plein' }),
        c('aff_id', 'Affaire', 'cha_aff_id', 'nombre', { reference: 'affaire', aide: 'Affaire qui regroupe ce chantier' }),
        c('prj_id', 'Projet', 'cha_prj_id', 'nombre', { reference: 'projet', aide: 'Projet obtenu à l\'origine du chantier' }),
        c('tiers_id', 'Client', 'cha_tiers_id', 'nombre', { reference: 'tiers' }),
        c('adresse', 'Adresse', 'cha_adresse', 'texte', { longueur: 200, largeur: 'plein' }),
        c('code_postal', 'Code postal', 'cha_code_postal', 'texte', { longueur: 10 }),
        c('ville', 'Ville', 'cha_ville', 'texte', { longueur: 100 }),
        c('contact_ind_id', 'Contact sur place', 'cha_contact_ind_id', 'nombre', { reference: 'individu', aide: 'Le client ou un salarié : repris dans l\'adresse des travaux et de livraison des documents' }),
        c('statut', 'Statut', 'cha_statut', 'liste', { obligatoire: true, defaut: 'OUVERT', options: options(['OUVERT', 'Ouvert'], ['TERMINE', 'Terminé'], ['CLOS', 'Clos']) }),
        c('date_ouverture', 'Ouverture', 'cha_date_ouverture', 'date'),
        c('date_fin_prevue', 'Fin des travaux prévue', 'cha_date_fin_prevue', 'date'),
        c('conducteur_ind_id', 'Conducteur de travaux', 'cha_conducteur_ind_id', 'nombre', { reference: 'individu_societe', aide: "Individu de notre société ou de l'une de ses agences (annuaire)" }),
        // Lot 6 des demandes du 25/10/2026 (db/236).
        c('charge_ind_id', "Chargé d'affaires", 'cha_charge_ind_id', 'nombre', { reference: 'individu_societe', aide: "Individu de notre société ou de l'une de ses agences" }),
        c('chef_ind_id', "Chef d'équipe", 'cha_chef_ind_id', 'nombre', { reference: 'individu_societe', aide: "Individu de notre société ou de l'une de ses agences" }),
        c('code_analytique', 'Code analytique', 'cha_code_analytique', 'texte', { longueur: 30, aide: "Section analytique de l'export comptable (vide : code du chantier)" }),
        c('debut_prevu', 'Début des travaux prévu', 'cha_debut_prevu', 'date'),
        c('debut_reel', 'Début réel', 'cha_debut_reel', 'date'),
        c('fin_reelle', 'Fin réelle', 'cha_fin_reelle', 'date'),
        c('depot', 'Dépôt de stock', 'cha_depot', 'booleen', { defaut: false, aide: 'Module Stock : dépôt géré (emplacements, inventaires, mini / maxi)' }),
        c('stock_tenu', 'Tient un stock', 'cha_stock_tenu', 'booleen', { defaut: false, aide: 'Module Stock : ce qui arrive sur le chantier y reste en stock jusqu\'à un transfert ; sinon il est consommé' }),
        c('commentaire', 'Commentaire', 'cha_commentaire', 'zone'),
      ],
    },
  },
  marche: {
    libelle: 'Marché', table: 'marche', cle: 'mar_id', colonne_proprietes: 'mar_proprietes',
    definition: {
      libelle: 'Marché', titre: '[code] – [libelle]', sous_titre: '',
      // Code d'après le chantier (M-2026-002-1) : rang = plus grand rang des marchés du chantier + 1 ; suffixe saisissable
      // en lettres (lot du chantier : M-2026-002-GO) ; préfixe selon le sens.
      chrono: chrono('M-', '{P}{PARENT}-{N}', 'J', {
        parent: 'cha_id', variante: 'sens',
        variantes: [{ valeur: 'V', libelle: 'Vente', prefixe: 'M-' }, { valeur: 'ST', libelle: 'Sous-traitance', prefixe: 'MST-' }],
      }),
      sections: [{
        code: 'informations', titre: 'Marché',
        groupes: [
          { titre: 'Identification', champs: ['code', 'libelle', 'sens', 'cha_id', 'tiers_id', 'ent_id'] },
          { titre: 'Conditions', champs: ['nature', 'montant_ht', 'depassement_autorise', 'retenue_pct', 'date', 'date_reception', 'reserves', 'reserves_levees_le', 'statut'] },
          { titre: 'Sous-traitance', champs: ['marche_vente_id', 'garantie', 'montant_agree', 'autoliquidation', 'debut_contractuel', 'fin_contractuelle'] },
          { titre: 'Commentaire', champs: ['commentaire'], largeur: 'plein' },
        ],
      }, {
        code: 'intervenants', titre: 'Intervenants',
        groupes: [{ titre: 'Petit annuaire', champs: ['intervenants'], largeur: 'plein' }],
      }],
      champs: [
        c('intervenants', 'Intervenants', null, 'json', { gere: true, largeur: 'plein', aide: 'Tiers et contacts de l\'annuaire avec leur fonction (client, architecte, sous-traitant, payeur…)' }),
        c('code', 'Code', 'mar_code', 'texte', { obligatoire: true, longueur: 20, non_copie: true }),
        c('libelle', 'Libellé', 'mar_libelle', 'texte', { obligatoire: true, longueur: 150, largeur: 'plein' }),
        c('cha_id', 'Chantier', 'mar_cha_id', 'nombre', { obligatoire: true, reference: 'chantier' }),
        c('sens', 'Sens', 'mar_sens', 'liste', { defaut: 'V', options: options(['V', 'Vente (client)'], ['ST', 'Sous-traitance']), aide: 'Marché de vente au client ou marché de sous-traitance (un par axe de facturation du sous-traitant)' }),
        c('tiers_id', 'Client ou sous-traitant', 'mar_tiers_id', 'nombre', { reference: 'tiers' }),
        c('ent_id', 'Commande de base', 'mar_ent_id', 'nombre', { reference: 'commande', aide: 'Commande dont la validation a ouvert le marché' }),
        c('marche_vente_id', 'Marché de vente lié', 'mar_marche_vente_id', 'nombre', { reference: 'marche', aide: 'Facultatif : marché du client sur lequel porte la sous-traitance (intervenant, paiement direct)' }),
        c('garantie', 'Garantie de paiement', 'mar_garantie', 'liste', { options: options(['PAIEMENT_DIRECT', 'Paiement direct (public)'], ['DELEGATION', 'Délégation de paiement (privé)'], ['CAUTION', 'Caution (privé)'], ['AUCUNE', 'Aucune']) }),
        c('montant_agree', 'Montant agréé (DC4)', 'mar_montant_agree', 'nombre', { format: '999999999999.99', aide: 'Plafond du paiement direct agréé par le maître d\'ouvrage' }),
        c('autoliquidation', 'Autoliquidation de la TVA', 'mar_autoliquidation', 'booleen', { defaut: true, aide: 'Travaux de construction sous-traités : le sous-traitant facture HT' }),
        c('debut_contractuel', 'Début contractuel', 'mar_debut_contractuel', 'date'),
        c('fin_contractuelle', 'Fin contractuelle', 'mar_fin_contractuelle', 'date', { aide: 'Délai d\'exécution du sous-traitant (jalon du planning)' }),
        c('nature', 'Nature', 'mar_nature', 'liste', { obligatoire: true, defaut: 'P', options: options(['P', 'Marché privé'], ['U', 'Marché public']) }),
        c('montant_ht', 'Montant HT', 'mar_montant_ht', 'nombre', { format: '999999999999.99', lecture_seule: true, aide: 'Calculé : total des commandes validées du marché (commande de base et avenants)' }),
        c('depassement_autorise', 'Dépassement autorisé', 'mar_depassement_autorise', 'booleen', { defaut: false, aide: "L'avancement peut dépasser le montant du marché (travaux publics : quantités réelles)" }),
        c('retenue_pct', 'Retenue de garantie (%)', 'mar_retenue_pct', 'nombre', { format: '999.99', aide: '% du TTC de chaque facture du marché (5 % au plus), poste du pied global et échéance à part' }),
        c('date', 'Date', 'mar_date', 'date', { obligatoire: true }),
        c('date_reception', 'Date de réception', 'mar_date_reception', 'date', { aide: 'Réception des travaux : la retenue de garantie est libérée un an après, sauf réserves' }),
        c('reserves', 'Réception avec réserves', 'mar_reserves', 'booleen', { defaut: false, aide: 'Réserves non levées : la retenue de garantie reste bloquée' }),
        c('reserves_levees_le', 'Réserves levées le', 'mar_reserves_levees_le', 'date', { aide: "Levée après l'échéance : la retenue est libérée à la levée" }),
        c('statut', 'Statut', 'mar_statut', 'liste', { obligatoire: true, defaut: 'EN_COURS', options: options(['EN_COURS', 'En cours'], ['SOLDE', 'Soldé'], ['RESILIE', 'Résilié']) }),
        c('commentaire', 'Commentaire', 'mar_commentaire', 'zone'),
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
  // Structure des affaires : ADMIN tout, SAISIE consulte et modifie.
  ...['projet', 'affaire', 'chantier', 'marche'].flatMap((type) => [
    ...['VOIR', 'MODIFIER', 'DEBLOQUER'].map((action) => ({ profil: 'ADMIN', type, action })),
    ...['VOIR', 'MODIFIER'].map((action) => ({ profil: 'SAISIE', type, action })),
  ]),
  // Suppression (listes et fiches) : profil ADMIN, refusée si la fiche est utilisée ailleurs.
  ...['salarie', 'materiel', 'element', 'personne', 'individu', 'projet', 'affaire', 'chantier', 'marche'].map((type) => ({ profil: 'ADMIN', type, action: 'SUPPRIMER' })),
  // Code d'une fiche déjà créée (chrono) : profil ADMIN.
  ...['salarie', 'materiel', 'element', 'personne', 'projet', 'affaire', 'chantier', 'marche'].map((type) => ({ profil: 'ADMIN', type, action: 'MODIFIER_CODE' })),
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
      { code: 'taille_vetement', libelle: 'Taille de vêtement', type: 'liste', options: options('S', 'M', 'L', 'XL', 'XXL'), groupe: 'Équipement', ordre: 10 },
      { code: 'pointure', libelle: 'Pointure', type: 'nombre', format: '99', groupe: 'Équipement', ordre: 20 },
      { code: 'permis_c', libelle: 'Permis C', type: 'booleen', groupe: 'Habilitations', ordre: 30 },
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
      { code: 'code_antivol', libelle: 'Code antivol', type: 'motdepasse', longueur: 40, groupe: 'Accès', ordre: 40 },
    ].map((x) => ({ ...x, actif: true })),
  },
};

/** Type de fiche et ID à partir d'une ligne de liste (types d'élément, ID préfixés de la vue Ressources). */
export function ficheDeLigne({ type, id }) {
  const st = /^SST-(\d+)$/.exec(String(id));
  if (st) return { type: 'personne', id: Number(st[1]) };
  const m = /^(SAL|MAT)-(\d+)$/.exec(String(id));
  if (m) return { type: m[1] === 'SAL' ? 'salarie' : 'materiel', id: Number(m[2]) };
  if (type === 'salarie' || type === 'interim') return { type: 'salarie', id };
  if (type === 'materiel') return { type: 'materiel', id };
  if (type === 'element') return { type: 'element', id };
  if (type === 'personne' || type === 'individu') return { type, id };
  if (['projet', 'affaire', 'chantier', 'marche'].includes(type)) return { type, id };
  return null;
}
