import { SUJET_FENETRE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, formatDate } from '@logibtp/socle/ui';
import { ExplorateurGed } from '@logibtp/ged/ui';
import { choisirPersonne } from '@logibtp/annuaire/ui';
import { api } from '../api.js';
import { zoneRiche, lienElement } from '../crm/crm.js';
import { PanneauSuivi } from '../crm/panneau-suivi.js';
import { extraireNomPlan } from '@logibtp/crm';
import { pastillePlan } from './crm-plans.js';

/** Indice affiché : l'indice vide est le premier (avant A). */
export const libelleIndice = (i) => (i ? `Indice ${i}` : 'Premier indice (vide)');
/** Nom du répertoire de la GED d'un indice (sous l'élément crm_plan). */
const nomRepertoire = (i) => (i ? `Indice ${i}` : 'Indice vide');

/**
 * Plan ou pièce technique (module CRM, suivi des validations) : `/crm/plan/<id>` ou
 * `/crm/plan/nouveau?type_element=&id_element=`. Repère, repère CCTP, nom, lot, finition, message ; indices (A, B…)
 * avec date de diffusion, motif et fichiers (pièces du plan dans la GED, un répertoire par indice ; l'indice vide est le
 * premier) ; visas attendus et reçus par tiers ; notes. Création : fichiers déposés avec le plan, repère, nom et indice
 * lus dans le nom du premier fichier selon le format des paramètres du CRM (`extraireNomPlan`).
 */
