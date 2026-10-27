import { luhn, tvaDepuisSiren } from '@logibtp/annuaire';

// Annuaire de démonstration (entreprises et personnes fictives) : référentiels (niveaux, relations — « casquettes » dans
// le code —, types de lien, rôles), personnes à plusieurs niveaux (société de la base et ses agences, groupe de location
// › société › agences dans plusieurs villes › dépôts, groupe › société › établissement…), tiers à plusieurs relations
// (client et fournisseur…), plusieurs contacts par personne,
// individus rattachés, coordonnées partagées. Exemple : Antoine Abel, commercial de Matériaux Rhône-Alpes à Gerland
// (fournisseur), est aussi client particulier ; son adresse et ses coordonnées personnelles sont partagées (même
// identifiant) entre sa fiche individu et son compte particulier. Alimente db/141 (généré).

export const NIVEAUX = [
  { code: 'GROUPE', libelle: 'Groupe', icone: '🏛️', morale: true, ordre: 10 },
  { code: 'SOCIETE', libelle: 'Société', icone: '🏢', morale: true, ordre: 20 },
  { code: 'COLLECTIVITE', libelle: 'Collectivité, administration', icone: '🏛', morale: true, ordre: 25 },
  { code: 'ASSOCIATION', libelle: 'Association', icone: '🤝', morale: true, ordre: 27 },
  { code: 'ETABLISSEMENT', libelle: 'Établissement', icone: '🏬', morale: true, ordre: 30 },
  { code: 'AGENCE', libelle: 'Agence', icone: '🏪', morale: true, ordre: 40 },
  { code: 'DEPOT', libelle: 'Dépôt', icone: '🏭', morale: true, ordre: 50 },
  { code: 'SERVICE', libelle: 'Service', icone: '🗂️', morale: true, ordre: 60 },
  { code: 'PARTICULIER', libelle: 'Particulier', icone: '🏠', morale: false, ordre: 90 },
].map((x) => ({ ...x, actif: true }));

export const CASQUETTES = [
  { code: 'CLIENT', libelle: 'Client', icone: '💶', groupes: ['client'], ordre: 10 },
  { code: 'PROSPECT', libelle: 'Prospect', icone: '🎯', groupes: [], ordre: 15 },
  { code: 'FOURNISSEUR', libelle: 'Fournisseur', icone: '📦', groupes: ['fournisseur'], ordre: 20 },
  { code: 'LOUEUR', libelle: 'Loueur de matériel', icone: '🚜', groupes: ['fournisseur'], ordre: 25 },
  { code: 'SOUS_TRAITANT', libelle: 'Sous-traitant', icone: '🤝', groupes: ['sous_traitant'], ordre: 30 },
  { code: 'COTRAITANT', libelle: 'Cotraitant', icone: '🔗', groupes: [], ordre: 35 },
  { code: 'INTERIM', libelle: "Agence d'intérim", icone: '👷', groupes: ['interim'], ordre: 40 },
  { code: 'ARCHITECTE', libelle: 'Architecte', icone: '📐', groupes: ['architecte'], ordre: 50 },
  { code: 'MOE', libelle: "Maître d'œuvre", icone: '🧭', groupes: [], ordre: 55 },
  { code: 'BE', libelle: "Bureau d'études", icone: '📊', groupes: [], ordre: 60 },
  { code: 'BC', libelle: 'Bureau de contrôle', icone: '✅', groupes: ['controle'], ordre: 65 },
  { code: 'MOA', libelle: "Maître d'ouvrage", icone: '🏗️', groupes: [], ordre: 70 },
  { code: 'BANQUE', libelle: 'Banque', icone: '🏦', groupes: [], ordre: 80 },
  { code: 'ASSURANCE', libelle: 'Assureur', icone: '🛡️', groupes: [], ordre: 85 },
  { code: 'RESTAURANT', libelle: 'Restaurant', icone: '🍽', groupes: [], ordre: 90 },
].map((x) => ({ ...x, actif: true }));

export const TYPES_LIEN = [
  { code: 'FACTURER_A', libelle: 'Facturer à', libelle_inverse: 'Payeur pour', ordre: 10 },
  { code: 'LIVRER_A', libelle: 'Livrer à', libelle_inverse: 'Reçoit les livraisons de', ordre: 20 },
  { code: 'MANDATAIRE', libelle: 'A pour mandataire', libelle_inverse: 'Mandataire de', ordre: 30 },
  { code: 'FACTOR', libelle: 'Affacturé par', libelle_inverse: 'Factor de', ordre: 40 },
  { code: 'BANQUE', libelle: 'A pour banque', libelle_inverse: 'Banque de', ordre: 50 },
  { code: 'ASSURE_PAR', libelle: 'Assuré par', libelle_inverse: 'Assureur de', ordre: 60 },
  { code: 'PARTENAIRE', libelle: 'Partenaire de', libelle_inverse: 'Partenaire de', ordre: 70 },
].map((x) => ({ ...x, actif: true }));

export const ROLES = [
  { code: 'DIRIGEANT', libelle: 'Dirigeant', icone: '🎩', ordre: 5 },
  { code: 'SALARIE', libelle: 'Salarié', icone: '👷', ordre: 10 },
  { code: 'CHARGE_AFFAIRES', libelle: "Chargé d'affaires", icone: '💼', ordre: 20 },
  { code: 'CHIFFREUR', libelle: 'Chiffreur', icone: '🧮', ordre: 30 },
  { code: 'CONDUCTEUR', libelle: 'Conducteur de travaux', icone: '🦺', ordre: 40 },
  { code: 'CHEF_CHANTIER', libelle: 'Chef de chantier', icone: '🏗️', ordre: 45 },
  { code: 'INTERIMAIRE', libelle: 'Intérimaire', icone: '⏱️', ordre: 50 },
  { code: 'UTILISATEUR', libelle: 'Utilisateur LogiBTP', icone: '🔑', ordre: 60 },
].map((x) => ({ ...x, actif: true }));

/** Chiffres complétés de leur clé de Luhn (SIREN fictifs : 8 chiffres + clé ; SIRET : SIREN + 4 chiffres + clé). */
function avecCle(chiffres) {
  for (let c = 0; c <= 9; c++) if (luhn(`${chiffres}${c}`)) return `${chiffres}${c}`;
  throw new Error(chiffres);
}
const siren = (base8) => avecCle(base8);
const siret = (sirenFr, nic4) => avecCle(`${sirenFr}${nic4}`);

