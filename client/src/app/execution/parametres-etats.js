import { texte, texteHtml, pairesParCode, pluriel, iconeHtml, couleurTheme } from '@logibtp/socle/dictionnaire';
import { echapper, creerCombo, confirmer } from '@logibtp/socle/ui';
import { NATURES_ETAPE, UNITES_ETAPE, MESSAGES_ETAPES, controlerEtapes } from '@logibtp/execution';
import { api } from '../api.js';
import { TYPES_ORDRE } from './execution.js';

// Module Exécution, lot 2c : paramétrage des états (ANALYSE-MODULE-EXECUTION.md § 13.3) : catalogue global (nature pour
// le planning, durée par défaut, couleur, service) et états de chaque type d'ordre (ordre, date obligatoire = colonne du
// tableau de l'entête, contrôle du N+1 bloquant ou non, statut documentaire déclenché, amonts, durée propre au type).

const optionsServices = (services) => services.filter((s) => s.actif).map((s) => ({ valeur: s.id, libelle: s.libelle, detail: s.code }));
const STATUTS = pairesParCode('execution_btp.statuts', ['ENVOYE', 'VALIDE']).map(([valeur, libelle]) => ({ valeur, libelle }));
const nombre = (v) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
const lireDuree = (t) => (String(t ?? '').trim() === '' ? null : Number(String(t).replace(',', '.')));

