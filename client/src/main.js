// Police de l'application et des éditions : Inter (OFL), livrée avec le client.
import '@fontsource-variable/inter';
import '@logibtp/socle/ui/socle.css';
import '@logibtp/document/ui/document.css';
import '@logibtp/metre/ui/metre.css';
import '@logibtp/liste/ui/liste.css';
import '@logibtp/fiche/ui/fiche.css';
import '@logibtp/ged/ui/ged.css';
import '@logibtp/navigation/ui/navigation.css';
import '@logibtp/bibliotheque/ui/bibliotheque.css';
import '@logibtp/graphe/ui/graphe.css';
import '@logibtp/planning/ui/planning.css';
import '@logibtp/execution/ui/atelier.css';
import '@logibtp/rentabilite/ui/rentabilite.css';
import '@logibtp/annuaire/ui/annuaire.css';
import '@logibtp/entreprises-fr/ui/entreprises.css';
import './styles.css';
import { observerEmojis } from '@logibtp/socle/dictionnaire';
import { chargerPersonnalisation } from './personnalisation.js';

// Application web LogiBTP : accueil, bandeau à menus, pages (listes, fiches, documents, GED, paramètres),
// fenêtres séparées et session restaurable (module Navigation).
// Textes, icônes et logo d'abord (module Personnalisation), puis l'application : importée seulement ensuite, ses
// modules (constantes comprises) s'évaluent avec le dictionnaire chargé. L'aperçu de la page quittée reste affiché.
async function demarrer() {
  await chargerPersonnalisation();
  // Shortcodes « :nom: » des textes affichés remplacés par les images fixes de images/emojis.json (§ 42).
  observerEmojis(document.body);
  const { Application } = await import('./app/application.js');
  const app = new Application();
  // Débogage en développement uniquement.
  if (import.meta.env.DEV) window.__logibtp = app;
  await app.demarrer().catch((e) => app.erreur(e));
}
demarrer().catch((e) => console.error(e));