const P = (id, niveau, raison_sociale, extra = {}) => ({
  id, code: `T${String(id).padStart(6, '0')}`, niveau, raison_sociale, nom_commercial: null, sigle: null, parent_id: null, casquettes: [], pays: 'FR',
  siren: null, siret: null, tva_intra: null, identifiant_etranger: null, naf: null, forme_juridique: null, forme_libelle: null, capital: null, rcs: null,
  date_creation: null, effectif: null, etat_administratif: 'A', siege: null, service_public: false, fe_plateforme: null, fe_adresse: null, fe_code_routage: null,
  fe_format: null, fe_code_service: null, fe_engagement: false, mode_reglement: null, delai_paiement: null, iban: null, bic: null, devise: 'EUR',
  societe_base: false, actif: true, commentaire: null, proprietes: {}, st_autoliquidation: true, ...extra,
});

/** Entreprise française : SIREN, SIRET (siège : NIC 0001), TVA calculée. */
const fr = (base8, nic = '0001', extra = {}) => {
  const s = siren(base8);
  return { siren: s, siret: siret(s, nic), tva_intra: tvaDepuisSiren(s), ...extra };
};

const NOTRE = siren('84251731');
const MRA = siren('52310440');
const LOCAPRO = siren('43312876');

export const PERSONNES = [
  P(1, 'SOCIETE', 'LogiBTP Démo', {
    ...fr('84251731'), siren: NOTRE, siret: siret(NOTRE, '0001'), tva_intra: tvaDepuisSiren(NOTRE), societe_base: true, siege: true,
    forme_juridique: '5710', forme_libelle: 'Société par actions simplifiée (SAS)', capital: 250000, rcs: 'Lyon B ' + NOTRE.replace(/(\d{3})(?=\d)/g, '$1 '),
    naf: '41.20B', date_creation: '2015-03-02', effectif: '50 à 99 salariés', fe_format: 'FACTURX', fe_adresse: NOTRE, fe_plateforme: 'Plateforme agréée de démonstration',
    mode_reglement: 'VIREMENT', delai_paiement: '30J', iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP', commentaire: 'Société de cette base : ses agences et salariés lui sont rattachés.',
  }),
  P(2, 'AGENCE', 'LogiBTP Démo – Agence de Grenoble', { parent_id: 1, siren: NOTRE, siret: siret(NOTRE, '0002'), siege: false, naf: '41.20B' }),
  P(3, 'DEPOT', 'LogiBTP Démo – Dépôt de Vénissieux', { parent_id: 1, siren: NOTRE, siret: siret(NOTRE, '0003'), siege: false, naf: '41.20B' }),
  P(4, 'GROUPE', 'Groupe Négoce Rhône', { ...fr('51870233'), forme_juridique: '5599', forme_libelle: "SA à conseil d'administration", naf: '70.10Z', siege: true }),
  P(5, 'SOCIETE', 'Matériaux Rhône-Alpes', {
    parent_id: 4, siren: MRA, siret: siret(MRA, '0001'), tva_intra: tvaDepuisSiren(MRA), siege: true, casquettes: ['FOURNISSEUR'], nom_commercial: 'MRA',
    forme_juridique: '5710', forme_libelle: 'Société par actions simplifiée (SAS)', naf: '46.73A', fou_compte: '401MRA', fou_numero_client: 'C-458712',
    fou_franco: 800, fou_delai_livraison: 2, mode_reglement: 'VIREMENT', delai_paiement: '45JFM', fe_format: 'FACTURX',
  }),
  P(6, 'ETABLISSEMENT', 'Matériaux Rhône-Alpes – Lyon Gerland', { parent_id: 5, siren: MRA, siret: siret(MRA, '0002'), siege: false, casquettes: ['FOURNISSEUR'], naf: '46.73A' }),
  P(7, 'SOCIETE', 'Électricité Rhône-Alpes', {
    ...fr('49215837'), casquettes: ['SOUS_TRAITANT', 'CLIENT', 'COTRAITANT'], cli_compte: '411ELECRA',
    commentaire: 'Sous-traitant sur nos chantiers ; client pour l\'extension de ses locaux ; cotraitant sur le lot technique de la ZAC.', forme_juridique: '5499', forme_libelle: 'Société à responsabilité limitée (SARL)', naf: '43.21A', siege: true,
    st_corps_etat: 'Électricité courants forts et faibles', st_qualifications: 'Qualifelec E2', st_decennale_assureur: 'Assurances Bâtisseurs Mutuelle',
    st_decennale_police: 'DEC-2026-11874', st_decennale_fin: '2026-12-31',
  }),
  P(8, 'SOCIETE', 'Plomberie Dupuis et Fils', {
    ...fr('80135562'), casquettes: ['SOUS_TRAITANT'], forme_juridique: '5498', forme_libelle: 'SARL unipersonnelle (EURL)', naf: '43.22A', siege: true,
    st_corps_etat: 'Plomberie, chauffage', st_qualifications: 'Qualibat 5211', st_decennale_assureur: 'Assurances Bâtisseurs Mutuelle', st_decennale_fin: '2026-03-31',
  }),
  P(9, 'AGENCE', 'LocaPro – Agence Lyon Est', { parent_id: 28, ...agenceLocapro('0012'), casquettes: ['LOUEUR', 'FOURNISSEUR'] }),
  P(10, 'AGENCE', 'Intérim BTP Services – Lyon', { ...fr('39845123', '0021'), casquettes: ['INTERIM'], naf: '78.20Z', siege: false, int_garantie_financiere: 'Caisse de garantie du travail temporaire', int_coefficient: 1.92 }),
  P(11, 'SOCIETE', "Atelier d'architecture Durand et associés", { ...fr('75223418'), casquettes: ['ARCHITECTE', 'MOE'], naf: '71.11Z', siege: true, arc_numero_ordre: 'S12345' }),
  P(12, 'SOCIETE', 'BET Structure Confluence', { ...fr('81904577'), casquettes: ['BE'], naf: '71.12B', siege: true }),
  P(13, 'AGENCE', 'Contrôle Bâtiment Sud-Est – Lyon', { ...fr('34456712', '0007'), casquettes: ['BC'], naf: '71.20B', siege: false, bc_agrement: 'BC-2023-069', bc_missions: 'L, S, SEI, PS, HAND' }),
  P(14, 'SOCIETE', 'SCI Les Érables', { ...fr('90123764'), casquettes: ['CLIENT', 'MOA'], forme_juridique: '6540', forme_libelle: 'Société civile immobilière (SCI)', naf: '68.20B', siege: true, cli_compte: '411ERABLES', delai_paiement: '30J', mode_reglement: 'VIREMENT' }),
  P(15, 'COLLECTIVITE', 'Commune de Belleroche', {
    ...fr('21690999'), casquettes: ['CLIENT', 'MOA'], forme_juridique: '7210', forme_libelle: 'Commune', naf: '84.11Z', siege: true, service_public: true,
    fe_plateforme: 'Chorus Pro', fe_code_service: 'SERVICES-TECHNIQUES', fe_engagement: true, cli_compte: '411BELLEROCHE', delai_paiement: '30J', mode_reglement: 'VIREMENT',
  }),
  P(16, 'SOCIETE', 'Bâtir Ensemble Immobilier', { ...fr('82667129'), casquettes: ['PROSPECT', 'MOA'], naf: '41.10A', siege: true }),
  P(17, 'PARTICULIER', 'M. ABEL Antoine', { casquettes: ['CLIENT'], cli_compte: '411ABEL', mode_reglement: 'CHEQUE', delai_paiement: 'COMPTANT', commentaire: 'Projet d\'extension de maison (2027).' }),
  P(18, 'PARTICULIER', 'Mme DURAND Claire', { casquettes: ['CLIENT'], cli_compte: '411DURANDC', mode_reglement: 'VIREMENT' }),
  P(19, 'SOCIETE', 'Crédit Rhodanien', { ...fr('55821094'), casquettes: ['BANQUE'], naf: '64.19Z', siege: true }),
  P(20, 'SOCIETE', 'Assurances Bâtisseurs Mutuelle', { ...fr('77543218'), casquettes: ['ASSURANCE'], naf: '65.12Z', siege: true }),
  P(21, 'SOCIETE', 'Costruzioni Alpine S.r.l.', {
    pays: 'IT', tva_intra: 'IT01234567897', identifiant_etranger: 'REA TO-1234567', casquettes: ['SOUS_TRAITANT', 'COTRAITANT'],
    commentaire: 'Entreprise italienne (Turin) : pas de SIRET, TVA intracommunautaire italienne.', st_corps_etat: 'Façades, pierre', st_autoliquidation: false,
  }),
  P(22, 'SOCIETE', 'Aciers du Rhône', { ...fr('42876519'), casquettes: ['FOURNISSEUR'], naf: '46.72Z', siege: true, fou_compte: '401ACIERS' }),
  P(23, 'SOCIETE', 'Métal Distribution', { ...fr('38712466'), casquettes: ['FOURNISSEUR'], naf: '46.72Z', siege: true }),
  P(24, 'SOCIETE', 'Béton Lyonnais', {
    ...fr('50466213'), casquettes: ['FOURNISSEUR', 'CLIENT'], naf: '23.63Z', siege: true, cli_compte: '411BETONLY', fou_compte: '401BETONLY',
    commentaire: 'Fournisseur de béton prêt à l\'emploi ; client pour la construction de sa nouvelle centrale à Corbas.',
  }),
  // Agences de notre société (rattachement des salariés selon leur agence).
  P(25, 'AGENCE', 'LogiBTP Démo – Agence de Saint-Étienne', { parent_id: 1, siren: NOTRE, siret: siret(NOTRE, '0004'), siege: false, naf: '41.20B' }),
  P(26, 'AGENCE', 'LogiBTP Démo – Agence de Bourg-en-Bresse', { parent_id: 1, siren: NOTRE, siret: siret(NOTRE, '0005'), siege: false, naf: '41.20B' }),
  // Groupe de location de matériel : société, agences dans plusieurs villes, dépôts rattachés à une agence.
  P(27, 'GROUPE', 'Groupe LocaPro', { ...fr('39017264'), forme_juridique: '5599', forme_libelle: "SA à conseil d'administration", naf: '70.10Z', siege: true }),
  P(28, 'SOCIETE', 'LocaPro Location', {
    parent_id: 27, siren: LOCAPRO, siret: siret(LOCAPRO, '0001'), tva_intra: tvaDepuisSiren(LOCAPRO), siege: true, casquettes: ['LOUEUR', 'FOURNISSEUR', 'CLIENT'],
    forme_juridique: '5710', forme_libelle: 'Société par actions simplifiée (SAS)', naf: '77.32Z', fou_compte: '401LOCAPRO', fou_numero_client: 'LP-778412',
    cli_compte: '411LOCAPRO', mode_reglement: 'PRELEVEMENT', delai_paiement: '30JFM', fe_format: 'UBL',
    commentaire: 'Loueur de matériel (fournisseur) ; client pour l\'aménagement de ses dépôts.',
  }),
  P(29, 'AGENCE', 'LocaPro – Agence Lyon Ouest', { parent_id: 28, ...agenceLocapro('0020'), casquettes: ['LOUEUR', 'FOURNISSEUR'] }),
  P(30, 'AGENCE', 'LocaPro – Agence Grenoble', { parent_id: 28, ...agenceLocapro('0038'), casquettes: ['LOUEUR', 'FOURNISSEUR'] }),
  P(31, 'AGENCE', 'LocaPro – Agence Saint-Étienne', { parent_id: 28, ...agenceLocapro('0046'), casquettes: ['LOUEUR', 'FOURNISSEUR'] }),
  P(32, 'AGENCE', 'LocaPro – Agence Villefranche-sur-Saône', { parent_id: 28, ...agenceLocapro('0053'), casquettes: ['LOUEUR', 'FOURNISSEUR'] }),
  P(33, 'AGENCE', 'LocaPro – Agence Chambéry', { parent_id: 28, ...agenceLocapro('0061'), casquettes: ['LOUEUR', 'FOURNISSEUR'] }),
  P(34, 'DEPOT', 'LocaPro – Dépôt de Saint-Priest', { parent_id: 9, ...agenceLocapro('0079'), casquettes: ['LOUEUR'] }),
  P(35, 'DEPOT', 'LocaPro – Dépôt de Corbas', { parent_id: 9, ...agenceLocapro('0087'), casquettes: ['LOUEUR'] }),
  P(36, 'DEPOT', "LocaPro – Dépôt d'Échirolles", { parent_id: 30, ...agenceLocapro('0095'), casquettes: ['LOUEUR'] }),
  P(37, 'SOCIETE', 'LocaPro Modulaires', { parent_id: 27, ...fr('48261937'), casquettes: ['LOUEUR', 'FOURNISSEUR'], naf: '77.39Z', siege: true, commentaire: 'Bungalows et bases vie de chantier.' }),
  // Tiers à plusieurs relations.
  P(38, 'SOCIETE', 'Charpentes du Lyonnais', {
    ...fr('51293846'), casquettes: ['SOUS_TRAITANT', 'FOURNISSEUR'], forme_juridique: '5499', forme_libelle: 'Société à responsabilité limitée (SARL)', naf: '16.23Z', siege: true,
    st_corps_etat: 'Charpente bois, ossature bois', st_qualifications: 'Qualibat 2312', st_decennale_assureur: 'Assurances Bâtisseurs Mutuelle', st_decennale_fin: '2027-06-30',
    commentaire: 'Sous-traitant en pose ; fournisseur de bois de charpente en fourniture seule.',
  }),
  P(39, 'SOCIETE', 'Rhône Habitat', {
    ...fr('27690012'), casquettes: ['CLIENT', 'MOA'], naf: '68.20A', siege: true, service_public: true, fe_plateforme: 'Chorus Pro', fe_code_service: 'PATRIMOINE',
    fe_engagement: true, cli_compte: '411RHONEHAB', delai_paiement: '30J', mode_reglement: 'VIREMENT', commentaire: 'Bailleur social (office public de l\'habitat).',
  }),
  P(40, 'SOCIETE', 'Garage Poids Lourds Martin', {
    ...fr('40518327'), casquettes: ['FOURNISSEUR', 'CLIENT'], naf: '45.20B', siege: true, fou_compte: '401GPLM', cli_compte: '411GPLM',
    commentaire: 'Entretient nos camions (fournisseur) ; nous agrandissons son atelier (client).',
  }),
  P(41, 'SOCIETE', 'Énergies Solaires du Rhône', {
    ...fr('83465201'), casquettes: ['CLIENT', 'FOURNISSEUR', 'COTRAITANT'], naf: '43.21B', siege: true, cli_compte: '411ESR', fou_compte: '401ESR',
    commentaire: 'Fournit les panneaux photovoltaïques, cotraitant en groupement, et client pour ses bureaux.',
  }),
  P(42, 'SOCIETE', 'Menuiseries Alpines', {
    ...fr('79256410'), casquettes: ['FOURNISSEUR', 'SOUS_TRAITANT'], naf: '16.23Z', siege: true, st_corps_etat: 'Menuiseries extérieures', st_qualifications: 'Qualibat 3512',
  }),
];

