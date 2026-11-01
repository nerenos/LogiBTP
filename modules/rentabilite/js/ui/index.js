// Module Rentabilité, interface (ANALYSE-MODULE-ANALYSE.md § 7, § 8) : tableau du Détail (bandes de couleur par
// indicateur, total en haut, montants anormaux en rouge, double-clic = faits du chiffre) et tableau des faits regroupés par
// pièce. Composants sans métier : l'application fournit les agrégats, les natures, les faits et l'ouverture d'une pièce.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { Dz } from '@logibtp/socle';
import { formatNombre, formatDate, formatDateHeure, echapper, celluleCsv } from '@logibtp/socle/ui';
import { COLONNES_DETAIL, COLONNES_HEURES, COUT, lignesDetail, anomalie, libelleColonne, infoColonne, regrouperFaits } from '../src/indicateurs.js';
import { COLONNES_LISTE, arbreListe, lignesListe, clesJusqua, arrondiAffiche } from '../src/liste.js';
import { NIVEAU_LISTE } from '../src/codes.js';
import { blocResultats } from '../src/resultats.js';

const montant = (v, decimales = 2) => formatNombre(v?.toString?.() ?? v, decimales);
/** Écart à la référence (contrôle ou photo) sous le chiffre, avec la valeur de référence en bulle. */
const ecart = (valeur, reference, libelleReference) => {
  if (reference === undefined || reference === null || valeur === null || reference.equals(valeur)) return '';
  const d = valeur.minus(reference);
  return `<small class="rentabilite-ecart" title="${echapper(texte('rentabilite.detail.reference_valeur', { reference: libelleReference, valeur: montant(reference) }))}">${
    echapper(texte(d.isNegative() ? 'rentabilite.detail.ecart_moins' : 'rentabilite.detail.ecart_plus', { valeur: montant(d.abs()) }))}</small>`;
};
const cellule = (valeur, c, l, ref = null) => {
  // Postes de pied : remises et déductions négatives par nature, jamais en rouge.
  const a = l.type === 'postes' ? null : anomalie(valeur, c.sens);
  const bulle = a ? `${texte(`rentabilite.anomalies.${a}`)}\n${texte('rentabilite.detail.ouvrir_faits')}` : texte('rentabilite.detail.ouvrir_faits');
  // Heures : vides plutôt que 0,00 (seules les natures de main-d'œuvre en portent).
  const affiche = c.heures && valeur.isZero() ? '' : montant(valeur);
  return `<td data-colonne="${c.code}" class="montant rentabilite-bande-${c.teinte}${c.code === 'h_budget' ? ' rentabilite-debut-heures' : ''}${a ? ' rentabilite-anomalie' : ''}" title="${echapper(bulle)}">${affiche}${
    ref ? ecart(valeur, ref.valeurs[c.code] ?? Dz(0), ref.libelle) : ''}</td>`;
};

