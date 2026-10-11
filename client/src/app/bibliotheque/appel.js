import { ratio, codeAppel } from '@logibtp/bibliotheque';
import { D, S, arr6 } from '@logibtp/socle';
import { echapper, formatNombre } from '@logibtp/socle/ui';
import { TL } from '../../calcul/index.js';

// Appel de la bibliothèque dans un éditeur de document (devis, facture… et composition d'un ouvrage) :
//   - colonne Code : « CODE » dans la bibliothèque du document, « BIB:CODE » dans une autre ; inconnu → recherche ;
//   - F3 : recherche dans la bibliothèque (code ou libellé, articles et ouvrages) ;
//   - article : la ligne reçoit le code d'appel, le libellé, l'unité de vente, le PA converti dans cette unité, les
//     coefficients, la remise, la nature et le lien vers l'élément (lig_art_id, lig_proprietes.element) ;
//   - ouvrage : la ligne est remplacée par l'ouvrage avec ses composantes, ses métrés et ses variables.
// Les prix sont copiés dans le document (ils ne suivent plus la bibliothèque) ; « Actualiser depuis la bibliothèque »
// les reprend pour les lignes choisies.

const nombre = (v) => (v === null || v === undefined || v === '' ? null : Number(S(arr6(D(v)))));
const prix = (v) => (v === null || v === undefined || v === '' ? '—' : formatNombre(v, Math.abs(Number(v)) < 10 ? 4 : 2));

/** Unité de la ligne (unité de vente, sinon de stock) et quantité en unité de stock pour 1 unité. */
export function uniteLigne(e) {
  const unite = e.unite_vente || e.unite_stock;
  try {
    return { unite, r: ratio(unite, { unite_stock: e.unite_stock, unites: e.unites ?? [], donnees: e.donnees ?? {} }) };
  } catch {
    return { unite: e.unite_stock, r: D(1) };
  }
}

/** Valeurs de prix d'un article pour une ligne : prix de l'unité de stock convertis dans l'unité de la ligne. */
export function prixArticle(e) {
  const { unite, r } = uniteLigne(e);
  const parUnite = (v) => (v === null || v === undefined || v === '' ? null : nombre(D(v).times(r)));
  const pvFixe = e.pv_fixe === true;
  return {
    lig_unt_code: unite, lig_pa: parUnite(e.pa), lig_coef_fg: nombre(e.coef_fg ?? 1), lig_coef_benef: nombre(e.coef_benef ?? 1),
    lig_pv_fixe: pvFixe, ...(pvFixe ? { lig_pv: parUnite(e.pv) } : {}), lig_coef_remise: nombre(e.coef_remise ?? 1), ratio: S(r),
  };
}

/** Lien d'une ligne vers l'élément de la bibliothèque. */
const lien = (e, extra = {}) => ({ id: e.id, bib: e.bib_code, code: e.code, type: e.type, ...extra });

/** Valeurs d'une ligne pour un article. */
export function valeursArticle(e, bibDocument, proprietes = {}) {
  const { ratio: r, ...p } = prixArticle(e);
  return {
    ...p, lig_code: codeAppel(e, bibDocument), lig_art_id: e.id, lig_nat_id: e.nat_id ?? null, lig_libelle_html: e.libelle_html,
    lig_proprietes: { ...proprietes, element: lien(e, { unite: p.lig_unt_code, ratio: r }) },
  };
}

/** Contenu à insérer pour un ouvrage (format du presse-papiers) : la racine reçoit l'appel, les composantes suivent. */
export function contenuOuvrage(e, bibDocument, { quantite = 1 } = {}) {
  const c = e.composition ?? { lignes: [] };
  const lignes = structuredClone(c.lignes ?? []).map((l) => ({ ...l, lig_origine_id: null }));
  const racine = lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.OUVRAGE);
  if (!racine) return null;
  Object.assign(racine, {
    lig_code: codeAppel(e, bibDocument), lig_art_id: e.id, lig_nat_id: e.nat_id ?? null, lig_libelle_html: e.libelle_html, lig_unt_code: e.unite_stock,
    lig_qte: quantite, lig_coef_fg: nombre(e.coef_fg ?? 1), lig_coef_benef: nombre(e.coef_benef ?? 1), lig_coef_remise: nombre(e.coef_remise ?? 1),
    lig_proprietes: { ...(racine.lig_proprietes ?? {}), element: lien(e, { unite: e.unite_stock }) },
  });
  return { racines: [racine.lig_id], lignes, metres: structuredClone(c.metres ?? []), metre_lignes: structuredClone(c.metre_lignes ?? []), variables: structuredClone(c.variables ?? []) };
}