/** Agence de LocaPro Location : SIRET de la société (NIC de l'agence), NAF de la location de matériel. */
function agenceLocapro(nic) {
  return { siren: LOCAPRO, siret: siret(LOCAPRO, nic), siege: false, naf: '77.32Z' };
}

const I = (id, civilite, prenom, nom, extra = {}) => ({ id, civilite, prenom, nom, date_naissance: null, pays: 'FR', roles: [], utilisateur: null, actif: true, commentaire: null, proprietes: {}, ...extra });

export const INDIVIDUS = [
  I(1, 'M.', 'Antoine', 'Abel', { date_naissance: '1984-06-12', commentaire: 'Commercial chez Matériaux Rhône-Alpes (Gerland) et client particulier.' }),
  I(2, 'Mme', 'Claire', 'Durand'),
  I(3, 'M.', 'Jean-Pierre', 'Martin', { roles: ['DIRIGEANT', 'UTILISATEUR'], utilisateur: 'jp.martin' }),
  I(4, 'Mme', 'Sophie', 'Bernard', { roles: ['SALARIE', 'CHARGE_AFFAIRES', 'UTILISATEUR'], utilisateur: 's.bernard' }),
  I(5, 'M.', 'Karim', 'Haddad', { roles: ['SALARIE', 'CHIFFREUR', 'UTILISATEUR'], utilisateur: 'k.haddad' }),
  I(6, 'M.', 'Lucas', 'Petit', { roles: ['SALARIE', 'CONDUCTEUR', 'UTILISATEUR'], utilisateur: 'l.petit' }),
  I(7, 'M.', 'Thomas', 'Leroy', { roles: ['INTERIMAIRE'] }),
  I(8, 'Mme', 'Nathalie', 'Roux'),
  I(9, 'M.', 'Marc', 'Dupuis'),
  I(10, 'Mme', 'Élodie', 'Durand'),
  I(11, 'M.', 'Hugo', 'Lambert'),
  I(12, 'Mme', 'Isabelle', 'Moreau'),
  I(13, 'M.', 'Paul', 'Garnier', { commentaire: 'Gère la SCI Les Érables et travaille chez Bâtir Ensemble Immobilier.' }),
  I(14, 'Mme', 'Julie', 'Fontaine'),
  I(15, 'M.', 'Giorgio', 'Rossi', { pays: 'IT' }),
  I(16, 'M.', 'Nicolas', 'Faure', { roles: ['SALARIE', 'CHEF_CHANTIER'] }),
  I(17, 'M.', 'Olivier', 'Chevalier'),
  I(18, 'Mme', 'Camille', 'Robin'),
  I(19, 'M.', 'Yanis', 'Benali', { commentaire: 'Commercial itinérant : couvre les agences Lyon Est et Lyon Ouest.' }),
  I(20, 'Mme', 'Laura', 'Mercier'),
  I(21, 'M.', 'Kévin', 'Girard'),
  I(22, 'Mme', 'Sarah', 'Lopez'),
  I(23, 'M.', 'Romain', 'Fabre'),
  I(24, 'Mme', 'Inès', 'Garcia'),
  I(25, 'M.', 'Damien', 'Perrin'),
  I(26, 'Mme', 'Chloé', 'Blanc'),
  I(27, 'M.', 'Patrick', 'Vidal'),
  I(28, 'Mme', 'Aurélie', 'Masson'),
  I(29, 'M.', 'Bruno', 'Leclerc'),
  I(30, 'M.', 'Fabien', 'Marchand'),
  I(31, 'Mme', 'Manon', 'Roche'),
  I(32, 'M.', 'Hervé', 'Collet'),
  I(33, 'Mme', 'Émilie', 'Garnier'),
];

