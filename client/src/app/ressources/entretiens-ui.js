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

export const NATURES_ENTRETIEN = { PREVENTIF: 'Préventif', CURATIF: 'Curatif (réparation)', REGLEMENTAIRE: 'Réglementaire' };

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const optionsNature = () => Object.entries(NATURES_ENTRETIEN).map(([valeur, libelle]) => ({ valeur, libelle }));

/** Bloc « Matériel entretenu » de l'entête d'un ordre d'entretien. */
export async function rendreEntretienOrdre(zone, { app, entId }) {
  if (!entId || entId < 0) { zone.innerHTML = '<p class="aide">Enregistrez l\'ordre d\'abord.</p>'; return; }
  let d = await api.ressources.entretien(entId);
  const rendre = () => {
    if (!d.materiel) { zone.innerHTML = '<p class="aide">Ordre sans matériel : créez les ordres d\'entretien depuis la fiche du matériel (onglet Compteurs).</p>'; return; }
    const m = d.materiel;
    const unites = unitesCompteurs(m.compteurs);
    const r = d.releve ?? {};
    zone.innerHTML = `<p><a href="${urlFiche(TYPE_FICHE.MATERIEL, m.id)}">🚜 ${echapper(m.code)} ${echapper(m.designation)}</a>
        <span class="aide">${unites.includes('H') ? `${formatNombre(m.heures ?? 0, 0)} h` : ''} ${unites.includes('KM') && m.kilometres != null ? `· ${formatNombre(m.kilometres, 0)} km` : ''}</span></p>
      <div class="formulaire-compact"><label>Nature <span data-nature></span></label>
      ${unites.length ? `<label>Compteur à l'intervention <input type="date" data-c="date" value="${echapper(r.date ? String(r.date).slice(0, 10) : '')}">
        <span data-unite></span><input type="number" min="0" step="0.1" data-c="valeur" value="${echapper(r.valeur ?? '')}" size="8"></label>
        <label><input type="checkbox" data-c="remise" ${r.remise ? 'checked' : ''}> Remise à zéro</label>` : ''}
      <p class="aide">À la clôture (état Terminé), l'entretien s'inscrit dans l'historique du matériel.</p>
      <div><button type="button" data-enregistrer>Enregistrer</button></div></div>`;
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
        app.message('Entretien enregistré', 'succes');
        rendre();
      } catch (e) { app.erreur(new Error(MESSAGES_COMPTEURS[e.code] ?? e.message)); }
    });
  };
  rendre();
}