/**
 * Tableau du Détail d'un chantier. options : { cout (PA | PR), ordre (undefined = tout, 0 = sans ordre, id), periode
 * (du… au : flux de la période), heures (colonnes d'heures de main-d'œuvre), reference ({ libelle, agregats } : contrôle ou photo, écarts sous les chiffres),
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
    const colonnes = this.#o.heures ? [...COLONNES_DETAIL, ...COLONNES_HEURES] : COLONNES_DETAIL;
    const parametres = { natures: donnees.natures ?? [], ordre: this.#o.ordre, cout: this.#o.cout, periode: !!this.#o.periode, colonnes };
    const ref = this.#o.reference;
    // Avec une référence, ses lignes disparues depuis restent affichées (à zéro) pour que les écarts se lisent ligne à ligne.
    const aZero = (ref?.agregats ?? []).map((a) => ({ ...a, pa: 0, pr: 0, pv: 0, heures: null, pa_periode: 0, pr_periode: 0, pv_periode: 0, heures_periode: null }));
    this.#lignes = lignesDetail({ ...parametres, agregats: [...(donnees.agregats ?? []), ...aZero] });
    const refs = ref ? new Map(lignesDetail({ ...parametres, agregats: ref.agregats ?? [] }).map((l) => [l.code, { libelle: ref.libelle, valeurs: l.valeurs }])) : null;
    const vide = this.#lignes.length === 1 && COLONNES_DETAIL.every((c) => this.#lignes[0].valeurs[c.code].isZero());
    if (vide) { this.#zone.innerHTML = `<p class="aide">${texteHtml('rentabilite.detail.aucun')}</p>`; return; }
    this.#zone.innerHTML = `<table class="rentabilite-detail tableau-compact">
      <thead><tr><th>${texteHtml('rentabilite.detail.nature')}</th>${colonnes.map((c) => `<th class="montant rentabilite-colonne-${c.teinte}${c.code === 'h_budget' ? ' rentabilite-debut-heures' : ''}" title="${echapper(infoColonne(c))}">${echapper(libelleColonne(c))}</th>`).join('')}</tr></thead>
      <tbody>${this.#lignes.map((l, i) => `<tr class="rentabilite-ligne-${l.type}" data-i="${i}"${l.info ? ` title="${echapper(l.info)}"` : ''}>
        <th scope="row">${echapper(l.libelle)}</th>
        ${colonnes.map((c) => cellule(l.valeurs[c.code], c, l, refs ? refs.get(l.code) ?? { libelle: ref.libelle, valeurs: {} } : null)).join('')}
      </tr>`).join('')}</tbody></table>`;
    const table = this.#zone.querySelector('table');
    table.addEventListener('dblclick', (ev) => {
      const td = ev.target.closest('td[data-colonne]');
      if (!td) return;
      const l = this.#lignes[Number(td.parentElement.dataset.i)];
      const c = colonnes.find((x) => x.code === td.dataset.colonne);
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

const LIGNES_DETAILLABLES = new Set(['chantier', 'ordre', 'sans_ordre']);

/**
 * Tableau de la Liste (§ 6) : arbre chargé d'affaires › affaire › chantier › ordre (ou affaire › …), total figé en pied,
 * montants anormaux en rouge, fraîcheur et changements depuis le contrôle de l'utilisateur, arrondi 0 ou 2 décimales,
 * colonnes en période. options : { cout, periode, decimales, niveau, etats: Map(cha_id → état), selection (Set de
 * chantiers cochés), ouvrirDetail(chantier, nouvelleFenetre), ouvrirFaits({ chantier, ordre, indicateurs, colonne },
 * nouvelleFenetre), ouvrirChangements(chantier, nouvelleFenetre), selectionModifiee(Set) }.
 */
