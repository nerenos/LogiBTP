import { texte, texteHtml, icone, iconeHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { urlDocument } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { echapper, creerCombo, formatNombre, ouvrirDialogue, confirmer } from '@logibtp/socle/ui';
import { ecrireDuree } from '@logibtp/pointage';
import { api } from '../api.js';
import {
  LIBELLES_UNITE, LIBELLES_EVENEMENT, ICONES_EVENEMENT, TYPES_EVENEMENT, MESSAGES_COMPTEURS,
  unitesCompteurs, cumuls, controlerEvenement, controlerReleves,
} from './compteurs.js';
import { creerOrdreEntretien, tableauOrdres, rendrePlansMateriel } from './entretiens-ui.js';

// Onglet Compteurs de la fiche matériel (lot 5c-2, db/233) : compteurs actuels, frise (courbe de chaque compteur,
// événements et entretiens), journal des relevés et des événements ; saisie d'un relevé, d'un plein de carburant ou
// d'un événement dans une fenêtre <dialog>. Contrôles de compteurs.js (↔ ReglesCompteurs.cs) avant l'envoi.

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const SOURCES = textesParCode('ressources_btp.compteurs.sources', ['SAISIE', 'CARBURANT', 'ORDRE', 'BORNE', 'REPRISE', 'TERRAIN', 'INVENTAIRE']);
const message = (e) => MESSAGES_COMPTEURS[e.code] ?? e.message;

/** Frise SVG : une courbe par unité (valeurs cumulées), événements en pastilles au-dessus, sur la période des données. */
function frise(d, unites) {
  const series = unites.map((u) => ({ u, points: cumuls(d.releves.map((r) => ({ ...r, valeur: Number(r.valeur) })), u) })).filter((s) => s.points.length);
  const dates = [...series.flatMap((s) => s.points.map((p) => p.date)), ...d.evenements.map((e) => String(e.date).slice(0, 10))];
  if (!dates.length) return `<p class="aide">${texteHtml('ressources_btp.compteurs.aucun')}</p>`;
  const t = (x) => new Date(`${x}T00:00:00Z`).getTime();
  const debut = t(dates.reduce((a, b) => (a < b ? a : b)));
  const fin = Math.max(t(aujourdhui()), t(dates.reduce((a, b) => (a > b ? a : b))));
  const L = 800, G = 60, D = 16, bande = 34, hauteurSerie = 90;
  const x = (date) => G + ((t(date) - debut) / Math.max(fin - debut, 1)) * (L - G - D);
  const H = bande + series.length * (hauteurSerie + 14) + 18;
  const evts = d.evenements.map((e) => `<g class="frise-evenement frise-${e.type.toLowerCase()}"><title>${echapper(`${jour(e.date)} · ${LIBELLES_EVENEMENT[e.type] ?? e.type}${e.libelle ? ` : ${e.libelle}` : ''}`)}</title>
      ${e.fin ? `<rect x="${x(String(e.date).slice(0, 10))}" y="${bande - 8}" width="${Math.max(x(String(e.fin).slice(0, 10)) - x(String(e.date).slice(0, 10)), 2)}" height="4" class="frise-duree"/>` : ''}
      <text x="${x(String(e.date).slice(0, 10))}" y="${bande - 14}" text-anchor="middle">${ICONES_EVENEMENT[e.type] ?? icone('ressources_btp_point')}</text></g>`).join('');
  const courbes = series.map((s, i) => {
    const y0 = bande + i * (hauteurSerie + 14) + 8;
    const min = Math.min(...s.points.map((p) => p.cumul)), max = Math.max(...s.points.map((p) => p.cumul));
    const y = (v) => y0 + hauteurSerie - ((v - min) / Math.max(max - min, 1)) * hauteurSerie;
    const pts = s.points.map((p) => `${x(p.date).toFixed(1)},${y(p.cumul).toFixed(1)}`).join(' ');
    return `<g class="frise-serie"><text x="${G - 6}" y="${y0 + 10}" text-anchor="end" class="frise-axe">${formatNombre(max, 0)} ${LIBELLES_UNITE[s.u]}</text>
      <text x="${G - 6}" y="${y0 + hauteurSerie}" text-anchor="end" class="frise-axe">${formatNombre(min, 0)}</text>
      <line x1="${G}" x2="${L - D}" y1="${y0 + hauteurSerie}" y2="${y0 + hauteurSerie}" class="frise-ligne"/>
      <polyline points="${pts}" class="frise-courbe"/>
      ${s.points.map((p) => `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.cumul).toFixed(1)}" r="2.5" class="frise-point"><title>${jour(p.date)} : ${formatNombre(p.valeur, 0)} ${LIBELLES_UNITE[s.u]}</title></circle>`).join('')}</g>`;
  }).join('');
  return `<svg class="frise-materiel" viewBox="0 0 ${L} ${H}" role="img" aria-label="${texteHtml('ressources_btp.compteurs.frise')}">
    <line x1="${G}" x2="${L - D}" y1="${bande - 6}" y2="${bande - 6}" class="frise-ligne"/>${evts}${courbes}
    <text x="${G}" y="${H - 4}" class="frise-axe">${jour(new Date(debut).toISOString())}</text>
    <text x="${L - D}" y="${H - 4}" text-anchor="end" class="frise-axe">${jour(new Date(fin).toISOString())}</text></svg>`;
}

