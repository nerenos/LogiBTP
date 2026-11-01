import { texte } from '@logibtp/socle/dictionnaire';
import { declarerRaccourcis } from '@logibtp/socle/ui';

// Fonctions de l'application qui acceptent un raccourci clavier (personnalisable : /parametres/raccourcis). Les
// raccourcis de la grille des lignes sont déclarés par le socle (groupe grille). Une fonction sans touche par défaut
// peut recevoir la sienne.

declarerRaccourcis('application', {
  libelle: texte('navigation_btp.raccourcis.application.groupe'),
  actions: {
    enregistrer: { libelle: texte('navigation_btp.raccourcis.application.enregistrer'), defaut: 'Ctrl+S' },
    fenetres: { libelle: texte('navigation_btp.raccourcis.application.fenetres'), defaut: 'Ctrl+Shift+F' },
    accueil: { libelle: texte('navigation_btp.raccourcis.application.accueil'), defaut: [] },
    retour: { libelle: texte('navigation_btp.raccourcis.application.retour'), defaut: [] },
    precedente: { libelle: texte('navigation_btp.raccourcis.application.precedente'), defaut: 'Alt+PageUp' },
    suivante: { libelle: texte('navigation_btp.raccourcis.application.suivante'), defaut: 'Alt+PageDown' },
    parametres: { libelle: texte('navigation_btp.raccourcis.application.parametres'), defaut: [] },
    raccourcis: { libelle: texte('navigation_btp.raccourcis.application.raccourcis'), defaut: [] },
  },
});

declarerRaccourcis('document', {
  libelle: texte('navigation_btp.raccourcis.document.groupe'),
  actions: {
    ongletEntete: { libelle: texte('navigation_btp.raccourcis.document.ongletEntete'), defaut: 'Alt+1' },
    ongletLignes: { libelle: texte('navigation_btp.raccourcis.document.ongletLignes'), defaut: 'Alt+2' },
    ongletAnalyse: { libelle: texte('navigation_btp.raccourcis.document.ongletAnalyse'), defaut: 'Alt+3' },
    ongletPieces: { libelle: texte('navigation_btp.raccourcis.document.ongletPieces'), defaut: 'Alt+4' },
    ongletTracabilite: { libelle: texte('navigation_btp.raccourcis.document.ongletTracabilite'), defaut: 'Alt+5' },
    ongletSuivi: { libelle: texte('navigation_btp.raccourcis.document.ongletSuivi'), defaut: 'Alt+6' },
    rechercher: { libelle: texte('navigation_btp.raccourcis.document.rechercher'), defaut: 'Ctrl+F' },
    valider: { libelle: texte('navigation_btp.raccourcis.document.valider'), defaut: [] },
    transformer: { libelle: texte('navigation_btp.raccourcis.document.transformer'), defaut: [] },
    bibliotheque: { libelle: texte('navigation_btp.raccourcis.document.bibliotheque'), defaut: [] },
    apercu: { libelle: texte('navigation_btp.raccourcis.document.apercu'), defaut: 'Ctrl+P' },
    notifications: { libelle: texte('navigation_btp.raccourcis.document.notifications'), defaut: 'Alt+7' },
    notificationSuivante: { libelle: texte('navigation_btp.raccourcis.document.notificationSuivante'), defaut: 'F8' },
    notificationPrecedente: { libelle: texte('navigation_btp.raccourcis.document.notificationPrecedente'), defaut: 'Shift+F8' },
  },
});

declarerRaccourcis('planning', {
  libelle: texte('navigation_btp.raccourcis.planning.groupe'),
  actions: {
    annuler: { libelle: texte('navigation_btp.raccourcis.planning.annuler'), defaut: 'Ctrl+Z' },
    retablir: { libelle: texte('navigation_btp.raccourcis.planning.retablir'), defaut: 'Ctrl+Y' },
    supprimer: { libelle: texte('navigation_btp.raccourcis.planning.supprimer'), defaut: 'Delete' },
    dupliquer: { libelle: texte('navigation_btp.raccourcis.planning.dupliquer'), defaut: 'Ctrl+D' },
    actualiser: { libelle: texte('navigation_btp.raccourcis.planning.actualiser'), defaut: [] },
  },
});

declarerRaccourcis('pointage', {
  libelle: texte('navigation_btp.raccourcis.pointage.groupe'),
  actions: {
    caseSuivante: { libelle: texte('navigation_btp.raccourcis.pointage.caseSuivante'), defaut: 'Enter' },
    casePrecedente: { libelle: texte('navigation_btp.raccourcis.pointage.casePrecedente'), defaut: 'Shift+Enter' },
    ligneDessus: { libelle: texte('navigation_btp.raccourcis.pointage.ligneDessus'), defaut: 'ArrowUp' },
    ligneDessous: { libelle: texte('navigation_btp.raccourcis.pointage.ligneDessous'), defaut: 'ArrowDown' },
    nouvelleLigne: { libelle: texte('navigation_btp.raccourcis.pointage.nouvelleLigne'), defaut: 'Ctrl+Enter' },
    dupliquer: { libelle: texte('navigation_btp.raccourcis.pointage.dupliquer'), defaut: 'Ctrl+D' },
    recopierSemaine: { libelle: texte('navigation_btp.raccourcis.pointage.recopierSemaine'), defaut: 'Alt+Enter' },
    supprimerLigne: { libelle: texte('navigation_btp.raccourcis.pointage.supprimerLigne'), defaut: 'Ctrl+Delete' },
    completerLigne: { libelle: texte('navigation_btp.raccourcis.pointage.completerLigne'), defaut: 'Ctrl+Shift+Enter' },
  },
});

/** Onglet de la page document désigné par une action. */
export const ONGLETS_DOCUMENT = { ongletEntete: 'entete', ongletLignes: 'lignes', ongletAnalyse: 'analyse', ongletPieces: 'pieces', ongletTracabilite: 'tracabilite', ongletSuivi: 'suivi' };
