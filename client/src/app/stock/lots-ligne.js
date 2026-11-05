import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { SUIVI_ARTICLE, repartirLots, dateLimiteLot, MESSAGES_TRACABILITE } from '@logibtp/stock';
import { TYPE_DOCUMENT } from '../codes.js';

// Lots et numéros de série d'une ligne de pièce (module Stock, lot S24-a ; ANALYSE-MODULE-STOCK.md § 11) : section
// « Lots » du détail de la ligne d'un article, sur les pièces qui mouvementent le stock. La répartition est facultative
// (S24.2) : le reste de la ligne est « sans lot ». Gardée dans `lig_proprietes.lots` ([{ numero, quantite, fabrication,
// limite, coulee }], quantités en unité de stock), lue à la validation par le serveur (MouvementsStockBtp : un
// mouvement par lot, lots créés aux entrées).

/** Pièces dont les lignes reçoivent des lots : entrées (lots créés : fabrication, date limite, coulée) et sorties. */
const ENTREES = new Set([TYPE_DOCUMENT.A_RECEPTION, TYPE_DOCUMENT.A_FACTURE, TYPE_DOCUMENT.V_RETOUR, TYPE_DOCUMENT.S_ENTREE]);
const SORTIES = new Set([TYPE_DOCUMENT.A_RETOUR, TYPE_DOCUMENT.V_RECEPTION, TYPE_DOCUMENT.V_FACTURE, TYPE_DOCUMENT.S_SORTIE, TYPE_DOCUMENT.S_TRANSFERT]);

export const typeAvecLots = (code) => ENTREES.has(code) || SORTIES.has(code);

/**
 * Section « Lots » d'une ligne dans le détail : rien pour un article sans suivi dont la ligne n'a aucun lot. options :
 * { editeur, lots(ele) → promesse des lots de l'article (suivi, unité, lots existants), lecture }.
 */