/**
 * Fenêtre de saisie d'un relevé seul ; rectification (db/252) : valeur corrigée, qui peut être inférieure au relevé
 * précédent, avec un motif obligatoire.
 */
async function saisirReleve(unites, { rectification = false } = {}) {
  return ouvrirDialogue({
    titre: texte(`ressources_btp.compteurs.${rectification ? 'rectification' : 'releve'}.titre`),
    html: `<div class="formulaire-compact">${rectification ? `<p class="aide">${texteHtml('ressources_btp.compteurs.rectification.aide')}</p>` : ''}
      <label>${texteHtml('ressources_btp.compteurs.champs.date')} <input type="date" data-c="date" value="${aujourdhui()}"></label>
      <label>${texteHtml('ressources_btp.compteurs.champs.compteur')} <span data-unite></span></label><label>${texteHtml(`ressources_btp.compteurs.champs.${rectification ? 'valeur_corrigee' : 'valeur'}`)} <input type="number" min="0" step="0.1" data-c="valeur"></label>
      ${rectification ? '' : `<label><input type="checkbox" data-c="remise"> ${texteHtml('ressources_btp.compteurs.champs.remise_remplace')}</label>`}
      <label>${texteHtml(`ressources_btp.compteurs.champs.${rectification ? 'motif' : 'commentaire'}`)} <input data-c="commentaire" maxlength="200" size="30"></label></div>`,
    focus: '[data-c="valeur"]',
    construire: (dlg) => { dlg._unite = creerCombo({ options: unites.map((u) => ({ valeur: u, libelle: LIBELLES_UNITE[u] })), valeur: unites[0], vide: false }); dlg.querySelector('[data-unite]').append(dlg._unite); },
    boutons: [{ libelle: texte('commun.annuler'), valeur: null }, {
      libelle: texte('commun.enregistrer'), principal: true,
      valeur: (dlg) => ({
        date: dlg.querySelector('[data-c="date"]').value || null, unite: dlg._unite.valeurCombo,
        valeur: dlg.querySelector('[data-c="valeur"]').value === '' ? null : Number(dlg.querySelector('[data-c="valeur"]').value),
        remise: dlg.querySelector('[data-c="remise"]')?.checked ?? false, commentaire: dlg.querySelector('[data-c="commentaire"]').value || null,
        rectification,
      }),
    }],
  });
}

