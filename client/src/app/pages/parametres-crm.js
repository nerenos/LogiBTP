import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo } from '@logibtp/socle/ui';
import { FORMAT_PLAN_DEFAUT, analyserFormatPlan, extraireNomPlan } from '@logibtp/crm';
import { api } from '../api.js';
import { contexteCrm } from '../crm/crm.js';

/**
 * Paramétrage du CRM (administrateur) : types de notes (appel, courriel, visite…), globaux ou propres à un service ;
 * un type retiré déjà utilisé est désactivé.
 */
export class PageParametresCrm extends PageBase {
  icone = '☑';

  get modifiee() { return Boolean(this.modifie); }

  async ouvrir() {
    const app = this.app;
    this.titre = 'Paramétrage du suivi (CRM)';
    this.conteneur.innerHTML = `<div class="page-parametres"><h1 class="page-titre">☑ Paramétrage du suivi (CRM)</h1><h2>Types de notes</h2><div data-types></div>
      <h2>Couleurs des rappels</h2><div data-seuils></div>
      <h2>Noms des fichiers de plans</h2><div data-format-plan></div>
      <h2>Statuts de visa</h2><div data-statuts></div></div>`;
    if (!app.enLigne) { this.conteneur.querySelector('[data-types]').innerHTML = '<p class="aide">Disponible en ligne seulement.</p>'; return; }
    this.ctx = await contexteCrm(app);
    this.types = await api.crm.typesNotes();
    this.rendreTypes();
    const parametres = await api.crm.parametres();
    this.rendreSeuils(parametres);
    this.rendreFormatPlan(parametres);
    this.statuts = await api.crm.statutsVisa();
    this.rendreStatuts();
  }

