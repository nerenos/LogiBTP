import { PageBase } from '@logibtp/navigation';
import { echapper, formatDateHeure } from '@logibtp/socle/ui';
import { api } from '../api.js';

const NIVEAUX = { URGENT: '🔴', ATTENTION: '🟠', INFO: '🔵' };
const MODULES = { crm: 'Suivi (CRM)', ressources: 'Ressources', planning: 'Planning', execution: 'Exécution', pointage: 'Pointage', mail: 'Messagerie', oauth: 'Connexions externes' };

/**
 * Boîte de notifications (module Notifications) : à traiter, non lues ou toutes, par module ; ouvrir une notification
 * la marque lue, « Traitée » la retire de la boîte ; tout marquer lu. Le compteur du bandeau suit (sujet `notifications`).
 */
export class PageNotifications extends PageBase {
  icone = '🔔';

  urlCourante() { return `/notifications?${new URLSearchParams({ etat: this.etat, module: this.module })}`; }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Notifications';
    this.etat = this.requete.etat ?? 'a_traiter';
    this.module = this.requete.module ?? '';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🔔 Notifications</h1>
      <p class="ligne">${[['a_traiter', 'À traiter'], ['non_lues', 'Non lues'], ['toutes', 'Toutes']].map(([v, l]) => `<label class="ligne"><input type="radio" name="etat" value="${v}" ${v === this.etat ? 'checked' : ''}> ${l}</label>`).join(' ')}
        · ${[['', 'Tous les modules'], ...Object.entries(MODULES)].map(([v, l]) => `<label class="ligne"><input type="radio" name="module" value="${v}" ${v === this.module ? 'checked' : ''}> ${l}</label>`).join(' ')}</p>
      <p><button type="button" data-tout-lire>✓ Tout marquer lu</button> <a href="/parametres/notifications">Préférences…</a>
        ${app.estAdmin() ? ' <button type="button" data-executer title="Exécuter maintenant les contrôles du planificateur pour cette société">⟳ Contrôler maintenant</button>' : ''}</p>
      <div data-liste></div></div>`;
    this.conteneur.querySelectorAll('[name="etat"]').forEach((r) => r.addEventListener('change', () => { this.etat = r.value; this.#charger(); }));
    this.conteneur.querySelectorAll('[name="module"]').forEach((r) => r.addEventListener('change', () => { this.module = r.value; this.#charger(); }));
    this.conteneur.querySelector('[data-tout-lire]').addEventListener('click', () => this.#marquer({ tout: true }, false));
    this.conteneur.querySelector('[data-executer]')?.addEventListener('click', async () => {
      try { await api.notifications.executer(); await this.#charger(); app.publier('notifications', {}); } catch (e) { app.erreur(e); }
    });
    this.desabonner = app.abonner('notifications', () => this.#charger());
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
        <span class="niveau" title="${echapper(n.niveau)}">${NIVEAUX[n.niveau] ?? '•'}</span>
        <div class="las-corps"><b>${n.url ? `<a href="${echapper(n.url)}" data-ouvrir>${echapper(n.titre)}</a>` : echapper(n.titre)}</b>
          ${n.texte ? `<br><span class="aide">${echapper(n.texte)}</span>` : ''}<br><small class="aide">${echapper(MODULES[n.module] ?? n.module)} · ${formatDateHeure(n.cree_le)}</small></div>
        ${n.traitee_le ? '<small class="aide">traitée</small>' : ''}
        <span class="las-actions">${n.lue_le ? '' : '<button type="button" class="bouton-icone" data-lue title="Marquer lue" aria-label="Marquer lue">👁</button>'}
          ${n.traitee_le ? '' : '<button type="button" class="bouton-icone" data-traitee title="Traitée : retirer de la boîte" aria-label="Traitée : retirer de la boîte">✔</button>'}</span></li>`).join('')}</ul>`
      : '<p class="aide">Aucune notification.</p>';
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
  icone = '🔔';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Préférences de notification';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🔔 Préférences de notification</h1><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    let prefs = await api.notifications.preferences();
    const courriel = (await api.notifications.canaux().catch(() => ({}))).courriel === true;
    const rendre = () => {
      corps.innerHTML = `<p class="aide">Ce que vous recevez dans votre boîte (🔔 du bandeau) et par courriel (adresse de votre fiche individu${courriel ? '' : ' ; messagerie non configurée : courriel indisponible'}).</p>
        <table><thead><tr><th>Module</th><th>Notification</th><th>À l'écran</th><th>Par courriel</th></tr></thead><tbody>
        ${prefs.map((p, i) => `<tr data-i="${i}"><td>${echapper(MODULES[p.module] ?? p.module)}</td><td>${echapper(p.libelle)}</td>
          <td><input type="checkbox" data-ecran ${p.ecran ? 'checked' : ''}></td><td><input type="checkbox" data-courriel ${p.courriel ? 'checked' : ''} ${courriel ? '' : 'disabled title="Aucun compte de messagerie configuré"'}></td></tr>`).join('')}</tbody></table>
        <p><button type="button" class="principal" data-enregistrer>Enregistrer</button></p>`;
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        tr.querySelector('[data-ecran]').addEventListener('change', (e) => { prefs[Number(tr.dataset.i)].ecran = e.target.checked; });
        tr.querySelector('[data-courriel]').addEventListener('change', (e) => { prefs[Number(tr.dataset.i)].courriel = e.target.checked; });
      });
      corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
        try { prefs = await api.notifications.enregistrerPreferences(prefs.map((p) => ({ module: p.module, type: p.type, ecran: p.ecran, courriel: Boolean(p.courriel) }))); app.message('Préférences enregistrées', 'succes'); rendre(); } catch (e) { app.erreur(e); }
      });
    };
    rendre();
  }
}
