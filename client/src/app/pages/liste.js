import { PageBase } from '@logibtp/navigation';
import { ListeDonnees } from '@logibtp/liste/ui';
import { PanneauArbres } from '@logibtp/bibliotheque/ui';
import { simulerModificationsAutres } from '../listes.js';
import { SOURCES_LISTE } from '../vues-liste.js';
import { FiltreRattachement, NIVEAUX } from '../structure/filtre-rattachement.js';
import { api } from '../api.js';
import { transformerDocument } from '../documents/transformation.js';

/** Bouton de création proposé par la liste, d'après la source de la vue ouverte. */
function creationDepuisVue(vue, app, themes = []) {
  const source = vue?.definition?.source?.vue;
  // Documents (en ligne) : premier type du thème (Commandes clients → commande client).
  if (source === 'documents') {
    const type = themes.find((t) => t.thl_code === vue.definition.theme)?.thl_types?.[0];
    if (!type || !app.enLigne) return null;
    return { libelle: `＋ ${type.libelle}`, action: () => app.naviguer(`/document/nouveau?type=${encodeURIComponent(type.code)}`) };
  }
  // Structure des affaires : fiches projet, affaire, chantier, marché.
  const structure = { projets: ['projet', 'Projet'], affaires: ['affaire', 'Affaire'], chantiers: ['chantier', 'Chantier'], marches: ['marche', 'Marché'] }[source];
  if (structure) return { libelle: `＋ ${structure[1]}`, action: () => app.naviguer(`/fiche/${structure[0]}/nouveau`) };
  if (source === 'elements') {
    const type = (vue.definition.filtres ?? []).find((f) => f.colonne === 'type' && ['OUVRAGE', 'ENSEMBLE'].includes(f.valeur))?.valeur ?? null;
    const libelle = { OUVRAGE: '＋ Ouvrage', ENSEMBLE: '＋ Ensemble' }[type] ?? '＋ Article';
    return { libelle, action: () => app.naviguer(`/fiche/element/nouveau${type ? `?type=${type}` : ''}`) };
  }
  // Annuaire : création avec la première relation (casquette) filtrée par la vue (Clients, Fournisseurs…).
  if (source === 'personnes') {
    const casquette = (vue.definition.filtres ?? []).find((f) => f.colonne === 'casquettes')?.valeurs?.[0];
    return { libelle: '＋ Personne', action: () => app.naviguer(`/fiche/personne/nouveau${casquette ? `?casquette=${casquette}` : ''}`) };
  }
  if (source === 'individus') return { libelle: '＋ Individu', action: () => app.naviguer('/fiche/individu/nouveau') };
  const type = { salaries: 'salarie', materiels: 'materiel' }[source];
  if (!type) return null;
  return { libelle: type === 'salarie' ? '＋ Salarié' : '＋ Matériel', action: () => app.naviguer(`/fiche/${type}/nouveau`) };
}

/** Fiche de chaque source de liste (thèmes d'un seul type de fiche). */
const FICHE_PAR_SOURCE = {
  salaries: 'salarie', materiels: 'materiel', elements: 'element', personnes: 'personne', individus: 'individu',
  projets: 'projet', affaires: 'affaire', chantiers: 'chantier', marches: 'marche',
};

/**
 * Consulter, copier, supprimer les éléments sélectionnés : thème d'un seul type de fiche, ou documents (en ligne).
 * Suppression proposée au profil ADMIN (droit SUPPRIMER des fiches ; documents : droit du type, contrôlé par le serveur).
 */
function actionsDepuisVue(vue, app, services, themes = []) {
  const source = vue?.definition?.source?.vue;
  const theme = themes.find((t) => t.thl_code === vue?.definition?.theme);
  const consulter = (l, e) => app.ouvrirElement({ id: l._id, type: l._type, ligne: l }, { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) });
  if (source === 'documents') {
    if (!app.enLigne) return null;
    return {
      consulter,
      copier: async (l) => {
        const rep = await api.copier(l._id);
        const id = rep.document?.ent_id ?? rep.ent_id;
        app.publier('enregistre', { ids: [id], cree: true });
        app.message(`Copie créée : ${rep.document?.ent_numero ?? ''}`, 'succes');
        await app.naviguer(`/document/${id}`);
      },
      supprimer: app.estAdmin() ? (l) => api.supprimerDocument(l._id) : null,
      // Transformation d'un document validé (même fenêtre de choix que la page document) ; le document créé s'ouvre.
      autres: [{
        code: 'transformer', libelle: '⇢ Transformer', titre: 'Transformer le document validé (commande, livraison, situation, facture…)',
        actif: ([l]) => (l.verrouille ?? (l.statut ? l.statut !== 'Brouillon' : true)) !== false,
        action: async ([l], e) => {
          const cree = await transformerDocument({ entId: l._id, typeCode: l._type, numero: l.numero, objet: l.objet, message: (t, n) => app.message(t, n) });
          if (!cree) return;
          app.publier('enregistre', { ids: [cree.ent_id], cree: true });
          app.message(`${cree.libelle} ${cree.ent_numero ?? ''} créé`, 'succes');
          await app.naviguer(`/document/${cree.ent_id}`, { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) });
        },
      }],
    };
  }
  const type = FICHE_PAR_SOURCE[source];
  if (!type || (theme?.thl_types?.length ?? 0) > 1) return null;
  return {
    consulter,
    copier: (l, e) => app.naviguer(`/fiche/${type}/${l._id}?copie=1`, { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) }),
    supprimer: app.estAdmin() ? (l) => services.fiche.supprimer(type, l._id) : null,
  };
}

