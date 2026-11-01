import { texte, texteHtml, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { pastille } from '../pastilles.js';
import { urlFiche, TYPE_FICHE, urlDocument } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { echapper, creerCombo, formatNombre, ouvrirDialogue } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { ETATS_EXECUTION } from '../execution/execution.js';
import { LIBELLES_UNITE, MESSAGES_COMPTEURS, unitesCompteurs } from './compteurs.js';
import { ETATS_ECHEANCE } from './entretiens.js';

// Ordres d'entretien du matériel (lot 5c-3, db/234) : bloc « Matériel entretenu » de l'entête d'un ordre E_ENT
// (matériel, nature, relevé du compteur à l'intervention, enregistrés à part du document, même validé) ; fenêtre de
// création depuis la fiche matériel ; ligne d'ordre dans l'onglet Compteurs.

export const NATURES_ENTRETIEN = textesParCode('ressources_btp.entretiens.natures', ['PREVENTIF', 'CURATIF', 'REGLEMENTAIRE']);

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const optionsNature = () => Object.entries(NATURES_ENTRETIEN).map(([valeur, libelle]) => ({ valeur, libelle }));

/** Bloc « Matériel entretenu » de l'entête d'un ordre d'entretien. */
export async function rendreEntretienOrdre(zone, { app, entId }) {
  if (!entId || entId < 0) { zone.innerHTML = `<p class="aide">${texteHtml('ressources_btp.entretiens.ordre.nouveau')}</p>`; return; }
  let d = await api.ressources.entretien(entId);
  const rendre = () => {
    if (!d.materiel) { zone.innerHTML = `<p class="aide">${texteHtml('ressources_btp.entretiens.ordre.sans_materiel')}</p>`; return; }
    const m = d.materiel;
    const unites = unitesCompteurs(m.compteurs);
    const r = d.releve ?? {};
    zone.innerHTML = `<p><a href="${urlFiche(TYPE_FICHE.MATERIEL, m.id)}">${iconeHtml('ressources_btp_materiel')} ${echapper(m.code)} ${echapper(m.designation)}</a>
        <span class="aide">${unites.includes('H') ? `${formatNombre(m.heures ?? 0, 0)} ${LIBELLES_UNITE.H}` : ''} ${unites.includes('KM') && m.kilometres != null ? `· ${formatNombre(m.kilometres, 0)} ${LIBELLES_UNITE.KM}` : ''}</span></p>
      <div class="formulaire-compact"><label>${texteHtml('ressources_btp.entretiens.champs.nature')} <span data-nature></span></label>
      ${unites.length ? `<label>${texteHtml('ressources_btp.entretiens.champs.compteur')} <input type="date" data-c="date" value="${echapper(r.date ? String(r.date).slice(0, 10) : '')}">
        <span data-unite></span><input type="number" min="0" step="0.1" data-c="valeur" value="${echapper(r.valeur ?? '')}" size="8"></label>
        <label><input type="checkbox" data-c="remise" ${r.remise ? 'checked' : ''}> ${texteHtml('ressources_btp.compteurs.champs.remise')}</label>` : ''}
      <p class="aide">${texteHtml('ressources_btp.entretiens.ordre.cloture')}</p>
      <div><button type="button" data-enregistrer>${texteHtml('commun.enregistrer')}</button></div></div>`;
    const nature = creerCombo({ options: optionsNature(), valeur: d.nature ?? '', vide: true });
    zone.querySelector('[data-nature]').append(nature);
    const unite = unites.length ? creerCombo({ options: unites.map((u) => ({ valeur: u, libelle: LIBELLES_UNITE[u] })), valeur: r.unite ?? unites[0], vide: false }) : null;
    if (unite) zone.querySelector('[data-unite]').append(unite);
    zone.querySelector('[data-enregistrer]').addEventListener('click', async () => {
      const valeur = zone.querySelector('[data-c="valeur"]')?.value ?? '';
      try {
        d = await api.ressources.enregistrerEntretien(entId, {
          nature: nature.valeurCombo || null,
          releve: valeur === '' ? null : {
            date: zone.querySelector('[data-c="date"]').value || aujourdhui(), unite: unite.valeurCombo, valeur: Number(valeur),
            remise: zone.querySelector('[data-c="remise"]').checked,
          },
        });
        app.message(texte('ressources_btp.entretiens.messages.enregistre'), 'succes');
        rendre();
      } catch (e) { app.erreur(new Error(MESSAGES_COMPTEURS[e.code] ?? e.message)); }
    });
  };
  rendre();
}

/** Fenêtre de création d'un ordre d'entretien : nature, objet, opérations (une par ligne). */
export async function saisirNouvelEntretien(valeurs = {}) {
  return ouvrirDialogue({
    titre: `${icone('ressources_btp_entretien')} ${texte('ressources_btp.entretiens.nouveau.titre')}`,
    html: `<div class="formulaire-compact"><label>${texteHtml('ressources_btp.entretiens.champs.nature')} <span data-nature></span></label>
      <label>${texteHtml('ressources_btp.entretiens.champs.objet')} <input data-c="objet" maxlength="200" size="40" value="${echapper(valeurs.objet ?? '')}"></label>
      <label>${texteHtml('ressources_btp.entretiens.champs.operations')} <textarea data-c="operations" rows="4" cols="40" placeholder="${texteHtml('ressources_btp.entretiens.champs.operations_aide')}">${echapper((valeurs.operations ?? []).join('\n'))}</textarea></label>
      <p class="aide">${texteHtml('ressources_btp.entretiens.nouveau.aide')}</p></div>`,
    focus: '[data-c="objet"]',
    construire: (dlg) => { dlg._nature = creerCombo({ options: optionsNature(), valeur: valeurs.nature ?? 'CURATIF', vide: false }); dlg.querySelector('[data-nature]').append(dlg._nature); },
    boutons: [{ libelle: texte('commun.annuler'), valeur: null }, {
      libelle: texte('commun.creer'), principal: true,
      valeur: (dlg) => ({
        nature: dlg._nature.valeurCombo, objet: dlg.querySelector('[data-c="objet"]').value || null,
        operations: dlg.querySelector('[data-c="operations"]').value.split('\n').map((x) => x.trim()).filter(Boolean), plan: valeurs.plan ?? null,
      }),
    }],
  });
}

/** Crée l'ordre (fenêtre) puis l'ouvre ; rend vrai si un ordre a été créé. */
export async function creerOrdreEntretien(app, materiel, valeurs) {
  const n = await saisirNouvelEntretien(valeurs);
  if (!n) return false;
  try {
    const { ent_id: id } = await api.ressources.creerOrdreEntretien(materiel, n);
    app.naviguer(urlDocument(id), { nouvelleFenetre: true });
    return true;
  } catch (e) { app.erreur(e); return false; }
}

/** Tableau des ordres d'entretien d'un matériel (onglet Compteurs). */
export function tableauOrdres(ordres) {
  if (!ordres.length) return `<p class="aide">${texteHtml('ressources_btp.entretiens.ordres.aucun')}</p>`;
  return `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.entretiens.colonnes.ordre')}</th><th>${texteHtml('ressources_btp.entretiens.colonnes.date')}</th><th>${texteHtml('ressources_btp.entretiens.champs.objet')}</th><th>${texteHtml('ressources_btp.entretiens.champs.nature')}</th><th>${texteHtml('ressources_btp.entretiens.colonnes.etat')}</th><th>${texteHtml('ressources_btp.entretiens.colonnes.statut')}</th></tr></thead><tbody>
    ${ordres.map((o) => `<tr><td><a href="${urlDocument(o.id)}">${echapper(o.numero ?? texte('ressources_btp.entretiens.ordres.brouillon'))}</a></td><td>${jour(o.date)}</td><td>${echapper(o.objet ?? '')}</td>
      <td>${echapper(NATURES_ENTRETIEN[o.nature] ?? '')}</td><td>${o.etat ? `${ETATS_EXECUTION[o.etat]?.icone ?? ''} ${echapper(ETATS_EXECUTION[o.etat]?.libelle ?? o.etat)}` : ''}</td><td>${echapper(o.statut ?? '')}</td></tr>`).join('')}</tbody></table>`;
}

// ------------------------------------------------------------------ plans et échéances (lot 5c-4, db/235)

const ORIGINES_PLAN = textesParCode('ressources_btp.entretiens.origines', ['TYPE_PARENT', 'TYPE', 'MATERIEL']);
const periodicite = (p) => [p.heures ? `${formatNombre(p.heures, 0)} ${LIBELLES_UNITE.H}` : '', p.km ? `${formatNombre(p.km, 0)} ${LIBELLES_UNITE.KM}` : '', p.mois ? texte('ressources_btp.entretiens.mois', { nombre: p.mois }) : ''].filter(Boolean).join(' · ');

/** Pastille de l'état d'une échéance. */
export function pastilleEcheance(etat) {
  const e = ETATS_ECHEANCE[etat] ?? ETATS_ECHEANCE.INCONNU;
  return pastille(e.libelle, e.classe);
}

/** Détail des critères d'une échéance : reste en heures, kilomètres ou jours, date estimée. */
function criteres(e) {
  return e.criteres.map((c) => {
    if (c.critere === 'MOIS') return texte('ressources_btp.entretiens.criteres.le', { date: jour(c.echeance) });
    const u = c.critere === 'H' ? LIBELLES_UNITE.H : LIBELLES_UNITE.KM;
    const reste = Number(c.reste);
    return `${reste <= 0 ? texte('ressources_btp.entretiens.criteres.depasse', { valeur: formatNombre(-reste, 0), unite: u }) : texte('ressources_btp.entretiens.criteres.dans', { valeur: formatNombre(reste, 0), unite: u })}${c.date && reste > 0 ? ` (≈ ${jour(c.date)})` : ''}`;
  }).join(' · ');
}

/** Tableau des échéances (avec la colonne Matériel pour la page « à surveiller »). */
export function tableauEcheances(l, { materiel = false, actions = false } = {}) {
  if (!l.length) return `<p class="aide">${texteHtml(materiel ? 'ressources_btp.entretiens.echeances.aucune' : 'ressources_btp.entretiens.echeances.aucun_plan')}</p>`;
  return `<table class="tableau-compact largeur-contenu"><thead><tr>${materiel ? `<th>${texteHtml('ressources_btp.entretiens.colonnes.materiel')}</th>` : ''}<th>${texteHtml('ressources_btp.entretiens.colonnes.plan')}</th><th>${texteHtml('ressources_btp.entretiens.colonnes.periodicite')}</th><th>${texteHtml('ressources_btp.entretiens.colonnes.dernier')}</th><th>${texteHtml('ressources_btp.entretiens.colonnes.echeance')}</th><th>${texteHtml('ressources_btp.entretiens.colonnes.etat')}</th>${actions ? '<th></th>' : ''}</tr></thead><tbody>
    ${l.map((x, i) => `<tr>${materiel ? `<td><a href="${urlFiche(TYPE_FICHE.MATERIEL, x.materiel_id)}">${iconeHtml('ressources_btp_materiel')} ${echapper(x.materiel_code)} ${echapper(x.designation ?? '')}</a></td>` : ''}
      <td>${echapper(x.libelle ?? x.code)} <small class="aide">${echapper(x.code)} · ${echapper(ORIGINES_PLAN[x.origine] ?? '')}</small></td>
      <td>${periodicite(x)}</td><td>${x.dernier_le ? jour(x.dernier_le) : `<span class="aide">${texteHtml('ressources_btp.entretiens.jamais')}</span>`}</td>
      <td>${criteres(x.echeance)}</td><td>${pastilleEcheance(x.echeance.etat)}</td>
      ${actions ? `<td class="cellule-boutons"><button type="button" class="bouton-icone" data-creer-ordre="${i}" title="${texteHtml('ressources_btp.entretiens.creer_ordre')}">${iconeHtml('ressources_btp_entretien')}</button></td>` : ''}</tr>`).join('')}</tbody></table>`;
}

/** Ligne de saisie d'un plan. */
const champsPlan = (p, i, lecture) => `<tr data-i="${i}">
  <td><input data-c="code" value="${echapper(p.code ?? '')}" size="10" maxlength="20" ${lecture ? 'readonly' : ''}></td>
  <td><input data-c="libelle" value="${echapper(p.libelle ?? '')}" size="24" maxlength="150" ${lecture ? 'readonly' : ''}></td>
  <td><input data-c="heures" type="number" min="0" value="${echapper(p.heures ?? '')}" size="6" ${lecture ? 'readonly' : ''}></td>
  <td><input data-c="km" type="number" min="0" value="${echapper(p.km ?? '')}" size="7" ${lecture ? 'readonly' : ''}></td>
  <td><input data-c="mois" type="number" min="0" value="${echapper(p.mois ?? '')}" size="4" ${lecture ? 'readonly' : ''}></td>
  <td data-nature></td>
  <td><textarea data-c="operations" rows="2" cols="28" ${lecture ? 'readonly' : ''}>${echapper(p.operations ?? '')}</textarea></td>
  <td><input type="checkbox" data-c="actif" ${p.actif !== false ? 'checked' : ''} ${lecture ? 'disabled' : ''} title="${texteHtml('ressources_btp.entretiens.plans.actif_aide')}"></td>
  <td class="cellule-boutons">${lecture ? '' : `<button type="button" class="bouton-icone" data-retirer title="${texteHtml('ressources_btp.entretiens.plans.retirer')}">${iconeHtml('retirer')}</button>`}</td></tr>`;

/**
 * Éditeur de plans (type de matériel ou matériel) : tableau saisi puis enregistré en entier ; `herites` : plans hérités
 * proposés au remplacement ou à la désactivation (même code).
 */
export function editeurPlans(zone, { plans, herites = [], lecture = false, enregistrer, app }) {
  let saisie = plans.map((p) => ({ ...p }));
  const rendre = () => {
    const codes = new Set(saisie.map((p) => p.code));
    const libres = herites.filter((h) => !codes.has(h.code));
    zone.innerHTML = `${libres.length && !lecture ? `<p class="aide">${texteHtml('ressources_btp.entretiens.plans.herites')} ${libres.map((h) => `<b>${echapper(h.code)}</b> ${echapper(h.libelle ?? '')} (${periodicite(h)})
        <button type="button" class="bouton-icone" data-remplacer="${echapper(h.code)}" title="${texteHtml('ressources_btp.entretiens.plans.remplacer')}">${iconeHtml('ressources_btp_modifier')}</button>
        <button type="button" class="bouton-icone" data-desactiver="${echapper(h.code)}" title="${texteHtml('ressources_btp.entretiens.plans.desactiver')}">${iconeHtml('ressources_btp_desactiver')}</button>`).join(' · ')}</p>` : ''}
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('ressources_btp.entretiens.plans.heures')}</th><th>${texteHtml('ressources_btp.entretiens.plans.km')}</th><th>${texteHtml('ressources_btp.entretiens.plans.mois')}</th><th>${texteHtml('ressources_btp.entretiens.champs.nature')}</th><th>${texteHtml('ressources_btp.entretiens.plans.operations')}</th><th>${texteHtml('ressources_btp.entretiens.plans.actif')}</th><th></th></tr></thead><tbody>
      ${saisie.map((p, i) => champsPlan(p, i, lecture)).join('') || `<tr><td colspan="9" class="aide">${texteHtml('ressources_btp.entretiens.plans.aucun')}</td></tr>`}</tbody></table>
      ${lecture ? '' : `<p><button type="button" class="bouton-icone" data-ajouter title="${texteHtml('ressources_btp.entretiens.plans.ajouter')}">${iconeHtml('ajouter')}</button> <button type="button" class="principal" data-enregistrer>${texteHtml('ressources_btp.entretiens.plans.enregistrer')}</button></p>`}`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const p = saisie[Number(tr.dataset.i)];
      const n = creerCombo({ options: optionsNature(), valeur: p.nature ?? 'PREVENTIF', vide: false });
      n.readOnly = lecture;
      n.addEventListener('change', () => { p.nature = n.valeurCombo; });
      tr.querySelector('[data-nature]').append(n);
      tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        const k = c.dataset.c;
        p[k] = k === 'actif' ? c.checked : ['heures', 'km', 'mois'].includes(k) ? (c.value === '' ? null : Number(c.value)) : k === 'code' ? c.value.trim().toUpperCase() : c.value;
      }));
      tr.querySelector('[data-retirer]')?.addEventListener('click', () => { saisie.splice(Number(tr.dataset.i), 1); rendre(); });
    });
    zone.querySelector('[data-ajouter]')?.addEventListener('click', () => { saisie.push({ code: '', nature: 'PREVENTIF', actif: true }); rendre(); });
    zone.querySelectorAll('[data-remplacer]').forEach((b) => b.addEventListener('click', () => {
      const h = herites.find((x) => x.code === b.dataset.remplacer);
      saisie.push({ code: h.code, libelle: h.libelle, heures: h.heures, km: h.km, mois: h.mois, nature: 'PREVENTIF', actif: true });
      rendre();
    }));
    zone.querySelectorAll('[data-desactiver]').forEach((b) => b.addEventListener('click', () => {
      const h = herites.find((x) => x.code === b.dataset.desactiver);
      saisie.push({ code: h.code, libelle: h.libelle, actif: false, nature: 'PREVENTIF' });
      rendre();
    }));
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        saisie = (await enregistrer(saisie.map((p, i) => ({ ...p, ordre: (i + 1) * 10 })))).map((p) => ({ ...p }));
        app.message(texte('ressources_btp.entretiens.messages.plans'), 'succes');
        rendre();
      } catch (e) { app.erreur(e); }
    });
  };
  rendre();
}

