import { urlDocument } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { echapper, creerCombo, formatNombre, ouvrirDialogue, confirmer } from '@logibtp/socle/ui';
import { api } from '../api.js';
import {
  LIBELLES_UNITE, LIBELLES_EVENEMENT, ICONES_EVENEMENT, TYPES_EVENEMENT, MESSAGES_COMPTEURS,
  unitesCompteurs, cumuls, controlerEvenement,
} from './compteurs.js';
import { creerOrdreEntretien, tableauOrdres, rendrePlansMateriel } from './entretiens-ui.js';

// Onglet Compteurs de la fiche matériel (lot 5c-2, db/233) : compteurs actuels, frise (courbe de chaque compteur,
// événements et entretiens), journal des relevés et des événements ; saisie d'un relevé, d'un plein de carburant ou
// d'un événement dans une fenêtre <dialog>. Contrôles de compteurs.js (↔ ReglesCompteurs.cs) avant l'envoi.

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const SOURCES = { SAISIE: 'Saisie', CARBURANT: 'Plein', ORDRE: 'Ordre', BORNE: 'Borne', REPRISE: 'Reprise de la fiche' };
const message = (e) => MESSAGES_COMPTEURS[e.code] ?? e.message;

/** Frise SVG : une courbe par unité (valeurs cumulées), événements en pastilles au-dessus, sur la période des données. */
function frise(d, unites) {
  const series = unites.map((u) => ({ u, points: cumuls(d.releves.map((r) => ({ ...r, valeur: Number(r.valeur) })), u) })).filter((s) => s.points.length);
  const dates = [...series.flatMap((s) => s.points.map((p) => p.date)), ...d.evenements.map((e) => String(e.date).slice(0, 10))];
  if (!dates.length) return '<p class="aide">Aucun relevé ni événement.</p>';
  const t = (x) => new Date(`${x}T00:00:00Z`).getTime();
  const debut = t(dates.reduce((a, b) => (a < b ? a : b)));
  const fin = Math.max(t(aujourdhui()), t(dates.reduce((a, b) => (a > b ? a : b))));
  const L = 800, G = 60, D = 16, bande = 34, hauteurSerie = 90;
  const x = (date) => G + ((t(date) - debut) / Math.max(fin - debut, 1)) * (L - G - D);
  const H = bande + series.length * (hauteurSerie + 14) + 18;
  const evts = d.evenements.map((e) => `<g class="frise-evenement frise-${e.type.toLowerCase()}"><title>${echapper(`${jour(e.date)} · ${LIBELLES_EVENEMENT[e.type] ?? e.type}${e.libelle ? ` : ${e.libelle}` : ''}`)}</title>
      ${e.fin ? `<rect x="${x(String(e.date).slice(0, 10))}" y="${bande - 8}" width="${Math.max(x(String(e.fin).slice(0, 10)) - x(String(e.date).slice(0, 10)), 2)}" height="4" class="frise-duree"/>` : ''}
      <text x="${x(String(e.date).slice(0, 10))}" y="${bande - 14}" text-anchor="middle">${ICONES_EVENEMENT[e.type] ?? '•'}</text></g>`).join('');
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
  return `<svg class="frise-materiel" viewBox="0 0 ${L} ${H}" role="img" aria-label="Frise des compteurs et des événements">
    <line x1="${G}" x2="${L - D}" y1="${bande - 6}" y2="${bande - 6}" class="frise-ligne"/>${evts}${courbes}
    <text x="${G}" y="${H - 4}" class="frise-axe">${jour(new Date(debut).toISOString())}</text>
    <text x="${L - D}" y="${H - 4}" text-anchor="end" class="frise-axe">${jour(new Date(fin).toISOString())}</text></svg>`;
}

