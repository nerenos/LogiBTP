// Module Rentabilité, interface (ANALYSE-MODULE-ANALYSE.md § 7, § 8) : tableau du Détail (bandes de couleur par
// indicateur, total en haut, montants anormaux en rouge, double-clic = faits du chiffre) et tableau des faits regroupés par
// pièce. Composants sans métier : l'application fournit les agrégats, les natures, les faits et l'ouverture d'une pièce.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { formatNombre, formatDate, echapper } from '@logibtp/socle/ui';
import { COLONNES_DETAIL, COUT, lignesDetail, anomalie, libelleColonne, infoColonne, regrouperFaits } from '../src/indicateurs.js';

const montant = (v) => formatNombre(v?.toString?.() ?? v, 2);
const cellule = (valeur, c, l) => {
  // Postes de pied : remises et déductions négatives par nature, jamais en rouge.
  const a = l.type === 'postes' ? null : anomalie(valeur, c.sens);
  const bulle = a ? `${texte(`rentabilite.anomalies.${a}`)}\n${texte('rentabilite.detail.ouvrir_faits')}` : texte('rentabilite.detail.ouvrir_faits');
  return `<td data-colonne="${c.code}" class="montant rentabilite-bande-${c.teinte}${a ? ' rentabilite-anomalie' : ''}" title="${echapper(bulle)}">${montant(valeur)}</td>`;
};

/**
 * Tableau du Détail d'un chantier. options : { cout (PA | PR), ordre (undefined = tout, 0 = sans ordre, id),
 * ouvrirFaits({ indicateurs, natures, composante, ordre, colonne, ligne }, nouvelleFenetre) }.
 */
