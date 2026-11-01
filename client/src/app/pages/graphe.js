import { texte, texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlFiche, TYPE_FICHE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { VueGrapheAnnuaire } from '@logibtp/annuaire/ui';

/**
 * Graphe relationnel de l'annuaire en pleine page : /annuaire/graphe?type=personne&id=1&profondeur=2&contacts=1&liens=1&max=8.
 * Sans fiche : notre société. Les réglages sont reportés dans l'adresse (fenêtre séparée, session restaurée) ; recentrer
 * sur un nœud est une navigation (retour arrière possible).
 */
export class PageGraphe extends PageBase {
  icone = icone('pages_btp_graphe');

  async ouvrir() {
    const app = this.app;
    const q = this.requete;
    const s = await app.services();
    let depart = q.type && q.id ? { type: q.type, id: Number(q.id) } : null;
    if (!depart) {
      const societe = await s.annuaire.societeBase();
      if (!societe) { this.conteneur.innerHTML = `<p class="aide">${texteHtml('pages_btp.graphe.aucune')}</p>`; return; }
      depart = { type: TYPE_FICHE.PERSONNE, id: societe.id };
    }
    const resume = depart.type === TYPE_FICHE.PERSONNE ? await s.annuaire.personne(depart.id).catch(() => null) : await s.annuaire.individu(depart.id).catch(() => null);
    const libelle = resume?.raison_sociale ?? resume?.nom_complet ?? `${depart.type} ${depart.id}`;
    this.titre = texte('pages_btp.graphe.titre', { libelle });
    this.conteneur.innerHTML = `<div class="page-graphe"><h1 class="page-titre">${iconeHtml('pages_btp_graphe')} ${texteHtml('pages_btp.graphe.relations', { libelle })}</h1><div class="page-graphe-corps graphe-hote"></div></div>`;
    const reglages = {
      ...(q.profondeur ? { profondeur: Number(q.profondeur) } : {}), ...(q.contacts ? { contacts: q.contacts === '1' } : {}),
      ...(q.liens ? { liens: q.liens === '1' } : {}), ...(q.max ? { max_contacts: Number(q.max) } : {}),
    };
    const url = (d, r) => app.routeur.url('graphe', {}, { type: d.type, id: d.id, profondeur: r.profondeur, contacts: r.contacts ? 1 : 0, liens: r.liens ? 1 : 0, max: r.max_contacts });
    const referentiels = await s.annuaire.referentiels();
    this.vue = new VueGrapheAnnuaire(this.conteneur.querySelector('.page-graphe-corps'), {
      annuaire: s.annuaire, depart, referentiels, reglages, message: (t, n) => app.message(t, n),
      ouvrirFiche: ({ type, id }, e) => app.naviguer(urlFiche(type, id), { nouvelleFenetre: Boolean(e && (e.ctrlKey || e.shiftKey || e.metaKey)) }),
      recentrer: (d, r) => app.naviguer(url(d, r)),
      surReglages: (r) => app.routeur.remplacerUrl(url(depart, r)),
    });
    app.majPage();
  }
}
