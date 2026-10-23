import { echapper, creerCombo } from '@logibtp/socle/ui';
import { NATURES_ETAPE } from '@logibtp/execution';
import { api } from '../api.js';

// Module Exécution, lot 2c : tableau des étapes dans l'entête d'un ordre (ANALYSE-MODULE-EXECUTION.md § 13.4) : une
// colonne par état à date obligatoire (les autres sur demande), quatre lignes : date prévisionnelle (imposée à la main ou
// calculée), validation (date et auteur), contrôle du N+1, ressource principale (celle de l'ordre par défaut). Les
// règles (ordre de validation, dates) sont celles du serveur (ReglesEtapes.cs ↔ etapes.js).

const jour = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '');
const TYPES_RESSOURCE = { SALARIE: '👷', EQUIPE: '👥', MATERIEL: '🚜', SOUS_TRAITANT: '🤝', SERVICE: '🏢' };

/** Options de combo des ressources principales (valeur : « TYPE:id »). */
export function optionsRessources(ressources) {
  return ressources.map((r) => ({ valeur: `${r.type}:${r.id}`, libelle: `${TYPES_RESSOURCE[r.type] ?? ''} ${r.libelle}`, detail: r.detail ?? '' }));
}

/** Ressource { type, id, libelle } depuis une valeur de combo ; null si vide. */
export function ressourceDe(valeur, ressources) {
  if (!valeur) return null;
  const r = ressources.find((x) => `${x.type}:${x.id}` === valeur);
  return r ? { type: r.type, id: r.id, libelle: r.libelle } : null;
}

const valeurRessource = (r) => (r ? `${r.type}:${r.id}` : '');

/**
 * Tableau des étapes d'un ordre. `ressourceOrdre` : ressource principale de l'ordre (affichée par défaut) ;
 * `surChange` : appelé après une action (l'état d'exécution ou les dates de l'ordre ont pu changer).
 */
