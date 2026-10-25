import { declarerRaccourcis } from '@logibtp/socle/ui';

// Fonctions de l'application qui acceptent un raccourci clavier (personnalisable : /parametres/raccourcis). Les
// raccourcis de la grille des lignes sont déclarés par le socle (groupe grille). Une fonction sans touche par défaut
// peut recevoir la sienne.

declarerRaccourcis('application', {
  libelle: 'Toute l\'application',
  actions: {
    enregistrer: { libelle: 'Enregistrer la page', defaut: 'Ctrl+S' },
    fenetres: { libelle: 'Fenêtres ouvertes', defaut: 'Ctrl+Shift+F' },
    accueil: { libelle: 'Accueil', defaut: [] },
    retour: { libelle: 'Page précédente', defaut: [] },
    precedente: { libelle: 'Fiche précédente de la liste', defaut: 'Alt+PageUp' },
    suivante: { libelle: 'Fiche suivante de la liste', defaut: 'Alt+PageDown' },
    parametres: { libelle: 'Paramètres', defaut: [] },
    raccourcis: { libelle: 'Personnaliser les raccourcis', defaut: [] },
  },
});

declarerRaccourcis('document', {
  libelle: 'Page document',
  actions: {
    ongletEntete: { libelle: 'Onglet Entête', defaut: 'Alt+1' },
    ongletLignes: { libelle: 'Onglet Lignes', defaut: 'Alt+2' },
    ongletAnalyse: { libelle: 'Onglet Analyse', defaut: 'Alt+3' },
    ongletPieces: { libelle: 'Onglet Pièces', defaut: 'Alt+4' },
    ongletTracabilite: { libelle: 'Onglet Traçabilité', defaut: 'Alt+5' },
    ongletSuivi: { libelle: 'Onglet Suivi (CRM)', defaut: 'Alt+6' },
    rechercher: { libelle: 'Rechercher dans les lignes', defaut: 'Ctrl+F' },
    valider: { libelle: 'Valider le document', defaut: [] },
    transformer: { libelle: 'Transformer le document', defaut: [] },
    bibliotheque: { libelle: 'Ouvrir la bibliothèque', defaut: [] },
    apercu: { libelle: 'Aperçu et impression', defaut: 'Ctrl+P' },
  },
});

declarerRaccourcis('planning', {
  libelle: 'Planning',
  actions: {
    annuler: { libelle: 'Annuler la dernière opération', defaut: 'Ctrl+Z' },
    retablir: { libelle: 'Rétablir', defaut: 'Ctrl+Y' },
    supprimer: { libelle: 'Supprimer la tâche sélectionnée', defaut: 'Delete' },
    dupliquer: { libelle: 'Dupliquer la tâche sélectionnée', defaut: 'Ctrl+D' },
    actualiser: { libelle: 'Actualiser le planning', defaut: [] },
  },
});

declarerRaccourcis('pointage', {
  libelle: 'Saisie des pointages (tableau)',
  actions: {
    caseSuivante: { libelle: 'Case suivante (fin de ligne : ligne suivante, fin du tableau : nouvelle ligne)', defaut: 'Enter' },
    casePrecedente: { libelle: 'Case précédente', defaut: 'Shift+Enter' },
    ligneDessus: { libelle: 'Même jour, ligne du dessus', defaut: 'ArrowUp' },
    ligneDessous: { libelle: 'Même jour, ligne du dessous', defaut: 'ArrowDown' },
    nouvelleLigne: { libelle: 'Nouvelle ligne reprenant chantier, ordre et type', defaut: 'Ctrl+Enter' },
    dupliquer: { libelle: 'Dupliquer la ligne avec ses durées', defaut: 'Ctrl+D' },
    recopierSemaine: { libelle: 'Recopier la durée sur les jours suivants jusqu\'au vendredi', defaut: 'Alt+Enter' },
    supprimerLigne: { libelle: 'Retirer la ligne', defaut: 'Ctrl+Delete' },
    completerLigne: { libelle: 'Compléter la ligne : heures par défaut du salarié moins les heures déjà saisies du jour', defaut: 'Ctrl+Shift+Enter' },
  },
});

/** Onglet de la page document désigné par une action. */
export const ONGLETS_DOCUMENT = { ongletEntete: 'entete', ongletLignes: 'lignes', ongletAnalyse: 'analyse', ongletPieces: 'pieces', ongletTracabilite: 'tracabilite', ongletSuivi: 'suivi' };
