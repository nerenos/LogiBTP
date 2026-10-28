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
 * Rend l'onglet. `element` : { type: 'marche' | 'personne', id, tiers } (tiers : sous-traitant du marché) ; `ged` :
 * fournisseur GED de l'application (deposer) ; `demander` : demande des pièces par courriel (facultatif).
 */
export async function rendrePieces(corps, { element, ged, message, demander = null, ouvrirGed = null }) {
  const [types, c] = await Promise.all([
    api.sousTraitance.typesPieces(),
    element.type === 'marche' ? api.sousTraitance.conformiteMarche(element.id) : api.sousTraitance.conformiteTiers(element.id),
  ]);
  const type = (code) => types.find((t) => t.code === code);
  const enDefaut = c.pieces.filter((p) => p.etat === 'MANQUANTE' || p.etat === 'EXPIREE');
  const bloquants = Object.entries(c.bloquants).filter(([, l]) => l.length);
  corps.innerHTML = `<div class="pieces-st">
    <p class="ligne"><span class="pastille-conformite ${c.conforme ? 'conforme' : 'non-conforme'}">${c.conforme ? '✅ Conforme' : '⛔ Non conforme'}</span>
      ${c.a_echeance.length ? `<span class="aide">⏳ ${c.a_echeance.length} pièce(s) à renouveler</span>` : ''}
      ${demander && (enDefaut.length || c.a_echeance.length) ? '<button type="button" data-demander title="Courriel au sous-traitant listant les pièces manquantes ou à renouveler">📧 Demander les pièces</button>' : ''}</p>
    ${bloquants.length ? `<p class="avertissement">${bloquants.map(([a, l]) => `${echapper(ACTIONS_BLOQUEES[a] ?? a)} bloquée : ${l.map((x) => echapper(type(x)?.libelle ?? x)).join(', ')}`).join('<br>')}</p>` : ''}
    <table class="tableau-compact"><thead><tr><th>Pièce</th><th>Portée</th><th>État</th><th>Valable jusqu'au</th><th>Document</th><th class="cellule-boutons"></th></tr></thead><tbody>
    ${c.pieces.map((p, i) => `<tr data-i="${i}" class="etat-${p.etat.toLowerCase()}">
      <td>${echapper(p.libelle)}${p.obligatoire ? '' : ' <small class="aide">(facultative)</small>'}${p.motif ? `<br><small class="aide">${echapper(p.motif)}</small>` : ''}</td>
      <td><small>${echapper(p.portee === 'TIERS' ? 'Sous-traitant' : 'Marché')}</small></td>
      <td>${ETATS_PIECE[p.etat]?.icone ?? ''} ${echapper(ETATS_PIECE[p.etat]?.libelle ?? p.etat)}</td>
      <td>${p.dge_id ? `<input type="date" data-validite value="${echapper(p.fin ?? '')}" title="Fin de validité (vide : durée de la pièce depuis son dépôt)">` : echapper(jour(p.fin))}</td>
      <td>${p.dge_id ? `<a href="/ged/${p.dge_id}" data-ged="${p.dge_id}">📄 voir</a>` : '—'}</td>
      <td class="cellule-boutons"><label class="bouton-fichier" title="Déposer la pièce (GED ${echapper(element.type === 'marche' && p.portee === 'TIERS' ? 'du sous-traitant' : 'de la fiche')})">📎<input type="file" data-deposer hidden></label>
        ${p.etat === 'DISPENSEE' ? '<button type="button" data-retablir title="Ne plus dispenser">↩</button>' : '<button type="button" data-dispenser title="Dispenser (motif)">➖</button>'}</td></tr>`).join('')}
    </tbody></table>
    <p class="ligne">Ajouter une pièce exigée pour ${element.type === 'marche' ? 'ce marché' : 'ce sous-traitant'} :
      <span data-ajout></span> <button type="button" data-ajouter>＋</button></p>
  </div>`;
  const recharger = () => rendrePieces(corps, { element, ged, message, demander, ouvrirGed });
  // Les ajustements d'une pièce du sous-traitant (portée TIERS) valent pour tous ses marchés : ils se posent sur la personne.
  const cible = (p) => (p.portee === 'TIERS' && element.type === 'marche' ? { type: 'personne', id: element.tiers } : element);
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
        message(`${p.libelle} déposée`, 'succes');
        await recharger();
      } catch (e) { message(e.message, 'erreur'); }
    });
    tr.querySelector('[data-validite]')?.addEventListener('change', async (ev) => {
      try { await api.sousTraitance.validite(p.dge_id, ev.target.value || null); await recharger(); } catch (e) { message(e.message, 'erreur'); }
    });
    tr.querySelector('[data-dispenser]')?.addEventListener('click', async () => {
      const motif = await saisir(`Dispenser « ${p.libelle} » : motif (tracé) ?`);
      if (motif?.trim()) ajuster(p, 'DISPENSEE', motif.trim());
    });
    tr.querySelector('[data-retablir]')?.addEventListener('click', () => ajuster(p, null));
    tr.querySelector('[data-ged]')?.addEventListener('click', (e) => { if (ouvrirGed) { e.preventDefault(); ouvrirGed(p.dge_id, e); } });
  });
  const ajout = creerCombo({
    vide: true, valeur: '',
    options: types.filter((t) => t.actif && !c.pieces.some((p) => p.code === t.code) && (element.type === 'marche' || t.portee === 'TIERS'))
      .map((t) => ({ valeur: t.code, libelle: t.libelle, detail: PORTEES_PIECE[t.portee] ?? t.portee })),
  });
  corps.querySelector('[data-ajout]').replaceWith(ajout);
  corps.querySelector('[data-ajouter]').addEventListener('click', () => {
    const code = ajout.valeurCombo;
    if (code) ajuster({ code, portee: element.type === 'personne' ? 'TIERS' : 'MARCHE' }, 'AJOUTEE', 'Ajoutée sur la fiche');
  });
  corps.querySelector('[data-demander]')?.addEventListener('click', () => demander({ manquantes: enDefaut.map((p) => p.libelle), a_renouveler: c.pieces.filter((p) => p.etat === 'A_ECHEANCE').map((p) => p.libelle) }));
}
