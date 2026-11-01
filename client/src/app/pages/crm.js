import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, lirePreferences, ecrirePreferences, formatDate } from '@logibtp/socle/ui';
import { NATURES_NOTE, ETATS_NOTE } from '@logibtp/crm';
import { api } from '../api.js';
import { contexteCrm, iconeNature, pastilleEtat, echeanceNote, lienElement, estClose } from '../crm/crm.js';

/** Vues de la liste des notes (module CRM). */
export const VUES_CRM = [
  { code: 'mes', libelle: texte('crm_btp.vues.mes.libelle'), aide: texte('crm_btp.vues.mes.aide') },
  { code: 'a_prendre', libelle: texte('crm_btp.vues.a_prendre.libelle'), aide: texte('crm_btp.vues.a_prendre.aide') },
  { code: 'recues', libelle: texte('crm_btp.vues.recues.libelle'), aide: texte('crm_btp.vues.recues.aide') },
  { code: 'creees', libelle: texte('crm_btp.vues.creees.libelle'), aide: texte('crm_btp.vues.creees.aide') },
  { code: 'toutes', libelle: texte('crm_btp.vues.toutes.libelle'), aide: texte('crm_btp.vues.toutes.aide') },
];

/**
 * Notes du CRM : `/crm?vue=mes|a_prendre|recues|creees|toutes&etat=&nature=&srv=&recherche=`. Liste par page, triée
 * par échéance (en retard en rouge), prise en charge directe des notes à prendre, ouverture de la note.
 */
export class PageCrm extends PageBase {
  icone = icone('crm_btp_suivi');

