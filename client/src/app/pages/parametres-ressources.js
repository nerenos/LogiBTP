import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { typesHabilitation } from '../ressources/ressources-ui.js';
import { editeurPlans } from '../ressources/entretiens-ui.js';

const CATEGORIES = [['CACES', 'CACES'], ['HAUTEUR', 'Travail en hauteur'], ['ELECTRIQUE', 'Électrique'], ['SECURITE', 'Sécurité'], ['MEDICAL', 'Médical'], ['CONTROLE', 'Contrôle (matériel)'], ['AUTRE', 'Autre']]
  .map(([valeur, libelle]) => ({ valeur, libelle }));
const CONCERNES = [{ valeur: 'SALARIE', libelle: 'Salarié' }, { valeur: 'MATERIEL', libelle: 'Matériel' }, { valeur: 'LES_DEUX', libelle: 'Les deux' }];
export const DOMAINES_MOTIF = [
  { valeur: 'BLOCAGE', libelle: "Blocage d'un ordre" }, { valeur: 'NON_CONFORMITE', libelle: 'Non-conformité' },
  { valeur: 'ECART_PLANNING', libelle: 'Écart de planning' }, { valeur: 'AUTRE', libelle: 'Autre' },
];

/**
 * Référentiel des ressources (db/195 ; ANALYSE-MODULES-TRANSVERSE.md § 4) : types d'habilitations (durée de validité,
 * élément concerné), motifs typés et service à prévenir, natures de main-d'œuvre rattachées à un service (heures budget
 * par service du Planning et de l'Exécution), plans d'entretien par type de matériel (lot 5c-4 : un type enfant hérite des
 * plans de son parent). Administrateur ; consultation pour les autres.
 */
export class PageParametresRessources extends PageBase {
  icone = '🧰';