export function sectionLots(zone, l, { editeur, lots, lecture }) {
  const type = editeur.definition.type?.tyd_code;
  if (!l.lig_art_id || !typeAvecLots(type)) return;
  const entree = ENTREES.has(type);
  lots(l.lig_art_id).then((info) => {
    if (!zone.isConnected || zone.querySelector('.lots-ligne')) return;
    const saisis = (l.lig_proprietes?.lots ?? []).map((x) => ({ ...x }));
    if (info.suivi.suivi === SUIVI_ARTICLE.AUCUN && !saisis.length) return;
    const bloc = document.createElement('fieldset');
    bloc.className = 'lots-ligne';
    zone.append(bloc);
    const memeUnite = !l.lig_unt_code || l.lig_unt_code === info.unite;
    const quantite = memeUnite ? (l.lig_qte_totale ?? l.lig_qte ?? 0) : null;
    const existants = info.lots.filter((x) => Number(x.quantite) > 0 || entree);
    const enregistrer = () => {
      const valeur = saisis.filter((x) => x.numero || x.quantite);
      editeur.magasin.modifier((b) => {
        const x = b.lignes.find((y) => y.lig_id === l.lig_id);
        if (x) x.lig_proprietes = { ...(x.lig_proprietes ?? {}), lots: valeur.length ? valeur : undefined };
      }, texte('stock_btp.lots.etape'));
    };
    const rendre = () => {
      const r = repartirLots({ quantite: quantite ?? 0, lots: saisis, suivi: info.suivi.suivi });
      const erreurs = new Map(r.erreurs.filter((e) => e.index !== null).map((e) => [e.index, MESSAGES_TRACABILITE[e.code]]));
      const generales = [...r.erreurs.filter((e) => e.index === null).map((e) => MESSAGES_TRACABILITE[e.code]),
        ...(quantite !== null ? r.avertissements.map((a) => MESSAGES_TRACABILITE[a.code]) : [])];
      const proposee = (x) => dateLimiteLot(info.suivi, { fabrication: x.fabrication || null, reception: editeur.saisie.document.ent_date || null });
      bloc.innerHTML = `<legend>${texteHtml(`stock_btp.lots.titre_${info.suivi.suivi}`)} <small>${texteHtml('stock_btp.lots.unite', { unite: info.unite ?? '' })}</small></legend>
        <datalist id="lots-${l.lig_id}">${existants.map((x) => `<option value="${echapper(x.numero)}">${texteHtml('stock_btp.lots.disponible', { quantite: formatNombre(x.quantite, info.precision) })}</option>`).join('')}</datalist>
        <table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.lots.numero')}</th><th>${texteHtml('stock_btp.lots.quantite')}</th>
          ${entree ? `<th>${texteHtml('stock_btp.lots.fabrication')}</th>${info.suivi.perissable ? `<th>${texteHtml('stock_btp.lots.limite')}</th>` : ''}<th>${texteHtml('stock_btp.lots.coulee')}</th>` : ''}
          ${lecture ? '' : '<th class="cellule-boutons"></th>'}</tr></thead><tbody>
        ${saisis.map((x, i) => `<tr${erreurs.has(i) ? ` class="invalide" title="${echapper(erreurs.get(i))}"` : ''}>
          <td><input data-i="${i}" data-c="numero" size="14" maxlength="60" list="lots-${l.lig_id}" value="${echapper(x.numero ?? '')}" ${lecture ? 'readonly' : ''}></td>
          <td><input data-i="${i}" data-c="quantite" size="7" class="nombre" value="${echapper(x.quantite ?? '')}" ${lecture ? 'readonly' : ''}></td>
          ${entree ? `<td><input type="date" data-i="${i}" data-c="fabrication" value="${x.fabrication ?? ''}" ${lecture ? 'disabled' : ''}></td>
            ${info.suivi.perissable ? `<td><input type="date" data-i="${i}" data-c="limite" value="${x.limite ?? ''}" placeholder="${proposee(x) ?? ''}" title="${proposee(x) ? texteHtml('stock_btp.lots.limite_proposee', { date: proposee(x) }) : ''}" ${lecture ? 'disabled' : ''}></td>` : ''}
            <td><input data-i="${i}" data-c="coulee" size="10" maxlength="60" value="${echapper(x.coulee ?? '')}" ${lecture ? 'readonly' : ''}></td>` : ''}
          ${lecture ? '' : `<td class="cellule-boutons"><button type="button" class="bouton-icone" data-retirer="${i}" title="${texteHtml('commun.supprimer')}">${iconeHtml('supprimer')}</button></td>`}</tr>`).join('')}
        </tbody></table>
        <p class="aide">${quantite === null ? texteHtml('stock_btp.lots.autre_unite')
          : Number(r.sans_lot) ? texteHtml('stock_btp.lots.sans_lot', { quantite: formatNombre(r.sans_lot, info.precision) }) : texteHtml('stock_btp.lots.repartie')}
          ${lecture ? '' : `<button type="button" class="bouton-icone" data-ajouter title="${texteHtml('stock_btp.lots.ajouter')}">${iconeHtml('ajouter')}</button>`}</p>
        ${generales.map((m) => `<p class="avertissement">${echapper(m)}</p>`).join('')}`;
      bloc.querySelectorAll('[data-c]').forEach((c) => c.addEventListener('change', () => {
        const x = saisis[Number(c.dataset.i)];
        x[c.dataset.c] = c.value.trim() || null;
        enregistrer();
        rendre();
      }));
      bloc.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { saisis.splice(Number(b.dataset.retirer), 1); enregistrer(); rendre(); }));
      bloc.querySelector('[data-ajouter]')?.addEventListener('click', () => {
        // Numéro de série : une unité par ligne ; lot : le reste de la ligne proposé.
        saisis.push({ numero: null, quantite: info.suivi.suivi === SUIVI_ARTICLE.SERIE ? 1 : Number(r.sans_lot) || null });
        rendre();
        bloc.querySelector(`[data-i="${saisis.length - 1}"][data-c="numero"]`)?.focus();
      });
    };
    rendre();
  }).catch(() => {});
}
