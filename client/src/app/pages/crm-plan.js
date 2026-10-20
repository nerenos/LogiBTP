import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { choisirPersonne } from '@logibtp/annuaire/ui';
import { api } from '../api.js';
import { zoneRiche, lienElement } from '../crm/crm.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';
import { pastillePlan } from './crm-plans.js';

const date = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');

/**
 * Plan ou pièce technique (module CRM, suivi des validations) : `/crm/plan/<id>` ou
 * `/crm/plan/nouveau?type_element=&id_element=`. Repère, repère CCTP, nom, lot, finition, message ; indices (A, B…)
 * avec date de diffusion, motif et fichier (pièces du plan dans la GED) ; visas attendus et reçus par tiers ; notes.
 */
export class PagePlanCrm extends PageBase {
  icone = '📐';

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    if (!app.enLigne) { this.conteneur.innerHTML = '<p class="aide">Suivi (CRM) disponible en ligne seulement.</p>'; return; }
    this.statuts = await api.crm.statutsVisa();
    if (this.params.id === 'nouveau') {
      this.detail = null;
      const r = this.requete;
      this.saisie = { repere: '', repere_cctp: '', nom: '', lot: '', finition: '', message_html: null, type_element: r.type_element ?? null, id_element: r.id_element ?? null };
      this.element = r.type_element ? (await api.crm.elements([{ type: r.type_element, id: String(r.id_element) }]))[0] : null;
      this.titre = 'Nouveau plan';
    } else await this.charger(Number(this.params.id));
    await this.rendre();
  }

  async charger(id) {
    this.detail = await api.crm.plan(id);
    const p = this.detail.plan;
    this.saisie = { repere: p.repere, repere_cctp: p.repere_cctp ?? '', nom: p.nom, lot: p.lot ?? '', finition: p.finition ?? '', message_html: p.message_html,
      type_element: p.type_element, id_element: p.id_element, maj_le: p.maj_le };
    this.element = p.element;
    this.titre = `${p.repere} – ${p.nom}`;
    this.modifie = false;
  }

  urlCourante() { return this.detail ? `/crm/plan/${this.detail.plan.id}` : null; }

  async rendre() {
    const d = this.detail;
    const s = this.saisie;
    this.conteneur.innerHTML = `<div class="page-parametres page-crm-note">
      <h1 class="page-titre">📐 ${echapper(d ? `${d.plan.repere} – ${d.plan.nom}` : 'Nouveau plan')} ${d ? pastillePlan(d.plan.etat) : ''}</h1>
      <div class="boutons crm-actions"><button type="button" class="principal" data-enregistrer title="Enregistrer (Ctrl+S)">Enregistrer</button>
        ${d ? '<button type="button" data-diffuser title="Bordereau de diffusion du dernier indice">📤 Diffuser…</button><button type="button" data-supprimer>Supprimer</button>' : ''}
        ${this.element ? `<span>Rattaché à ${lienElement(this.element)}</span>` : ''}</div>
      <div class="crm-note-grille"><section class="crm-note-principal">
        <div class="formulaire crm-formulaire">
          <label>Repère <input data-c="repere" maxlength="40" value="${echapper(s.repere)}"></label>
          <label>Nom <input data-c="nom" maxlength="200" value="${echapper(s.nom)}"></label>
          <label>Lot <input data-c="lot" maxlength="80" value="${echapper(s.lot)}"></label>
          <label>Repère CCTP <input data-c="repere_cctp" maxlength="40" value="${echapper(s.repere_cctp)}"></label>
          <label>Finition <input data-c="finition" maxlength="120" value="${echapper(s.finition)}" placeholder="Teinte RAL, état de surface…"></label>
        </div>
        <div data-message></div>
        ${d ? `<h2>Indices et visas</h2>
          <p class="aide">En vigueur : <b>${echapper(d.plan.etat.en_vigueur ?? 'aucun indice bon pour exécution')}</b>${d.plan.etat.manquants ? ` · ${d.plan.etat.manquants} visa(s) attendu(s)` : ''}${d.plan.etat.retards ? ` · <span class="crm-retard">${d.plan.etat.retards} en retard</span>` : ''}</p>
          <div data-indices></div>
          <div class="crm-ajout-rappel"><input data-nouvel-indice size="4" placeholder="Indice" title="Vide : indice suivant"> <input type="date" data-date-indice title="Date de diffusion (vide : à diffuser)">
            <input data-motif-indice size="28" placeholder="Motif de la révision"> <span data-fichier-indice></span> <button type="button" data-ajouter-indice>＋ Indice</button></div>
          <h2>Suivi</h2><div data-suivi></div>` : '<p class="aide">Indices, visas et pièces : après le premier enregistrement.</p>'}
      </section><aside class="crm-note-cote">${d ? '<h2>Pièces du plan</h2><div data-pieces class="crm-pieces"></div>' : ''}</aside></div></div>`;
    const $ = (sel) => this.conteneur.querySelector(sel);
    this.conteneur.querySelectorAll('input[data-c]').forEach((i) => i.addEventListener('input', () => { s[i.dataset.c] = i.value; this.modifie = true; }));
    this.message = zoneRiche(s.message_html, { surChange: () => { this.modifie = true; } });
    $('[data-message]').replaceWith(this.message.element);
    $('[data-enregistrer]').addEventListener('click', () => this.enregistrer());
    $('[data-supprimer]')?.addEventListener('click', async () => {
      if (!confirm('Supprimer ce plan, ses indices et ses visas ?')) return;
      try { await api.crm.supprimerPlan(d.plan.id); this.modifie = false; this.app.publier('crm', {}); this.app.routeur.retour('/crm/plans'); } catch (e) { this.app.erreur(e); }
    });
    $('[data-diffuser]')?.addEventListener('click', () => this.app.naviguer(`/crm/diffusion/nouveau?plans=${d.plan.id}${s.type_element ? `&type_element=${encodeURIComponent(s.type_element)}&id_element=${encodeURIComponent(s.id_element)}` : ''}`));
    if (!d) return;
    const sv = await this.app.services();
    this.pieces = await sv.ged.lister({ type_element: 'crm_plan', id_element: String(d.plan.id) }).catch(() => []);
    this.fichiers = this.pieces.map((x) => ({ valeur: x.id, libelle: x.titre }));
    this.rendreIndices();
    const fichier = creerCombo({ options: this.fichiers, titre: 'Fichier de l\'indice (pièces du plan)' });
    $('[data-fichier-indice]').replaceWith(fichier);
    $('[data-ajouter-indice]').addEventListener('click', () => this.appliquer(() => api.crm.ajouterIndice(d.plan.id, {
      indice: $('[data-nouvel-indice]').value.trim() || null, date: $('[data-date-indice]').value || null, motif: $('[data-motif-indice]').value.trim() || null,
      dge_id: fichier.valeurCombo === '' ? null : Number(fichier.valeurCombo),
    })));
    this.ged = new ExplorateurGed($('[data-pieces]'), {
      fournisseur: sv.ged, contexte: { type_element: 'crm_plan', id_element: String(d.plan.id), libelle: d.plan.repere, icone: '📐' }, compact: true,
      ouvrirUrl: (url) => this.app.naviguer(url, { nouvelleFenetre: true }), modifiable: true, admin: this.app.estAdmin(), utilisateur: this.app.utilisateur(),
      message: (t, n) => this.app.message(t, n),
    });
    this.suivi?.fermer();
    this.suivi = new PanneauSuivi($('[data-suivi]'), { app: this.app, type: 'crm_plan', id: d.plan.id, libelle: d.plan.repere });
    this.suivi.ouvrir().catch((e) => this.app.erreur(e));
  }

  rendreIndices() {
    const zone = this.conteneur.querySelector('[data-indices]');
    const indices = [...this.detail.indices].reverse();
    const titre = (id) => this.pieces.find((x) => x.id === id)?.titre ?? (id ? `Document ${id}` : '');
    zone.innerHTML = indices.length ? indices.map((i) => `<div class="crm-indice" data-indice="${i.id}">
      <div class="crm-indice-entete"><b>Indice ${echapper(i.indice)}</b> <span class="aide">${i.date ? `diffusé le ${date(i.date)}` : 'à diffuser'}${i.motif ? ` · ${echapper(i.motif)}` : ''}</span>
        ${i.dge_id ? `<a href="/ged/${i.dge_id}">📄 ${echapper(titre(i.dge_id))}</a>` : ''}
        <button type="button" data-supprimer-indice="${i.id}" title="Supprimer l'indice">✕</button></div>
      ${i.visas.length ? `<table class="crm-table"><thead><tr><th>Tiers</th><th>Attendu le</th><th>Visa</th><th>Reçu le</th><th>Observation</th><th>Retour</th><th></th></tr></thead><tbody>
        ${i.visas.map((v) => `<tr data-visa="${v.id}"><td>${lienElement(v.tiers)}${v.contact ? `<br><small>${lienElement(v.contact)}</small>` : ''}${v.diffusion_numero ? `<br><small class="aide">${echapper(v.diffusion_numero)}</small>` : ''}</td>
          <td class="${!v.statut && v.attendu_le && v.attendu_le < new Date().toISOString().slice(0, 10) ? 'crm-retard' : ''}">${date(v.attendu_le)}</td>
          <td><span data-statut></span></td><td><input type="date" data-recu value="${v.recu_le ?? ''}"></td>
          <td><input data-observation size="22" value="${echapper(v.observation ?? '')}"></td><td><span data-retour></span></td>
          <td><button type="button" data-enregistrer-visa title="Enregistrer le visa">✓</button><button type="button" data-supprimer-visa title="Retirer">✕</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucun visa attendu.</p>'}
      <div class="crm-ajout-rappel"><button type="button" data-ajouter-visa title="Visa attendu d'un tiers (choisi dans l'annuaire)">＋ Visa attendu…</button> <input type="date" data-attendu title="Attendu le"></div></div>`).join('')
      : '<p class="aide">Aucun indice : créez l\'indice A.</p>';
    for (const i of this.detail.indices) {
      const bloc = zone.querySelector(`[data-indice="${i.id}"]`);
      bloc.querySelector('[data-supprimer-indice]').addEventListener('click', () => { if (confirm(`Supprimer l'indice ${i.indice} ?`)) this.appliquer(() => api.crm.supprimerIndice(i.id)); });
      bloc.querySelector('[data-ajouter-visa]').addEventListener('click', async () => {
        const { annuaire } = await this.app.services();
        const p = await choisirPersonne({ annuaire, titre: `Visa attendu sur l'indice ${i.indice}` });
        if (p) this.appliquer(() => api.crm.ajouterVisa(i.id, { tiers_id: p.id, ind_id: null, attendu_le: bloc.querySelector('[data-attendu]').value || null }));
      });
      for (const v of i.visas) {
        const tr = bloc.querySelector(`[data-visa="${v.id}"]`);
        const statut = creerCombo({ options: this.statuts.filter((x) => x.actif || x.code === v.statut).map((x) => ({ valeur: x.code, libelle: x.libelle })), valeur: v.statut ?? '', titre: 'Vide : visa attendu' });
        tr.querySelector('[data-statut]').replaceWith(statut);
        const retour = creerCombo({ options: this.fichiers, valeur: v.dge_retour_id ?? '', titre: 'Plan annoté en retour (pièces du plan)' });
        tr.querySelector('[data-retour]').replaceWith(retour);
        tr.querySelector('[data-enregistrer-visa]').addEventListener('click', () => this.appliquer(() => api.crm.saisirVisa(v.id, {
          statut: statut.valeurCombo === '' ? null : statut.valeurCombo, recu_le: tr.querySelector('[data-recu]').value || null,
          observation: tr.querySelector('[data-observation]').value || null, dge_retour_id: retour.valeurCombo === '' ? null : Number(retour.valeurCombo),
        }), 'Visa enregistré'));
        tr.querySelector('[data-supprimer-visa]').addEventListener('click', () => this.appliquer(() => api.crm.supprimerVisa(v.id)));
      }
    }
  }

  async appliquer(f, texte = null) {
    try {
      this.detail = await f();
      this.app.publier('crm', { plan: this.detail.plan.id });
      if (texte) this.app.message(texte, 'succes');
      await this.charger(this.detail.plan.id);
      await this.rendre();
    } catch (e) { this.app.erreur(e); }
  }

  async enregistrer() {
    this.saisie.message_html = this.message?.valeur() ?? null;
    try {
      const nouveau = !this.detail;
      const r = nouveau ? await api.crm.creerPlan(this.saisie) : await api.crm.enregistrerPlan(this.detail.plan.id, this.saisie);
      await this.charger(r.plan.id);
      if (nouveau) this.app.routeur.remplacerUrl(`/crm/plan/${r.plan.id}`);
      this.app.publier('crm', { plan: r.plan.id });
      this.app.message('Plan enregistré', 'succes');
      await this.rendre();
    } catch (e) { this.app.erreur(e); }
  }

  fermer() { this.suivi?.fermer(); }
}
