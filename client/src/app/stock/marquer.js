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
  dlg.innerHTML = `<form method="dialog"><h3>🏷 Marquer ${ids.length} article${ids.length > 1 ? 's' : ''}</h3>
    <p class="ligne"><b>Ajouter</b> <span data-ajouter></span></p><p class="ligne"><b>Retirer</b> <span data-retirer></span></p>
    <p class="aide">Les marques servent de listes rapides (inventaires, magasin, borne) ; elles se définissent dans les paramètres du stock.
      ${marques.length ? '' : `<br>${echapper('Aucune marque définie.')}`}</p>
    <div class="boutons"><button value="annuler">Annuler</button> <button type="button" class="principal" data-ok>Appliquer</button></div></form>`;
  const ajouter = choixMultiple({ options, titre: 'Ajouter une marque', aucun: 'aucune' });
  const retirer = choixMultiple({ options, titre: 'Retirer une marque', aucun: 'aucune' });
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