// Rattachements : [id, individu, personne, fonction, extra]
const R = (id, ind_id, per_id, fonction, extra = {}) => ({ id, ind_id, per_id, fonction, service: null, principal: false, titulaire: false, debut: null, fin: null, actif: true, commentaire: null, ...extra });

export const RATTACHEMENTS = [
  R(1, 1, 6, 'Commercial sédentaire', { principal: true, service: 'Ventes', debut: '2019-09-01' }),
  R(2, 1, 17, 'Titulaire', { principal: true, titulaire: true }),
  R(3, 2, 18, 'Titulaire', { principal: true, titulaire: true }),
  R(4, 3, 1, 'Président', { principal: true, debut: '2015-03-02' }),
  R(5, 4, 2, "Chargée d'affaires", { principal: true, debut: '2018-01-08' }),
  R(6, 5, 1, 'Chiffreur', { service: 'Études de prix', debut: '2020-04-01' }),
  R(7, 6, 1, 'Conducteur de travaux', { service: 'Travaux', debut: '2017-06-12' }),
  R(8, 7, 10, 'Coffreur (missions)', { debut: '2026-02-01' }),
  R(9, 8, 7, 'Gérante', { principal: true }),
  R(10, 9, 8, 'Gérant', { principal: true }),
  R(11, 10, 11, 'Architecte associée', { principal: true }),
  R(12, 11, 12, 'Ingénieur structure', { principal: true }),
  R(13, 12, 15, 'Directrice des services techniques', { principal: true, service: 'Services techniques' }),
  R(14, 13, 14, 'Gérant', { principal: true }),
  R(15, 13, 16, 'Responsable de programmes', { principal: true }),
  R(16, 14, 5, 'Comptabilité fournisseurs', { service: 'Comptabilité', principal: true }),
  R(17, 15, 21, 'Amministratore', { principal: true }),
  R(18, 16, 3, 'Chef de dépôt', { principal: true }),
  // Plusieurs contacts par personne (LocaPro, MRA, Électricité Rhône-Alpes, Rhône Habitat…).
  R(19, 17, 28, 'Directeur régional', { principal: true, service: 'Direction régionale Rhône-Alpes' }),
  R(20, 22, 28, 'Administration des ventes', { service: 'ADV et facturation' }),
  R(21, 18, 9, "Cheffe d'agence", { principal: true }),
  R(22, 19, 9, 'Commercial itinérant', { service: 'Ventes' }),
  R(23, 19, 29, 'Commercial itinérant', { service: 'Ventes' }),
  R(24, 20, 30, "Cheffe d'agence", { principal: true }),
  R(25, 21, 34, 'Responsable de dépôt', { principal: true }),
  R(26, 23, 5, 'Directeur commercial', { service: 'Commercial' }),
  R(27, 24, 6, 'Assistante ADV', { service: 'Ventes' }),
  R(28, 25, 7, "Chef d'équipe", { service: 'Chantiers' }),
  R(29, 26, 7, 'Secrétaire', { service: 'Administration' }),
  R(30, 27, 38, 'Gérant', { principal: true }),
  R(31, 29, 39, 'Directeur du patrimoine', { principal: true, service: 'Patrimoine' }),
  R(32, 28, 39, "Chargée d'opérations", { service: 'Maîtrise d\'ouvrage' }),
  R(33, 30, 41, 'Gérant', { principal: true }),
  R(34, 31, 42, 'Commerciale', { principal: true }),
  R(35, 32, 40, 'Chef d\'atelier', { principal: true }),
  R(36, 33, 40, 'Comptable', { service: 'Comptabilité' }),
  R(37, 32, 37, 'Ancien responsable technique', { actif: false, fin: '2024-12-31' }),
];

