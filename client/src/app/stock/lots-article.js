import { texte, texteHtml, pairesParCode, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre, creerCombo } from '@logibtp/socle/ui';
import { aujourdhui } from '@logibtp/socle';
import { SUIVI_ARTICLE, UNITE_DUREE } from '@logibtp/stock';
import { api } from '../api.js';

// Lots et numéros de série d'un article (module Stock, lot S24-a ; ANALYSE-MODULE-STOCK.md § 11) : section de l'onglet
// Stock de la fiche article — suivi (aucun, par lot, par numéro de série), péremption (article périssable, durée
// théorique qui propose la date limite des lots, S24.7), lots avec leur stock actuel par lieu, reste sans lot, fiche
// d'un lot (fabrication, date limite, coulée, norme, commentaire).

/** Rend la section dans zone ; options { id, message }. */
export async function rendreLotsArticle(zone, { id, message }) {
  const d = await api.stock.lotsArticle(id);
  const nb = (v) => formatNombre(v, d.precision);
  const jour = aujourdhui();
  const s = { ...d.suivi };
  zone.innerHTML = `<h3>${texteHtml('stock_btp.lots.titre_article')}</h3>
    <p class="ligne"><label>${texteHtml('stock_btp.lots.suivi')} <span data-suivi></span></label>
      <label><input type="checkbox" data-perissable ${s.perissable ? 'checked' : ''}> ${texteHtml('stock_btp.lots.perissable')}</label>
      <label>${texteHtml('stock_btp.lots.duree')} <input data-duree size="4" value="${s.duree ?? ''}" ${s.perissable ? '' : 'disabled'}></label> <span data-unite></span>
      <label title="${texteHtml('stock_btp.lots.certificat_titre')}"><input type="checkbox" data-certificat ${s.certificat ? 'checked' : ''}> ${texteHtml('stock_btp.lots.certificat')}</label>
      <label title="${texteHtml('stock_btp.lots.garantie_titre')}">${texteHtml('stock_btp.lots.garantie')} <input data-garantie size="4" value="${s.garantie_mois ?? ''}"> ${texteHtml('stock_btp.lots.garantie_unite')}</label>
      <button type="button" data-enr-suivi>${texteHtml('commun.enregistrer')}</button></p>
    ${d.lots.length || Number(d.sans_lot) ? `<table class="tableau-compact lots-article"><thead><tr><th>${texteHtml('stock_btp.lots.numero')}</th><th>${texteHtml('stock_btp.lots.fournisseur')}</th>
      <th>${texteHtml('stock_btp.lots.fabrication')}</th><th>${texteHtml('stock_btp.lots.limite')}</th><th>${texteHtml('stock_btp.lots.coulee')}</th><th>${texteHtml('stock_btp.lots.norme')}</th>
      <th>${texteHtml('stock_btp.lots.commentaire')}</th><th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.lots.lieux')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${d.lots.map((l, i) => `<tr data-lot="${i}"${Number(l.quantite) === 0 ? ' class="discret"' : ''}><td><a href="/stock/lot/${l.id}" data-url><b>${echapper(l.numero)}</b></a></td><td>${echapper(l.tiers_nom ?? '')}</td>
        <td><input type="date" data-c="fabrication" value="${l.fabrication ?? ''}"></td>
        <td${l.limite && l.limite < jour ? ` class="avertissement" title="${texteHtml('stock_btp.lots.perime')}"` : ''}><input type="date" data-c="limite" value="${l.limite ?? ''}"></td>
        <td><input data-c="coulee" size="10" maxlength="60" value="${echapper(l.coulee ?? '')}"></td><td><input data-c="norme" size="10" maxlength="60" value="${echapper(l.norme ?? '')}"></td>
        <td><input data-c="commentaire" size="16" value="${echapper(l.commentaire ?? '')}"></td>
        <td class="nombre">${nb(l.quantite)} ${echapper(d.unite ?? '')}</td><td>${l.lieux.map((x) => `${echapper(x.lieu_code ?? '')} ${nb(x.quantite)}`).join(', ')}</td>
        <td class="cellule-boutons"><button type="button" class="bouton-icone" data-enr-lot="${i}" hidden title="${texteHtml('commun.enregistrer')}">${iconeHtml('stock_btp_valide')}</button></td></tr>`).join('')}
      ${Number(d.sans_lot) ? `<tr><td colspan="7"><i>${texteHtml('stock_btp.lots.sans_lot_ligne')}</i></td><td class="nombre">${nb(d.sans_lot)} ${echapper(d.unite ?? '')}</td>
        <td>${d.sans_lot_lieux.map((x) => `${echapper(x.lieu_code ?? '')} ${nb(x.quantite)}`).join(', ')}</td><td></td></tr>` : ''}
      </tbody></table>` : `<p class="aide">${texteHtml('stock_btp.lots.aucun')}</p>`}`;
  const suivi = creerCombo({ options: pairesParCode('stock_btp.lots.suivis', Object.values(SUIVI_ARTICLE)).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: s.suivi, vide: false });
  zone.querySelector('[data-suivi]').append(suivi);
  const unite = creerCombo({ options: pairesParCode('stock_btp.lots.unites', Object.values(UNITE_DUREE)).map(([valeur, libelle]) => ({ valeur, libelle })), valeur: s.unite, vide: false });
  zone.querySelector('[data-unite]').append(unite);
  const duree = zone.querySelector('[data-duree]');
  const garantie = zone.querySelector('[data-garantie]');
  zone.querySelector('[data-perissable]').addEventListener('change', (e) => { duree.disabled = !e.target.checked; });
  zone.querySelector('[data-enr-suivi]').addEventListener('click', async () => {
    const perissable = zone.querySelector('[data-perissable]').checked;
    try {
      await api.stock.definirSuiviArticle(id, { suivi: suivi.valeurCombo, perissable, duree: perissable && duree.value.trim() ? Number(duree.value) : null, unite: unite.valeurCombo,
        certificat: zone.querySelector('[data-certificat]').checked, garantie_mois: garantie.value.trim() ? Number(garantie.value) : null });
      message(texte('stock_btp.lots.suivi_enregistre'));
    } catch (e) { message(e.message, 'erreur'); }
  });
  zone.querySelectorAll('tr[data-lot]').forEach((tr) => {
    const l = d.lots[Number(tr.dataset.lot)];
    const bouton = tr.querySelector('[data-enr-lot]');
    tr.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('input', () => { bouton.hidden = false; }));
    bouton.addEventListener('click', async () => {
      const v = (c) => tr.querySelector(`[data-c="${c}"]`).value.trim() || null;
      try {
        await api.stock.modifierLot(l.id, { fabrication: v('fabrication'), limite: v('limite'), coulee: v('coulee'), norme: v('norme'), commentaire: v('commentaire') });
        message(texte('stock_btp.lots.lot_enregistre', { numero: l.numero }));
        await rendreLotsArticle(zone, { id, message });
      } catch (e) { message(e.message, 'erreur'); }
    });
  });
}
