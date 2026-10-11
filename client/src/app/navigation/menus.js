import { Bandeau } from '@logibtp/navigation/ui';
import { THEMES } from '@logibtp/socle/ui';

// Menus du bandeau, regroupés par classe de métier, et catalogue des raccourcis de l'accueil (tous les éléments
// de menu ayant une URL). Les menus Fenêtres et Paramètres sont construits à l'ouverture (état courant).

const L = (theme) => `/liste/${theme}`;

/** Menus métier (statiques). */
export const MENUS_METIER = [
  {
    code: 'ressources', libelle: '&Ressources', elements: [
      { code: 'ressources', libelle: 'Toutes les ressources', icone: '🧰', url: L('ressources'), info: 'Équipes, salariés, intérim, matériel, sous-traitants' },
      { separateur: true },
      { code: 'salaries', libelle: 'Salariés et intérimaires', icone: '👷', url: L('salaries') },
      { code: 'nouveau-salarie', libelle: 'Nouveau salarié', icone: '＋', url: '/fiche/salarie/nouveau' },
      { separateur: true },
      { code: 'materiels', libelle: 'Matériels', icone: '🚜', url: L('materiels') },
      { code: 'nouveau-materiel', libelle: 'Nouveau matériel', icone: '＋', url: '/fiche/materiel/nouveau' },
    ],
  },
  {
    code: 'ventes', libelle: '&Ventes', elements: [
      { code: 'devis', libelle: 'Devis', icone: '📝', url: L('devis') },
      { code: 'factures', libelle: 'Factures, avoirs, situations', icone: '💶', url: L('factures') },
      { code: 'documents', libelle: 'Tous les documents', icone: '📄', url: L('documents') },
      { separateur: true },
      { code: 'devis-demo', libelle: 'Devis de démonstration', icone: '🏠', url: '/document/demo', info: 'Éditeur de devis : métrés, ouvrages, totaux' },
    ],
  },
  {
    code: 'achats', libelle: '&Achats', elements: [
      { code: 'ddp', libelle: 'Demandes de prix (DDP)', icone: '📨', url: L('achats_ddp') },
      { code: 'commandes-fournisseurs', libelle: 'Commandes fournisseurs', icone: '📦', url: L('achats_commandes') },
      { code: 'factures-fournisseurs', libelle: 'Factures fournisseurs', icone: '🧾', url: L('achats_factures') },
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
        { separateur: true },
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

export const RACCOURCIS_DEFAUT = ['salaries', 'materiels', 'devis', 'factures', 'ged', 'coffre', 'nouveau-salarie', 'devis-demo'];
