import { texte, texteHtml, pluriel, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, ouvrirModale } from '@logibtp/socle/ui';
import { api } from '../api.js';
import { choixMultiple } from '../choix-multiple.js';

// Module Stock, lot 2 (ANALYSE-MODULE-STOCK.md S20) : marquage en masse des articles sélectionnés dans la liste de la
// bibliothèque (marques ajoutées et retirées). Résout le nombre d'articles traités, ou null (abandon).
export async function marquerArticles(ids) {
  const marques = (await api.stock.marques()).filter((m) => m.actif);
  const options = marques.map((m) => ({ valeur: m.code, libelle: m.libelle }));
  const dlg = document.createElement('dialog');
  dlg.className = 'dialogue-structure';
  dlg.innerHTML = `<form method="dialog"><h3>${iconeHtml('stock_btp_marque')} ${texteHtml('stock_btp.marquer.titre', { articles: pluriel('stock_btp.etat.articles', ids.length) })}</h3>
    <p class="ligne"><b>${texteHtml('commun.ajouter')}</b> <span data-ajouter></span></p><p class="ligne"><b>${texteHtml('commun.retirer')}</b> <span data-retirer></span></p>
    <p class="aide">${texteHtml('stock_btp.marquer.aide')}
      ${marques.length ? '' : `<br>${texteHtml('stock_btp.marquer.aucune')}`}</p>
    <div class="boutons"><button value="annuler">${texteHtml('commun.annuler')}</button> <button type="button" class="principal" data-ok>${texteHtml('stock_btp.marquer.appliquer')}</button></div></form>`;
  const ajouter = choixMultiple({ options, titre: texte('stock_btp.marquer.ajouter'), aucun: texte('stock_btp.marquer.aucun') });
  const retirer = choixMultiple({ options, titre: texte('stock_btp.marquer.retirer'), aucun: texte('stock_btp.marquer.aucun') });
  dlg.querySelector('[data-ajouter]').append(ajouter);
  dlg.querySelector('[data-retirer]').append(retirer);
  document.body.append(dlg);
  return new Promise((resoudre, rejeter) => {
    const finir = (v) => { if (dlg.open) dlg.close(); dlg.remove(); resoudre(v); };
    dlg.addEventListener('close', () => finir(null));
    dlg.querySelector('[data-ok]').addEventListener('click', async () => {
      try {
        const r = await api.stock.marquer({ articles: ids, ajouter: ajouter.valeurs, retirer: retirer.valeurs });
        finir(r.articles);
      } catch (e) { dlg.remove(); rejeter(e); }
    });
    ouvrirModale(dlg, () => dlg.close());
  });
}
