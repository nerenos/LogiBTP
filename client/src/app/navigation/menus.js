import { Bandeau } from '@logibtp/navigation/ui';
import { THEMES } from '@logibtp/socle/ui';

// Menus du bandeau, regroupés par classe de métier, et catalogue des raccourcis de l'accueil (tous les éléments
// de menu ayant une URL). Les menus Fenêtres et Paramètres sont construits à l'ouverture (état courant).

const L = (theme) => `/liste/${theme}`;
/** Création rapide (bouton ＋ sur la ligne du menu) : fiche ou document. */
const F = (type, titre, requete = '') => ({ url: `/fiche/${type}/nouveau${requete}`, titre });
const D = (code, titre) => ({ url: `/document/nouveau?type=${code}`, titre });

/** Menus métier (statiques). */
export const MENUS_METIER = [
  {
    code: 'ressources', libelle: '&Ressources', elements: [
      { code: 'ressources', libelle: 'Toutes les ressources', icone: '🧰', url: L('ressources'), info: 'Équipes, salariés, intérim, matériel, sous-traitants' },
      { separateur: true },
      { code: 'salaries', libelle: 'Salariés et intérimaires', icone: '👷', url: L('salaries'), creation: F('salarie', 'Nouveau salarié') },
      { code: 'materiels', libelle: 'Matériels', icone: '🚜', url: L('materiels'), creation: F('materiel', 'Nouveau matériel') },
    ],
  },
  {
    code: 'annuaire', libelle: '&Tiers', elements: [
      { code: 'tiers', libelle: 'Tous les tiers', icone: '🏢', url: '/liste/tiers?vue=20', info: 'Sociétés, établissements, particuliers…', creation: F('personne', 'Nouvelle personne (société…)') },
      { code: 'clients', libelle: 'Clients et prospects', icone: '💶', url: '/liste/tiers?vue=21', creation: F('personne', 'Nouveau client', '?casquette=CLIENT') },
      { code: 'fournisseurs', libelle: 'Fournisseurs et loueurs', icone: '📦', url: '/liste/tiers?vue=22', creation: F('personne', 'Nouveau fournisseur', '?casquette=FOURNISSEUR') },
      { code: 'sous-traitants', libelle: 'Sous-traitants, cotraitants, intérim', icone: '🤝', url: '/liste/tiers?vue=23', creation: F('personne', 'Nouveau sous-traitant', '?casquette=SOUS_TRAITANT') },
      { code: 'prescripteurs', libelle: 'Prescripteurs et maîtres d\'ouvrage', icone: '📐', url: '/liste/tiers?vue=24', creation: F('personne', 'Nouveau prescripteur', '?casquette=ARCHITECTE') },
      { separateur: true },
      { code: 'contacts', libelle: 'Contacts (individus)', icone: '👤', url: '/liste/contacts?vue=25', creation: F('individu', 'Nouvel individu (contact)') },
      { code: 'equipe-interne', libelle: 'Notre société : salariés et rôles', icone: '🎩', url: '/liste/contacts?vue=26', creation: F('individu', 'Nouvel individu') },
      { separateur: true },
      { code: 'graphe-relations', libelle: 'Graphe des relations', icone: '🕸️', url: '/annuaire/graphe', info: 'Hiérarchie, liens et contacts (depuis notre société)' },
      { code: 'notre-societe', libelle: 'Notre société', icone: '🏛️', url: '/annuaire/societe', info: 'Fiche de la société de cette base' },
      { code: 'parametrage-annuaire', libelle: 'Niveaux, relations, liens, rôles…', icone: '⚙', url: '/parametres/annuaire' },
    ],
  },
  {
    code: 'affaires', libelle: 'A&ffaires', elements: [
      { code: 'projets', libelle: 'Projets (chiffrage)', icone: '🎯', url: L('projets'), creation: F('projet', 'Nouveau projet') },
      { code: 'affaires', libelle: 'Affaires', icone: '🗂', url: L('affaires'), info: 'Regroupement de chantiers, ou affaire de gestion (frais hors chantier)', creation: F('affaire', 'Nouvelle affaire') },
      { code: 'chantiers', libelle: 'Chantiers', icone: '🏗', url: L('chantiers'), creation: F('chantier', 'Nouveau chantier') },
      { code: 'marches', libelle: 'Marchés', icone: '📜', url: L('marches'), info: 'Ouverts à la validation des commandes clients : suivi de la facturation', creation: F('marche', 'Nouveau marché') },
    ],
  },
  {
    code: 'ventes', libelle: '&Ventes', elements: [
      { code: 'devis', libelle: 'Devis', icone: '📝', url: L('devis'), creation: D('V_DEVIS', 'Nouveau devis') },
      { code: 'commandes', libelle: 'Commandes clients', icone: '🤝', url: L('commandes'), creation: D('V_COMMANDE', 'Nouvelle commande client') },
      { code: 'livraisons', libelle: 'Bons de livraison et de retour', icone: '🚚', url: L('livraisons'), creation: D('V_RECEPTION', 'Nouveau bon de livraison') },
      { code: 'situations', libelle: 'Situations de travaux', icone: '📈', url: L('situations'), creation: D('V_SITUATION', 'Nouvelle situation de travaux') },
      { code: 'factures', libelle: 'Factures, factures d\'avancement, avoirs', icone: '💶', url: L('factures'), creation: D('V_FACTURE', 'Nouvelle facture') },
      { code: 'documents', libelle: 'Tous les documents', icone: '📄', url: L('documents') },
      { code: 'reglements-clients', libelle: 'Règlements clients', icone: '💳', url: '/reglements?sens=E', info: 'Échéances, règlements, pointage et cautions (module Règlements)' },
      { separateur: true },
      { code: 'import-optim', libelle: 'Importer un devis OptimBTP', icone: '📥', url: '/import/optimbtp', info: 'Fichier .optim : lignes, prix et coefficients repris, champs non repris listés' },
    ],
  },
  {
    code: 'achats', libelle: '&Achats', elements: [
      { code: 'ddp', libelle: 'Demandes de prix (DDP)', icone: '📨', url: L('achats_ddp'), creation: D('A_DEVIS', 'Nouvelle demande de prix') },
      { code: 'commandes-fournisseurs', libelle: 'Commandes fournisseurs', icone: '📦', url: L('achats_commandes'), creation: D('A_COMMANDE', 'Nouvelle commande fournisseur') },
      { code: 'livraisons-fournisseurs', libelle: 'Bons de livraison et de retour fournisseurs', icone: '🚛', url: L('achats_livraisons'), creation: D('A_RECEPTION', 'Nouveau bon de livraison fournisseur') },
      { code: 'factures-fournisseurs', libelle: 'Factures fournisseurs', icone: '🧾', url: L('achats_factures'), creation: D('A_FACTURE', 'Nouvelle facture fournisseur') },
      { code: 'reglements-fournisseurs', libelle: 'Règlements fournisseurs', icone: '💳', url: '/reglements?sens=D', info: 'Échéances à payer, règlements émis et pointage (module Règlements)' },
    ],
  },
  {
    code: 'bibliotheque', libelle: '&Bibliothèque', elements: [
      { code: 'articles', libelle: 'Articles', icone: '🧱', url: '/liste/bibliotheque?vue=12', creation: F('element', 'Nouvel article') },
      { code: 'ouvrages', libelle: 'Ouvrages', icone: '🏗️', url: '/liste/bibliotheque?vue=13', creation: F('element', 'Nouvel ouvrage', '?type=OUVRAGE') },
      { code: 'ensembles', libelle: 'Ensembles (structures réutilisables)', icone: '🧩', url: '/liste/bibliotheque?vue=15', creation: F('element', 'Nouvel ensemble', '?type=ENSEMBLE') },
      { code: 'elements', libelle: 'Tous les éléments', icone: '📚', url: '/liste/bibliotheque?vue=14', creation: F('element', 'Nouvel article') },
      { separateur: true },
      { code: 'parametrage-bibliotheque', libelle: 'Bibliothèques, familles, natures…', icone: '⚙', url: '/parametres/bibliotheque' },
    ],
  },
  {
    code: 'documents-ged', libelle: '&Documents', elements: [
      { code: 'ged', libelle: 'GED : tous les documents', icone: '📎', url: '/ged' },
      { code: 'coffre', libelle: 'Coffre-fort', icone: '🔒', url: '/ged?coffre=1', info: 'Documents administratifs scellés' },
      { code: 'ged-liste', libelle: 'Recherche de documents (liste)', icone: '🔎', url: L('ged') },
    ],
  },
];