/** Catalogue des états (administrateur) ; `apres` : rappelé après un enregistrement (les types relisent les libellés). */
export async function rendreCatalogueEtats(zone, { app, services, apres = () => {} }) {
  const admin = app.estAdmin();
  const etats = await api.execution.etats();
  const rendre = () => {
    const erreurs = controlerEtapes(etats.map((e) => ({ code: e.code, nature: e.nature, duree: e.duree, unite: e.unite })));
    zone.innerHTML = `<p class="aide">${texteHtml('execution_btp.catalogue.aide')}</p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('execution_btp.catalogue.couleur')}</th><th>${texteHtml('execution_btp.catalogue.nature')}</th><th>${texteHtml('execution_btp.catalogue.duree')}</th><th>${texteHtml('execution_btp.catalogue.unite')}</th><th>${texteHtml('execution_btp.catalogue.service')}</th><th>${texteHtml('execution_btp.catalogue.actif')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${etats.map((e, i) => `<tr data-i="${i}"><td><input data-c="code" size="12" value="${echapper(e.code)}" ${admin && !e._existant ? '' : 'readonly'}></td>
        <td><input data-c="libelle" size="26" value="${echapper(e.libelle)}" ${admin ? '' : 'readonly'}></td>
        <td><input type="color" data-c="couleur" value="${echapper(e.couleur ?? couleurTheme('--execution-etape-defaut', '#94a3b8'))}" ${admin ? '' : 'disabled'}></td>
        <td data-nature></td><td><input data-c="duree" size="5" value="${nombre(e.duree)}" ${admin ? '' : 'readonly'}></td><td data-unite></td><td data-service></td>
        <td><input type="checkbox" data-c="actif" ${e.actif ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${admin ? `<button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')}</tbody></table>
      ${erreurs.length ? `<p class="erreur">${erreurs.map((c) => echapper(MESSAGES_ETAPES[c] ?? c)).join(' · ')}</p>` : ''}
      ${admin ? `<p class="ligne"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('execution_btp.catalogue.etat')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('execution_btp.catalogue.enregistrer')}</button></p>` : ''}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const e = etats[Number(tr.dataset.i)];
      const combo = (sel, options, champ, vide = false, nombreVal = false) => {
        const c = creerCombo({ options, valeur: e[champ] ?? '', vide });
        c.readOnly = !admin;
        c.addEventListener('change', () => { e[champ] = c.valeurCombo === '' ? null : nombreVal ? Number(c.valeurCombo) : c.valeurCombo; rendre(); });
        tr.querySelector(sel).append(c);
      };
      combo('[data-nature]', Object.entries(NATURES_ETAPE).map(([valeur, n]) => ({ valeur, libelle: `${n.icone} ${n.libelle}` })), 'nature');
      combo('[data-unite]', Object.entries(UNITES_ETAPE).map(([valeur, libelle]) => ({ valeur, libelle })), 'unite');
      combo('[data-service]', optionsServices(services), 'srv_id', true, true);
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        const c = x.dataset.c;
        e[c] = c === 'actif' ? x.checked : c === 'duree' ? lireDuree(x.value) ?? 0 : c === 'code' ? x.value.trim().toUpperCase() : x.value;
        if (c === 'code' || c === 'duree') rendre();
      }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { etats.splice(etats.indexOf(e), 1); rendre(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      etats.push({ code: '', libelle: '', couleur: couleurTheme('--execution-etape-defaut', '#94a3b8'), nature: 'TACHE', duree: 1, unite: 'OUV', srv_id: null, ordre: 0, actif: true }); rendre();
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        const l = await api.execution.enregistrerEtats(etats.map(({ _existant, ...x }) => x));
        etats.splice(0, etats.length, ...l.map((x) => ({ ...x, _existant: true })));
        app.message(texte('execution_btp.catalogue.enregistre'), 'succes');
        rendre();
        apres();
      } catch (e) { app.message(e.message, 'erreur'); }
    });
  };
  etats.forEach((e) => { e._existant = true; });
  rendre();
}

/** États d'un type d'ordre (administrateur) ; « Appliquer aux ordres en cours » (E41). */
export async function rendreEtatsTypes(zone, { app }) {
  const admin = app.estAdmin();
  const types = (await api.execution.types().catch(() => Object.keys(TYPES_ORDRE).map((code) => ({ code, libelle: TYPES_ORDRE[code], actif: true }))));
  const catalogue = (await api.execution.etats()).filter((e) => e.actif);
  let type = zone.dataset.type || types[0]?.code;
  let etats = [];
  const rendre = () => {
    const erreurs = controlerEtapes(etats.map((e) => ({ code: e.code, amonts: e.amonts ?? undefined, duree: e.duree ?? 0 })));
    zone.innerHTML = `<p class="aide">${texteHtml('execution_btp.types.aide')}</p>
      <p class="ligne">${texteHtml('execution_btp.types.type')} <span data-type></span></p>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('execution_btp.catalogue.etat')}</th><th>${texteHtml('execution_btp.catalogue.nature')}</th><th>${texteHtml('execution_btp.types.date_obligatoire')}</th><th>${texteHtml('execution_btp.etapes.controle')}</th><th>${texteHtml('execution_btp.types.bloquant')}</th><th>${texteHtml('execution_btp.types.statut')}</th>
        <th>${texteHtml('execution_btp.types.amonts')}</th><th>${texteHtml('execution_btp.catalogue.duree')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${etats.map((e, i) => {
        const c = catalogue.find((x) => x.code === e.code);
        return `<tr data-i="${i}"><td data-etat></td><td>${echapper(NATURES_ETAPE[c?.nature]?.icone ?? '')} ${echapper(c ? `${nombre(c.duree)} ${UNITES_ETAPE[c.unite] ?? ''}` : '')}</td>
          <td><input type="checkbox" data-c="date_obligatoire" ${e.date_obligatoire ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-c="controle" ${e.controle ? 'checked' : ''} ${admin ? '' : 'disabled'}></td>
          <td><input type="checkbox" data-c="controle_bloquant" ${e.controle_bloquant ? 'checked' : ''} ${admin && e.controle ? '' : 'disabled'}></td>
          <td data-statut></td>
          <td><input data-c="amonts" size="14" placeholder="${texteHtml('execution_btp.types.precedent')}" value="${echapper((e.amonts ?? []).join(', '))}" ${admin ? '' : 'readonly'}></td>
          <td><input data-c="duree" size="5" placeholder="${echapper(nombre(c?.duree))}" value="${nombre(e.duree)}" ${admin ? '' : 'readonly'}></td>
          <td class="cellule-boutons">${admin ? `<button type="button" data-monter title="${texteHtml('execution_btp.types.monter')}" ${i ? '' : 'disabled'}>${iconeHtml('execution_btp_monter')}</button><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      ${erreurs.length ? `<p class="erreur">${erreurs.map((c) => echapper(MESSAGES_ETAPES[c] ?? c)).join(' · ')}</p>` : ''}
      ${admin ? `<p class="ligne"><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('execution_btp.catalogue.etat')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('execution_btp.types.enregistrer')}</button>
        <button type="button" data-appliquer title="${texteHtml('execution_btp.types.appliquer_titre')}">${texteHtml('execution_btp.types.appliquer')}</button></p>` : ''}`;
    const cType = creerCombo({ options: types.map((t) => ({ valeur: t.code, libelle: t.libelle, detail: t.actif ? t.code : texte('execution_btp.types.inactif', { code: t.code }) })), valeur: type, vide: false });
    cType.addEventListener('change', () => { type = cType.valeurCombo; zone.dataset.type = type; charger(); });
    zone.querySelector('[data-type]').append(cType);
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const e = etats[Number(tr.dataset.i)];
      const cEtat = creerCombo({ options: catalogue.map((x) => ({ valeur: x.code, libelle: x.libelle, detail: x.code })), valeur: e.code, vide: false });
      cEtat.readOnly = !admin;
      cEtat.addEventListener('change', () => { e.code = cEtat.valeurCombo; rendre(); });
      tr.querySelector('[data-etat]').append(cEtat);
      const cStatut = creerCombo({ options: STATUTS, valeur: e.statut_document ?? '', vide: true });
      cStatut.readOnly = !admin;
      cStatut.addEventListener('change', () => { e.statut_document = cStatut.valeurCombo || null; });
      tr.querySelector('[data-statut]').append(cStatut);
      tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
        const c = x.dataset.c;
        if (x.type === 'checkbox') e[c] = x.checked;
        else if (c === 'duree') e.duree = lireDuree(x.value);
        else e.amonts = x.value.trim() ? x.value.split(/[,;\s]+/).map((a) => a.trim().toUpperCase()).filter(Boolean) : null;
        rendre();
      }));
      tr.querySelector('[data-monter]')?.addEventListener('click', () => { const i = etats.indexOf(e); etats.splice(i - 1, 0, ...etats.splice(i, 1)); rendre(); });
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { etats.splice(etats.indexOf(e), 1); rendre(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
      const libre = catalogue.find((c) => !etats.some((e) => e.code === c.code));
      if (!libre) { app.message(texte('execution_btp.types.tous'), 'avertissement'); return; }
      etats.push({ code: libre.code, date_obligatoire: true, controle: false, controle_bloquant: true, statut_document: null, amonts: null, duree: null }); rendre();
    });
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try { etats = await api.execution.enregistrerEtatsType(type, etats); app.message(texte('execution_btp.types.enregistres'), 'succes'); rendre(); } catch (e) { app.message(e.message, 'erreur'); }
    });
    zone.querySelector('[data-appliquer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('execution_btp.types.confirmer'))) return;
      try { const r = await api.execution.appliquerType(type); app.message(pluriel('execution_btp.types.appliques', r.ordres), 'succes'); } catch (e) { app.message(e.message, 'erreur'); }
    });
  };
  const charger = async () => { etats = type ? await api.execution.etatsType(type) : []; rendre(); };
  await charger();
}