export const LIENS = [
  { id: 1, per_id: 6, cible_id: 5, tli_code: 'FACTURER_A', commentaire: 'Factures émises par la société', debut: null, fin: null },
  { id: 2, per_id: 14, cible_id: 16, tli_code: 'MANDATAIRE', commentaire: 'Mandat de gestion des travaux', debut: '2026-01-01', fin: null },
  { id: 3, per_id: 7, cible_id: 20, tli_code: 'ASSURE_PAR', commentaire: 'Décennale et RC pro', debut: null, fin: null },
  { id: 4, per_id: 1, cible_id: 19, tli_code: 'BANQUE', commentaire: null, debut: null, fin: null },
  { id: 5, per_id: 21, cible_id: 7, tli_code: 'PARTENAIRE', commentaire: 'Groupement pour les façades', debut: null, fin: null },
  { id: 6, per_id: 9, cible_id: 28, tli_code: 'FACTURER_A', commentaire: 'Factures des agences émises par LocaPro Location', debut: null, fin: null },
  { id: 7, per_id: 41, cible_id: 7, tli_code: 'PARTENAIRE', commentaire: 'Groupement ZAC des Gaulnes (lot technique)', debut: '2026-03-01', fin: null },
  { id: 8, per_id: 38, cible_id: 20, tli_code: 'ASSURE_PAR', commentaire: 'Décennale', debut: null, fin: null },
];

// Coordonnées et usages : chaque coordonnée est stockée une fois ; ses usages la relient aux fiches.
export const COORDONNEES = [];
export const USAGES = [];
const adresse = (ligne1, code_postal, ville, extra = {}) => ({ nature: 'ADRESSE', ligne1, ligne2: null, ligne3: null, code_postal, ville, pays: 'FR', ...extra });
const tel = (valeur) => ({ nature: 'TELEPHONE', valeur });
const mail = (valeur) => ({ nature: 'EMAIL', valeur });
const web = (valeur, reseau = null) => ({ nature: 'WEB', valeur, reseau });

/** Nouvelle coordonnée ; renvoie son identifiant. */
function coo(c) {
  const id = COORDONNEES.length + 1;
  COORDONNEES.push({ id, nature: c.nature, valeur: c.valeur ?? null, ligne1: c.ligne1 ?? null, ligne2: c.ligne2 ?? null, ligne3: c.ligne3 ?? null,
    code_postal: c.code_postal ?? null, ville: c.ville ?? null, pays: c.pays ?? null, reseau: c.reseau ?? null, modifie_le: '2026-01-05T09:00:00.000Z', modifie_par: 'demo' });
  return id;
}
/** Usage d'une coordonnée par une fiche ({ per }, { ind } ou { rat }), principal si premier de sa nature. */
function usage(cooId, fiche, usage, { libelle = null } = {}) {
  const nature = COORDONNEES[cooId - 1].nature;
  const cle = fiche.per ? ['per_id', fiche.per] : fiche.ind ? ['ind_id', fiche.ind] : ['rat_id', fiche.rat];
  const memes = USAGES.filter((u) => u[cle[0]] === cle[1] && COORDONNEES[u.coo_id - 1].nature === nature);
  USAGES.push({ id: USAGES.length + 1, coo_id: cooId, per_id: null, ind_id: null, rat_id: null, [cle[0]]: cle[1], usage, libelle, principal: memes.length === 0, ordre: memes.length });
}
const pour = (fiche, ...lignes) => lignes.forEach(([c, u, o]) => usage(typeof c === 'number' ? c : coo(c), fiche, u, o));

