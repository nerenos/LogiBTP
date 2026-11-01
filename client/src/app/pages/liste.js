import { texte, icone } from '@logibtp/socle/dictionnaire';
import { urlDocument, urlFiche, TYPE_FICHE, MODULE_FACULTATIF, SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { ListeDonnees } from '@logibtp/liste/ui';
import { PanneauArbres } from '@logibtp/bibliotheque/ui';
import { SOURCES_LISTE } from '../vues-liste.js';
import { FiltreRattachement, NIVEAUX } from '../structure/filtre-rattachement.js';
import { groupesThemes } from '../navigation/menus.js';
import { api } from '../api.js';
import { marquerArticles } from '../stock/marquer.js';
import { memoriserSuite } from '../suite-liste.js';
import { transformerDocument } from '../documents/transformation.js';

/** Bouton de création proposé par la liste, d'après la source de la vue ouverte. */
function creationDepuisVue(vue, app, themes = []) {
  const source = vue?.definition?.source?.vue;
  // Documents (en ligne) : premier type du thème (Commandes clients → commande client).
  if (source === 'documents') {
    const type = themes.find((t) => t.thl_code === vue.definition.theme)?.thl_types?.[0];
    if (!type) return null;
    return { libelle: `${icone('ajouter')} ${type.libelle}`, action: () => app.naviguer(`/document/nouveau?type=${encodeURIComponent(type.code)}`) };
  }
  // Structure des affaires : fiches projet, affaire, chantier, marché.
  const structure = { projets: 'projet', affaires: 'affaire', chantiers: 'chantier', marches: 'marche', marches_st: 'marche' }[source];
  if (structure) return { libelle: `${icone('ajouter')} ${texte(`pages_btp.liste.creer.${structure}`)}`, action: () => app.naviguer(`/fiche/${structure}/nouveau`) };
  if (source === 'elements') {
    const type = (vue.definition.filtres ?? []).find((f) => f.colonne === 'type' && ['OUVRAGE', 'ENSEMBLE'].includes(f.valeur))?.valeur ?? null;
    const libelle = `${icone('ajouter')} ${texte(`pages_btp.liste.creer.${['OUVRAGE', 'ENSEMBLE'].includes(type) ? type : 'ARTICLE'}`)}`;
    return { libelle, action: () => app.naviguer(`/fiche/element/nouveau${type ? `?type=${type}` : ''}`) };
  }
  // Annuaire : création avec la première relation (casquette) filtrée par la vue (Clients, Fournisseurs…).
  if (source === 'personnes') {
    const casquette = (vue.definition.filtres ?? []).find((f) => f.colonne === 'casquettes')?.valeurs?.[0];
    return { libelle: `${icone('ajouter')} ${texte(`pages_btp.liste.creer.${'personne'}`)}`, action: () => app.naviguer(`/fiche/personne/nouveau${casquette ? `?casquette=${casquette}` : ''}`) };
  }
  if (source === 'individus') return { libelle: `${icone('ajouter')} ${texte(`pages_btp.liste.creer.${'individu'}`)}`, action: () => app.naviguer('/fiche/individu/nouveau') };
  const type = { salaries: 'salarie', materiels: 'materiel' }[source];
  if (!type) return null;
  return { libelle: `${icone('ajouter')} ${texte(`pages_btp.liste.creer.${type === TYPE_FICHE.SALARIE ? 'salarie' : 'materiel'}`)}`, action: () => app.naviguer(`/fiche/${type}/nouveau`) };
}

/** Fiche de chaque source de liste (thèmes d'un seul type de fiche). */
const FICHE_PAR_SOURCE = {
  salaries: 'salarie', materiels: 'materiel', elements: 'element', personnes: 'personne', individus: 'individu',
  projets: 'projet', affaires: 'affaire', chantiers: 'chantier', marches: 'marche', marches_st: 'marche',
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
    return {
      consulter,
      copier: async (l) => {
        const rep = await api.copier(l._id);
        const id = rep.document?.ent_id ?? rep.ent_id;
        app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [id], cree: true });
        app.message(texte('pages_btp.liste.copie', { numero: rep.document?.ent_numero ?? '' }), 'succes');
        await app.naviguer(urlDocument(id));
      },
      supprimer: app.estAdmin() ? (l) => api.supprimerDocument(l._id) : null,
      // Transformation d'un document validé (même fenêtre de choix que la page document) ; le document créé s'ouvre.
      autres: [{
        code: 'transformer', icone: icone('pages_btp_transformer'), libelle: texte('pages_btp.liste.transformer'), titre: texte('pages_btp.liste.transformer_aide'),
        actif: ([l]) => (l.verrouille ?? (l.statut ? l.statut !== 'Brouillon' : true)) !== false,
        action: async ([l], e) => {
          const cree = await transformerDocument({ entId: l._id, typeCode: l._type, numero: l.numero, objet: l.objet, message: (t, n) => app.message(t, n) });
          if (!cree) return;
          app.publier(SUJET_FENETRE.ENREGISTRE, { ids: [cree.ent_id], cree: true });
          app.message(`${cree.libelle} ${cree.ent_numero ?? ''} créé`, 'succes');
          await app.naviguer(urlDocument(cree.ent_id), { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) });
        },
      }],
    };
  }
  const type = FICHE_PAR_SOURCE[source];
  if (!type || (theme?.thl_types?.length ?? 0) > 1) return null;
  // Bibliothèque, module Stock actif : marquage en masse des articles sélectionnés.
  const marquer = type === TYPE_FICHE.ELEMENT && app.moduleActif(MODULE_FACULTATIF.STOCK) ? [{
    code: 'marquer', icone: icone('pages_btp_marquer'), libelle: texte('pages_btp.liste.marquer'), titre: texte('pages_btp.liste.marquer_aide'),
    actif: (lignes) => lignes.length > 0,
    action: async (lignes) => {
      const n = await marquerArticles(lignes.map((l) => Number(l._id)));
      if (n !== null) { app.message(texte('pages_btp.liste.marques', { nombre: n }), 'succes'); app.publier(SUJET_FENETRE.ENREGISTRE, { ids: lignes.map((l) => l._id) }); }
    },
  }] : [];
  return {
    consulter,
    copier: (l, e) => app.naviguer(`${urlFiche(type, l._id)}?copie=1`, { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) }),
    supprimer: app.estAdmin() ? (l) => services.fiche.supprimer(type, l._id) : null,
    ...(marquer.length ? { autres: marquer } : {}),
  };
}