export class PagePlanCrm extends PageBase {
  icone = '📐';

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    [this.statuts, this.parametres] = await Promise.all([api.crm.statutsVisa(), api.crm.parametres().catch(() => ({}))]);
    this.fichiersNouveaux = [];
    if (this.params.id === 'nouveau') {
      this.detail = null;
      const r = this.requete;
      this.saisie = { repere: '', repere_cctp: '', nom: '', lot: '', finition: '', message_html: null, type_element: r.type_element ?? null, id_element: r.id_element ?? null, indice: '' };
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
          ${d ? '' : `<label>Indice <input data-c="indice" maxlength="5" size="5" value="${echapper(s.indice)}" placeholder="vide = premier" title="Vide : premier indice (avant A)"></label>`}
        </div>
        ${d ? '' : `<div class="crm-depot" data-depot-plan><label class="crm-photos"><input type="file" data-fichiers-plan multiple hidden>📎 Fichiers du plan…</label>
          <span class="aide">ou glissez-les ici : rangés dans la GED du plan, répertoire de l'indice ; repère, nom et indice lus dans le nom du premier fichier (format : ${echapper(this.parametres?.format_plan ?? '')}).</span>
          <ul class="crm-liens" data-liste-fichiers></ul></div>`}
        <div data-message></div>
        ${d ? `<h2>Indices et visas</h2>
          <p class="aide">En vigueur : <b>${echapper(d.plan.etat.en_vigueur === '' ? libelleIndice('') : d.plan.etat.en_vigueur ?? 'aucun indice bon pour exécution')}</b>${d.plan.etat.manquants ? ` · ${d.plan.etat.manquants} visa(s) attendu(s)` : ''}${d.plan.etat.retards ? ` · <span class="crm-retard">${d.plan.etat.retards} en retard</span>` : ''}</p>
          <div data-indices></div>
          <div class="crm-ajout-rappel"><input data-nouvel-indice size="4" placeholder="Indice" title="Vide : indice suivant"> <input type="date" data-date-indice title="Date de diffusion (vide : à diffuser)">
            <input data-motif-indice size="28" placeholder="Motif de la révision"> <span data-fichier-indice></span>
            <label class="crm-photos" title="Fichiers du nouvel indice (rangés dans son répertoire de la GED)"><input type="file" data-fichiers-indice multiple hidden>📎 Fichiers</label><span data-nb-fichiers class="aide"></span>
            <button type="button" data-ajouter-indice>＋ Indice</button></div>
          <h2>Suivi</h2><div data-suivi></div>` : '<p class="aide">Indices, visas et pièces : après le premier enregistrement.</p>'}
      </section><aside class="crm-note-cote">${d ? '<h2>Pièces du plan</h2><div data-pieces class="crm-pieces"></div>' : ''}</aside></div></div>`;
    const $ = (sel) => this.conteneur.querySelector(sel);
    this.conteneur.querySelectorAll('input[data-c]').forEach((i) => i.addEventListener('input', () => { s[i.dataset.c] = i.value; this.modifie = true; }));
    if (!d) this.brancherFichiersNouveaux();
    this.message = zoneRiche(s.message_html, { surChange: () => { this.modifie = true; } });
    $('[data-message]').replaceWith(this.message.element);
    $('[data-enregistrer]').addEventListener('click', () => this.enregistrer());
    $('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer('Supprimer ce plan, ses indices et ses visas ?')) return;
      try { await api.crm.supprimerPlan(d.plan.id); this.modifie = false; this.app.publier(SUJET_FENETRE.CRM, {}); this.app.routeur.retour('/crm/plans'); } catch (e) { this.app.erreur(e); }
    });
    $('[data-diffuser]')?.addEventListener('click', () => this.app.naviguer(`/crm/diffusion/nouveau?plans=${d.plan.id}${s.type_element ? `&type_element=${encodeURIComponent(s.type_element)}&id_element=${encodeURIComponent(s.id_element)}` : ''}`));
    if (!d) return;
    const sv = await this.app.services();
    this.pieces = await sv.ged.lister({ type_element: 'crm_plan', id_element: String(d.plan.id) }).catch(() => []);
    this.fichiers = this.pieces.map((x) => ({ valeur: x.id, libelle: x.titre }));
    this.rendreIndices();
    const fichier = creerCombo({ options: this.fichiers, titre: 'Fichier de l\'indice (pièces du plan)' });
    $('[data-fichier-indice]').replaceWith(fichier);
    $('[data-fichiers-indice]').addEventListener('change', (e) => { const n = e.target.files.length; $('[data-nb-fichiers]').textContent = n ? `${n} fichier(s)` : ''; });
    $('[data-ajouter-indice]').addEventListener('click', () => this.appliquer(async () => {
      const fichiers = [...$('[data-fichiers-indice]').files];
      let r = await api.crm.ajouterIndice(d.plan.id, {
        indice: $('[data-nouvel-indice]').value.trim() || null, date: $('[data-date-indice]').value || null, motif: $('[data-motif-indice]').value.trim() || null,
        dge_id: fichier.valeurCombo === '' ? null : Number(fichier.valeurCombo),
      });
      if (fichiers.length) r = await this.deposerIndice(r, r.indices[r.indices.length - 1], fichiers);
      return r;
    }));
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
      <div class="crm-indice-entete"><b>${echapper(libelleIndice(i.indice))}</b> <span class="aide">${i.date ? `diffusé le ${formatDate(i.date)}` : 'à diffuser'}${i.motif ? ` · ${echapper(i.motif)}` : ''}</span>
        ${i.dge_id ? `<a href="/ged/${i.dge_id}">📄 ${echapper(titre(i.dge_id))}</a>` : ''}
        <label class="crm-photos" title="Ajouter des fichiers dans le répertoire de l'indice"><input type="file" data-fichiers-de="${i.id}" multiple hidden>📎</label>
        <button type="button" data-supprimer-indice="${i.id}" title="Supprimer l'indice">✕</button></div>
      ${(() => { const f = this.pieces.filter((x) => i.rge_id && x.repertoire_id === i.rge_id && x.id !== i.dge_id); return f.length ? `<ul class="crm-liens">${f.map((x) => `<li>📄 <a href="/ged/${x.id}">${echapper(x.titre)}</a></li>`).join('')}</ul>` : ''; })()}
      ${i.visas.length ? `<table class="crm-table"><thead><tr><th>Tiers</th><th>Attendu le</th><th>Visa</th><th>Reçu le</th><th>Observation</th><th>Retour</th><th></th></tr></thead><tbody>
        ${i.visas.map((v) => `<tr data-visa="${v.id}"><td>${lienElement(v.tiers)}${v.contact ? `<br><small>${lienElement(v.contact)}</small>` : ''}${v.diffusion_numero ? `<br><small class="aide">${echapper(v.diffusion_numero)}</small>` : ''}</td>
          <td class="${!v.statut && v.attendu_le && v.attendu_le < aujourdhui() ? 'crm-retard' : ''}">${formatDate(v.attendu_le)}</td>
          <td><span data-statut></span></td><td><input type="date" data-recu value="${v.recu_le ?? ''}"></td>
          <td><input data-observation size="22" value="${echapper(v.observation ?? '')}"></td><td><span data-retour></span></td>
          <td><button type="button" data-enregistrer-visa title="Enregistrer le visa">✓</button><button type="button" data-supprimer-visa title="Retirer">✕</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucun visa attendu.</p>'}
      <div class="crm-ajout-rappel"><button type="button" data-ajouter-visa title="Visa attendu d'un tiers (choisi dans l'annuaire)">＋ Visa attendu…</button> <input type="date" data-attendu title="Attendu le"></div></div>`).join('')
      : '<p class="aide">Aucun indice : créez le premier (indice vide) ou l\'indice A.</p>';
    for (const i of this.detail.indices) {
      const bloc = zone.querySelector(`[data-indice="${i.id}"]`);
      bloc.querySelector('[data-fichiers-de]').addEventListener('change', (e) => {
        const fichiers = [...e.target.files];
        if (fichiers.length) this.appliquer(() => this.deposerIndice(this.detail, i, fichiers), `${fichiers.length} fichier(s) ajouté(s)`);
      });
      bloc.querySelector('[data-supprimer-indice]').addEventListener('click', async () => { if (await confirmer(`Supprimer : ${libelleIndice(i.indice)} ?`)) this.appliquer(() => api.crm.supprimerIndice(i.id)); });
      bloc.querySelector('[data-ajouter-visa]').addEventListener('click', async () => {
        const { annuaire } = await this.app.services();
        const p = await choisirPersonne({ annuaire, titre: `Visa attendu : ${libelleIndice(i.indice).toLowerCase()}` });
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
      this.app.publier(SUJET_FENETRE.CRM, { plan: this.detail.plan.id });
      if (texte) this.app.message(texte, 'succes');
      await this.charger(this.detail.plan.id);
      await this.rendre();
    } catch (e) { this.app.erreur(e); }
  }

  async enregistrer() {
    this.saisie.message_html = this.message?.valeur() ?? null;
    try {
      const nouveau = !this.detail;
      if (nouveau && !this.saisie.nom.trim() && this.fichiersNouveaux.length) this.saisie.nom = this.fichiersNouveaux[0].name.replace(/\.[^.]+$/, '');
      const r = nouveau ? await api.crm.creerPlan(this.saisie) : await api.crm.enregistrerPlan(this.detail.plan.id, this.saisie);
      if (nouveau && this.fichiersNouveaux.length) {
        // Premier indice (celui saisi, vide par défaut) et ses fichiers dans son répertoire de la GED.
        const avecIndice = await api.crm.ajouterIndice(r.plan.id, { indice: this.saisie.indice?.trim() || null, date: null, motif: null, dge_id: null });
        await this.deposerIndice(avecIndice, avecIndice.indices[avecIndice.indices.length - 1], this.fichiersNouveaux);
        this.fichiersNouveaux = [];
      }
      await this.charger(r.plan.id);
      if (nouveau) this.app.routeur.remplacerUrl(`/crm/plan/${r.plan.id}`);
      this.app.publier(SUJET_FENETRE.CRM, { plan: r.plan.id });
      this.app.message('Plan enregistré', 'succes');
      await this.rendre();
    } catch (e) { this.app.erreur(e); }
  }

  /** Fichiers choisis ou glissés à la création : le premier préremplit repère, nom et indice (format des paramètres). */
  brancherFichiersNouveaux() {
    const zone = this.conteneur.querySelector('[data-depot-plan]');
    const s = this.saisie;
    const ajouter = (fichiers) => {
      if (!fichiers.length) return;
      const premier = !this.fichiersNouveaux.length;
      this.fichiersNouveaux.push(...fichiers);
      this.modifie = true;
      if (premier) {
        const lu = extraireNomPlan(fichiers[0].name, this.parametres?.format_plan || undefined);
        const champs = lu ?? { nom: fichiers[0].name.replace(/\.[^.]+$/, '') };
        for (const c of ['repere', 'nom', 'lot', 'indice']) {
          if (!champs[c] || String(s[c] ?? '').trim()) continue;
          s[c] = champs[c];
          const input = this.conteneur.querySelector(`input[data-c="${c}"]`);
          if (input) input.value = champs[c];
        }
      }
      zone.querySelector('[data-liste-fichiers]').innerHTML = this.fichiersNouveaux.map((f) => `<li>📄 ${echapper(f.name)}</li>`).join('');
    };
    zone.querySelector('[data-fichiers-plan]').addEventListener('change', (e) => ajouter([...e.target.files]));
    zone.addEventListener('dragover', (e) => { e.preventDefault(); });
    zone.addEventListener('drop', (e) => { e.preventDefault(); ajouter([...e.dataTransfer.files]); });
  }

  /**
   * Fichiers d'un indice : répertoire de la GED de l'indice (créé au besoin sous l'élément crm_plan et retenu sur
   * l'indice), dépôt des fichiers ; le premier devient le fichier de l'indice s'il n'en a pas. Renvoie le plan relu.
   */
  async deposerIndice(detail, indice, fichiers) {
    const { ged } = await this.app.services();
    const plan = detail.plan.id;
    let rge = indice.rge_id;
    if (!rge) {
      const existants = await ged.repertoires({ type_element: 'crm_plan', id_element: String(plan) });
      rge = existants.find((x) => !x.parent_id && x.nom.toLowerCase() === nomRepertoire(indice.indice).toLowerCase())?.id
        ?? (await ged.creerRepertoire({ nom: nomRepertoire(indice.indice), type_element: 'crm_plan', id_element: String(plan) })).id;
    }
    let premier = null;
    for (const f of fichiers) {
      const doc = await ged.deposer({ fichier: f, nom_fichier: f.name, meta: { titre: f.name, categorie: 'crm', type_element: 'crm_plan', id_element: String(plan), repertoire_id: rge } });
      premier ??= doc?.id ?? null;
    }
    return api.crm.modifierIndice(indice.id, { date: indice.date, motif: indice.motif, dge_id: indice.dge_id ?? premier, rge_id: rge });
  }

  fermer() { this.suivi?.fermer(); }
}