// Société de la base et ses agences ; l'adresse du siège sert aussi d'adresse de facturation du dépôt (partagée).
const siegeNotre = coo(adresse('15 rue de la République', '69002', 'Lyon'));
pour({ per: 1 }, [siegeNotre, 'SIEGE'], [tel('04 78 00 00 00'), 'STANDARD'], [mail('contact@logibtp-demo.fr'), 'PRO'], [mail('factures@logibtp-demo.fr'), 'FACTURATION'],
  [web('https://www.logibtp-demo.fr'), 'SITE'], [web('https://www.linkedin.com/company/logibtp-demo', 'LINKEDIN'), 'RESEAU']);
pour({ per: 2 }, [adresse('8 avenue Alsace-Lorraine', '38000', 'Grenoble'), 'PRINCIPALE'], [tel('04 76 00 00 00'), 'STANDARD'], [mail('grenoble@logibtp-demo.fr'), 'PRO']);
pour({ per: 3 }, [adresse('ZI des Grandes Terres, 12 rue du Dauphiné', '69200', 'Vénissieux'), 'PRINCIPALE'], [siegeNotre, 'FACTURATION'], [tel('04 72 50 00 00'), 'FIXE']);
// Groupe, société et établissement : le siège de la société est aussi celui du groupe (partagé).
const siegeMra = coo(adresse('40 boulevard Vivier-Merle', '69003', 'Lyon'));
pour({ per: 4 }, [siegeMra, 'SIEGE'], [web('https://www.groupe-negoce-rhone.example'), 'SITE']);
pour({ per: 5 }, [siegeMra, 'SIEGE'], [tel('04 72 10 20 30'), 'STANDARD'], [mail('commandes@mra.example'), 'COMMANDE'], [mail('compta.fournisseurs@mra.example'), 'FACTURATION']);
pour({ per: 6 }, [adresse('112 avenue Jean-Jaurès', '69007', 'Lyon'), 'PRINCIPALE'], [tel('04 78 61 00 00'), 'STANDARD'], [mail('gerland@mra.example'), 'COMMANDE']);
pour({ per: 7 }, [adresse('3 rue des Artisans', '69800', 'Saint-Priest'), 'SIEGE'], [tel('04 72 23 45 67'), 'FIXE'], [mail('contact@electricite-ra.example'), 'PRO']);
pour({ per: 8 }, [adresse('27 chemin des Vignes', '69340', 'Francheville'), 'SIEGE'], [tel('04 78 59 12 34'), 'FIXE'], [mail('plomberie.dupuis@exemple.fr'), 'PRO']);
pour({ per: 9 }, [adresse('5 rue de l\'Industrie', '69800', 'Saint-Priest'), 'PRINCIPALE'], [tel('04 72 90 80 70'), 'STANDARD'], [mail('lyon-est@locapro.example'), 'COMMANDE']);
pour({ per: 25 }, [adresse('12 rue de la Résistance', '42000', 'Saint-Étienne'), 'PRINCIPALE'], [tel('04 77 00 00 00'), 'STANDARD'], [mail('saint-etienne@logibtp-demo.fr'), 'PRO']);
pour({ per: 26 }, [adresse('6 avenue Alsace-Lorraine', '01000', 'Bourg-en-Bresse'), 'PRINCIPALE'], [tel('04 74 00 00 10'), 'STANDARD'], [mail('bourg@logibtp-demo.fr'), 'PRO']);
// Groupe LocaPro : siège du groupe partagé avec la société ; e-mail de facturation de la société partagé par les agences.
const siegeLocapro = coo(adresse('2 rue des Frères-Lumière', '69680', 'Chassieu'));
const factLocapro = coo(mail('factures@locapro.example'));
pour({ per: 27 }, [siegeLocapro, 'SIEGE'], [web('https://www.locapro.example'), 'SITE'], [web('https://www.linkedin.com/company/locapro', 'LINKEDIN'), 'RESEAU']);
pour({ per: 28 }, [siegeLocapro, 'SIEGE'], [tel('04 72 47 00 00'), 'STANDARD'], [mail('contact@locapro.example'), 'PRO'], [factLocapro, 'FACTURATION']);
usage(factLocapro, { per: 9 }, 'FACTURATION');
pour({ per: 29 }, [adresse('48 avenue de la République', '69160', 'Tassin-la-Demi-Lune'), 'PRINCIPALE'], [tel('04 78 34 00 00'), 'STANDARD'], [mail('lyon-ouest@locapro.example'), 'COMMANDE'], [factLocapro, 'FACTURATION']);
pour({ per: 30 }, [adresse('15 rue Jean-Pain', '38100', 'Grenoble'), 'PRINCIPALE'], [tel('04 76 22 00 00'), 'STANDARD'], [mail('grenoble@locapro.example'), 'COMMANDE'], [factLocapro, 'FACTURATION']);
pour({ per: 31 }, [adresse('80 rue de la Montat', '42100', 'Saint-Étienne'), 'PRINCIPALE'], [tel('04 77 33 00 00'), 'STANDARD'], [mail('saint-etienne@locapro.example'), 'COMMANDE'], [factLocapro, 'FACTURATION']);
pour({ per: 32 }, [adresse('3 route de Riottier', '69400', 'Villefranche-sur-Saône'), 'PRINCIPALE'], [tel('04 74 62 00 00'), 'STANDARD'], [mail('villefranche@locapro.example'), 'COMMANDE'], [factLocapro, 'FACTURATION']);
pour({ per: 33 }, [adresse('210 avenue des Landiers', '73000', 'Chambéry'), 'PRINCIPALE'], [tel('04 79 69 00 00'), 'STANDARD'], [mail('chambery@locapro.example'), 'COMMANDE'], [factLocapro, 'FACTURATION']);
pour({ per: 34 }, [adresse('ZI Mi-Plaine, 9 rue Ferdinand-Perrier', '69800', 'Saint-Priest'), 'PRINCIPALE'], [tel('04 72 90 80 79'), 'FIXE'], [adresse('ZI Mi-Plaine, quai 4', '69800', 'Saint-Priest'), 'LIVRAISON']);
pour({ per: 35 }, [adresse('31 rue Marcel-Mérieux', '69960', 'Corbas'), 'PRINCIPALE'], [tel('04 72 50 70 70'), 'FIXE']);
pour({ per: 36 }, [adresse('7 avenue de Grugliasco', '38130', 'Échirolles'), 'PRINCIPALE'], [tel('04 76 09 00 00'), 'FIXE']);
pour({ per: 37 }, [adresse('2 rue des Frères-Lumière', '69680', 'Chassieu', { ligne2: 'Bâtiment B' }), 'SIEGE'], [tel('04 72 47 10 00'), 'STANDARD'], [mail('contact@locapro-modulaires.example'), 'PRO']);
pour({ per: 38 }, [adresse('45 route de Lyon', '69440', 'Mornant'), 'SIEGE'], [tel('04 78 44 00 00'), 'FIXE'], [mail('contact@charpentes-lyonnais.example'), 'PRO'], [mail('commandes@charpentes-lyonnais.example'), 'COMMANDE']);
pour({ per: 39 }, [adresse('53 avenue Jean-Jaurès', '69007', 'Lyon'), 'SIEGE'], [adresse('Service patrimoine, 53 avenue Jean-Jaurès', '69007', 'Lyon'), 'FACTURATION'], [tel('04 72 00 30 00'), 'STANDARD']);
pour({ per: 40 }, [adresse('14 rue de l\'Artisanat', '69330', 'Meyzieu'), 'SIEGE'], [tel('04 78 31 00 00'), 'FIXE'], [mail('atelier@gplm.example'), 'PRO']);
pour({ per: 41 }, [adresse('6 rue Jacquard', '69100', 'Villeurbanne'), 'SIEGE'], [tel('04 78 93 00 00'), 'FIXE'], [mail('contact@esr-solaire.example'), 'PRO'], [web('https://www.esr-solaire.example'), 'SITE']);
pour({ per: 42 }, [adresse('ZA Les Iles, 2 rue du Lac', '74000', 'Annecy'), 'SIEGE'], [tel('04 50 00 00 00'), 'FIXE'], [mail('ventes@menuiseries-alpines.example'), 'COMMANDE']);
pour({ per: 10 }, [adresse('61 cours Gambetta', '69003', 'Lyon'), 'PRINCIPALE'], [tel('04 78 95 00 00'), 'STANDARD'], [mail('lyon@interim-btp.example'), 'PRO']);
pour({ per: 11 }, [adresse('9 quai Saint-Antoine', '69002', 'Lyon'), 'SIEGE'], [tel('04 78 42 11 22'), 'FIXE'], [mail('atelier@durand-architectes.example'), 'PRO'],
  [web('https://www.instagram.com/durand.architectes', 'INSTAGRAM'), 'RESEAU']);