  async ouvrir() {
    const app = this.app;
    this.titre = 'Référentiel des ressources';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">🧰 Référentiel des ressources</h1>
      <section class="carte" data-types></section><section class="carte" data-motifs></section><section class="carte" data-natures></section><section class="carte" data-plans></section></div>`;
    this.admin = app.estAdmin();
    this.services = (await api.services()).filter((s) => s.actif).map((s) => ({ valeur: s.id, libelle: s.libelle, detail: s.code }));
    await Promise.all([this.#types(), this.#motifs(), this.#natures(), this.#plans()]);
  }

  async #types() {
    const zone = this.conteneur.querySelector('[data-types]');
    let liste = (await typesHabilitation({ recharger: true })).liste.map((t) => ({ ...t }));
    const rendre = () => {
      zone.innerHTML = `<h2>Types d'habilitations</h2>
        <p class="aide">Durée de validité en mois (vide : sans fin) ; la fin de validité d'une habilitation se calcule depuis son obtention si elle n'est pas saisie.
          Un type retiré est supprimé s'il est inutilisé, sinon désactivé.</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Catégorie</th><th>Concerne</th><th>Durée (mois)</th><th>Ordre</th><th>Actif</th><th class="nombre">Utilisé</th><th></th></tr></thead><tbody>
        ${liste.map((t, i) => `<tr data-i="${i}"><td><input data-c="code" value="${echapper(t.code)}" size="16" ${this.admin && !t.nb ? '' : 'disabled'}></td>
          <td><input data-c="libelle" value="${echapper(t.libelle)}" size="36" ${this.admin ? '' : 'disabled'}></td><td data-categorie></td><td data-concerne></td>
          <td><input data-c="duree_mois" value="${t.duree_mois ?? ''}" size="5" inputmode="numeric" ${this.admin ? '' : 'disabled'}></td>
          <td><input data-c="ordre" value="${t.ordre ?? 0}" size="4" inputmode="numeric" ${this.admin ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-c="actif" ${t.actif ? 'checked' : ''} ${this.admin ? '' : 'disabled'}></td><td class="nombre">${t.nb || ''}</td>
          <td>${this.admin ? '<button type="button" data-retirer title="Retirer">✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
        ${this.admin ? '<p><button type="button" data-ajouter>＋ Type</button> <button type="button" class="principal" data-enregistrer>Enregistrer les types</button></p>' : ''}`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const t = liste[Number(tr.dataset.i)];
        for (const [cle, options] of [['categorie', CATEGORIES], ['concerne', CONCERNES]]) {
          const c = creerCombo({ options, valeur: t[cle], vide: false });
          c.readOnly = !this.admin;
          c.addEventListener('change', () => { t[cle] = c.valeurCombo; });
          tr.querySelector(`[data-${cle}]`).append(c);
        }
        tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
          t[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'duree_mois' ? (c.value.trim() ? Number(c.value) : null) : c.dataset.c === 'ordre' ? Number(c.value || 0) : c.value;
        }));
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { liste.splice(Number(tr.dataset.i), 1); rendre(); });
      });
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { liste.push({ code: '', libelle: '', categorie: 'AUTRE', concerne: 'SALARIE', duree_mois: null, ordre: (liste.at(-1)?.ordre ?? 0) + 1, actif: true }); rendre(); });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try {
          liste = (await api.ressources.enregistrerTypesHabilitation(liste)).map((t) => ({ ...t }));
          await typesHabilitation({ recharger: true });
          this.app.message("Types d'habilitations enregistrés", 'succes');
          rendre();
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  async #motifs() {
    const zone = this.conteneur.querySelector('[data-motifs]');
    let liste = (await api.ressources.motifs()).map((m) => ({ ...m }));
    const rendre = () => {
      zone.innerHTML = `<h2>Motifs</h2>
        <p class="aide">Motifs de blocage des ordres (Exécution), de non-conformité (Pointage), d'écart de planning ; le service désigné est prévenu
          (tâche du CRM si le module est actif). Un motif retiré est désactivé.</p>
        <table class="tableau-compact largeur-contenu"><thead><tr><th>Domaine</th><th>Code</th><th>Libellé</th><th>Service à prévenir</th><th>Ordre</th><th>Actif</th></tr></thead><tbody>
        ${liste.map((m, i) => `<tr data-i="${i}"${m.actif ? '' : ' class="discret"'}><td data-domaine></td><td><input data-c="code" value="${echapper(m.code)}" size="14" ${this.admin && !m.id ? '' : 'disabled'}></td>
          <td><input data-c="libelle" value="${echapper(m.libelle)}" size="36" ${this.admin ? '' : 'disabled'}></td><td data-service></td>
          <td><input data-c="ordre" value="${m.ordre ?? 0}" size="4" inputmode="numeric" ${this.admin ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-c="actif" ${m.actif ? 'checked' : ''} ${this.admin ? '' : 'disabled'}></td></tr>`).join('')}</tbody></table>
        ${this.admin ? '<p><button type="button" data-ajouter>＋ Motif</button> <button type="button" class="principal" data-enregistrer>Enregistrer les motifs</button></p>' : ''}`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const m = liste[Number(tr.dataset.i)];
        const domaine = creerCombo({ options: DOMAINES_MOTIF, valeur: m.domaine, vide: false });
        domaine.readOnly = !this.admin || Boolean(m.id);
        domaine.addEventListener('change', () => { m.domaine = domaine.valeurCombo; });
        tr.querySelector('[data-domaine]').append(domaine);
        const service = creerCombo({ options: this.services, valeur: m.srv_id ?? '', vide: true });
        service.readOnly = !this.admin;
        service.addEventListener('change', () => { m.srv_id = service.valeurCombo ? Number(service.valeurCombo) : null; });
        tr.querySelector('[data-service]').append(service);
        tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
          m[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'ordre' ? Number(c.value || 0) : c.value;
        }));
      });
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { liste.push({ id: null, domaine: 'BLOCAGE', code: '', libelle: '', srv_id: null, ordre: 99, actif: true }); rendre(); });
      zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
        try { liste = (await api.ressources.enregistrerMotifs(liste)).map((m) => ({ ...m })); this.app.message('Motifs enregistrés', 'succes'); rendre(); } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }

  /** Plans d'entretien par type de matériel (db/235) : un type choisi, ses plans ; ceux du type parent en rappel. */
  async #plans() {
    const zone = this.conteneur.querySelector('[data-plans]');
    const [types, plans] = await Promise.all([api.listesValeurs.lire('TYPE_MATERIEL'), api.ressources.plansTypes()]);
    const libelle = (code) => types.find((t) => t.code === code)?.libelle ?? code;
    const options = types.filter((t) => t.actif).map((t) => ({ valeur: t.code, libelle: t.parent ? `${libelle(t.parent)} › ${t.libelle}` : t.libelle, detail: plans[t.code]?.length ? `${plans[t.code].length} plan(s)` : '' }));
    zone.innerHTML = `<h2>Plans d'entretien par type de matériel</h2>
      <p class="aide">Périodicités en heures, kilomètres ou mois (la première atteinte déclenche) ; un type enfant hérite des plans de son parent, un matériel peut remplacer ou retirer un plan (onglet Compteurs de sa fiche).</p>
      <p>Type <span data-type></span></p><p class="aide" data-parent></p><div data-editeur></div>`;
    const combo = creerCombo({ options, valeur: '', vide: true });
    const afficher = () => {
      const type = combo.valeurCombo;
      const ed = zone.querySelector('[data-editeur]');
      if (!type) { ed.innerHTML = ''; zone.querySelector('[data-parent]').textContent = ''; return; }
      const parent = types.find((t) => t.code === type)?.parent;
      zone.querySelector('[data-parent]').textContent = parent && plans[parent]?.length
        ? `Hérités de ${libelle(parent)} : ${plans[parent].map((p) => p.libelle ?? p.code).join(', ')} (un plan de même code les remplace).` : '';
      editeurPlans(ed, {
        app: this.app, plans: plans[type] ?? [], lecture: !this.admin,
        enregistrer: async (l) => { plans[type] = await api.ressources.enregistrerPlansType(type, l); return plans[type]; },
      });
    };
    combo.addEventListener('change', afficher);
    zone.querySelector('[data-type]').append(combo);
  }

  async #natures() {
    const zone = this.conteneur.querySelector('[data-natures]');
    const liste = (await api.ressources.naturesMo()).map((n) => ({ ...n }));
    zone.innerHTML = `<h2>Natures de main-d'œuvre → services</h2>
      <p class="aide">Les heures des composantes de ces natures (unité heure) dans les commandes validées donnent les heures budget d'un chantier par service.</p>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Nature</th><th>Libellé</th><th>Service</th></tr></thead><tbody>
      ${liste.map((n, i) => `<tr data-i="${i}"><td>${echapper(n.code)}</td><td>${echapper(n.libelle)}</td><td data-service></td></tr>`).join('')}</tbody></table>
      ${this.admin ? '<p><button type="button" class="principal" data-enregistrer>Enregistrer</button></p>' : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const n = liste[Number(tr.dataset.i)];
      const c = creerCombo({ options: this.services, valeur: n.srv_id ?? '', vide: true });
      c.readOnly = !this.admin;
      c.addEventListener('change', () => { n.srv_id = c.valeurCombo ? Number(c.valeurCombo) : null; });
      tr.querySelector('[data-service]').append(c);
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try { await api.ressources.enregistrerNaturesMo(liste.map((n) => ({ id: n.id, srv_id: n.srv_id }))); this.app.message('Natures enregistrées', 'succes'); } catch (e) { this.app.erreur(e); }
    });
  }
}