export class TableauListe {
  #zone;
  #o;
  #racine = null;
  #lignes = [];
  #ouverts = new Set();
  #donnees = null;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { cout: COUT.PR, periode: false, decimales: 2, niveau: NIVEAU_LISTE.AFFAIRE, etats: new Map(), selection: new Set(),
      ouvrirDetail: () => {}, ouvrirFaits: () => {}, ouvrirChangements: () => {}, selectionModifiee: () => {}, ...options };
  }

  /** donnees : { chantiers, ordres, agregats } du serveur (GET /rentabilite/chantiers). */
  rendre(donnees, options = {}) {
    if (donnees) this.#donnees = donnees;
    const niveau = this.#o.niveau;
    Object.assign(this.#o, options);
    const d = this.#donnees ?? { chantiers: [], agregats: [], ordres: [] };
    this.#racine = arbreListe({ chantiers: d.chantiers ?? [], agregats: d.agregats ?? [], ordres: d.ordres ?? [], niveau: this.#o.niveau,
      cout: this.#o.cout, periode: this.#o.periode });
    // Changement d'origine : groupes repliés jusqu'au chantier.
    if (niveau !== this.#o.niveau || !this.#ouverts.size) this.#ouverts = new Set(clesJusqua(this.#racine, this.#o.niveau === NIVEAU_LISTE.CHARGE ? 'charge' : 'affaire'));
    this.#dessiner();
  }

  /** Ouvre tout jusqu'au type donné (charge, affaire, chantier) ou referme tout (null). */
  ouvrirJusqua(type) {
    this.#ouverts = new Set(type ? clesJusqua(this.#racine, type) : []);
    this.#dessiner();
  }

  get racine() { return this.#racine; }

  #valeur(v, c) {
    if (v === null || v === undefined) return '';
    if (c.pourcent) return texte('rentabilite.liste.pourcent', { valeur: formatNombre(arrondiAffiche(v, 1).toString(), 1) });
    if (c.heures) return v.isZero() ? '' : formatNombre(arrondiAffiche(v, 2).toString(), 2);
    return formatNombre(arrondiAffiche(v, this.#o.decimales).toString(), this.#o.decimales);
  }

  #cellule(l, c) {
    const v = l.valeurs[c.code];
    const a = v === null ? null : anomalie(v, c.sens);
    const detaillable = LIGNES_DETAILLABLES.has(l.type) && !c.pourcent;
    const bulle = [a ? texte(`rentabilite.anomalies.${a}`) : '', detaillable ? texte('rentabilite.liste.ouvrir_faits') : ''].filter(Boolean).join('\n');
    return `<td data-colonne="${c.code}" class="montant rentabilite-bande-${c.teinte}${a ? ' rentabilite-anomalie' : ''}${detaillable ? ' rentabilite-detaillable' : ''}"${
      bulle ? ` title="${echapper(bulle)}"` : ''}>${echapper(this.#valeur(v, c))}</td>`;
  }

  #etat(l) {
    if (l.type !== 'chantier') return '';
    const e = this.#o.etats.get(l.chantier);
    if (!e) return '';
    const marques = [];
    if (e.en_attente) marques.push(`<span class="rentabilite-marque" title="${echapper(texte('rentabilite.liste.en_attente'))}">${iconeHtml('rentabilite_attente')}</span>`);
    if (e.erreur || e.etat === 'ERREUR') marques.push(`<span class="rentabilite-marque rentabilite-anomalie" title="${echapper(texte('rentabilite.liste.erreur', { erreur: e.erreur ?? '' }))}">${iconeHtml('rentabilite_anomalie')}</span>`);
    if (e.changements > 0) {
      marques.push(`<a href="#" class="rentabilite-changements" data-changements="${l.chantier}" title="${echapper(texte('rentabilite.liste.controle_le', { date: formatDateHeure(e.controle_le) }))}">${
        echapper(texte(e.changements > 1 ? 'rentabilite.liste.changements_autre' : 'rentabilite.liste.changements_un', { nombre: e.changements }))}</a>`);
    }
    return marques.join(' ');
  }

  #dessiner() {
    if (!this.#racine.enfants.length) { this.#zone.innerHTML = `<p class="aide">${texteHtml('rentabilite.liste.aucun')}</p>`; return; }
    this.#lignes = lignesListe(this.#racine, this.#ouverts);
    const sel = this.#o.selection;
    const tete = COLONNES_LISTE.map((c) => `<th class="montant rentabilite-colonne-${c.teinte}" title="${echapper(infoColonne(c))}">${echapper(libelleColonne(c))}</th>`).join('');
    const ligne = (l, i) => {
      const bascule = l.feuille ? '<span class="rentabilite-bascule"></span>'
        : `<button type="button" class="rentabilite-bascule" data-basculer="${i}" title="${echapper(texte(l.ouvert ? 'rentabilite.liste.replier' : 'rentabilite.liste.deplier'))}">${iconeHtml(l.ouvert ? 'rentabilite_replier' : 'rentabilite_deplier')}</button>`;
      const coche = l.type === 'chantier' ? `<input type="checkbox" data-cocher="${l.chantier}"${sel.has(l.chantier) ? ' checked' : ''} title="${echapper(texte('rentabilite.liste.selection'))}">` : '';
      const libelle = l.type === 'chantier'
        ? `<a href="#" data-detail="${l.chantier}" title="${echapper(texte('rentabilite.liste.ouvrir_detail'))}">${echapper(l.libelle)}</a>`
        : echapper(l.libelle);
      return `<tr class="rentabilite-ligne-${l.type}" data-i="${i}">
        <th scope="row" style="--profondeur:${l.profondeur}">${coche}${bascule}${libelle} ${this.#etat(l)}</th>
        ${COLONNES_LISTE.map((c) => this.#cellule(l, c)).join('')}</tr>`;
    };
    const total = this.#racine;
    this.#zone.innerHTML = `<table class="rentabilite-liste tableau-compact">
      <thead><tr><th>${texteHtml('rentabilite.liste.origine')}</th>${tete}</tr></thead>
      <tbody>${this.#lignes.map(ligne).join('')}</tbody>
      <tfoot><tr class="rentabilite-ligne-total"><th scope="row">${echapper(total.libelle)}</th>${COLONNES_LISTE.map((c) => this.#cellule(total, c)).join('')}</tr></tfoot>
    </table>`;
    const table = this.#zone.querySelector('table');
    table.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-basculer]');
      if (b) {
        const l = this.#lignes[Number(b.dataset.basculer)];
        if (this.#ouverts.has(l.cle)) this.#ouverts.delete(l.cle); else this.#ouverts.add(l.cle);
        this.#dessiner();
        return;
      }
      const a = ev.target.closest('a[data-detail]');
      if (a) { ev.preventDefault(); this.#o.ouvrirDetail(Number(a.dataset.detail), ev.ctrlKey || ev.metaKey); return; }
      const ch = ev.target.closest('a[data-changements]');
      if (ch) { ev.preventDefault(); this.#o.ouvrirChangements(Number(ch.dataset.changements), ev.ctrlKey || ev.metaKey); }
    });
    table.addEventListener('change', (ev) => {
      const c = ev.target.closest('input[data-cocher]');
      if (!c) return;
      const id = Number(c.dataset.cocher);
      if (c.checked) sel.add(id); else sel.delete(id);
      this.#o.selectionModifiee(sel);
    });
    table.addEventListener('dblclick', (ev) => {
      const td = ev.target.closest('td.rentabilite-detaillable');
      if (!td) return;
      const l = this.#lignes[Number(td.parentElement.dataset.i)];
      const c = COLONNES_LISTE.find((x) => x.code === td.dataset.colonne);
      this.#o.ouvrirFaits({ chantier: l.chantier, ordre: l.ordre, indicateurs: c.faits, colonne: c.code, ligne: l.libelle }, ev.ctrlKey || ev.metaKey);
    });
  }

  /** Lignes CSV de tout l'arbre (tous niveaux, total en dernier), montants à l'arrondi choisi, point décimal. */
  lignesCsv() {
    const tout = lignesListe(this.#racine, new Set(clesJusqua(this.#racine, 'chantier').concat(clesJusqua(this.#racine, 'ordre'))));
    const valeur = (v, c) => (v === null || v === undefined ? '' : arrondiAffiche(v, c.pourcent ? 1 : c.heures ? 2 : this.#o.decimales).toString());
    const ligne = (l) => [texte(`rentabilite.liste.niveaux.${l.type}`), `${'  '.repeat(l.profondeur ?? 0)}${l.libelle}`, ...COLONNES_LISTE.map((c) => valeur(l.valeurs[c.code], c))]
      .map(celluleCsv).join(';');
    return [
      [texte('rentabilite.liste.csv.niveau'), texte('rentabilite.liste.csv.libelle'), ...COLONNES_LISTE.map(libelleColonne)].map(celluleCsv).join(';'),
      ...tout.map(ligne),
      ligne({ ...this.#racine, profondeur: 0 }),
    ];
  }
}

/**
 * Bloc de résultats sur les PV (§ 4.8) sous le Détail : lignes Budget, Réalisé, Facturé, Reste à facturer, Prévisionnel ;
 * HT des lignes, postes par libellé, HT net, coût PA et marge brute, coût PR et marge nette (montant et %). options :
 * { ordre, periode, voirCouts, decimales }.
 */
export class TableauResultats {
  #zone;

  constructor(zone) { this.#zone = zone; }

  /** donnees : { agregats, postes } du Détail. */
  rendre(donnees, { ordre, periode = false, voirCouts = true } = {}) {
    const { libelles, lignes } = blocResultats({ agregats: donnees.agregats ?? [], postes: donnees.postes ?? [], ordre, periode });
    const pct = (v) => (v === null ? '' : texte('rentabilite.liste.pourcent', { valeur: formatNombre(v.toDecimalPlaces(1).toString(), 1) }));
    const negatif = (v) => (v !== null && v.isNegative() && !v.isZero() ? ' rentabilite-anomalie' : '');
    const th = (cle, classe = 'montant') => `<th class="${classe}" title="${echapper(texte(`rentabilite.resultats.colonnes.${cle}.info`))}">${texteHtml(`rentabilite.resultats.colonnes.${cle}.libelle`)}</th>`;
    this.#zone.innerHTML = `<table class="rentabilite-resultats tableau-compact">
      <thead><tr><th>${texteHtml('rentabilite.resultats.titre')}</th>${th('lignes')}
        ${libelles.map((l) => `<th class="montant rentabilite-poste" title="${echapper(texte('rentabilite.resultats.colonnes.poste.info'))}">${echapper(l)}</th>`).join('')}
        ${th('net')}${voirCouts ? `${th('pa')}${th('brute')}${th('taux_brute')}${th('pr')}${th('nette')}${th('taux_nette')}` : ''}</tr></thead>
      <tbody>${lignes.map((l) => `<tr class="rentabilite-resultat-${l.code}" title="${echapper(texte(`rentabilite.resultats.lignes.${l.code}.info`))}">
        <th scope="row">${texteHtml(`rentabilite.resultats.lignes.${l.code}.libelle`)}</th>
        <td class="montant">${montant(l.lignes)}</td>
        ${libelles.map((x) => `<td class="montant rentabilite-poste">${l.postes.has(x) ? montant(l.postes.get(x)) : ''}</td>`).join('')}
        <td class="montant rentabilite-net">${montant(l.net)}</td>
        ${voirCouts ? `<td class="montant">${montant(l.pa)}</td><td class="montant${negatif(l.brute)}">${montant(l.brute)}</td><td class="montant${negatif(l.taux_brute)}">${pct(l.taux_brute)}</td>
          <td class="montant">${montant(l.pr)}</td><td class="montant${negatif(l.nette)}">${montant(l.nette)}</td><td class="montant${negatif(l.taux_nette)}">${pct(l.taux_nette)}</td>` : ''}
      </tr>`).join('')}</tbody></table>
      ${periode ? `<p class="aide">${texteHtml('rentabilite.resultats.periode')}</p>` : ''}`;
  }
}
