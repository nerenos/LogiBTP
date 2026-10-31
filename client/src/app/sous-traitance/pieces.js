import { texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';
import { TYPE_FICHE } from '../codes.js';
import { aujourdhui } from '@logibtp/socle';
import { echapper, creerCombo, saisir } from '@logibtp/socle/ui';
import { ETATS_PIECE, ACTIONS_BLOQUEES, PORTEES_PIECE } from '@logibtp/sous-traitance';
import { api } from '../api.js';

// Module Sous-traitance, lot 2 (ANALYSE-MODULE-SOUS-TRAITANCE.md § 5.3) : onglet « Pièces » d'un marché de
// sous-traitance (pièces du sous-traitant et du marché) ou d'un sous-traitant (pièces annexes) : état de chaque pièce
// exigée (règle conformite.js ↔ ReglesConformite.cs, calculée par le serveur), dépôt du fichier dans la GED de
// l'élément (catégorie de la pièce), fin de validité, pièce ajoutée ou dispensée (motif), actions bloquées.

const jour = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

/**
 * Rend l'onglet. `element` : { type: TYPE_FICHE.MARCHE | 'personne', id, tiers } (tiers : sous-traitant du marché) ; `ged` :
 * fournisseur GED de l'application (deposer) ; `demander` : demande des pièces par courriel (facultatif).
 */
export async function rendrePieces(corps, { element, ged, message, demander = null, ouvrirGed = null }) {
  const [types, c] = await Promise.all([
    api.sousTraitance.typesPieces(),
    element.type === TYPE_FICHE.MARCHE ? api.sousTraitance.conformiteMarche(element.id) : api.sousTraitance.conformiteTiers(element.id),
  ]);
  const type = (code) => types.find((t) => t.code === code);
  const enDefaut = c.pieces.filter((p) => p.etat === 'MANQUANTE' || p.etat === 'EXPIREE');
  const bloquants = Object.entries(c.bloquants).filter(([, l]) => l.length);
  corps.innerHTML = `<div class="pieces-st">
    <p class="ligne"><span class="pastille-conformite ${c.conforme ? 'conforme' : 'non-conforme'}">${c.conforme ? `${iconeHtml('sous_traitance_btp_conforme')} ${texteHtml('sous_traitance_btp.pieces.conforme')}` : `${iconeHtml('sous_traitance_btp_non_conforme')} ${texteHtml('sous_traitance_btp.pieces.non_conforme')}`}</span>
      ${c.a_echeance.length ? `<span class="aide">${iconeHtml('sous_traitance_btp_attente')} ${echapper(pluriel('sous_traitance_btp.pieces.a_renouveler', c.a_echeance.length))}</span>` : ''}
      ${demander && (enDefaut.length || c.a_echeance.length) ? `<button type="button" data-demander title="${texteHtml('sous_traitance_btp.pieces.demander_titre')}">${iconeHtml('sous_traitance_btp_courriel')} ${texteHtml('sous_traitance_btp.pieces.demander')}</button>` : ''}</p>
    ${bloquants.length ? `<p class="avertissement">${bloquants.map(([a, l]) => `${texteHtml('sous_traitance_btp.pieces.bloquee', { action: ACTIONS_BLOQUEES[a] ?? a, pieces: l.map((x) => type(x)?.libelle ?? x).join(', ') })}`).join('<br>')}</p>` : ''}
    <table class="tableau-compact"><thead><tr><th>${texteHtml('sous_traitance_btp.retenue.piece')}</th><th>${texteHtml('sous_traitance_btp.pieces.portee')}</th><th>${texteHtml('sous_traitance_btp.pieces.etat')}</th><th>${texteHtml('sous_traitance_btp.pieces.jusquau')}</th><th>${texteHtml('sous_traitance_btp.pieces.document')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
    ${c.pieces.map((p, i) => `<tr data-i="${i}" class="etat-${p.etat.toLowerCase()}">
      <td>${echapper(p.libelle)}${p.obligatoire ? '' : ` <small class="aide">${texteHtml('sous_traitance_btp.pieces.facultative')}</small>`}${p.motif ? `<br><small class="aide">${echapper(p.motif)}</small>` : ''}</td>
      <td><small>${p.portee === 'TIERS' ? texteHtml('sous_traitance_btp.pieces.sous_traitant') : texteHtml('sous_traitance_btp.pieces.marche')}</small></td>
      <td>${echapper(ETATS_PIECE[p.etat]?.icone ?? '')} ${echapper(ETATS_PIECE[p.etat]?.libelle ?? p.etat)}</td>
      <td>${p.dge_id ? `<input type="date" data-validite value="${echapper(p.fin ?? '')}" title="${texteHtml('sous_traitance_btp.pieces.validite')}">` : echapper(jour(p.fin))}</td>
      <td>${p.dge_id ? `<a href="/ged/${p.dge_id}" data-ged="${p.dge_id}">${iconeHtml('sous_traitance_btp_document')} ${texteHtml('sous_traitance_btp.pieces.voir')}</a>` : '—'}</td>
      <td class="cellule-boutons"><label class="bouton-fichier" title="${element.type === TYPE_FICHE.MARCHE && p.portee === 'TIERS' ? texteHtml('sous_traitance_btp.pieces.deposer_tiers') : texteHtml('sous_traitance_btp.pieces.deposer')}">${iconeHtml('sous_traitance_btp_deposer')}<input type="file" data-deposer hidden></label>
        ${p.etat === 'DISPENSEE' ? `<button type="button" data-retablir title="${texteHtml('sous_traitance_btp.pieces.retablir')}">${iconeHtml('sous_traitance_btp_retablir')}</button>` : `<button type="button" data-dispenser title="${texteHtml('sous_traitance_btp.pieces.dispenser')}">${iconeHtml('sous_traitance_btp_dispenser')}</button>`}</td></tr>`).join('')}
    </tbody></table>
    <p class="ligne">${element.type === TYPE_FICHE.MARCHE ? texteHtml('sous_traitance_btp.pieces.ajouter_marche') : texteHtml('sous_traitance_btp.pieces.ajouter_tiers')}
      <span data-ajout></span> <button type="button" data-ajouter title="${texteHtml('commun.ajouter')}">${iconeHtml('ajouter')}</button></p>
  </div>`;
  const recharger = () => rendrePieces(corps, { element, ged, message, demander, ouvrirGed });
  // Les ajustements d'une pièce du sous-traitant (portée TIERS) valent pour tous ses marchés : ils se posent sur la personne.
  const cible = (p) => (p.portee === 'TIERS' && element.type === TYPE_FICHE.MARCHE ? { type: TYPE_FICHE.PERSONNE, id: element.tiers } : element);
  const ajuster = async (p, mode, motif = null) => {
    const x = cible(p);
    try { await api.sousTraitance.ajuster(x.type, x.id, p.code, { mode, motif }); await recharger(); } catch (e) { message(e.message, 'erreur'); }
  };
  corps.querySelectorAll('tr[data-i]').forEach((tr) => {
    const p = c.pieces[Number(tr.dataset.i)];
    tr.querySelector('[data-deposer]').addEventListener('change', async (ev) => {
      const fichier = ev.target.files[0];
      if (!fichier) return;
      const x = cible(p);
      try {
        await ged.deposer({ fichier, nom_fichier: fichier.name, meta: { titre: p.libelle, categorie: type(p.code)?.categorie ?? p.code, type_element: x.type, id_element: String(x.id),
          date_document: aujourdhui() } });
        message(texte('sous_traitance_btp.pieces.deposee', { piece: p.libelle }), 'succes');
        await recharger();
      } catch (e) { message(e.message, 'erreur'); }
    });
    tr.querySelector('[data-validite]')?.addEventListener('change', async (ev) => {
      try { await api.sousTraitance.validite(p.dge_id, ev.target.value || null); await recharger(); } catch (e) { message(e.message, 'erreur'); }
    });
    tr.querySelector('[data-dispenser]')?.addEventListener('click', async () => {
      const motif = await saisir(texte('sous_traitance_btp.pieces.motif', { piece: p.libelle }));
      if (motif?.trim()) ajuster(p, 'DISPENSEE', motif.trim());
    });
    tr.querySelector('[data-retablir]')?.addEventListener('click', () => ajuster(p, null));
    tr.querySelector('[data-ged]')?.addEventListener('click', (e) => { if (ouvrirGed) { e.preventDefault(); ouvrirGed(p.dge_id, e); } });
  });
  const ajout = creerCombo({
    vide: true, valeur: '',
    options: types.filter((t) => t.actif && !c.pieces.some((p) => p.code === t.code) && (element.type === TYPE_FICHE.MARCHE || t.portee === 'TIERS'))
      .map((t) => ({ valeur: t.code, libelle: t.libelle, detail: PORTEES_PIECE[t.portee] ?? t.portee })),
  });
  corps.querySelector('[data-ajout]').replaceWith(ajout);
  corps.querySelector('[data-ajouter]').addEventListener('click', () => {
    const code = ajout.valeurCombo;
    if (code) ajuster({ code, portee: element.type === TYPE_FICHE.PERSONNE ? 'TIERS' : 'MARCHE' }, 'AJOUTEE', texte('sous_traitance_btp.pieces.ajoutee'));
  });
  corps.querySelector('[data-demander]')?.addEventListener('click', () => demander({ manquantes: enDefaut.map((p) => p.libelle), a_renouveler: c.pieces.filter((p) => p.etat === 'A_ECHEANCE').map((p) => p.libelle) }));
}