/**
 * Liste (module Liste) : /liste/<thème>?vue=<id>[&projet=CODE&affaire=CODE&chantier=CODE&marche=CODE] (filtre par
 * rattachement : barre des listes de documents, colonnes de même nom des autres listes). Le thème et la vue choisis sont reportés dans l'URL. La page est
 * conservée quand on ouvre une fiche : au retour, elle retrouve ses lignes et sa position, puis se contrôle.
 */
export class PageListe extends PageBase {
  static conserver = true;
  icone = icone('pages_btp_liste');

  async ouvrir() {
    const app = this.app;
    this.conteneur.innerHTML = `<div class="page-liste"><div class="page-liste-filtre" hidden></div><div class="page-liste-zone"></div></div>`;
    const s = await app.services();
    // Rattachement demandé par l'adresse (raccourcis des fiches projet, affaire, chantier, marché).
    const codes = Object.fromEntries(NIVEAUX.filter((n) => this.requete[n.type]).map((n) => [n.type, this.requete[n.type]]));
    const refs = await s.structure?.referentiels().catch(() => null) ?? null;
    let premier = true;
    this.liste = new ListeDonnees(this.conteneur.querySelector('.page-liste-zone'), {
      fournisseur: s.liste,
      // Suite des lignes affichées confiée à la fenêtre : précédent / suivant dans la fiche ouverte (suite-liste.js).
      ouvrir: (l) => {
        memoriserSuite(this.liste.lignesAffichees().map((x) => app.urlElement({ id: x._id, type: x._type })), app.routeur?.cle ?? location.pathname);
        return app.ouvrirElement(l, { nouvelleFenetre: l.nouvelleFenetre });
      },
      message: (t, n) => app.message(t, n),
      // Requête manuelle : profil ADMIN, contrôlée côté serveur.
      peutRequete: app.estAdmin(),
      peutGererThemes: app.peutGererThemes(),
      // Combo des thèmes regroupée comme les menus du bandeau.
      groupeTheme: (t) => groupesThemes().get(t.thl_code) ?? null,
      creation: (vue) => creationDepuisVue(vue, app, this.liste?.themes ?? []),
      actionsElements: (vue) => actionsDepuisVue(vue, app, s, this.liste?.themes ?? []),
      // Impression de la vue (recherche en cours comprise) ou d'étiquettes (module Édition).
      actionsVue: (vue) => (vue?.vli_id ? [{
        icone: icone('pages_btp_imprimer'), libelle: texte('pages_btp.fiche.imprimer'), titre: texte('pages_btp.liste.imprimer_aide'),
        action: () => {
          const recherche = this.liste?.recherche ? `&recherche=${encodeURIComponent(this.liste.recherche)}` : '';
          app.naviguer(`/edition?source=liste&id=${vue.vli_id}${recherche}`, { nouvelleFenetre: true });
        },
      }] : []),
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
    if (this.params.theme) this.liste.theme = this.params.theme;
    // Fiche enregistrée dans cette fenêtre ou dans une autre : rafraîchissement ciblé des lignes.
    this.desabonner = [
      app.abonner(SUJET_FENETRE.ENREGISTRE, ({ ids, cree }) => (cree ? this.liste.verifier() : this.liste.rafraichirLignes(ids)).catch(() => {})),
      app.abonner(SUJET_FENETRE.THEMES, () => this.liste.chargerThemes().then(() => this.liste.chargerVues()).catch(() => {})),
    ];
    await this.liste.demarrer(this.requete.vue ? Number(this.requete.vue) : null);
  }

  #vueChoisie(theme, vue) {
    const t = this.liste.themes.find((x) => x.thl_code === theme);
    this.icone = t?.thl_icone || icone('pages_btp_liste');
    this.titre = [t?.thl_libelle, this.liste.vue?.vli_nom].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' – ') || texte('pages_btp.liste.titre');
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