/** Fenêtre de saisie d'un événement (plein de carburant : type imposé) avec son relevé facultatif. */
async function saisirEvenement(unites, e = {}, plans = []) {
  const v = (k) => echapper(e[k] ?? '');
  const r = e.releve ?? {};
  return ouvrirDialogue({
    titre: e.type === 'CARBURANT' ? `${icone('ressources_btp_plein')} ${LIBELLES_EVENEMENT.CARBURANT}` : texte(e.id ? 'ressources_btp.compteurs.evenement.titre' : 'ressources_btp.compteurs.evenement.nouveau'),
    html: `<div class="formulaire-compact"><label>${texteHtml('ressources_btp.compteurs.champs.type')} <span data-type></span></label>
      <label>${texteHtml('ressources_btp.compteurs.champs.date')} <input type="date" data-c="date" value="${v('date') || aujourdhui()}"></label>
      <label data-hors-plein>${texteHtml('ressources_btp.compteurs.champs.fin')} <input type="date" data-c="fin" value="${v('fin')}"></label>
      <label data-hors-plein>${texteHtml('commun.libelle')} <input data-c="libelle" maxlength="150" size="34" value="${v('libelle')}"></label>
      ${plans.length ? `<label data-plan>${texteHtml('ressources_btp.compteurs.champs.plan')} <span data-plan-combo></span></label>` : ''}
      <label data-plein>${texteHtml('ressources_btp.compteurs.champs.litres')} <input type="number" min="0" step="0.01" data-c="litres" value="${v('litres')}"></label>
      <label>${texteHtml('ressources_btp.compteurs.champs.cout')} <input type="number" min="0" step="0.01" data-c="cout" value="${v('cout')}"></label>
      ${unites.length ? `<label>${texteHtml('ressources_btp.compteurs.champs.compteur')} <span data-unite></span> <input type="number" min="0" step="0.1" data-c="releve" value="${echapper(r.valeur ?? '')}"></label>
      <label><input type="checkbox" data-c="remise" ${r.remise ? 'checked' : ''}> ${texteHtml('ressources_btp.compteurs.champs.remise')}</label>` : ''}
      <label data-hors-plein>${texteHtml('ressources_btp.compteurs.champs.description')} <textarea data-c="description" rows="3" cols="40">${v('description')}</textarea></label>
      <p class="connexion-erreur" data-erreur hidden></p></div>`,
    focus: e.type === 'CARBURANT' ? '[data-c="litres"]' : '[data-c="libelle"]',
    construire: (dlg) => {
      dlg._type = creerCombo({ options: TYPES_EVENEMENT.map((t) => ({ valeur: t, libelle: `${ICONES_EVENEMENT[t]} ${LIBELLES_EVENEMENT[t]}` })), valeur: e.type ?? 'PANNE', vide: false });
      const basculer = () => {
        const plein = dlg._type.valeurCombo === 'CARBURANT';
        dlg.querySelectorAll('[data-plein]').forEach((x) => { x.hidden = !plein; });
        dlg.querySelectorAll('[data-hors-plein]').forEach((x) => { x.hidden = plein; });
        dlg.querySelectorAll('[data-plan]').forEach((x) => { x.hidden = !['ENTRETIEN', 'CONTROLE'].includes(dlg._type.valeurCombo); });
      };
      dlg._type.addEventListener('change', basculer);
      dlg.querySelector('[data-type]').append(dlg._type);
      if (plans.length) {
        dlg._plan = creerCombo({ options: plans.map((p) => ({ valeur: p.code, libelle: p.libelle ?? p.code, detail: p.code })), valeur: e.plan_code ?? '', vide: true });
        dlg.querySelector('[data-plan-combo]').append(dlg._plan);
      }
      if (unites.length) {
        dlg._unite = creerCombo({ options: unites.map((u) => ({ valeur: u, libelle: LIBELLES_UNITE[u] })), valeur: r.unite ?? unites[0], vide: false });
        dlg.querySelector('[data-unite]').append(dlg._unite);
      }
      basculer();
    },
    boutons: [{ libelle: texte('commun.annuler'), valeur: null }, {
      libelle: texte('commun.enregistrer'), principal: true,
      valeur: (dlg) => {
        const lire = (k) => dlg.querySelector(`[data-c="${k}"]`)?.value ?? '';
        const num = (k) => (lire(k) === '' ? null : Number(lire(k)));
        const type = dlg._type.valeurCombo;
        return {
          type, date: lire('date') || null, fin: type === 'CARBURANT' ? null : lire('fin') || null,
          libelle: type === 'CARBURANT' ? null : lire('libelle') || null, description: type === 'CARBURANT' ? null : lire('description') || null,
          litres: type === 'CARBURANT' ? num('litres') : null, cout: num('cout'), ent_id: e.ent_id ?? null,
          plan_code: ['ENTRETIEN', 'CONTROLE'].includes(type) ? dlg._plan?.valeurCombo || null : null,
          releve: num('releve') === null ? null : { unite: dlg._unite.valeurCombo, valeur: num('releve'), remise: dlg.querySelector('[data-c="remise"]').checked },
        };
      },
    }],
  });
}