/** Fenêtre de saisie d'un relevé seul. */
async function saisirReleve(unites) {
  return ouvrirDialogue({
    titre: 'Relevé du compteur',
    html: `<div class="formulaire-compact"><label>Date <input type="date" data-c="date" value="${aujourdhui()}"></label>
      <label>Compteur <span data-unite></span></label><label>Valeur <input type="number" min="0" step="0.1" data-c="valeur"></label>
      <label><input type="checkbox" data-c="remise"> Remise à zéro (compteur remplacé)</label>
      <label>Commentaire <input data-c="commentaire" maxlength="200" size="30"></label></div>`,
    focus: '[data-c="valeur"]',
    construire: (dlg) => { dlg._unite = creerCombo({ options: unites.map((u) => ({ valeur: u, libelle: LIBELLES_UNITE[u] })), valeur: unites[0], vide: false }); dlg.querySelector('[data-unite]').append(dlg._unite); },
    boutons: [{ libelle: 'Annuler', valeur: null }, {
      libelle: 'Enregistrer', principal: true,
      valeur: (dlg) => ({
        date: dlg.querySelector('[data-c="date"]').value || null, unite: dlg._unite.valeurCombo,
        valeur: dlg.querySelector('[data-c="valeur"]').value === '' ? null : Number(dlg.querySelector('[data-c="valeur"]').value),
        remise: dlg.querySelector('[data-c="remise"]').checked, commentaire: dlg.querySelector('[data-c="commentaire"]').value || null,
      }),
    }],
  });
}