/**
 * Liste (module Liste) : /liste/<thème>?vue=<id>[&projet=CODE&affaire=CODE&chantier=CODE&marche=CODE] (filtre par
 * rattachement : barre des listes de documents, colonnes de même nom des autres listes). Le thème et la vue choisis sont reportés dans l'URL. La page est
 * conservée quand on ouvre une fiche : au retour, elle retrouve ses lignes et sa position, puis se contrôle.
 */
export class PageListe extends PageBase {
  static conserver = true;
  icone = '📋';

  async ouvrir() {
    const app = this.app;
    this.conteneur.innerHTML = `<div class="page-liste"><div class="page-liste-filtre" hidden></div><div class="page-liste-zone"></div>
      <div class="liste-demo" hidden>
        <button type="button" data-action="simuler" title="Démo hors ligne : modifie, supprime et crée des matériels comme le ferait un autre poste">Simuler une modification d'un autre utilisateur</button>
        <span class="aide">Le contrôle des lignes chargées s'exécute toutes les 30 s, au retour sur la fenêtre et avec ⟳. Double-clic : ouvrir · Ctrl+double-clic : nouvelle fenêtre.</span>
      </div></div>`;
    const s = await app.services();
    // Rattachement demandé par l'adresse (raccourcis des fiches projet, affaire, chantier, marché).
    const codes = Object.fromEntries(NIVEAUX.filter((n) => this.requete[n.type]).map((n) => [n.type, this.requete[n.type]]));
    const refs = await s.structure?.referentiels().catch(() => null) ?? null;
    let premier = true;
    this.liste = new ListeDonnees(this.conteneur.querySelector('.page-liste-zone'), {
      fournisseur: s.liste,
      ouvrir: (l) => app.ouvrirElement(l, { nouvelleFenetre: l.nouvelleFenetre }),
      message: (t, n) => app.message(t, n),
      // Requête manuelle : profil ADMIN, contrôlée côté serveur (indisponible hors ligne).
      peutRequete: app.enLigne && app.estAdmin(),
      peutGererThemes: app.peutGererThemes(),
      creation: (vue) => creationDepuisVue(vue, app, this.liste?.themes ?? []),
      actionsElements: (vue) => actionsDepuisVue(vue, app, s, this.liste?.themes ?? []),
      surVue: ({ theme, vue }) => { this.filtre?.rendre(); this.#vueChoisie(theme, vue); },
      filtresVue: (vue) => {
        if (!this.filtre) return {};
        const source = vue?.definition?.source?.vue ?? null;
        const colonnes = (SOURCES_LISTE[source]?.colonnes ?? []).map((c) => c[0]);
        const f = this.filtre.filtresPour(source, colonnes, premier ? codes : null);
        premier = false;
        return f;
      },
      // Vues de la bibliothèque : arbres des familles et des natures dans le panneau ancrable (filtres fam_id, nat_id).
      panneau: ({ vue, conteneur, liste }) => (vue.definition?.source?.vue === 'elements' ? new PanneauArbres({ conteneur, liste, fournisseur: s.bibliotheque }) : null),
      // Éléments de la bibliothèque glissables vers un document (autre fenêtre) : article ou ouvrage, même société.
      // Identifiant : _id (colonne id de la source) ; type ARTICLE / OUVRAGE par la colonne type si elle est affichée
      // (sinon article : l'élément est relu au dépôt, un ouvrage est inséré avec ses composantes).
      glisser: ({ ligne, definition }) => (definition?.source?.vue === 'elements' && ligne._id
        ? {
          type: ligne.type === 'ENSEMBLE' ? 'application/x-logibtp-ensemble' : ligne.type === 'OUVRAGE' ? 'application/x-logibtp-ouvrage' : 'application/x-logibtp-article',
          rang: { ENSEMBLE: 2, OUVRAGE: 1 }[ligne.type] ?? 0,
          valeur: { id: Number(ligne._id), code: ligne.code, bib: ligne.bib_code, type: ligne.type ?? null, societe: location.host },
          texte: `${ligne.code ?? ''} ${ligne.libelle ?? ''}`.trim(),
        }
        : null),
    });
    if (refs) {
      this.filtre = new FiltreRattachement(this.conteneur.querySelector('.page-liste-filtre'), {
        liste: this.liste, refs, surChange: () => this.#vueChoisie(this.liste.theme, this.liste.vue?.vli_id ?? null),
      });
    }
    const demo = this.conteneur.querySelector('.liste-demo');
    demo.hidden = app.enLigne;
    demo.querySelector('[data-action="simuler"]').addEventListener('click', () => app.message(simulerModificationsAutres(s.liste)));
    if (this.params.theme) this.liste.theme = this.params.theme;
    // Fiche enregistrée dans cette fenêtre ou dans une autre : rafraîchissement ciblé des lignes.
    this.desabonner = [
      app.abonner('enregistre', ({ ids, cree }) => (cree ? this.liste.verifier() : this.liste.rafraichirLignes(ids)).catch(() => {})),
      app.abonner('themes', () => this.liste.chargerThemes().then(() => this.liste.chargerVues()).catch(() => {})),
    ];
    await this.liste.demarrer(this.requete.vue ? Number(this.requete.vue) : null);
  }

  #vueChoisie(theme, vue) {
    const t = this.liste.themes.find((x) => x.thl_code === theme);
    this.icone = t?.thl_icone || '📋';
    this.titre = [t?.thl_libelle, this.liste.vue?.vli_nom].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' – ') || 'Listes';
    const url = this.app.routeur.url('liste', { theme }, { vue, ...(this.filtre?.codes() ?? {}) });
    if (this.app.routeur.page === this) this.app.routeur.remplacerUrl(url);
    this.app.majPage();
  }

  async reprendre() { this.liste.verifier().catch(() => {}); }

  fermer() {
    this.desabonner?.forEach((f) => f());
    this.liste?.detruire();
  }
}
