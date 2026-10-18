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
import '@logibtp/annuaire/ui/annuaire.css';
import '@logibtp/entreprises-fr/ui/entreprises.css';
import './styles.css';
import { Application } from './app/application.js';

// Application web LogiBTP : accueil, bandeau à menus, pages (listes, fiches, documents, GED, paramètres),
// fenêtres séparées et session restaurable (module Navigation).
const app = new Application();
// Débogage en développement uniquement.
if (import.meta.env.DEV) window.__logibtp = app;
app.demarrer().catch((e) => app.erreur(e));
