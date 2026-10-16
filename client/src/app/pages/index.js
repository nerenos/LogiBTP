import { PageAccueil } from './accueil.js';
import { PageListe } from './liste.js';
import { PageFiche } from './fiche.js';
import { PageDocument } from './document.js';
import { PageGed } from './ged.js';
import { PageParametres } from './parametres.js';
import { PageParametresBibliotheque } from './parametres-bibliotheque.js';
import { PageParametresAnnuaire, PageNotreSociete } from './parametres-annuaire.js';
import { PageParametresDocuments } from './parametres-documents.js';
import { PageParametresGed } from './parametres-ged.js';
import { PageParametresRaccourcis } from './parametres-raccourcis.js';
import { PageGraphe } from './graphe.js';
import { PageIntrouvable } from './introuvable.js';
import { PageImportOptim } from './import-optim.js';

// Routes de l'application. Chaque URL désigne un écran précis : elle se partage, se rouvre dans une autre fenêtre
// et sert à restaurer la session.
export const ROUTES = [
  { nom: 'accueil', chemin: '/', page: PageAccueil, titre: 'Accueil' },
  { nom: 'liste', chemin: '/liste/:theme?', page: PageListe, titre: 'Listes' },
  { nom: 'fiche', chemin: '/fiche/:type/:id', page: PageFiche, titre: 'Fiche' },
  { nom: 'document', chemin: '/document/:id', page: PageDocument, titre: 'Document' },
  { nom: 'ged', chemin: '/ged/:id?', page: PageGed, titre: 'Documents (GED)' },
  { nom: 'parametres', chemin: '/parametres', page: PageParametres, titre: 'Paramètres' },
  { nom: 'parametres-bibliotheque', chemin: '/parametres/bibliotheque', page: PageParametresBibliotheque, titre: 'Paramétrage de la bibliothèque' },
  { nom: 'parametres-annuaire', chemin: '/parametres/annuaire', page: PageParametresAnnuaire, titre: 'Paramétrage de l\'annuaire' },
  { nom: 'parametres-documents', chemin: '/parametres/documents', page: PageParametresDocuments, titre: 'Paramétrage des documents' },
  { nom: 'parametres-ged', chemin: '/parametres/ged', page: PageParametresGed, titre: 'Paramétrage de la GED' },
  { nom: 'parametres-raccourcis', chemin: '/parametres/raccourcis', page: PageParametresRaccourcis, titre: 'Raccourcis clavier' },
  { nom: 'graphe', chemin: '/annuaire/graphe', page: PageGraphe, titre: 'Graphe des relations' },
  { nom: 'notre-societe', chemin: '/annuaire/societe', page: PageNotreSociete, titre: 'Notre société' },
  { nom: 'import-optim', chemin: '/import/optimbtp', page: PageImportOptim, titre: "Import d'un devis OptimBTP" },
  { nom: '404', chemin: '/404', page: PageIntrouvable, titre: 'Page introuvable' },
];
