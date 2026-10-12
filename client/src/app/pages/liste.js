import { PageBase } from '@logibtp/navigation';
import { ListeDonnees } from '@logibtp/liste/ui';
import { PanneauArbres } from '@logibtp/bibliotheque/ui';
import { simulerModificationsAutres } from '../listes.js';

/** Bouton de création proposé par la liste, d'après la source de la vue ouverte. */
function creationDepuisVue(vue, app) {
  const source = vue?.definition?.source?.vue;
  if (source === 'elements') {
    const ouvrage = (vue.definition.filtres ?? []).some((f) => f.colonne === 'type' && f.valeur === 'OUVRAGE');
    return { libelle: ouvrage ? '＋ Ouvrage' : '＋ Article', action: () => app.naviguer(`/fiche/element/nouveau${ouvrage ? '?type=OUVRAGE' : ''}`) };
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

/**
 * Liste (module Liste) : /liste/<thème>?vue=<id>. Le thème et la vue choisis sont reportés dans l'URL. La page est
 * conservée quand on ouvre une fiche : au retour, elle retrouve ses lignes et sa position, puis se contrôle.
 */
export class PageListe extends PageBase {
  static conserver = true;
  icone = '📋';

  async ouvrir() {
    const app = this.app;
    this.conteneur.innerHTML = `<div class="page-liste"><div class="page-liste-zone"></div>
      <div class="liste-demo" hidden>
        <button type="button" data-action="simuler" title="Démo hors ligne : modifie, supprime et crée des matériels comme le ferait un autre poste">Simuler une modification d'un autre utilisateur</button>
        <span class="aide">Le contrôle des lignes chargées s'exécute toutes les 30 s, au retour sur la fenêtre et avec ⟳. Double-clic : ouvrir · Ctrl+double-clic : nouvelle fenêtre.</span>
      </div></div>`;
    const s = await app.services();
    this.liste = new ListeDonnees(this.conteneur.querySelector('.page-liste-zone'), {
      fournisseur: s.liste,
      ouvrir: (l) => app.ouvrirElement(l, { nouvelleFenetre: l.nouvelleFenetre }),
      message: (t, n) => app.message(t, n),
      // Requête manuelle : profil ADMIN, contrôlée côté serveur (indisponible hors ligne).
      peutRequete: app.enLigne && app.estAdmin(),
      peutGererThemes: app.peutGererThemes(),
      creation: (vue) => creationDepuisVue(vue, app),
      surVue: ({ theme, vue }) => this.#vueChoisie(theme, vue),
      // Vues de la bibliothèque : arbres des familles et des natures dans le panneau ancrable (filtres fam_id, nat_id).
      panneau: ({ vue, conteneur, liste }) => (vue.definition?.source?.vue === 'elements' ? new PanneauArbres({ conteneur, liste, fournisseur: s.bibliotheque }) : null),
    });
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
    const url = this.app.routeur.url('liste', { theme }, { vue });
    if (this.app.routeur.page === this) this.app.routeur.remplacerUrl(url);
    this.app.majPage();
  }

  async reprendre() { this.liste.verifier().catch(() => {}); }

  fermer() {
    this.desabonner?.forEach((f) => f());
    this.liste?.detruire();
  }
}