/** Onglet Compteurs de la fiche matériel. */
export async function rendreCompteursMateriel(corps, { app, materiel }) {
  let d = await api.ressources.compteurs(materiel);
  let ordres = await api.ressources.ordresEntretien(materiel).catch(() => []);
  let plans = [];
  const rendre = () => {
    const unites = unitesCompteurs(d.compteurs);
    const actuels = [unites.includes('H') ? `${formatNombre(d.heures ?? 0, 0)} ${LIBELLES_UNITE.H}` : null, unites.includes('KM') && d.kilometres != null ? `${formatNombre(d.kilometres, 0)} ${LIBELLES_UNITE.KM}` : null].filter(Boolean);
    const journal = [
      ...d.evenements.map((e) => ({ genre: 'evenement', date: String(e.date).slice(0, 10), id: e.id, e })),
      ...d.releves.filter((r) => !r.evenement).map((r) => ({ genre: 'releve', date: String(r.date).slice(0, 10), id: r.id, r })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
    const ligne = (x) => {
      if (x.genre === 'releve') {
        const r = x.r;
        return `<tr><td>${jour(r.date)}</td><td>${iconeHtml('ressources_btp_releve')} ${texteHtml('ressources_btp.compteurs.journal.releve')}</td><td>${echapper(r.commentaire ?? '')}${r.remise ? ` <span class="pastille-compte attention">${texteHtml('ressources_btp.compteurs.journal.remise')}</span>` : ''}${r.source === 'INVENTAIRE' ? ` <span class="pastille-compte attention">${texteHtml('ressources_btp.compteurs.journal.rectification')}</span>` : ''}</td>
          <td class="nombre">${formatNombre(r.valeur, 1)} ${LIBELLES_UNITE[r.unite]}</td><td></td><td></td>
          <td>${r.numero ? `<a href="${urlDocument(r.ent_id)}">${echapper(r.numero)}</a>` : echapper(SOURCES[r.source] ?? r.source)}</td>
          <td class="cellule-boutons">${r.source !== 'ORDRE' ? `<button type="button" class="bouton-icone" data-retirer-releve="${r.id}" title="${texteHtml('ressources_btp.compteurs.journal.retirer_releve')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`;
      }
      const e = x.e;
      return `<tr><td>${jour(e.date)}${e.fin ? ` → ${jour(e.fin)}` : ''}</td><td>${ICONES_EVENEMENT[e.type] ?? ''} ${echapper(LIBELLES_EVENEMENT[e.type] ?? e.type)}</td>
        <td>${echapper(e.libelle ?? '')}${e.litres ? ` ${texteHtml('ressources_btp.compteurs.journal.litres', { litres: formatNombre(e.litres, 2) })}` : ''}</td>
        <td class="nombre">${e.releve ? `${formatNombre(e.releve.valeur, 1)} ${LIBELLES_UNITE[e.releve.unite]}` : ''}</td>
        <td class="nombre">${e.cout != null ? formatNombre(e.cout, 2) : ''}</td><td></td>
        <td>${e.numero ? `<a href="${urlDocument(e.ent_id)}">${echapper(e.numero)}</a>` : ''}</td>
        <td class="cellule-boutons"><button type="button" class="bouton-icone" data-modifier="${e.id}" title="${texteHtml('commun.modifier')}">${iconeHtml('ressources_btp_modifier')}</button>
          <button type="button" class="bouton-icone" data-retirer-evenement="${e.id}" title="${texteHtml('ressources_btp.compteurs.journal.supprimer_evenement')}">${iconeHtml('retirer')}</button></td></tr>`;
    };
    corps.innerHTML = `<div class="ressources-compteurs"><div class="titre-actions"><h3>${texteHtml('ressources_btp.compteurs.titre')}</h3>
        <span class="titre-actions-boutons">
          ${unites.length ? `<button type="button" class="bouton-icone" data-releve title="${texteHtml('ressources_btp.compteurs.actions.releve')}">${iconeHtml('ressources_btp_releve')}</button>` : ''}
          ${unites.length ? `<button type="button" class="bouton-icone" data-rectifier title="${texteHtml('ressources_btp.compteurs.actions.rectifier')}">${iconeHtml('ressources_btp_rectifier')}</button>` : ''}
          <button type="button" class="bouton-icone" data-plein title="${texteHtml('ressources_btp.compteurs.actions.plein')}">${iconeHtml('ressources_btp_plein')}</button>
          <button type="button" class="bouton-icone" data-evenement title="${texteHtml('ressources_btp.compteurs.actions.evenement')}">${iconeHtml('ajouter')}</button>
          <button type="button" class="bouton-icone" data-ordre title="${texteHtml('ressources_btp.compteurs.actions.ordre')}">${iconeHtml('ressources_btp_entretien')}</button></span></div>
      <p>${actuels.length ? texteHtml('ressources_btp.compteurs.actuels_html', { valeurs: actuels.join(' · ') }) : `<span class="aide">${texteHtml('ressources_btp.compteurs.aucun_compteur')}</span>`}</p>
      ${frise(d, unites)}
      <div data-plans></div>
      <div data-pointages-materiel></div>
      <h4>${texteHtml('ressources_btp.compteurs.ordres')}</h4>${tableauOrdres(ordres)}
      <h4>${texteHtml('ressources_btp.compteurs.journal.titre')}</h4>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('ressources_btp.compteurs.champs.date')}</th><th>${texteHtml('ressources_btp.compteurs.champs.type')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('ressources_btp.compteurs.champs.compteur')}</th><th>${texteHtml('ressources_btp.compteurs.champs.cout')}</th><th></th><th>${texteHtml('ressources_btp.compteurs.journal.origine')}</th><th></th></tr></thead><tbody>
      ${journal.map(ligne).join('') || `<tr><td colspan="8" class="aide">${texteHtml('ressources_btp.compteurs.aucun')}</td></tr>`}</tbody></table></div>`;
    const appliquer = async (promesse, succes) => {
      try { d = await promesse; app.message(succes, 'succes'); rendre(); } catch (e) { app.erreur(new Error(message(e))); }
    };
    const evenement = async (base) => {
      const e = await saisirEvenement(unites, base, plans);
      if (!e) return;
      const fautes = controlerEvenement(e);
      if (fautes.length) { app.erreur(new Error(fautes.map((f) => MESSAGES_COMPTEURS[f]).join(' · '))); return; }
      await appliquer(api.ressources.enregistrerEvenement(materiel, base.id ?? null, e), texte('ressources_btp.compteurs.messages.evenement_enregistre'));
    };
    corps.querySelector('[data-releve]')?.addEventListener('click', async () => {
      const r = await saisirReleve(unites);
      if (r) await appliquer(api.ressources.ajouterReleve(materiel, r), texte('ressources_btp.compteurs.messages.releve_enregistre'));
    });
    corps.querySelector('[data-rectifier]')?.addEventListener('click', async () => {
      const r = await saisirReleve(unites, { rectification: true });
      if (!r) return;
      const fautes = controlerReleves(unites, [r]);
      if (fautes.length) { app.erreur(new Error(fautes.map((f) => MESSAGES_COMPTEURS[f.code]).join(' · '))); return; }
      await appliquer(api.ressources.ajouterReleve(materiel, r), texte('ressources_btp.compteurs.messages.rectifie'));
    });
    corps.querySelector('[data-plein]').addEventListener('click', () => evenement({ type: 'CARBURANT' }));
    corps.querySelector('[data-evenement]').addEventListener('click', () => evenement({}));
    corps.querySelector('[data-ordre]').addEventListener('click', async () => {
      if (await creerOrdreEntretien(app, materiel)) { ordres = await api.ressources.ordresEntretien(materiel).catch(() => ordres); rendre(); }
    });
    corps.querySelectorAll('[data-modifier]').forEach((b) => b.addEventListener('click', () => {
      const e = d.evenements.find((x) => String(x.id) === b.dataset.modifier);
      evenement({ ...e, date: String(e.date).slice(0, 10), fin: e.fin ? String(e.fin).slice(0, 10) : '' });
    }));
    corps.querySelectorAll('[data-retirer-releve]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmer(texte('ressources_btp.compteurs.messages.retirer_releve'))) await appliquer(api.ressources.supprimerReleve(materiel, b.dataset.retirerReleve), texte('ressources_btp.compteurs.messages.releve_retire'));
    }));
    corps.querySelectorAll('[data-retirer-evenement]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmer(texte('ressources_btp.compteurs.messages.supprimer_evenement'))) await appliquer(api.ressources.supprimerEvenement(materiel, b.dataset.retirerEvenement), texte('ressources_btp.compteurs.messages.evenement_supprime'));
    }));
    // Heures pointées sur le terrain (lot 7) : section affichée seulement s'il y en a.
    api.ressources.pointagesMateriel(materiel).then((p) => {
      const z = corps.querySelector('[data-pointages-materiel]');
      if (z && p.length) {
        z.innerHTML = `<h4>${texteHtml('ressources_btp.compteurs.pointages.titre')}</h4><table class="tableau-compact"><thead><tr><th>${texteHtml('ressources_btp.compteurs.champs.date')}</th><th>${texteHtml('ressources_btp.compteurs.pointages.chantier')}</th><th>${texteHtml('ressources_btp.compteurs.pointages.conducteur')}</th><th class="nombre">${texteHtml('ressources_btp.compteurs.pointages.duree')}</th><th>${texteHtml('ressources_btp.compteurs.champs.commentaire')}</th></tr></thead>
          <tbody>${p.map((x) => `<tr><td>${jour(x.date)}</td><td>${echapper(x.chantier ?? '')}</td><td>${echapper(x.salarie ?? '')}</td><td class="nombre">${ecrireDuree(x.minutes)}</td><td>${echapper(x.commentaire ?? '')}</td></tr>`).join('')}</tbody></table>`;
      }
    }).catch(() => {});
    rendrePlansMateriel(corps.querySelector('[data-plans]'), {
      app, materiel, surOrdre: async () => { ordres = await api.ressources.ordresEntretien(materiel).catch(() => ordres); rendre(); },
    }).then((l) => { plans = l; }).catch((e) => app.erreur(e));
  };
  rendre();
}