pour({ per: 12 }, [adresse('18 cours Charlemagne', '69002', 'Lyon'), 'SIEGE'], [tel('04 26 00 11 22'), 'FIXE'], [mail('contact@bet-confluence.example'), 'PRO']);
pour({ per: 13 }, [adresse('25 rue Garibaldi', '69006', 'Lyon'), 'PRINCIPALE'], [tel('04 72 83 00 00'), 'STANDARD'], [mail('lyon@controle-se.example'), 'PRO']);
pour({ per: 14 }, [adresse('4 allée des Érables', '69130', 'Écully'), 'SIEGE'], [mail('sci.erables@exemple.fr'), 'PRO']);
pour({ per: 15 }, [adresse('Place de la Mairie', '69999', 'Belleroche'), 'PRINCIPALE'], [adresse('Services techniques, 2 rue de l\'Église', '69999', 'Belleroche'), 'FACTURATION'],
  [tel('04 74 00 00 00'), 'STANDARD'], [mail('mairie@belleroche.example'), 'PRO']);
pour({ per: 16 }, [adresse('77 rue de Créqui', '69006', 'Lyon'), 'SIEGE'], [tel('04 78 24 00 00'), 'STANDARD'], [web('https://www.batir-ensemble.example'), 'SITE']);
pour({ per: 19 }, [adresse('1 place des Terreaux', '69001', 'Lyon'), 'SIEGE'], [tel('04 72 00 11 00'), 'STANDARD']);
pour({ per: 20 }, [adresse('30 rue de la Bourse', '69002', 'Lyon'), 'SIEGE'], [tel('04 72 00 22 00'), 'STANDARD'], [mail('sinistres@abm.example'), 'PRO']);
pour({ per: 21 }, [adresse('Via Roma 12', '10121', 'Torino', { pays: 'IT' }), 'SIEGE'], [tel('+39 011 123 4567'), 'FIXE'], [mail('info@costruzioni-alpine.example'), 'PRO']);
pour({ per: 22 }, [adresse('8 rue de la Forge', '69120', 'Vaulx-en-Velin'), 'SIEGE'], [tel('04 78 80 00 00'), 'STANDARD'], [mail('commandes@aciers-du-rhone.example'), 'COMMANDE']);
pour({ per: 23 }, [adresse('14 avenue de l\'Europe', '69140', 'Rillieux-la-Pape'), 'SIEGE'], [tel('04 78 88 00 00'), 'STANDARD']);
pour({ per: 24 }, [adresse('2 quai Fillon', '69200', 'Vénissieux'), 'SIEGE'], [tel('04 72 89 00 00'), 'STANDARD']);

