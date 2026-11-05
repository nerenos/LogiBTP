import { texte, texteHtml, textesParCode, pairesParCode, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlDocument } from '../codes.js';
import { echapper, formatNombre, creerCombo } from '@logibtp/socle/ui';
import { METHODES_VALORISATION } from '@logibtp/stock';
import { api } from '../api.js';
import { dateHeureLocale, isoDepuisLocal } from './etat.js';
import { choixMultiple } from '../choix-multiple.js';
import { rendreLotsArticle } from './lots-article.js';

// Module Stock, lot 1 (ANALYSE-MODULE-STOCK.md § 5.1, S4, S31) : onglet Stock de la fiche d'un article géré en stock :
// quantité par lieu à maintenant, valorisation (PMP, dernier prix d'achat avec sa pièce, son fournisseur et sa date,
// provisoire tant que la réception n'est pas facturée), correction datée du PMP (commentaire, historique), emplacements
// habituels dans chaque dépôt, derniers mouvements ; lot 2 : marques de l'article, micro-inventaire (« Corriger le
// stock » : quantité comptée maintenant ou à une date, valeur d'inventaire, appliquée au PMP au choix).

/** Origine d'un mouvement sans pièce, par code (module Personnalisation). */
const ORIGINES = textesParCode('stock_btp.origines', ['DOCUMENT', 'DOTATION', 'BORNE']);

