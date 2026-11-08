import { texte, texteHtml, textesParCode } from '@logibtp/socle/dictionnaire';
import { echapper, formatDate, formatNombre } from '@logibtp/socle/ui';
import { ETAT_RELANCE, MODE_RELANCE } from '@logibtp/relance';
import { urlDocument } from '../codes.js';
import { api } from '../api.js';

// Relances faites d'une pièce (et de son groupe d'indices) ou d'un tiers, lues dans le journal du module Relances
// (GET /api/relances/journal) : onglet Suivi de la page document (avec la traçabilité) et de la fiche tiers. Seules les
// relances faites comptent (ENVOYEE, ATTENTE_NUMERO) : les propositions d'un lot en préparation et les annulées sont ignorées.

const FAITES = new Set([ETAT_RELANCE.ENVOYEE, ETAT_RELANCE.ATTENTE_NUMERO]);
const MODES = textesParCode('relance.modes', Object.values(MODE_RELANCE));
const ETATS = textesParCode('relances_btp.journal.etats', [ETAT_RELANCE.ENVOYEE, ETAT_RELANCE.ATTENTE_NUMERO]);

/** Relances faites, de la plus récente à la plus ancienne. */
export function relancesFaites(journal) {
  return (journal ?? []).filter((r) => FAITES.has(r.etat)).sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id);
}

/**
 * Affiche le journal dans `zone` (masquée sans relance faite ni droit de lecture). filtre : { piece, groupe } ou { tiers } ;
 * pieces : true pour nommer la pièce de chaque relance (fiche tiers) ; naviguer(url, e) ouvre une pièce.
 */
export async function afficherJournalRelances(zone, { filtre, pieces = false, naviguer }) {
  let lignes;
  try { lignes = relancesFaites(await api.relances.journal(filtre)); } catch { zone.hidden = true; return; }
  zone.hidden = false;
  let libelles = {};
  if (pieces && lignes.length) {
    try { libelles = (await api.relances.libelles([...new Set(lignes.map((r) => r.piece_id))], [])).pieces ?? {}; } catch { /* numéro par défaut */ }
  }
  const piece = (r) => {
    const l = libelles[r.piece_id] ?? texte('relance.piece_sans_nom', { id: r.piece_id });
    return `<a href="${urlDocument(r.piece_id)}" data-document="${r.piece_id}">${echapper(l)}</a>`;
  };
  zone.innerHTML = `<h3>${texteHtml('relances_btp.journal.titre')}</h3>${lignes.length ? `
    <p class="aide">${texteHtml('relances_btp.journal.derniere', { date: formatDate(lignes[0].date), niveau: lignes[0].niveau })}</p>
    <table class="table-analyse"><thead><tr><th>${texteHtml('relances_btp.journal.colonnes.date')}</th>${pieces ? `<th>${texteHtml('relances_btp.journal.colonnes.piece')}</th>` : ''}
      <th>${texteHtml('relances_btp.journal.colonnes.niveau')}</th><th>${texteHtml('relances_btp.journal.colonnes.mode')}</th><th>${texteHtml('relances_btp.journal.colonnes.etat')}</th>
      <th>${texteHtml('relances_btp.journal.colonnes.montant')}</th><th>${texteHtml('relances_btp.journal.colonnes.auteur')}</th><th>${texteHtml('relances_btp.journal.colonnes.commentaire')}</th></tr></thead><tbody>
    ${lignes.map((r) => `<tr><td>${formatDate(r.date)}</td>${pieces ? `<td>${piece(r)}</td>` : ''}<td class="nombre">${r.niveau}</td><td>${echapper(MODES[r.mode] ?? r.mode)}</td>
      <td>${echapper(ETATS[r.etat] ?? r.etat)}</td><td class="nombre">${formatNombre(r.montant, 2)}</td><td>${echapper(r.auteur ?? '')}</td><td>${echapper(r.commentaire ?? '')}</td></tr>`).join('')}</tbody></table>`
    : `<p class="aide">${texteHtml('relances_btp.journal.aucune')}</p>`}`;
  zone.querySelectorAll('[data-document]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer?.(urlDocument(a.dataset.document), e); }));
}