// Antoine Abel : coordonnées personnelles partagées avec son compte particulier (même identifiant), coordonnées
// professionnelles portées par son rattachement à l'établissement de Gerland.
const domicileAbel = coo(adresse('8 impasse des Lilas', '69100', 'Villeurbanne'));
const portableAbel = coo(tel('06 98 76 54 32'));
const mailAbel = coo(mail('antoine.abel@exemple.fr'));
pour({ ind: 1 }, [domicileAbel, 'PERSONNELLE'], [portableAbel, 'PORTABLE'], [mailAbel, 'PERSO']);
pour({ per: 17 }, [domicileAbel, 'PRINCIPALE'], [portableAbel, 'PORTABLE'], [mailAbel, 'PERSO']);
pour({ rat: 1 }, [tel('06 12 34 56 78'), 'PORTABLE', { libelle: 'Portable professionnel' }], [mail('a.abel@mra.example'), 'PRO'], [tel('04 78 61 00 12'), 'PRO', { libelle: 'Ligne directe' }]);
// Claire Durand : domicile partagé avec son compte particulier.
const domicileDurand = coo(adresse('21 rue Paul-Bert', '69003', 'Lyon'));
const portableDurand = coo(tel('07 11 22 33 44'));
pour({ ind: 2 }, [domicileDurand, 'PERSONNELLE'], [portableDurand, 'PORTABLE'], [mail('claire.durand@exemple.fr'), 'PERSO']);
pour({ per: 18 }, [domicileDurand, 'PRINCIPALE'], [portableDurand, 'PORTABLE']);
// Salariés : coordonnées professionnelles sur le rattachement à la société ; standard de la société partagé.
pour({ rat: 4 }, [mail('jp.martin@logibtp-demo.fr'), 'PRO'], [tel('06 01 02 03 04'), 'PORTABLE']);
pour({ rat: 5 }, [mail('s.bernard@logibtp-demo.fr'), 'PRO'], [tel('06 11 12 13 14'), 'PORTABLE']);
pour({ rat: 6 }, [mail('k.haddad@logibtp-demo.fr'), 'PRO'], [tel('04 78 00 00 12'), 'PRO', { libelle: 'Ligne directe' }]);
pour({ rat: 7 }, [mail('l.petit@logibtp-demo.fr'), 'PRO'], [tel('06 21 22 23 24'), 'PORTABLE']);
pour({ rat: 18 }, [tel('06 31 32 33 34'), 'PORTABLE']);
pour({ ind: 7 }, [tel('06 45 45 45 45'), 'PORTABLE'], [adresse('3 rue Paul-Verlaine', '69100', 'Villeurbanne'), 'PERSONNELLE']);
pour({ rat: 9 }, [tel('06 70 10 20 30'), 'PORTABLE'], [mail('n.roux@electricite-ra.example'), 'PRO']);
pour({ rat: 10 }, [tel('06 70 40 50 60'), 'PORTABLE']);
pour({ rat: 11 }, [mail('e.durand@durand-architectes.example'), 'PRO'], [tel('06 80 11 22 33'), 'PORTABLE']);
pour({ rat: 12 }, [mail('h.lambert@bet-confluence.example'), 'PRO']);
pour({ rat: 13 }, [mail('i.moreau@belleroche.example'), 'PRO'], [tel('04 74 00 00 12'), 'PRO', { libelle: 'Secrétariat' }]);
// Paul Garnier : rattaché à 2 personnes, avec des coordonnées distinctes ; même portable (partagé) pour les deux.
const portableGarnier = coo(tel('06 55 44 33 22'));
pour({ rat: 14 }, [mail('gestion@sci-erables.example'), 'PRO'], [portableGarnier, 'PORTABLE']);
pour({ rat: 15 }, [mail('p.garnier@batir-ensemble.example'), 'PRO'], [portableGarnier, 'PORTABLE'], [tel('04 78 24 00 15'), 'PRO', { libelle: 'Ligne directe' }]);
pour({ rat: 16 }, [mail('j.fontaine@mra.example'), 'PRO'], [tel('04 72 10 20 35'), 'PRO']);
pour({ rat: 17 }, [mail('g.rossi@costruzioni-alpine.example'), 'PRO'], [tel('+39 333 123 4567'), 'PORTABLE']);

// Contacts multiples : coordonnées professionnelles par rattachement (Yanis Benali : même portable pour ses 2 agences).
const portableBenali = coo(tel('06 60 70 80 90'));
pour({ rat: 19 }, [mail('o.chevalier@locapro.example'), 'PRO'], [tel('06 60 10 20 30'), 'PORTABLE']);
pour({ rat: 20 }, [mail('adv@locapro.example'), 'PRO'], [tel('04 72 47 00 05'), 'PRO', { libelle: 'Ligne directe' }]);
pour({ rat: 21 }, [mail('c.robin@locapro.example'), 'PRO'], [tel('06 60 11 22 33'), 'PORTABLE']);
pour({ rat: 22 }, [mail('y.benali@locapro.example'), 'PRO'], [portableBenali, 'PORTABLE']);
pour({ rat: 23 }, [mail('y.benali@locapro.example'), 'PRO'], [portableBenali, 'PORTABLE']);
pour({ rat: 24 }, [mail('l.mercier@locapro.example'), 'PRO'], [tel('06 60 44 55 66'), 'PORTABLE']);
pour({ rat: 25 }, [tel('06 60 77 88 99'), 'PORTABLE'], [mail('depot.saint-priest@locapro.example'), 'PRO']);
pour({ rat: 26 }, [mail('r.fabre@mra.example'), 'PRO'], [tel('06 71 00 00 01'), 'PORTABLE']);
pour({ rat: 27 }, [mail('adv.gerland@mra.example'), 'PRO'], [tel('04 78 61 00 15'), 'PRO', { libelle: 'Ligne directe' }]);
pour({ rat: 28 }, [tel('06 71 00 00 02'), 'PORTABLE']);
pour({ rat: 29 }, [mail('secretariat@electricite-ra.example'), 'PRO']);
pour({ rat: 30 }, [mail('p.vidal@charpentes-lyonnais.example'), 'PRO'], [tel('06 71 00 00 03'), 'PORTABLE']);
pour({ rat: 31 }, [mail('b.leclerc@rhone-habitat.example'), 'PRO'], [tel('04 72 00 30 12'), 'PRO', { libelle: 'Secrétariat' }]);
pour({ rat: 32 }, [mail('a.masson@rhone-habitat.example'), 'PRO'], [tel('06 71 00 00 04'), 'PORTABLE']);
pour({ rat: 33 }, [mail('f.marchand@esr-solaire.example'), 'PRO'], [tel('06 71 00 00 05'), 'PORTABLE']);
pour({ rat: 34 }, [mail('m.roche@menuiseries-alpines.example'), 'PRO'], [tel('06 71 00 00 06'), 'PORTABLE']);
pour({ rat: 35 }, [tel('06 71 00 00 07'), 'PORTABLE']);
pour({ rat: 36 }, [mail('compta@gplm.example'), 'PRO']);

/** Agences de notre société (personnes) par agence des salariés de démonstration. */
export const AGENCES_SALARIES = { Lyon: 1, Grenoble: 2, 'Saint-Étienne': 25, 'Bourg-en-Bresse': 26 };

/** Fournisseurs des tarifs de la bibliothèque de démonstration : tfo_tiers_id. */
export const TIERS_TARIFS = { 'Aciers du Rhône': 22, 'Métal Distribution': 23, 'Béton Lyonnais': 24, 'Matériaux Rhône-Alpes': 5 };
