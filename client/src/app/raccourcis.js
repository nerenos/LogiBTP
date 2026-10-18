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
    rechercher: { libelle: 'Rechercher dans les lignes', defaut: 'Ctrl+F' },
    valider: { libelle: 'Valider le document', defaut: [] },
    transformer: { libelle: 'Transformer le document', defaut: [] },
    bibliotheque: { libelle: 'Ouvrir la bibliothèque', defaut: [] },
    apercu: { libelle: 'Aperçu et impression', defaut: 'Ctrl+P' },
  },
});

/** Onglet de la page document désigné par une action. */
export const ONGLETS_DOCUMENT = { ongletEntete: 'entete', ongletLignes: 'lignes', ongletAnalyse: 'analyse', ongletPieces: 'pieces', ongletTracabilite: 'tracabilite' };