export async function rendreEtapes(zone, { app, entId, ressources, ressourceOrdre, surChange = () => {} }) {
  let r;
  try { r = await api.execution.etapes(entId); } catch (e) { zone.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
  if (!r.etapes.length) {
    zone.innerHTML = '<p class="aide">Aucun état paramétré pour ce type d\'ordre (Exécution › Modèles de parcours › États).</p>';
    return;
  }
  const tout = zone.dataset.tout === '1';
  const colonnes = r.etapes.filter((e) => tout || e.date_obligatoire);
  const options = optionsRessources(ressources);
  const action = async (code, a) => {
    try {
      const rep = await api.execution.actionEtape(entId, code, a);
      for (const m of rep.avertissements ?? []) app.message(m, 'avertissement');
      surChange(rep);
    } catch (e) { app.message(e.message, 'erreur'); }
    // Le panneau parent peut s'être redessiné (surChange) : zone remplacée.
    if (zone.isConnected) await rendreEtapes(zone, { app, entId, ressources, ressourceOrdre, surChange });
  };
  zone.innerHTML = `<div class="etapes-ordre">
    <table class="tableau-compact etapes-tableau"><thead><tr><th></th>
      ${colonnes.map((e) => `<th class="${e.code === r.en_cours ? 'en-cours' : ''}" title="${echapper(NATURES_ETAPE[e.nature]?.libelle ?? '')}">
        <span class="etape-pastille" style="background:${echapper(e.couleur ?? '#94a3b8')}"></span>${NATURES_ETAPE[e.nature]?.icone ?? ''} ${echapper(e.libelle)}
        ${e.date_obligatoire ? '' : '<small class="aide">(masqué)</small>'}</th>`).join('')}</tr></thead>
    <tbody>
      <tr><th>Prévisionnelle</th>${colonnes.map((e) => `<td data-code="${e.code}" class="${e.en_retard ? 'erreur' : ''}">
        <input type="date" data-prevu value="${echapper(e.prevu_le ?? '')}" ${e.valide_le || !r.peut_valider ? 'disabled' : ''} title="Date saisie : imposée ; vide : calculée">
        ${e.prevu_impose ? '<span title="Date imposée">📌</span>' : ''}</td>`).join('')}</tr>
      <tr><th>Validation</th>${colonnes.map((e) => `<td data-code="${e.code}">${e.valide_le
        ? `✅ ${jour(e.valide_le)} <small>${echapper(e.valide_par ?? '')}</small>${r.peut_valider ? ' <button type="button" data-annuler title="Annuler la validation">✕</button>' : ''}`
        : r.peut_valider ? `<button type="button" data-valider class="${e.code === r.en_cours ? 'principal' : ''}">✓ Valider</button>` : '—'}</td>`).join('')}</tr>
      <tr><th>Contrôle N+1</th>${colonnes.map((e) => `<td data-code="${e.code}">${e.controle
        ? `<label><input type="checkbox" data-controle ${e.controle_le ? 'checked' : ''} ${r.peut_controler && e.valide_le ? '' : 'disabled'}>
           ${e.controle_le ? `${jour(e.controle_le)} <small>${echapper(e.controle_par ?? '')}</small>` : e.controle_bloquant ? '<small>bloquant</small>' : '<small>alerte</small>'}</label>`
        : '—'}</td>`).join('')}</tr>
      <tr><th>Ressource</th>${colonnes.map((e) => `<td data-code="${e.code}" data-ressource></td>`).join('')}</tr>
    </tbody></table>
    <p class="ligne"><button type="button" data-tout>${tout ? 'Masquer les étapes sans date obligatoire' : `Toutes les étapes (${r.etapes.length})`}</button>
      ${r.peut_valider ? '<button type="button" data-recalculer title="Les dates imposées reprennent leur valeur calculée">⟳ Recalculer les dates</button>' : ''}</p>
  </div>`;
  zone.querySelectorAll('td[data-ressource]').forEach((td) => {
    const e = r.etapes.find((x) => x.code === td.dataset.code);
    const c = creerCombo({ options, valeur: valeurRessource(e.ressource), vide: true });
    c.placeholder = ressourceOrdre?.libelle ?? '';
    c.title = e.ressource ? '' : 'Ressource de l\'ordre';
    c.readOnly = !r.peut_valider;
    c.addEventListener('change', () => action(e.code, { action: 'RESSOURCE', ressource: ressourceDe(c.valeurCombo, ressources) }));
    td.append(c);
  });
  zone.querySelectorAll('input[data-prevu]').forEach((i) => i.addEventListener('change', () => action(i.closest('td').dataset.code, { action: 'PREVOIR', date: i.value || null })));
  zone.querySelectorAll('[data-valider]').forEach((b) => b.addEventListener('click', () => action(b.closest('td').dataset.code, { action: 'VALIDER' })));
  zone.querySelectorAll('[data-annuler]').forEach((b) => b.addEventListener('click', () => {
    const motif = prompt('Motif de l\'annulation de la validation (tracé) :');
    if (motif) action(b.closest('td').dataset.code, { action: 'ANNULER', commentaire: motif });
  }));
  zone.querySelectorAll('[data-controle]').forEach((c) => c.addEventListener('change', () => action(c.closest('td').dataset.code, { action: c.checked ? 'CONTROLER' : 'DECONTROLER' })));
  zone.querySelector('[data-tout]').addEventListener('click', () => { zone.dataset.tout = tout ? '0' : '1'; rendreEtapes(zone, { app, entId, ressources, ressourceOrdre, surChange }); });
  zone.querySelector('[data-recalculer]')?.addEventListener('click', async () => {
    try { await api.execution.recalculerEtapes(entId); surChange(); } catch (e) { app.message(e.message, 'erreur'); }
    await rendreEtapes(zone, { app, entId, ressources, ressourceOrdre, surChange });
  });
}