  async ouvrir() {
    const app = this.app;
    const r = this.requete;
    this.filtre = { vue: VUES_CRM.some((v) => v.code === r.vue) ? r.vue : 'mes', etat: r.etat ?? 'ouvertes', nature: r.nature ?? '', srv: r.srv ?? '', recherche: r.recherche ?? '', page: 1 };
    this.titre = VUES_CRM.find((v) => v.code === this.filtre.vue).libelle;
    this.ctx = await contexteCrm(app);
    // Panneau de gauche (vues et filtres) réductible : état gardé dans le navigateur, réduit d'office sur un petit écran.
    const prefReduit = lirePreferences().crmPanneauReduit;
    const reduit = prefReduit ?? window.matchMedia('(max-width: 900px)').matches;
    this.conteneur.innerHTML = `<div class="page-crm-taches${reduit ? ' panneau-reduit' : ''}">
      <aside class="crm-panneau">
        <div class="crm-panneau-entete"><strong>${iconeHtml('crm_btp_suivi')} ${texteHtml('crm_btp.routes.crm')}</strong><button type="button" class="discret" data-replier title="${texteHtml('crm_btp.liste.reduire')}">${iconeHtml('crm_btp_reduire')}</button></div>
        <nav class="crm-vues-liste">${VUES_CRM.map((v) => `<button type="button" data-vue="${v.code}" title="${echapper(v.aide)}">${echapper(v.libelle)}</button>`).join('')}</nav>
        <div class="crm-filtres-colonne"><label>${texteHtml('crm_btp.liste.recherche')}<input type="search" data-recherche placeholder="${texteHtml('crm_btp.liste.recherche_aide')}" value="${echapper(this.filtre.recherche)}"></label>
          <label>${texteHtml('crm_btp.liste.etat')}<span data-etat></span></label><label>${texteHtml('crm_btp.liste.nature')}<span data-nature></span></label><label>${texteHtml('crm_btp.liste.service')}<span data-srv></span></label></div>
      </aside>
      <div class="crm-principal">
        <div class="crm-filtres"><button type="button" class="crm-deplier" data-deplier title="${texteHtml('crm_btp.liste.deplier')}">${iconeHtml('crm_btp_deplier')}</button>
          <h1 class="page-titre" data-titre></h1>
          <button type="button" class="principal" data-nouvelle title="${texteHtml('crm_btp.liste.nouvelle_titre')}">${iconeHtml('ajouter')} ${texteHtml('crm_btp.liste.nouvelle')}</button></div>
        ${this.ctx.individu_id ? '' : `<p class="aide">${texteHtml('crm_btp.liste.sans_individu')}</p>`}
        <div data-corps></div></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    const racine = $('.page-crm-taches');
    const basculer = (r) => { racine.classList.toggle('panneau-reduit', r); ecrirePreferences({ crmPanneauReduit: r }); };
    $('[data-replier]').addEventListener('click', () => basculer(true));
    $('[data-deplier]').addEventListener('click', () => basculer(!racine.classList.contains('panneau-reduit')));
    this.conteneur.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => { this.filtre.vue = b.dataset.vue; this.filtre.page = 1; this.titre = VUES_CRM.find((v) => v.code === b.dataset.vue).libelle; this.charger(); }));
    const combo = (sel, options, cle, vide = true) => {
      const c = creerCombo({ options, valeur: this.filtre[cle], vide });
      c.addEventListener('change', () => { this.filtre[cle] = c.valeurCombo; this.filtre.page = 1; this.charger(); });
      $(sel).replaceWith(c);
    };
    combo('[data-etat]', [{ valeur: 'ouvertes', libelle: texte('crm_btp.liste.ouvertes') }, ...ETATS_NOTE], 'etat', true);
    combo('[data-nature]', NATURES_NOTE.map((n) => ({ valeur: n.valeur, libelle: `${n.icone} ${n.libelle}` })), 'nature');
    combo('[data-srv]', this.ctx.tous_services.map((s) => ({ valeur: s.id, libelle: s.libelle })), 'srv');
    let minuterie;
    $('[data-recherche]').addEventListener('input', (e) => { clearTimeout(minuterie); minuterie = setTimeout(() => { this.filtre.recherche = e.target.value; this.filtre.page = 1; this.charger(); }, 300); });
    $('[data-nouvelle]').addEventListener('click', (e) => app.naviguer('/crm/note/nouveau', { nouvelleFenetre: e.ctrlKey || e.shiftKey }));
    this.desabonner = app.abonner(SUJET_FENETRE.CRM, () => this.charger());
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
    const titre = this.conteneur.querySelector('[data-titre]');
    if (titre) titre.textContent = VUES_CRM.find((v) => v.code === this.filtre.vue).libelle;
    this.app.routeur?.remplacerUrl(this.urlCourante());
    let page;
    try {
      page = await api.crm.notes({ ...this.filtre, taille: 50 });
    } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!page.notes.length) { corps.innerHTML = `<p class="aide">${texteHtml('crm_btp.liste.aucune')}</p>`; return; }
    const pages = Math.ceil(page.total / page.taille);
    corps.innerHTML = `<table class="crm-table"><thead><tr><th></th><th>${texteHtml('crm_btp.liste.objet')}</th><th>${texteHtml('crm_btp.liste.rattachement')}</th><th>${texteHtml('crm_btp.liste.etat')}</th><th>${texteHtml('crm_btp.liste.responsable')}</th><th>${texteHtml('crm_btp.liste.echeance')}</th><th>${texteHtml('crm_btp.liste.creee')}</th><th></th></tr></thead>
      <tbody>${page.notes.map((n) => {
        const e = echeanceNote(n);
        return `<tr class="${estClose(n) ? 'discret' : ''}${n.non_lue ? ' crm-non-lue' : ''}"><td title="${echapper(n.type ?? NATURES_NOTE.find((x) => x.valeur === n.nature)?.libelle ?? '')}">${n.icone ?? iconeNature(n.nature)}</td>
          <td><a href="/crm/note/${n.id}">${n.masquee ? `${iconeHtml('verrou')} ` : ''}${echapper(n.objet)}</a>${n.nb_reponses ? ` <span class="aide">${iconeHtml('crm_btp_note')} ${n.nb_reponses}</span>` : ''}</td>
          <td>${lienElement(n.element)}${n.nb_liens > 1 ? ` <span class="aide">+${n.nb_liens - 1}</span>` : ''}</td><td>${pastilleEtat(n)}</td>
          <td>${echapper(n.responsable ?? (n.service ? texte('crm_btp.liste.service_a_prendre', { service: n.service }) : ''))}</td><td class="${e.classe}">${echapper(e.texte)}</td>
          <td><span class="aide">${echapper(n.cree_par)}, ${formatDate(n.cree_le)}</span></td>
          <td>${n.a_prendre ? `<button type="button" data-prendre="${n.id}" title="${texteHtml('crm_btp.liste.prendre_titre')}">${texteHtml('crm_btp.liste.prendre')}</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      <p class="aide">${echapper(pluriel('crm_btp.liste.nb_notes', page.total))}${pages > 1 ? ` · ${texteHtml('crm_btp.liste.page', { page: page.page, pages })} <button type="button" data-page="-1" ${page.page <= 1 ? 'disabled' : ''}>${iconeHtml('precedent')}</button> <button type="button" data-page="1" ${page.page >= pages ? 'disabled' : ''}>${iconeHtml('suivant')}</button>` : ''}</p>`;
    corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.crm.prendre(Number(b.dataset.prendre)); this.app.message(texte('crm_btp.liste.prise'), 'succes'); this.app.publier(SUJET_FENETRE.CRM, {}); } catch (e) { this.app.erreur(e); }
    }));
    corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { this.filtre.page += Number(b.dataset.page); this.charger(); }));
  }
}
