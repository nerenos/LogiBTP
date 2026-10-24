import { echapper, formatNombre, creerCombo } from '@logibtp/socle/ui';
import { METHODES_VALORISATION } from '@logibtp/stock';
import { api } from '../api.js';
import { dateHeureLocale, isoDepuisLocal } from './etat.js';
import { choixMultiple } from '../choix-multiple.js';

// Module Stock, lot 1 (ANALYSE-MODULE-STOCK.md § 5.1, S4, S31) : onglet Stock de la fiche d'un article géré en stock :
// quantité par lieu à maintenant, valorisation (PMP, dernier prix d'achat avec sa pièce, son fournisseur et sa date,
// provisoire tant que la réception n'est pas facturée), correction datée du PMP (commentaire, historique), emplacements
// habituels dans chaque dépôt, derniers mouvements ; lot 2 : marques de l'article, micro-inventaire (« Corriger le
// stock » : quantité comptée maintenant ou à une date, valeur d'inventaire, appliquée au PMP au choix).

const ORIGINES = { DOCUMENT: '', DOTATION: 'Dotation', BORNE: 'Borne' };

/** Rend l'onglet dans corps ; options { id, message, naviguer(url, e) }. */
export async function rendreStockArticle(corps, { id, message, naviguer }) {
  corps.innerHTML = '<p class="aide">Chargement…</p>';
  const [f, lieux, marques, portees] = await Promise.all([api.stock.article(id), api.stock.lieux(), api.stock.marques(), api.stock.marquesArticle(id)]);
  const depots = lieux.filter((l) => l.depot);
  const emplacements = new Map(await Promise.all(depots.map(async (d) => [d.id, await api.stock.emplacements(d.id)])));
  const nb = (v, p = f.precision) => (v === null || v === undefined ? '' : formatNombre(v, p));
  const piece = f.dernier_pa_piece;
  corps.innerHTML = `<div class="stock-article">
    <div class="ligne"><b>Stock total : ${nb(f.quantite)} ${echapper(f.unite)}</b>
      · ${echapper(METHODES_VALORISATION[f.methode] ?? f.methode)} : <b>${nb(f.valeur_unitaire, 4)}</b>${f.source === 'REPLI' ? ' <span class="avertissement">(aucun achat : PA de la bibliothèque)</span>' : ''}</div>
    <p class="ligne">Marques <span data-marques></span></p>
    <table class="tableau-compact"><thead><tr><th>Lieu</th><th>Quantité</th><th>Dernier inventaire</th></tr></thead><tbody>
      ${f.lieux.map((l) => `<tr><td>${l.depot ? '📦' : '🏗'} ${echapper(l.code)} ${echapper(l.libelle)}${l.depot ? ` <a href="/stock/projection?lieu=${l.lieu}&article=${id}" data-url title="Projection : réservations, commandes, ruptures à venir">📈</a>` : ''}</td><td class="nombre${Number(l.quantite) < 0 ? ' avertissement' : ''}">${nb(l.quantite)}</td>
        <td>${dateHeureLocale(l.dernier_comptage)}</td></tr>`).join('') || '<tr><td colspan="3" class="aide">Aucun mouvement</td></tr>'}</tbody></table>
    <h3>Corriger le stock</h3>
    <p class="ligne"><label>Lieu <span data-lieu-correction></span></label> <label>Quantité comptée <input data-cq size="8"></label>
      <label>Au <input type="datetime-local" data-cdate title="Vide : maintenant"></label> <label>Valeur d'inventaire <input data-cprix size="8" title="Facultatif : stock lent, obsolète…"></label>
      <label><input type="checkbox" data-cpmp> Appliquer au PMP</label> <label>Commentaire <input data-ccom size="24"></label> <button type="button" data-corriger>Corriger</button></p>
    <h3>Valorisation</h3>
    <p>PMP : <b>${nb(f.pmp, 6) || '—'}</b> · Dernier prix d'achat : <b>${nb(f.dernier_pa, 6) || '—'}</b>${f.provisoire ? ' <span title="Réception non encore facturée">⏳ provisoire</span>' : ''}
      ${piece ? ` — ${echapper(piece.type)} <a href="/document/${piece.id}" data-piece="${piece.id}">${echapper(piece.numero)}</a>${piece.tiers ? `, ${echapper(piece.tiers)}` : ''}, ${dateHeureLocale(f.dernier_pa_date)}` : ''}</p>
    <p class="ligne"><label>Nouveau PMP <input data-pmp size="10"></label> <label>Au <input type="datetime-local" data-date title="Vide : maintenant"></label>
      <label>Commentaire <input data-commentaire size="30"></label> <button type="button" data-reevaluer>Corriger le PMP</button></p>
    ${f.reevaluations.length ? `<table class="tableau-compact"><thead><tr><th>Date</th><th>Ancien PMP</th><th>PMP</th><th>Commentaire</th><th>Par</th></tr></thead><tbody>
      ${f.reevaluations.map((r) => `<tr><td>${dateHeureLocale(r.date)}</td><td class="nombre">${nb(r.ancien_pmp, 6)}</td><td class="nombre">${nb(r.pmp, 6)}</td>
        <td>${echapper(r.commentaire ?? '')}</td><td>${echapper(r.par)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${depots.length ? `<h3>Emplacements habituels</h3>${depots.map((d) => `<p class="ligne"><b>${echapper(d.code)}</b>
      ${(emplacements.get(d.id) ?? []).filter((e) => e.actif).map((e) => `<label><input type="checkbox" data-emp="${e.id}" ${f.emplacements.includes(e.id) ? 'checked' : ''}> ${echapper(e.code)}</label>`).join(' ')
        || '<span class="aide">aucun emplacement</span>'}</p>`).join('')}<p class="ligne"><button type="button" data-emplacements>Enregistrer les emplacements</button></p>` : ''}
    <h3>Derniers mouvements</h3>
    <table class="tableau-compact"><thead><tr><th>Date</th><th>Lieu</th><th>Quantité</th><th>Prix</th><th>PMP</th><th>Pièce</th><th>Tiers</th></tr></thead><tbody>
      ${f.mouvements.map((m) => `<tr><td>${dateHeureLocale(m.date)}</td><td>${echapper(m.lieu_code ?? '')}</td>
        <td class="nombre${Number(m.quantite) < 0 ? '' : ' entree'}">${Number(m.quantite) > 0 ? '+' : ''}${nb(m.quantite)}</td>
        <td class="nombre">${nb(m.prix, 4)}${m.provisoire ? ' ⏳' : ''}</td><td class="nombre">${nb(m.pmp, 4)}</td>
        <td>${m.ent_id ? `<a href="/document/${m.ent_id}" data-piece="${m.ent_id}">${echapper(m.piece ?? '')}</a> <small>${echapper(m.type_piece ?? '')}</small>` : echapper(ORIGINES[m.origine] ?? m.origine)}</td>
        <td>${echapper(m.tiers ?? '')}</td></tr>`).join('') || '<tr><td colspan="7" class="aide">Aucun mouvement</td></tr>'}</tbody></table></div>`;
  // Marques : ajout ou retrait enregistré aussitôt.
  let actuelles = [...portees];
  corps.querySelector('[data-marques]').append(choixMultiple({
    options: marques.filter((m) => m.actif || actuelles.includes(m.code)).map((m) => ({ valeur: m.code, libelle: m.libelle })), valeurs: actuelles,
    titre: 'Ajouter une marque', aucun: 'aucune',
    changer: async (v) => {
      try {
        await api.stock.marquer({ articles: [id], ajouter: v.filter((x) => !actuelles.includes(x)), retirer: actuelles.filter((x) => !v.includes(x)) });
        actuelles = v;
      } catch (e) { message(e.message, 'erreur'); }
    },
  }));
  const tenus = lieux.filter((l) => l.depot || f.lieux.some((x) => x.lieu === l.id));
  const lieuCorrection = creerCombo({ options: tenus.map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: f.lieux[0]?.lieu ?? depots[0]?.id ?? '', vide: false });
  corps.querySelector('[data-lieu-correction]').append(lieuCorrection);
  corps.querySelector('[data-corriger]').addEventListener('click', async () => {
    const lire = (sel) => { const v = corps.querySelector(sel).value.trim().replace(/\s/g, '').replace(',', '.'); return v === '' ? null : v; };
    try {
      await api.stock.corriger(id, { lieu: Number(lieuCorrection.valeurCombo), quantite: lire('[data-cq]'), prix: lire('[data-cprix]'), appliquer_pmp: corps.querySelector('[data-cpmp]').checked,
        commentaire: corps.querySelector('[data-ccom]').value, date: isoDepuisLocal(corps.querySelector('[data-cdate]').value) });
      message('Stock corrigé (micro-inventaire)');
      await rendreStockArticle(corps, { id, message, naviguer });
    } catch (e) { message(e.message, 'erreur'); }
  });
  corps.querySelectorAll('[data-url]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(a.getAttribute('href'), e); }));
  corps.querySelectorAll('[data-piece]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(`/document/${a.dataset.piece}`, e); }));
  corps.querySelector('[data-reevaluer]').addEventListener('click', async () => {
    const v = corps.querySelector('[data-pmp]').value.trim().replace(/\s/g, '').replace(',', '.');
    const d = corps.querySelector('[data-date]').value;
    try {
      await api.stock.reevaluer(id, { pmp: v === '' ? null : v, commentaire: corps.querySelector('[data-commentaire]').value, date: d ? new Date(d).toISOString() : null });
      message('PMP corrigé');
      await rendreStockArticle(corps, { id, message, naviguer });
    } catch (e) { message(e.message, 'erreur'); }
  });
  corps.querySelector('[data-emplacements]')?.addEventListener('click', async () => {
    const choisis = [...corps.querySelectorAll('[data-emp]:checked')].map((x) => Number(x.dataset.emp));
    try { await api.stock.emplacementsArticle(id, choisis); message('Emplacements enregistrés'); } catch (e) { message(e.message, 'erreur'); }
  });
}