/** Fenêtre de saisie d'un événement (plein de carburant : type imposé) avec son relevé facultatif. */
async function saisirEvenement(unites, e = {}, plans = []) {
  const v = (k) => echapper(e[k] ?? '');
  const r = e.releve ?? {};
  return ouvrirDialogue({
    titre: e.type === 'CARBURANT' ? '⛽ Plein de carburant' : e.id ? 'Événement' : 'Nouvel événement',
    html: `<div class="formulaire-compact"><label>Type <span data-type></span></label>
      <label>Date <input type="date" data-c="date" value="${v('date') || aujourdhui()}"></label>
      <label data-hors-plein>Fin <input type="date" data-c="fin" value="${v('fin')}"></label>
      <label data-hors-plein>Libellé <input data-c="libelle" maxlength="150" size="34" value="${v('libelle')}"></label>
      ${plans.length ? '<label data-plan>Plan réalisé <span data-plan-combo></span></label>' : ''}
      <label data-plein>Litres <input type="number" min="0" step="0.01" data-c="litres" value="${v('litres')}"></label>
      <label>Coût HT <input type="number" min="0" step="0.01" data-c="cout" value="${v('cout')}"></label>
      ${unites.length ? `<label>Compteur <span data-unite></span> <input type="number" min="0" step="0.1" data-c="releve" value="${echapper(r.valeur ?? '')}"></label>
      <label><input type="checkbox" data-c="remise" ${r.remise ? 'checked' : ''}> Remise à zéro</label>` : ''}
      <label data-hors-plein>Description <textarea data-c="description" rows="3" cols="40">${v('description')}</textarea></label>
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
    boutons: [{ libelle: 'Annuler', valeur: null }, {
      libelle: 'Enregistrer', principal: true,
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
    const actuels = [unites.includes('H') ? `${formatNombre(d.heures ?? 0, 0)} h` : null, unites.includes('KM') && d.kilometres != null ? `${formatNombre(d.kilometres, 0)} km` : null].filter(Boolean);
    const journal = [
      ...d.evenements.map((e) => ({ genre: 'evenement', date: String(e.date).slice(0, 10), id: e.id, e })),
      ...d.releves.filter((r) => !r.evenement).map((r) => ({ genre: 'releve', date: String(r.date).slice(0, 10), id: r.id, r })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
    const ligne = (x) => {
      if (x.genre === 'releve') {
        const r = x.r;
        return `<tr><td>${jour(r.date)}</td><td>📟 Relevé</td><td>${echapper(r.commentaire ?? '')}${r.remise ? ' <span class="pastille-compte attention">remise à zéro</span>' : ''}</td>
          <td class="nombre">${formatNombre(r.valeur, 1)} ${LIBELLES_UNITE[r.unite]}</td><td></td><td></td>
          <td>${r.numero ? `<a href="${urlDocument(r.ent_id)}">${echapper(r.numero)}</a>` : echapper(SOURCES[r.source] ?? r.source)}</td>
          <td class="cellule-boutons">${r.source !== 'ORDRE' ? `<button type="button" class="bouton-icone" data-retirer-releve="${r.id}" title="Retirer ce relevé">✕</button>` : ''}</td></tr>`;
      }
      const e = x.e;
      return `<tr><td>${jour(e.date)}${e.fin ? ` → ${jour(e.fin)}` : ''}</td><td>${ICONES_EVENEMENT[e.type] ?? ''} ${echapper(LIBELLES_EVENEMENT[e.type] ?? e.type)}</td>
        <td>${echapper(e.libelle ?? '')}${e.litres ? ` ${formatNombre(e.litres, 2)} l` : ''}</td>
        <td class="nombre">${e.releve ? `${formatNombre(e.releve.valeur, 1)} ${LIBELLES_UNITE[e.releve.unite]}` : ''}</td>
        <td class="nombre">${e.cout != null ? formatNombre(e.cout, 2) : ''}</td><td></td>
        <td>${e.numero ? `<a href="${urlDocument(e.ent_id)}">${echapper(e.numero)}</a>` : ''}</td>
        <td class="cellule-boutons"><button type="button" class="bouton-icone" data-modifier="${e.id}" title="Modifier">✎</button>
          <button type="button" class="bouton-icone" data-retirer-evenement="${e.id}" title="Supprimer cet événement">✕</button></td></tr>`;
    };
    corps.innerHTML = `<div class="ressources-compteurs"><div class="titre-actions"><h3>Compteurs et événements</h3>
        <span class="titre-actions-boutons">
          ${unites.length ? '<button type="button" class="bouton-icone" data-releve title="Nouveau relevé du compteur">📟</button>' : ''}
          <button type="button" class="bouton-icone" data-plein title="Plein de carburant (coût porté au chantier de suivi)">⛽</button>
          <button type="button" class="bouton-icone" data-evenement title="Nouvel événement : panne, sinistre, contrôle…">＋</button>
          <button type="button" class="bouton-icone" data-ordre title="Nouvel ordre d'entretien (atelier)">🔧</button></span></div>
      <p>${actuels.length ? `Compteurs : <b>${actuels.join(' · ')}</b>` : '<span class="aide">Aucun compteur suivi (champ Compteurs de la fiche).</span>'}</p>
      ${frise(d, unites)}
      <div data-plans></div>
      <h4>Ordres d'entretien</h4>${tableauOrdres(ordres)}
      <h4>Journal</h4>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th>Compteur</th><th>Coût HT</th><th></th><th>Origine</th><th></th></tr></thead><tbody>
      ${journal.map(ligne).join('') || '<tr><td colspan="8" class="aide">Aucun relevé ni événement.</td></tr>'}</tbody></table></div>`;
    const appliquer = async (promesse, texte) => {
      try { d = await promesse; app.message(texte, 'succes'); rendre(); } catch (e) { app.erreur(new Error(message(e))); }
    };
    const evenement = async (base) => {
      const e = await saisirEvenement(unites, base, plans);
      if (!e) return;
      const fautes = controlerEvenement(e);
      if (fautes.length) { app.erreur(new Error(fautes.map((f) => MESSAGES_COMPTEURS[f]).join(' · '))); return; }
      await appliquer(api.ressources.enregistrerEvenement(materiel, base.id ?? null, e), 'Événement enregistré');
    };
    corps.querySelector('[data-releve]')?.addEventListener('click', async () => {
      const r = await saisirReleve(unites);
      if (r) await appliquer(api.ressources.ajouterReleve(materiel, r), 'Relevé enregistré');
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
      if (await confirmer('Retirer ce relevé ?')) await appliquer(api.ressources.supprimerReleve(materiel, b.dataset.retirerReleve), 'Relevé retiré');
    }));
    corps.querySelectorAll('[data-retirer-evenement]').forEach((b) => b.addEventListener('click', async () => {
      if (await confirmer('Supprimer cet événement et son relevé ?')) await appliquer(api.ressources.supprimerEvenement(materiel, b.dataset.retirerEvenement), 'Événement supprimé');
    }));
    rendrePlansMateriel(corps.querySelector('[data-plans]'), {
      app, materiel, surOrdre: async () => { ordres = await api.ressources.ordresEntretien(materiel).catch(() => ordres); rendre(); },
    }).then((l) => { plans = l; }).catch((e) => app.erreur(e));
  };
  rendre();
}