/** Ligne sans contenu saisi (le code vient d'y être tapé) : elle peut être remplacée. */
const ligneVide = (l) => !l.lig_libelle_html && (l.lig_pa === null || l.lig_pa === undefined) && !l.lig_art_id;

export class AppelBibliotheque {
  /**
   * fournisseur : FournisseurBibliotheque… ; editeur() : éditeur courant ; bibliotheque() : code de la bibliothèque du
   * document (null : bibliothèque par défaut) ; message(texte, niveau).
   */
  constructor({ fournisseur, editeur, bibliotheque = () => null, message = () => {} }) {
    this.fournisseur = fournisseur;
    this.editeur = editeur;
    this.bibliotheque = bibliotheque;
    this.message = message;
  }

  /** Bibliothèque du document, ou la bibliothèque par défaut (codes d'appel sans préfixe). */
  async bibDocument() {
    if (this.bibliotheque()) return this.bibliotheque();
    this.bibs ??= await this.fournisseur.bibliotheques();
    return this.bibs.find((b) => b.defaut)?.code ?? null;
  }

  /** Saisie dans la colonne Code. */
  async appeler(ligId, code) {
    try {
      const e = await this.fournisseur.appelCode(code, this.bibliotheque());
      await this.deployer(ligId, e, { surLigne: true });
    } catch (x) {
      if (x.statut === 404 || x.code === 'INTROUVABLE') {
        this.message(`${code} : introuvable dans la bibliothèque, choisissez un élément`, 'avertissement');
        await this.rechercher(ligId, code, { surLigne: true });
      } else this.message(x.message ?? String(x), 'erreur');
    }
  }

  /** F3 : recherche puis déploiement de l'élément choisi (après la ligne courante, ou à sa place si elle est vide). */
  async rechercher(ligId, texte = '', { surLigne = false } = {}) {
    const choisi = await this.choisir(texte);
    if (choisi) await this.deployer(ligId, await this.fournisseur.element(choisi.id), { surLigne });
  }

  /**
   * surLigne : le code a été saisi sur cette ligne (elle reçoit l'article, ou l'ouvrage la remplace) ; sinon l'élément
   * est inséré après elle, sauf si elle est vide.
   */
  async deployer(ligId, e, { surLigne = false } = {}) {
    const ed = this.editeur();
    const bib = await this.bibDocument();
    const l = ed.saisie.lignes.find((x) => x.lig_id === ligId) ?? null;
    const aEnfants = l && ed.saisie.lignes.some((x) => x.lig_parent_id === ligId);
    const surPlace = Boolean(l) && !aEnfants && (ligneVide(l) || (surLigne && l.lig_tyl_id === TL.ELEMENT));
    if (e.type === 'OUVRAGE') {
      const contenu = contenuOuvrage(e, bib, { quantite: surPlace && l.lig_qte ? l.lig_qte : 1 });
      if (!contenu) { this.message(`${e.code} : ouvrage sans composition`, 'avertissement'); return; }
      ed.insererContenu(contenu, ligId, `Ouvrage ${e.code}`, { remplacer: surPlace });
    } else if (surPlace) {
      // Article sur la ligne où le code est saisi : quantité, position et métré conservés.
      ed.magasin.modifier((d) => {
        const x = d.lignes.find((y) => y.lig_id === ligId);
        Object.assign(x, valeursArticle(e, bib, x.lig_proprietes ?? {}));
        x.lig_tyl_id = TL.ELEMENT;
        if ((x.lig_qte === null || x.lig_qte === undefined) && x.lig_qte_source !== 'M') x.lig_qte = 1;
        ed.regles.appliquerContexte(d, ligId, ed.definition.taux_tva);
      }, `Article ${e.code}`);
    } else {
      const ligne = { ...ed.nouvelleLigne(1, TL.ELEMENT, ed.saisie.document.ent_id), ...valeursArticle(e, bib), lig_qte: 1 };
      ed.insererContenu({ racines: [1], lignes: [ligne], metres: [], metre_lignes: [], variables: [] }, ligId, `Article ${e.code}`);
    }
    this.message(`${codeAppel(e, bib)} – ${e.libelle ?? ''}`.slice(0, 120));
  }