/** Section « Plans d'entretien » de l'onglet Compteurs : échéances, création de l'ordre d'un plan, plans propres au matériel. */
export async function rendrePlansMateriel(zone, { app, materiel, surOrdre }) {
  const rendre = async () => {
    const echeances = await api.ressources.echeancesMateriel(materiel);
    zone.innerHTML = `<div class="titre-actions"><h4>${texteHtml('ressources_btp.entretiens.plans.titre')}</h4><span class="titre-actions-boutons">
        <button type="button" class="bouton-icone" data-editer title="${texteHtml('ressources_btp.entretiens.plans.editer')}">${iconeHtml('ressources_btp_modifier')}</button></span></div>
      ${tableauEcheances(echeances, { actions: true })}<div data-editeur hidden></div>`;
    zone.querySelectorAll('[data-creer-ordre]').forEach((b) => b.addEventListener('click', async () => {
      const x = echeances[Number(b.dataset.creerOrdre)];
      const cree = await creerOrdreEntretien(app, materiel, {
        nature: x.nature, objet: x.libelle ?? x.code, plan: x.plan_id, operations: (x.operations ?? '').split('\n').map((o) => o.trim()).filter(Boolean),
      });
      if (cree) surOrdre?.();
    }));
    zone.querySelector('[data-editer]').addEventListener('click', async () => {
      const ed = zone.querySelector('[data-editeur]');
      ed.hidden = !ed.hidden;
      if (ed.hidden) return;
      const p = await api.ressources.plansMateriel(materiel);
      editeurPlans(ed, {
        app, plans: p.propres, herites: p.herites,
        enregistrer: async (l) => { const r = await api.ressources.enregistrerPlansMateriel(materiel, l); rendre(); return r; },
      });
    });
    return echeances;
  };
  return rendre();
}