  /** Statuts de visa (effet : ACCEPTE bon pour exécution, REFUSE bloquant, NEUTRE pour information). */
  rendreStatuts() {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-statuts]');
    const EFFETS = [{ valeur: 'ACCEPTE', libelle: 'Accepté (bon pour exécution)' }, { valeur: 'REFUSE', libelle: 'Refusé (bloquant)' }, { valeur: 'NEUTRE', libelle: 'Neutre (pour information)' }];
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Effet</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
      ${this.statuts.map((s, i) => `<tr data-i="${i}"${s.actif ? '' : ' class="discret"'}><td><input data-c="code" value="${echapper(s.code)}" size="6" maxlength="10" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="libelle" value="${echapper(s.libelle)}" size="28" maxlength="80" ${admin ? '' : 'disabled'}></td><td><span data-effet></span></td>
        <td><input data-c="ordre" value="${s.ordre}" size="4" ${admin ? '' : 'disabled'}></td><td><input type="checkbox" data-c="actif" ${s.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td>${admin ? '<button type="button" data-retirer>✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? '<div class="boutons"><button type="button" data-ajouter>＋ Statut</button> <button type="button" class="principal" data-enregistrer>Enregistrer les statuts</button></div>' : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const s = this.statuts[Number(tr.dataset.i)];
      const effet = creerCombo({ options: EFFETS, valeur: s.effet, vide: false });
      effet.readOnly = !admin;
      effet.addEventListener('change', () => { s.effet = effet.valeurCombo; this.modifie = true; });
      tr.querySelector('[data-effet]').replaceWith(effet);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => { s[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'ordre' ? Number(c.value) || 0 : c.value; this.modifie = true; }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.statuts.splice(Number(tr.dataset.i), 1); this.modifie = true; this.rendreStatuts(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { this.statuts.push({ code: '', libelle: '', effet: 'NEUTRE', ordre: (this.statuts.length + 1) * 10, actif: true }); this.rendreStatuts(); });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try { this.statuts = await api.crm.enregistrerStatutsVisa(this.statuts); this.modifie = false; this.app.message('Statuts de visa enregistrés', 'succes'); this.rendreStatuts(); } catch (e) { this.app.erreur(e); }
    });
  }

  /** Seuils globaux des couleurs des rappels « avant l'échéance » (C19, C26). */
  rendreSeuils(p) {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-seuils]');
    zone.innerHTML = `<p class="aide">Un rappel avant l'échéance passe à l'orange puis au rouge selon le temps qui reste jusqu'à l'échéance de la note ;
      un rappel à date est vert avant sa date, rouge ensuite. Le délai d'un rappel (par défaut le seuil orange) fixe quand il paraît dans « Mes rappels ».</p>
      <div class="formulaire"><label>Orange à <input data-orange size="4" inputmode="decimal" value="${echapper(String(p.seuils.orange))}" ${admin ? '' : 'disabled'}> jours ou moins</label>
      <label>Rouge à <input data-rouge size="4" inputmode="decimal" value="${echapper(String(p.seuils.rouge))}" ${admin ? '' : 'disabled'}> jours ou moins (et au-delà de l'échéance)</label>
      ${admin ? '<button type="button" class="principal" data-enregistrer-seuils>Enregistrer les seuils</button>' : ''}</div>`;
    zone.querySelector('[data-enregistrer-seuils]')?.addEventListener('click', async () => {
      try {
        const lire = (s) => Number(String(zone.querySelector(s).value).replace(',', '.'));
        this.rendreSeuils(await api.crm.enregistrerParametres({ seuils: { orange: lire('[data-orange]'), rouge: lire('[data-rouge]') } }));
        this.app.message('Seuils des rappels enregistrés', 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }

  /** Format global des noms de fichiers de plans : repère, nom, lot et indice lus à la création d'un plan ou d'un indice. */
  rendreFormatPlan(p) {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-format-plan]');
    zone.innerHTML = `<p class="aide">Champs entre accolades séparés par un texte fixe : {repere}, {nom}, {lot}, {indice} (une ou deux lettres, facultatif en fin : vide = premier indice), {*} (ignoré).
      Les fichiers déposés à la création d'un plan préremplissent le repère, le nom et l'indice.</p>
      <div class="formulaire"><label>Format <input data-format size="40" maxlength="120" value="${echapper(p.format_plan ?? FORMAT_PLAN_DEFAUT)}" ${admin ? '' : 'disabled'}></label>
        <label>Essai <input data-essai size="40" value="R01_Plan de masse_B.pdf"></label><span data-apercu class="aide"></span>
        ${admin ? '<button type="button" class="principal" data-enregistrer-format>Enregistrer le format</button>' : ''}</div>`;
    const $ = (s) => zone.querySelector(s);
    const apercu = () => {
      const a = analyserFormatPlan($('[data-format]').value);
      if (a.erreur) { $('[data-apercu]').innerHTML = `<span class="erreur">${echapper(a.erreur)}</span>`; return; }
      const r = extraireNomPlan($('[data-essai]').value, $('[data-format]').value);
      $('[data-apercu]').textContent = r ? `Repère « ${r.repere} » · nom « ${r.nom} »${r.lot ? ` · lot « ${r.lot} »` : ''} · indice ${r.indice ? `« ${r.indice} »` : 'vide (premier)'}` : 'Ne suit pas le format : le nom du fichier devient le nom du plan';
    };
    $('[data-format]').addEventListener('input', apercu);
    $('[data-essai]').addEventListener('input', apercu);
    apercu();
    $('[data-enregistrer-format]')?.addEventListener('click', async () => {
      try {
        const actuels = await api.crm.parametres();
        this.rendreFormatPlan(await api.crm.enregistrerParametres({ seuils: actuels.seuils, format_plan: $('[data-format]').value }));
        this.app.message('Format des noms de plans enregistré', 'succes');
      } catch (e) { this.app.erreur(e); }
    });
  }

  rendreTypes() {
    const admin = this.app.estAdmin();
    const zone = this.conteneur.querySelector('[data-types]');
    zone.innerHTML = `<table class="tableau-compact largeur-contenu"><thead><tr><th>Icône</th><th>Code</th><th>Libellé</th><th>Service</th><th>Ordre</th><th>Actif</th><th></th></tr></thead><tbody>
      ${this.types.map((t, i) => `<tr data-i="${i}"${t.actif ? '' : ' class="discret"'}>
        <td><input data-c="icone" value="${echapper(t.icone ?? '')}" size="3" maxlength="8" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="code" value="${echapper(t.code)}" size="10" maxlength="20" ${admin ? '' : 'disabled'}></td>
        <td><input data-c="libelle" value="${echapper(t.libelle)}" size="28" maxlength="80" ${admin ? '' : 'disabled'}></td>
        <td><span data-srv></span></td>
        <td><input data-c="ordre" value="${Number(t.ordre ?? 0)}" size="4" ${admin ? '' : 'disabled'}></td>
        <td><input type="checkbox" data-c="actif" ${t.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td>${admin ? '<button type="button" data-retirer title="Retirer (désactivé s\'il est utilisé)">✕</button>' : ''}</td></tr>`).join('')}</tbody></table>
      ${admin ? '<div class="boutons"><button type="button" data-ajouter>＋ Type</button> <button type="button" class="principal" data-enregistrer>Enregistrer les types</button></div>' : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const t = this.types[Number(tr.dataset.i)];
      const srv = creerCombo({ options: this.ctx.tous_services.map((s) => ({ valeur: s.id, libelle: s.libelle })), valeur: t.srv_id ?? '', titre: 'Vide : type global' });
      srv.readOnly = !admin;
      srv.addEventListener('change', () => { t.srv_id = srv.valeurCombo === '' ? null : Number(srv.valeurCombo); this.modifie = true; });
      tr.querySelector('[data-srv]').replaceWith(srv);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        t[c.dataset.c] = c.type === 'checkbox' ? c.checked : c.dataset.c === 'ordre' ? Number(c.value) || 0 : c.value;
        this.modifie = true;
      }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { this.types.splice(Number(tr.dataset.i), 1); this.modifie = true; this.rendreTypes(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      this.types.push({ id: null, code: '', libelle: '', srv_id: null, icone: '', modele_html: null, ordre: (this.types.length + 1) * 10, actif: true });
      this.modifie = true;
      this.rendreTypes();
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        this.types = await api.crm.enregistrerTypesNotes(this.types);
        this.modifie = false;
        this.app.contexteCrm = null;
        this.app.message('Types de notes enregistrés', 'succes');
        this.rendreTypes();
      } catch (e) { this.app.erreur(e); }
    });
  }
}