export class TableauDetail {
  #zone;
  #o;
  #lignes = [];

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { cout: COUT.PR, ouvrirFaits: () => {}, ...options };
  }

  /** donnees : { agregats, natures } du serveur (GET /rentabilite/chantiers/{id}). */
  rendre(donnees, options = {}) {
    Object.assign(this.#o, options);
    this.#lignes = lignesDetail({ agregats: donnees.agregats ?? [], natures: donnees.natures ?? [], ordre: this.#o.ordre, cout: this.#o.cout });
    const vide = this.#lignes.length === 1 && COLONNES_DETAIL.every((c) => this.#lignes[0].valeurs[c.code].isZero());
    if (vide) { this.#zone.innerHTML = `<p class="aide">${texteHtml('rentabilite.detail.aucun')}</p>`; return; }
    this.#zone.innerHTML = `<table class="rentabilite-detail tableau-compact">
      <thead><tr><th>${texteHtml('rentabilite.detail.nature')}</th>${COLONNES_DETAIL.map((c) => `<th class="montant rentabilite-colonne-${c.teinte}" title="${echapper(infoColonne(c))}">${echapper(libelleColonne(c))}</th>`).join('')}</tr></thead>
      <tbody>${this.#lignes.map((l, i) => `<tr class="rentabilite-ligne-${l.type}" data-i="${i}"${l.info ? ` title="${echapper(l.info)}"` : ''}>
        <th scope="row">${echapper(l.libelle)}</th>
        ${COLONNES_DETAIL.map((c) => cellule(l.valeurs[c.code], c, l)).join('')}
      </tr>`).join('')}</tbody></table>`;
    const table = this.#zone.querySelector('table');
    table.addEventListener('dblclick', (ev) => {
      const td = ev.target.closest('td[data-colonne]');
      if (!td) return;
      const l = this.#lignes[Number(td.parentElement.dataset.i)];
      const c = COLONNES_DETAIL.find((x) => x.code === td.dataset.colonne);
      this.#o.ouvrirFaits({ indicateurs: c.faits, natures: l.natures, composante: l.composante, ordre: this.#o.ordre, colonne: c.code, ligne: l.libelle },
        ev.ctrlKey || ev.metaKey);
    });
  }

  get lignes() { return this.#lignes; }
}

/**
 * Tableau des faits d'un chiffre, regroupés par pièce (§ 8). options : { annulees, voirCouts, ouvrirPiece(entId,
 * nouvelleFenetre), libelleRegle(code), libelleNature(id), libelleOrdre(id) }.
 */
export class TableauFaits {
  #zone;
  #o;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { annulees: false, voirCouts: true, ouvrirPiece: () => {}, libelleRegle: (c) => c, libelleNature: () => '', libelleOrdre: () => '', ...options };
  }

  /** donnees : { faits, pieces: { [ent_id]: piece }, masques: [{ type, nombre, pa, pr, pv }] } du serveur. */
  rendre(donnees, options = {}) {
    Object.assign(this.#o, options);
    const { groupes, total, parIndicateur, masques } = regrouperFaits(donnees.faits ?? [], donnees.pieces ?? {}, { annulees: this.#o.annulees });
    const couts = this.#o.voirCouts;
    const nbCol = couts ? 12 : 10;
    const ligneTotal = (libelle, t, classe) => `<tr class="${classe}"><th colspan="${nbCol - (couts ? 4 : 2)}">${echapper(libelle)}</th>
      ${couts ? `<td class="montant">${montant(t.pa)}</td><td class="montant">${montant(t.pr)}</td>` : ''}<td class="montant">${montant(t.pv)}</td><td class="montant">${t.heures.isZero() ? '' : montant(t.heures)}</td></tr>`;
    const lignesMasquees = (donnees.masques ?? []).map((m) => `<tr class="rentabilite-masque"><td colspan="${nbCol - (couts ? 4 : 2)}">${iconeHtml('rentabilite_anomalie')} ${texteHtml(m.pieces > 1 ? 'rentabilite.faits.masques_autre' : 'rentabilite.faits.masques_un', { nombre: m.pieces, type: m.type })}</td>
      ${couts ? `<td class="montant">${montant(m.pa)}</td><td class="montant">${montant(m.pr)}</td>` : ''}<td class="montant">${montant(m.pv)}</td><td></td></tr>`).join('');
    if (!groupes.length && !lignesMasquees) { this.#zone.innerHTML = `<p class="aide">${texteHtml('rentabilite.faits.aucun')}</p>`; return; }
    const entetes = ['date', 'indicateur', 'piece', 'ligne', 'nature', 'ordre', 'qte', 'unite', ...(couts ? ['pa', 'pr'] : []), 'pv', 'heures'];
    const numeriques = new Set(['qte', 'pa', 'pr', 'pv', 'heures']);
    this.#zone.innerHTML = `${masques ? `<p class="aide">${iconeHtml('rentabilite_annulee')} ${texteHtml(masques > 1 ? 'rentabilite.faits.annulees_masquees_autre' : 'rentabilite.faits.annulees_masquees_un', { nombre: masques })}</p>` : ''}
      <table class="rentabilite-faits tableau-compact">
      <thead><tr>${entetes.map((e) => `<th${numeriques.has(e) ? ' class="montant"' : ''}>${texteHtml(`rentabilite.faits.${e}`)}</th>`).join('')}</tr></thead>
      <tbody>${groupes.map((g) => {
        const nomPiece = g.piece ? `${g.piece.type_libelle ?? g.piece.type} ${g.piece.numero ?? ''}${g.piece.indice ? ` (${g.piece.indice})` : ''}` : texte(`rentabilite.sources.${g.source}`);
        return `${g.faits.map((f) => `<tr class="${g.piece?.annulee ? 'rentabilite-annulee' : ''}" title="${echapper(this.#o.libelleRegle(f.afa_regle))}">
          <td>${formatDate(f.afa_date)}</td>
          <td>${texteHtml(`rentabilite.indicateurs.${f.afa_indicateur}`)}</td>
          <td>${g.piece ? `<a href="#" data-piece="${f.afa_ent_id}">${echapper(nomPiece)}</a>${g.piece.annulee ? ` ${iconeHtml('rentabilite_annulee')}` : ''}` : echapper(nomPiece)}</td>
          <td>${echapper(f.afa_libelle ?? '')}</td>
          <td>${echapper(this.#o.libelleNature(f.afa_nat_id))}</td>
          <td>${echapper(this.#o.libelleOrdre(f.afa_ordre_id))}</td>
          <td class="montant">${f.afa_qte === null || f.afa_qte === undefined ? '' : formatNombre(f.afa_qte, 2)}</td>
          <td>${echapper(f.afa_unite ?? '')}</td>
          ${couts ? `<td class="montant">${montant(f.afa_montant_pa)}</td><td class="montant">${montant(f.afa_montant_pr)}</td>` : ''}
          <td class="montant">${montant(f.afa_montant_pv)}</td>
          <td class="montant">${f.afa_heures === null || f.afa_heures === undefined ? '' : montant(f.afa_heures)}</td></tr>`).join('')}
          ${ligneTotal(texte('rentabilite.faits.sous_total', { piece: nomPiece }), g.totaux, 'rentabilite-ligne-groupe')}`;
      }).join('')}
      ${lignesMasquees}
      ${parIndicateur.length
        ? parIndicateur.map((x) => ligneTotal(texte('rentabilite.faits.total_indicateur', { indicateur: texte(`rentabilite.indicateurs.${x.indicateur}`) }), x.totaux, 'rentabilite-ligne-total')).join('')
        : ligneTotal(texte('rentabilite.faits.total'), total, 'rentabilite-ligne-total')}</tbody></table>`;
    this.#zone.querySelectorAll('a[data-piece]').forEach((a) => a.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.#o.ouvrirPiece(Number(a.dataset.piece), ev.ctrlKey || ev.metaKey);
    }));
  }
}
