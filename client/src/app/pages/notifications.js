import { texte, texteHtml, textesParCode, pairesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { SUJET_FENETRE } from '../codes.js';
import { NIVEAU_NOTIFICATION } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';

const NIVEAUX = { [NIVEAU_NOTIFICATION.URGENT]: 'notifications_btp_urgent', [NIVEAU_NOTIFICATION.ATTENTION]: 'notifications_btp_attention', [NIVEAU_NOTIFICATION.INFO]: 'notifications_btp_info' };
// Modules émetteurs : libellé « notifications_btp.modules.<module> ».
const MODULES = textesParCode('notifications_btp.modules', ['crm', 'ressources', 'planning', 'execution', 'pointage', 'mail', 'oauth']);

/**
 * Boîte de notifications (module Notifications) : à traiter, non lues ou toutes, par module ; ouvrir une notification
 * la marque lue, « Traitée » la retire de la boîte ; tout marquer lu. Le compteur du bandeau suit (sujet `notifications`).
 */
export class PageNotifications extends PageBase {
  icone = icone('notifications_btp_cloche');

  urlCourante() { return `/notifications?${new URLSearchParams({ etat: this.etat, module: this.module })}`; }

  async ouvrir() {
    const app = this.app;
    this.titre = texte('notifications_btp.boite.titre');
    this.etat = this.requete.etat ?? 'a_traiter';
    this.module = this.requete.module ?? '';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('notifications_btp_cloche')} ${texteHtml('notifications_btp.boite.titre')}</h1>
      <p class="ligne">${pairesParCode('notifications_btp.boite.etats', ['a_traiter', 'non_lues', 'toutes']).map(([v, l]) => `<label class="ligne"><input type="radio" name="etat" value="${v}" ${v === this.etat ? 'checked' : ''}> ${echapper(l)}</label>`).join(' ')}
        · ${[['', texte('notifications_btp.boite.tous_modules')], ...Object.entries(MODULES)].map(([v, l]) => `<label class="ligne"><input type="radio" name="module" value="${v}" ${v === this.module ? 'checked' : ''}> ${echapper(l)}</label>`).join(' ')}</p>
      <p><button type="button" data-tout-lire>${iconeHtml('notifications_btp_tout_lire')} ${texteHtml('notifications_btp.boite.tout_lire')}</button> <a href="/parametres/notifications">${texteHtml('notifications_btp.boite.preferences')}</a>
        ${app.estAdmin() ? ` <button type="button" data-executer title="${texteHtml('notifications_btp.boite.executer_aide')}">${iconeHtml('notifications_btp_controler')} ${texteHtml('notifications_btp.boite.executer')}</button>` : ''}</p>
      <div data-liste></div></div>`;
    this.conteneur.querySelectorAll('[name="etat"]').forEach((r) => r.addEventListener('change', () => { this.etat = r.value; this.#charger(); }));
    this.conteneur.querySelectorAll('[name="module"]').forEach((r) => r.addEventListener('change', () => { this.module = r.value; this.#charger(); }));
    this.conteneur.querySelector('[data-tout-lire]').addEventListener('click', () => this.#marquer({ tout: true }, false));
    this.conteneur.querySelector('[data-executer]')?.addEventListener('click', async () => {
      try { await api.notifications.executer(); await this.#charger(); app.publier(SUJET_FENETRE.NOTIFICATIONS, {}); } catch (e) { app.erreur(e); }
    });
    this.desabonner = app.abonner(SUJET_FENETRE.NOTIFICATIONS, () => this.#charger());
    await this.#charger();
  }

  fermer() { this.desabonner?.(); }

  async #marquer(m, traitees) {
    try {
      const c = traitees ? await api.notifications.traitees(m) : await api.notifications.lues(m);
      this.app.majNotifications(c);
      await this.#charger();
    } catch (e) { this.app.erreur(e); }
  }

  async #charger() {
    const zone = this.conteneur.querySelector('[data-liste]');
    const l = await api.notifications.boite({ etat: this.etat, module: this.module }).catch((e) => { this.app.erreur(e); return []; });
    // Actions de la ligne affichées au survol ou à la sélection (clic sur la ligne), comme une liste de courriels.
    zone.innerHTML = l.length ? `<ul class="liste-notifications">${l.map((n) => `<li data-id="${n.id}" tabindex="0" class="ligne-actions-survol ${n.lue_le ? 'lue' : 'non-lue'}${n.traitee_le ? ' traitee' : ''}">
        <span class="niveau" title="${echapper(n.niveau)}">${NIVEAUX[n.niveau] ? iconeHtml(NIVEAUX[n.niveau]) : '•'}</span>
        <div class="las-corps"><b>${n.url ? `<a href="${echapper(n.url)}" data-ouvrir>${echapper(n.titre)}</a>` : echapper(n.titre)}</b>
          ${n.texte ? `<br><span class="aide">${echapper(n.texte)}</span>` : ''}<br><small class="aide">${echapper(MODULES[n.module] ?? n.module)} · ${formatDateHeure(n.cree_le)}</small></div>
        ${n.traitee_le ? `<small class="aide">${texteHtml('notifications_btp.boite.traitee')}</small>` : ''}
        <span class="las-actions">${n.lue_le ? '' : `<button type="button" class="bouton-icone" data-lue title="${texteHtml('notifications_btp.boite.marquer_lue')}" aria-label="${texteHtml('notifications_btp.boite.marquer_lue')}">${iconeHtml('notifications_btp_lue')}</button>`}
          ${n.traitee_le ? '' : `<button type="button" class="bouton-icone" data-traitee title="${texteHtml('notifications_btp.boite.marquer_traitee')}" aria-label="${texteHtml('notifications_btp.boite.marquer_traitee')}">${iconeHtml('notifications_btp_traitee')}</button>`}</span></li>`).join('')}</ul>`
      : `<p class="aide">${texteHtml('notifications_btp.boite.aucune')}</p>`;
    zone.querySelectorAll('li[data-id]').forEach((li) => {
      const id = Number(li.dataset.id);
      li.querySelector('[data-lue]')?.addEventListener('click', () => this.#marquer({ ids: [id] }, false));
      li.querySelector('[data-traitee]')?.addEventListener('click', () => this.#marquer({ ids: [id] }, true));
      li.querySelector('[data-ouvrir]')?.addEventListener('click', () => { api.notifications.lues({ ids: [id] }).then((c) => this.app.majNotifications(c)).catch(() => {}); });
      li.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        const choisie = !li.classList.contains('selection');
        zone.querySelectorAll('li.selection').forEach((x) => x.classList.remove('selection'));
        li.classList.toggle('selection', choisie);
      });
    });
  }
}

/** Préférences de notification : par module et type, à l'écran et par courriel (canal du module Mail, s'il a un compte d'envoi). */
export class PageParametresNotifications extends PageBase {
  icone = icone('notifications_btp_cloche');

  async ouvrir() {
    const app = this.app;
    this.titre = texte('notifications_btp.preferences.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">${iconeHtml('notifications_btp_cloche')} ${texteHtml('notifications_btp.preferences.titre')}</h1><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    let prefs = await api.notifications.preferences();
    const courriel = (await api.notifications.canaux().catch(() => ({}))).courriel === true;
    const rendre = () => {
      corps.innerHTML = `<p class="aide">${texteHtml('notifications_btp.preferences.aide_html', { cloche: icone('notifications_btp_cloche') })}${courriel ? '' : ` ${texteHtml('notifications_btp.preferences.sans_messagerie')}`}</p>
        <table><thead><tr><th>${texteHtml('notifications_btp.preferences.module')}</th><th>${texteHtml('notifications_btp.preferences.notification')}</th><th>${texteHtml('notifications_btp.preferences.ecran')}</th><th>${texteHtml('notifications_btp.preferences.courriel')}</th></tr></thead><tbody>
        ${prefs.map((p, i) => `<tr data-i="${i}"><td>${echapper(MODULES[p.module] ?? p.module)}</td><td>${echapper(p.libelle)}</td>
          <td><input type="checkbox" data-ecran ${p.ecran ? 'checked' : ''}></td><td><input type="checkbox" data-courriel ${p.courriel ? 'checked' : ''} ${courriel ? '' : `disabled title="${texteHtml('notifications_btp.preferences.sans_compte')}"`}></td></tr>`).join('')}</tbody></table>
        <p><button type="button" class="principal" data-enregistrer>${texteHtml('commun.enregistrer')}</button></p>`;
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        tr.querySelector('[data-ecran]').addEventListener('change', (e) => { prefs[Number(tr.dataset.i)].ecran = e.target.checked; });
        tr.querySelector('[data-courriel]').addEventListener('change', (e) => { prefs[Number(tr.dataset.i)].courriel = e.target.checked; });
      });
      corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
        try { prefs = await api.notifications.enregistrerPreferences(prefs.map((p) => ({ module: p.module, type: p.type, ecran: p.ecran, courriel: Boolean(p.courriel) }))); app.message(texte('notifications_btp.preferences.enregistrees'), 'succes'); rendre(); } catch (e) { app.erreur(e); }
      });
    };
    rendre();
  }
}