/** Fenêtre de création d'un ordre d'entretien : nature, objet, opérations (une par ligne). */
export async function saisirNouvelEntretien(valeurs = {}) {
  return ouvrirDialogue({
    titre: '🔧 Nouvel ordre d\'entretien',
    html: `<div class="formulaire-compact"><label>Nature <span data-nature></span></label>
      <label>Objet <input data-c="objet" maxlength="200" size="40" value="${echapper(valeurs.objet ?? '')}"></label>
      <label>Opérations <textarea data-c="operations" rows="4" cols="40" placeholder="Une opération par ligne">${echapper((valeurs.operations ?? []).join('\n'))}</textarea></label>
      <p class="aide">L'ordre est créé en brouillon sur le chantier de suivi du matériel : ajoutez-y la main-d'œuvre (heures) et les pièces.</p></div>`,
    focus: '[data-c="objet"]',
    construire: (dlg) => { dlg._nature = creerCombo({ options: optionsNature(), valeur: valeurs.nature ?? 'CURATIF', vide: false }); dlg.querySelector('[data-nature]').append(dlg._nature); },
    boutons: [{ libelle: 'Annuler', valeur: null }, {
      libelle: 'Créer', principal: true,
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
  if (!ordres.length) return '<p class="aide">Aucun ordre d\'entretien.</p>';
  return `<table class="tableau-compact largeur-contenu"><thead><tr><th>Ordre</th><th>Date</th><th>Objet</th><th>Nature</th><th>État</th><th>Statut</th></tr></thead><tbody>
    ${ordres.map((o) => `<tr><td><a href="${urlDocument(o.id)}">${echapper(o.numero ?? 'Brouillon')}</a></td><td>${jour(o.date)}</td><td>${echapper(o.objet ?? '')}</td>
      <td>${echapper(NATURES_ENTRETIEN[o.nature] ?? '')}</td><td>${o.etat ? `${ETATS_EXECUTION[o.etat]?.icone ?? ''} ${echapper(ETATS_EXECUTION[o.etat]?.libelle ?? o.etat)}` : ''}</td><td>${echapper(o.statut ?? '')}</td></tr>`).join('')}</tbody></table>`;
}

// ------------------------------------------------------------------ plans et échéances (lot 5c-4, db/235)

const ORIGINES_PLAN = { TYPE_PARENT: 'type parent', TYPE: 'type', MATERIEL: 'matériel' };
const periodicite = (p) => [p.heures ? `${formatNombre(p.heures, 0)} h` : '', p.km ? `${formatNombre(p.km, 0)} km` : '', p.mois ? `${p.mois} mois` : ''].filter(Boolean).join(' · ');

/** Pastille de l'état d'une échéance. */
export function pastilleEcheance(etat) {
  const e = ETATS_ECHEANCE[etat] ?? ETATS_ECHEANCE.INCONNU;
  return pastille(e.libelle, e.classe);
}

/** Détail des critères d'une échéance : reste en heures, kilomètres ou jours, date estimée. */
function criteres(e) {
  return e.criteres.map((c) => {
    if (c.critere === 'MOIS') return `le ${jour(c.echeance)}`;
    const u = c.critere === 'H' ? 'h' : 'km';
    const reste = Number(c.reste);
    return `${reste <= 0 ? `dépassé de ${formatNombre(-reste, 0)} ${u}` : `dans ${formatNombre(reste, 0)} ${u}`}${c.date && reste > 0 ? ` (≈ ${jour(c.date)})` : ''}`;
  }).join(' · ');
}

/** Tableau des échéances (avec la colonne Matériel pour la page « à surveiller »). */
export function tableauEcheances(l, { materiel = false, actions = false } = {}) {
  if (!l.length) return `<p class="aide">${materiel ? 'Aucun entretien en retard ni à prévoir dans ce délai.' : 'Aucun plan d\'entretien.'}</p>`;
  return `<table class="tableau-compact largeur-contenu"><thead><tr>${materiel ? '<th>Matériel</th>' : ''}<th>Plan</th><th>Périodicité</th><th>Dernier</th><th>Échéance</th><th>État</th>${actions ? '<th></th>' : ''}</tr></thead><tbody>
    ${l.map((x, i) => `<tr>${materiel ? `<td><a href="${urlFiche(TYPE_FICHE.MATERIEL, x.materiel_id)}">🚜 ${echapper(x.materiel_code)} ${echapper(x.designation ?? '')}</a></td>` : ''}
      <td>${echapper(x.libelle ?? x.code)} <small class="aide">${echapper(x.code)} · ${echapper(ORIGINES_PLAN[x.origine] ?? '')}</small></td>
      <td>${periodicite(x)}</td><td>${x.dernier_le ? jour(x.dernier_le) : '<span class="aide">jamais</span>'}</td>
      <td>${criteres(x.echeance)}</td><td>${pastilleEcheance(x.echeance.etat)}</td>
      ${actions ? `<td class="cellule-boutons"><button type="button" class="bouton-icone" data-creer-ordre="${i}" title="Créer l'ordre d'entretien de ce plan">🔧</button></td>` : ''}</tr>`).join('')}</tbody></table>`;
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
  <td><input type="checkbox" data-c="actif" ${p.actif !== false ? 'checked' : ''} ${lecture ? 'disabled' : ''} title="Décoché : le plan hérité de même code est retiré"></td>
  <td class="cellule-boutons">${lecture ? '' : '<button type="button" class="bouton-icone" data-retirer title="Retirer ce plan">✕</button>'}</td></tr>`;

/**
 * Éditeur de plans (type de matériel ou matériel) : tableau saisi puis enregistré en entier ; `herites` : plans hérités
 * proposés au remplacement ou à la désactivation (même code).
 */
export function editeurPlans(zone, { plans, herites = [], lecture = false, enregistrer, app }) {
  let saisie = plans.map((p) => ({ ...p }));
  const rendre = () => {
    const codes = new Set(saisie.map((p) => p.code));
    const libres = herites.filter((h) => !codes.has(h.code));
    zone.innerHTML = `${libres.length && !lecture ? `<p class="aide">Hérités : ${libres.map((h) => `<b>${echapper(h.code)}</b> ${echapper(h.libelle ?? '')} (${periodicite(h)})
        <button type="button" class="bouton-icone" data-remplacer="${echapper(h.code)}" title="Remplacer pour ce matériel">✎</button>
        <button type="button" class="bouton-icone" data-desactiver="${echapper(h.code)}" title="Ne pas appliquer à ce matériel">⊘</button>`).join(' · ')}</p>` : ''}
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Code</th><th>Libellé</th><th>Heures</th><th>Km</th><th>Mois</th><th>Nature</th><th>Opérations (une par ligne)</th><th>Actif</th><th></th></tr></thead><tbody>
      ${saisie.map((p, i) => champsPlan(p, i, lecture)).join('') || '<tr><td colspan="9" class="aide">Aucun plan.</td></tr>'}</tbody></table>
      ${lecture ? '' : '<p><button type="button" class="bouton-icone" data-ajouter title="Nouveau plan">＋</button> <button type="button" class="principal" data-enregistrer>Enregistrer les plans</button></p>'}`;
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
        app.message('Plans enregistrés', 'succes');
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
    zone.innerHTML = `<div class="titre-actions"><h4>Plans d'entretien</h4><span class="titre-actions-boutons">
        <button type="button" class="bouton-icone" data-editer title="Plans propres à ce matériel (remplacer ou retirer un plan du type)">✎</button></span></div>
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
