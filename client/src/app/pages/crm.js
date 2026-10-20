import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { NATURES_NOTE, ETATS_NOTE } from '@logibtp/crm';
import { api } from '../api.js';
import { contexteCrm, iconeNature, pastilleEtat, echeanceNote, lienElement, estClose } from '../crm/crm.js';

/** Vues de la liste des notes (module CRM). */
export const VUES_CRM = [
  { code: 'mes', libelle: 'Mes tâches', aide: 'Notes dont je suis responsable, ouvertes' },
  { code: 'a_prendre', libelle: 'À prendre', aide: 'Notes en attente dans mes services : la première personne qui la prend en devient responsable' },
  { code: 'recues', libelle: 'Reçues', aide: 'Notes dont je suis destinataire' },
  { code: 'creees', libelle: 'Créées par moi', aide: 'Notes que j\'ai créées' },
  { code: 'toutes', libelle: 'Toutes', aide: 'Toutes les notes (contenu des notes privées et RGPD masqué)' },
];

/**
 * Notes du CRM : `/crm?vue=mes|a_prendre|recues|creees|toutes&etat=&nature=&srv=&recherche=`. Liste par page, triée
 * par échéance (en retard en rouge), prise en charge directe des notes à prendre, ouverture de la note.
 */
export class PageCrm extends PageBase {
  icone = '☑';

  async ouvrir() {
    const app = this.app;
    const r = this.requete;
    this.filtre = { vue: VUES_CRM.some((v) => v.code === r.vue) ? r.vue : 'mes', etat: r.etat ?? 'ouvertes', nature: r.nature ?? '', srv: r.srv ?? '', recherche: r.recherche ?? '', page: 1 };
    this.titre = VUES_CRM.find((v) => v.code === this.filtre.vue).libelle;
    if (!app.enLigne) { this.conteneur.innerHTML = '<p class="aide">Suivi (CRM) disponible en ligne seulement.</p>'; return; }
    this.ctx = await contexteCrm(app);
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">☑ Suivi</h1>
      <nav class="onglets crm-vues">${VUES_CRM.map((v) => `<button type="button" data-vue="${v.code}" title="${echapper(v.aide)}">${echapper(v.libelle)}</button>`).join('')}</nav>
      <div class="crm-filtres"><input type="search" data-recherche placeholder="Rechercher (objet, message)" value="${echapper(this.filtre.recherche)}">
        <span data-etat></span><span data-nature></span><span data-srv></span>
        <button type="button" class="principal" data-nouvelle title="Nouvelle note (Ctrl : autre fenêtre)">＋ Nouvelle note</button></div>
      ${this.ctx.individu_id ? '' : '<p class="aide">Votre identifiant de connexion n\'est relié à aucun individu de l\'annuaire (fiche individu, « Identifiant de connexion ») : « Mes tâches » et « À prendre » restent vides.</p>'}
      <div data-corps></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    this.conteneur.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => { this.filtre.vue = b.dataset.vue; this.filtre.page = 1; this.titre = VUES_CRM.find((v) => v.code === b.dataset.vue).libelle; this.charger(); }));
    const combo = (sel, options, cle, vide = true) => {
      const c = creerCombo({ options, valeur: this.filtre[cle], vide });
      c.addEventListener('change', () => { this.filtre[cle] = c.valeurCombo; this.filtre.page = 1; this.charger(); });
      $(sel).replaceWith(c);
    };
    combo('[data-etat]', [{ valeur: 'ouvertes', libelle: 'Ouvertes' }, ...ETATS_NOTE], 'etat', true);
    combo('[data-nature]', NATURES_NOTE.map((n) => ({ valeur: n.valeur, libelle: `${n.icone} ${n.libelle}` })), 'nature');
    combo('[data-srv]', this.ctx.tous_services.map((s) => ({ valeur: s.id, libelle: s.libelle })), 'srv');
    let minuterie;
    $('[data-recherche]').addEventListener('input', (e) => { clearTimeout(minuterie); minuterie = setTimeout(() => { this.filtre.recherche = e.target.value; this.filtre.page = 1; this.charger(); }, 300); });
    $('[data-nouvelle]').addEventListener('click', (e) => app.naviguer('/crm/note/nouveau', { nouvelleFenetre: e.ctrlKey || e.shiftKey }));
    this.desabonner = app.abonner('crm', () => this.charger());
    await this.charger();
  }

  urlCourante() {
    const f = this.filtre;
    if (!f) return null;
    const p = new URLSearchParams(Object.entries({ vue: f.vue, etat: f.etat === 'ouvertes' ? '' : f.etat, nature: f.nature, srv: f.srv, recherche: f.recherche }).filter(([, v]) => v !== '' && v !== null && v !== undefined));
    return `/crm?${p}`;
  }

  async reprendre() { await this.charger(); }

  fermer() { this.desabonner?.(); }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!corps) return;
    this.conteneur.querySelectorAll('[data-vue]').forEach((b) => b.classList.toggle('actif', b.dataset.vue === this.filtre.vue));
    this.app.routeur?.remplacerUrl(this.urlCourante());
    let page;
    try {
      page = await api.crm.notes({ ...this.filtre, taille: 50 });
    } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!page.notes.length) { corps.innerHTML = '<p class="aide">Aucune note.</p>'; return; }
    const pages = Math.ceil(page.total / page.taille);
    corps.innerHTML = `<table class="crm-table"><thead><tr><th></th><th>Objet</th><th>Rattachement</th><th>État</th><th>Responsable</th><th>Échéance</th><th>Créée</th><th></th></tr></thead>
      <tbody>${page.notes.map((n) => {
        const e = echeanceNote(n);
        return `<tr class="${estClose(n) ? 'discret' : ''}${n.non_lue ? ' crm-non-lue' : ''}"><td title="${echapper(n.type ?? NATURES_NOTE.find((x) => x.valeur === n.nature)?.libelle ?? '')}">${n.icone ?? iconeNature(n.nature)}</td>
          <td><a href="/crm/note/${n.id}">${n.masquee ? '🔒 ' : ''}${echapper(n.objet)}</a>${n.nb_reponses ? ` <span class="aide">💬 ${n.nb_reponses}</span>` : ''}</td>
          <td>${lienElement(n.element)}${n.nb_liens > 1 ? ` <span class="aide">+${n.nb_liens - 1}</span>` : ''}</td><td>${pastilleEtat(n)}</td>
          <td>${echapper(n.responsable ?? (n.service ? `${n.service} (à prendre)` : ''))}</td><td class="${e.classe}">${echapper(e.texte)}</td>
          <td><span class="aide">${echapper(n.cree_par)}, ${new Date(n.cree_le).toLocaleDateString('fr-FR')}</span></td>
          <td>${n.a_prendre ? `<button type="button" data-prendre="${n.id}" title="Je la prends : j'en deviens responsable">Prendre</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      <p class="aide">${page.total} note(s)${pages > 1 ? ` · page ${page.page} / ${pages} <button type="button" data-page="-1" ${page.page <= 1 ? 'disabled' : ''}>◀</button> <button type="button" data-page="1" ${page.page >= pages ? 'disabled' : ''}>▶</button>` : ''}</p>`;
    corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.crm.prendre(Number(b.dataset.prendre)); this.app.message('Note prise en charge', 'succes'); this.app.publier('crm', {}); } catch (e) { this.app.erreur(e); }
    }));
    corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { this.filtre.page += Number(b.dataset.page); this.charger(); }));
  }
}