  /** Reprend les prix de la bibliothèque (articles) pour les lignes choisies ; quantités et libellés conservés. */
  async actualiser(ids) {
    const ed = this.editeur();
    const lignes = ed.saisie.lignes.filter((l) => ids.includes(l.lig_id) && l.lig_art_id && l.lig_tyl_id === TL.ELEMENT);
    if (!lignes.length) { this.message('Aucune ligne d\'article de la bibliothèque dans la sélection', 'avertissement'); return; }
    const elements = new Map();
    for (const l of lignes) {
      try { elements.set(l.lig_id, await this.fournisseur.element(l.lig_art_id)); } catch { /* élément supprimé */ }
    }
    ed.magasin.modifier((d) => {
      for (const [id, e] of elements) {
        const x = d.lignes.find((y) => y.lig_id === id);
        const { ratio: r, ...p } = prixArticle(e);
        Object.assign(x, p, { lig_proprietes: { ...(x.lig_proprietes ?? {}), element: lien(e, { unite: p.lig_unt_code, ratio: r }) } });
      }
    }, 'Prix de la bibliothèque');
    this.message(`${elements.size} ligne(s) actualisée(s) depuis la bibliothèque`, 'succes');
  }

  /** Dialogue de recherche (articles et ouvrages, toutes bibliothèques) ; résout avec l'élément choisi ou null. */
  choisir(texte = '') {
    return new Promise((resoudre) => {
      const fond = document.createElement('div');
      fond.className = 'fiche-dialogue-fond';
      fond.innerHTML = `<section class="fiche-dialogue element-recherche" role="dialog" aria-label="Bibliothèque">
        <header><h2>📚 Bibliothèque</h2><button type="button" data-fermer title="Fermer (Échap)">✕</button></header>
        <div class="element-recherche-barre"><input type="search" placeholder="Code ou libellé…" value="${echapper(texte)}">
          <select data-type><option value="">Articles et ouvrages</option><option value="ARTICLE">Articles</option><option value="OUVRAGE">Ouvrages</option></select></div>
        <div class="element-resultats"></div>
        <p class="aide">Entrée ou double-clic : insérer · ↑↓ : choisir · Échap : fermer</p></section>`;
      document.body.append(fond);
      const entree = fond.querySelector('input');
      const zone = fond.querySelector('.element-resultats');
      let resultats = [];
      let actif = 0;
      const fermer = (e) => { fond.remove(); resoudre(e ?? null); };
      const surligner = () => zone.querySelectorAll('tr[data-i]').forEach((tr) => tr.classList.toggle('actif', Number(tr.dataset.i) === actif));
      const chercher = async () => {
        resultats = await this.fournisseur.rechercher({ recherche: entree.value, type: fond.querySelector('[data-type]').value || null });
        actif = 0;
        zone.innerHTML = resultats.length ? `<table class="bib-table"><thead><tr><th></th><th>Code</th><th>Libellé</th><th>U.</th><th>PA</th><th>PV net</th></tr></thead><tbody>
          ${resultats.map((e, i) => `<tr data-i="${i}"><td>${e.type === 'OUVRAGE' ? '🏗️' : '🧱'}</td><td><b>${echapper(e.bib_code)}:${echapper(e.code)}</b></td><td>${echapper(e.libelle ?? '')}</td>
            <td>${echapper(e.unite_stock)}</td><td class="nombre">${prix(e.pa)}</td><td class="nombre">${prix(e.pv_net)}</td></tr>`).join('')}</tbody></table>`
          : '<p class="aide">Aucun élément.</p>';
        surligner();
      };
      let minuterie;
      entree.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(chercher, 250); });
      fond.querySelector('[data-type]').addEventListener('change', chercher);
      fond.querySelector('[data-fermer]').addEventListener('click', () => fermer());
      zone.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) { actif = Number(tr.dataset.i); surligner(); } });
      zone.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-i]'); if (tr) fermer(resultats[Number(tr.dataset.i)]); });
      fond.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fermer(); } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          actif = Math.min(Math.max(actif + (e.key === 'ArrowDown' ? 1 : -1), 0), Math.max(resultats.length - 1, 0));
          surligner();
          zone.querySelector('tr.actif')?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && resultats[actif]) { e.preventDefault(); fermer(resultats[actif]); }
      });
      entree.focus();
      chercher();
    });
  }
}