/** Rend l'onglet dans corps ; options { id, message, naviguer(url, e) }. */
export async function rendreStockArticle(corps, { id, message, naviguer }) {
  corps.innerHTML = `<p class="aide">${texteHtml('stock_btp.article.chargement')}</p>`;
  const [f, lieux, marques, portees, dotation] = await Promise.all([api.stock.article(id), api.stock.lieux(), api.stock.marques(), api.stock.marquesArticle(id),
    api.stock.dotationArticle(id)]);
  const depots = lieux.filter((l) => l.depot);
  const emplacements = new Map(await Promise.all(depots.map(async (d) => [d.id, await api.stock.emplacements(d.id)])));
  const nb = (v, p = f.precision) => (formatNombre(v, p));
  const piece = f.dernier_pa_piece;
  corps.innerHTML = `<div class="stock-article">
    <div class="ligne"><b>${texteHtml('stock_btp.article.total', { quantite: nb(f.quantite), unite: f.unite })}</b>
      · ${echapper(METHODES_VALORISATION[f.methode] ?? f.methode)} : <b>${nb(f.valeur_unitaire, 4)}</b>${f.source === 'REPLI' ? ` <span class="avertissement">${texteHtml('stock_btp.article.repli')}</span>` : ''}</div>
    <p class="ligne">${texteHtml('stock_btp.article.marques')} <span data-marques></span></p>
    <p class="ligne"><label>${texteHtml('stock_btp.article.dotation')} <span data-dotation></span></label> <label>${texteHtml('stock_btp.article.duree')} <input data-duree size="3" value="${dotation.duree_mois ?? ''}"> ${texteHtml('stock_btp.article.mois')}</label>
      <button type="button" data-enr-dotation title="${texteHtml('stock_btp.article.dotation_titre')}">${texteHtml('commun.enregistrer')}</button></p>
    <table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.lieu')}</th><th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.colonnes.dernier_inventaire')}</th></tr></thead><tbody>
      ${f.lieux.map((l) => `<tr><td>${iconeHtml(l.depot ? 'stock_btp_stock' : 'stock_btp_chantier')} ${echapper(l.code)} ${echapper(l.libelle)}${l.depot ? ` <a href="/stock/projection?lieu=${l.lieu}&article=${id}" data-url title="${texteHtml('stock_btp.article.projection_titre')}">${iconeHtml('stock_btp_projection')}</a>` : ''}</td><td class="nombre${Number(l.quantite) < 0 ? ' avertissement' : ''}">${nb(l.quantite)}</td>
        <td>${dateHeureLocale(l.dernier_comptage)}</td></tr>`).join('') || `<tr><td colspan="3" class="aide">${texteHtml('stock_btp.article.aucun_mouvement')}</td></tr>`}</tbody></table>
    <div data-lots></div>
    <h3>${texteHtml('stock_btp.article.corriger')}</h3>
    <p class="ligne"><label>${texteHtml('stock_btp.colonnes.lieu')} <span data-lieu-correction></span></label> <label>${texteHtml('stock_btp.article.quantite_comptee')} <input data-cq size="8"></label>
      <label>${texteHtml('stock_btp.article.au')} <input type="datetime-local" data-cdate title="${texteHtml('stock_btp.etat.date_titre')}"></label> <label>${texteHtml('stock_btp.article.valeur_inventaire')} <input data-cprix size="8" title="${texteHtml('stock_btp.article.valeur_inventaire_titre')}"></label>
      <label><input type="checkbox" data-cpmp> ${texteHtml('stock_btp.article.appliquer_pmp')}</label> <label>${texteHtml('stock_btp.article.commentaire')} <input data-ccom size="24"></label> <button type="button" data-corriger>${texteHtml('stock_btp.article.corriger_bouton')}</button></p>
    <h3>${texteHtml('stock_btp.parametres.valorisation')}</h3>
    <p>${texteHtml('stock_btp.article.pmp')} <b>${nb(f.pmp, 6) || '—'}</b> · ${texteHtml('stock_btp.article.dernier_pa')} <b>${nb(f.dernier_pa, 6) || '—'}</b>${f.provisoire ? ` <span title="${texteHtml('stock_btp.article.provisoire_titre')}">${iconeHtml('stock_btp_provisoire')} ${texteHtml('stock_btp.article.provisoire')}</span>` : ''}
      ${piece ? ` — ${echapper(piece.type)} <a href="${urlDocument(piece.id)}" data-piece="${piece.id}">${echapper(piece.numero)}</a>${piece.tiers ? `, ${echapper(piece.tiers)}` : ''}, ${dateHeureLocale(f.dernier_pa_date)}` : ''}</p>
    <p class="ligne"><label>${texteHtml('stock_btp.article.nouveau_pmp')} <input data-pmp size="10"></label> <label>${texteHtml('stock_btp.article.au')} <input type="datetime-local" data-date title="${texteHtml('stock_btp.etat.date_titre')}"></label>
      <label>${texteHtml('stock_btp.article.commentaire')} <input data-commentaire size="30"></label> <button type="button" data-reevaluer>${texteHtml('stock_btp.article.corriger_pmp')}</button></p>
    ${f.reevaluations.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.date')}</th><th>${texteHtml('stock_btp.article.ancien_pmp')}</th><th>${texteHtml('stock_btp.colonnes.pmp')}</th><th>${texteHtml('stock_btp.article.commentaire')}</th><th>${texteHtml('stock_btp.colonnes.par')}</th></tr></thead><tbody>
      ${f.reevaluations.map((r) => `<tr><td>${dateHeureLocale(r.date)}</td><td class="nombre">${nb(r.ancien_pmp, 6)}</td><td class="nombre">${nb(r.pmp, 6)}</td>
        <td>${echapper(r.commentaire ?? '')}</td><td>${echapper(r.par)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${depots.length ? `<h3>${texteHtml('stock_btp.article.emplacements')}</h3>${depots.map((d) => `<p class="ligne"><b>${echapper(d.code)}</b>
      ${(emplacements.get(d.id) ?? []).filter((e) => e.actif).map((e) => `<label><input type="checkbox" data-emp="${e.id}" ${f.emplacements.includes(e.id) ? 'checked' : ''}> ${echapper(e.code)}</label>`).join(' ')
        || `<span class="aide">${texteHtml('stock_btp.article.aucun_emplacement')}</span>`}</p>`).join('')}<p class="ligne"><button type="button" data-emplacements>${texteHtml('stock_btp.article.enregistrer_emplacements')}</button></p>` : ''}
    <h3>${texteHtml('stock_btp.article.derniers')}</h3>
    <table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.date')}</th><th>${texteHtml('stock_btp.colonnes.lieu')}</th><th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.colonnes.prix')}</th><th>${texteHtml('stock_btp.colonnes.pmp')}</th><th>${texteHtml('stock_btp.colonnes.piece')}</th><th>${texteHtml('stock_btp.colonnes.tiers')}</th></tr></thead><tbody>
      ${f.mouvements.map((m) => `<tr><td>${dateHeureLocale(m.date)}</td><td>${echapper(m.lieu_code ?? '')}</td>
        <td class="nombre${Number(m.quantite) < 0 ? '' : ' entree'}">${Number(m.quantite) > 0 ? '+' : ''}${nb(m.quantite)}</td>
        <td class="nombre">${nb(m.prix, 4)}${m.provisoire ? ` ${iconeHtml('stock_btp_provisoire')}` : ''}</td><td class="nombre">${nb(m.pmp, 4)}</td>
        <td>${m.ent_id ? `<a href="${urlDocument(m.ent_id)}" data-piece="${m.ent_id}">${echapper(m.piece ?? '')}</a> <small>${echapper(m.type_piece ?? '')}</small>` : echapper(ORIGINES[m.origine] ?? m.origine)}</td>
        <td>${echapper(m.tiers ?? '')}</td></tr>`).join('') || `<tr><td colspan="7" class="aide">${texteHtml('stock_btp.article.aucun_mouvement')}</td></tr>`}</tbody></table></div>`;
  // Lots et numéros de série (S24-a) : suivi de l'article, lots et leur stock.
  rendreLotsArticle(corps.querySelector('[data-lots]'), { id, message }).catch((e) => message(e.message, 'erreur'));
  // Dotation (lot 4) : EPI ou outillage consommable, durée de vie (renouvellement).
  const typeDotation = creerCombo({ options: pairesParCode('stock_btp.types_dotation', ['EPI', 'OUTILLAGE']).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: dotation.type ?? '' });
  corps.querySelector('[data-dotation]').append(typeDotation);
  corps.querySelector('[data-enr-dotation]').addEventListener('click', async () => {
    const d = corps.querySelector('[data-duree]').value.trim();
    try { await api.stock.definirDotation(id, { type: typeDotation.valeurCombo || null, duree_mois: d ? Number(d) : null }); message(texte('stock_btp.article.dotation_enregistree')); } catch (e) { message(e.message, 'erreur'); }
  });
  // Marques : ajout ou retrait enregistré aussitôt.
  let actuelles = [...portees];
  corps.querySelector('[data-marques]').append(choixMultiple({
    options: marques.filter((m) => m.actif || actuelles.includes(m.code)).map((m) => ({ valeur: m.code, libelle: m.libelle })), valeurs: actuelles,
    titre: texte('stock_btp.marquer.ajouter'), aucun: texte('stock_btp.marquer.aucun'),
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
      message(texte('stock_btp.article.corrige'));
      await rendreStockArticle(corps, { id, message, naviguer });
    } catch (e) { message(e.message, 'erreur'); }
  });
  corps.querySelectorAll('[data-url]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(a.getAttribute('href'), e); }));
  corps.querySelectorAll('[data-piece]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(urlDocument(a.dataset.piece), e); }));
  corps.querySelector('[data-reevaluer]').addEventListener('click', async () => {
    const v = corps.querySelector('[data-pmp]').value.trim().replace(/\s/g, '').replace(',', '.');
    const d = corps.querySelector('[data-date]').value;
    try {
      await api.stock.reevaluer(id, { pmp: v === '' ? null : v, commentaire: corps.querySelector('[data-commentaire]').value, date: d ? new Date(d).toISOString() : null });
      message(texte('stock_btp.article.pmp_corrige'));
      await rendreStockArticle(corps, { id, message, naviguer });
    } catch (e) { message(e.message, 'erreur'); }
  });
  corps.querySelector('[data-emplacements]')?.addEventListener('click', async () => {
    const choisis = [...corps.querySelectorAll('[data-emp]:checked')].map((x) => Number(x.dataset.emp));
    try { await api.stock.emplacementsArticle(id, choisis); message(texte('stock_btp.parametres.emplacements_enregistres')); } catch (e) { message(e.message, 'erreur'); }
  });
}