/** Menus complets : métier, puis Paramètres et Fenêtres (dynamiques). */
export function menus(app) {
  return [
    ...MENUS_METIER,
    {
      code: 'parametres', libelle: '&Paramètres', elements: () => [
        { code: 'preferences', libelle: 'Préférences', icone: '⚙', url: '/parametres' },
        { separateur: true, libelle: 'Affichage' },
        ...THEMES.map((t) => ({ libelle: t.libelle, icone: t.icone, coche: app.preferences.get('theme') === t.code, action: () => app.changerTheme(t.code) })),
        { separateur: true },
        { code: 'themes', libelle: 'Thèmes et vues de liste…', icone: '🗂', action: () => app.gererThemes(), desactive: !app.peutGererThemes() },
        { separateur: true, libelle: 'Fiches' },
        { libelle: 'Fiche salarié : champs…', icone: '👷', action: () => app.parametrerFiche('salarie'), desactive: !app.estAdmin() },
        { libelle: 'Fiche matériel : champs…', icone: '🚜', action: () => app.parametrerFiche('materiel'), desactive: !app.estAdmin() },
        { libelle: 'Fiche élément : données techniques…', icone: '📚', action: () => app.parametrerFiche('element'), desactive: !app.estAdmin() },
        { libelle: 'Fiche personne : champs…', icone: '🏢', action: () => app.parametrerFiche('personne'), desactive: !app.estAdmin() },
        { libelle: 'Fiche individu : champs…', icone: '👤', action: () => app.parametrerFiche('individu'), desactive: !app.estAdmin() },
        { separateur: true, libelle: 'Documents' },
        { libelle: 'Étiquettes et couleurs des lignes…', icone: '🏷', url: '/parametres/documents' },
        { libelle: 'GED : rétention et classification…', icone: '⏳', url: '/parametres/ged' },
        { separateur: true, libelle: 'Annuaire et bibliothèque' },
        { libelle: 'Annuaire : niveaux, relations, liens, rôles…', icone: '🏢', url: '/parametres/annuaire' },
        { libelle: 'Bibliothèques, familles, natures, scénarios…', icone: '⚙', url: '/parametres/bibliotheque' },
        { separateur: true },
        { code: 'raccourcis', libelle: 'Raccourcis clavier…', icone: '⌨', url: '/parametres/raccourcis' },
        { code: 'apropos', libelle: 'À propos de LogiBTP', icone: 'ℹ️', url: '/parametres#apropos', fenetre: false },
      ],
    },
    {
      code: 'fenetres', libelle: 'Fe&nêtres', elements: () => {
        const liste = app.fenetres.liste();
        return [
          ...liste.map((f) => ({
            libelle: f.titre || f.url, icone: f.icone || '🗔', coche: f.courante, info: f.courante ? 'Cette fenêtre' : f.url,
            classe: f.modifiee ? 'fenetre-modifiee' : '', titre: f.modifiee ? 'Modifications non enregistrées' : 'Mettre au premier plan',
            action: () => { if (!f.courante && !app.fenetres.focaliser(f.id)) app.message('Le navigateur ne permet pas de mettre cette fenêtre au premier plan : elle est signalée', 'avertissement'); },
          })),
          { separateur: true },
          { libelle: 'Liste des fenêtres…', icone: '🗗', raccourci: 'Ctrl+Maj+F', action: () => app.listeFenetres() },
          { libelle: 'Nouvelle fenêtre', icone: '⧉', action: () => app.naviguer(app.routeur.cle ?? '/', { nouvelleFenetre: true }), titre: 'Ouvre la page courante dans une fenêtre séparée' },
          { libelle: 'Restaurer ma session précédente', icone: '↺', action: () => app.restaurerSession(), desactive: !app.fenetres.sessionPrecedente() },
          { separateur: true },
          { libelle: 'Fermer cette fenêtre', icone: '✕', action: () => app.fermerFenetre() },
          { libelle: 'Fermer la session…', icone: '⏻', action: () => app.fermerSession(), titre: 'Ferme toutes les fenêtres ; la session pourra être restaurée depuis l\'accueil' },
        ];
      },
    },
  ];
}

/** Raccourcis proposés à l'accueil : éléments de menu métier ayant une URL. */
export function catalogueRaccourcis() {
  return [
    ...MENUS_METIER.flatMap((m) => m.elements.filter((e) => e.url && e.code).map((e) => ({ code: e.code, libelle: e.libelle, icone: e.icone, url: e.url, groupe: Bandeau.libelle(m.libelle) }))),
    { code: 'preferences', libelle: 'Préférences', icone: '⚙', url: '/parametres', groupe: 'Paramètres' },
  ];
}

export const RACCOURCIS_DEFAUT = ['tiers', 'clients', 'contacts', 'salaries', 'materiels', 'devis', 'factures', 'ged', 'coffre'];
