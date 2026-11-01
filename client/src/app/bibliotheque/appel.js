import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { formatPrix } from '@logibtp/bibliotheque/ui';
import { ratio, codeAppel } from '@logibtp/bibliotheque';
import { D, S, arr6 } from '@logibtp/socle';
import { echapper, formatNombre, ouvrirModale } from '@logibtp/socle/ui';
import { TL } from '../../calcul/index.js';

// Appel de la bibliothèque dans un éditeur de document (devis, facture… et composition d'un ouvrage) :
//   - colonne Code : « CODE » dans la bibliothèque du document, « BIB:CODE » dans une autre ; absent de la bibliothèque
//     du document → élément de même code d'une autre bibliothèque (liste s'ils sont plusieurs), sinon recherche ;
//   - F3 : recherche dans la bibliothèque (code ou libellé, articles et ouvrages) ;
//   - article : la ligne reçoit le code d'appel, le libellé, l'unité de vente, le PA converti dans cette unité, les
//     coefficients, la remise, la nature et le lien vers l'élément (lig_art_id, lig_proprietes.element) ;
//   - ouvrage : la ligne est remplacée par l'ouvrage avec ses composantes, ses métrés et ses variables ;
//   - poste de pied (POSTE_PIED) : une ligne de pied HT ou TTC est ajoutée dans le pied (celui de la section de la ligne
//     pour un poste HT d'un document à sections), ou la ligne de pied du même niveau où le code est saisi la reçoit ;
//   - texte (TEXTE, lot 7) : une ligne de texte reçoit son libellé (la ligne vide où le code est saisi, sinon après elle) ;
//   - un code inconnu qui est un code-barres désigne son élément (lecteur, résolu par le serveur).
// Les prix sont copiés dans le document (ils ne suivent plus la bibliothèque) ; « Actualiser depuis la bibliothèque »
// les reprend pour les lignes choisies.

const nombre = (v) => (v === null || v === undefined || v === '' ? null : Number(S(arr6(D(v)))));
const prix = formatPrix;

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

/** Données techniques de l'élément recopiées sur la ligne (db/165) : dimensions converties de mm en mètres. */
export function techniquesLigne(e) {
  const metres = (v) => (v === null || v === undefined || v === '' ? null : nombre(D(v).div(1000)));
  return {
    lig_poids: nombre(e.poids), lig_surface: nombre(e.surface), lig_volume: nombre(e.volume),
    lig_hauteur: metres(e.hauteur), lig_largeur: metres(e.largeur), lig_epaisseur: metres(e.epaisseur), lig_longueur: metres(e.longueur),
  };
}

/** Lien d'une ligne vers l'élément de la bibliothèque. */
export const lien = (e, extra = {}) => ({ id: e.id, bib: e.bib_code, code: e.code, type: e.type, ...extra });

/** PA et PV d'un article dans l'unité d'une ligne (unité de vente à défaut) ; lève une erreur sans correspondance d'unité. */
export function prixUnite(e, unite) {
  const u = unite || e.unite_vente || e.unite_stock;
  const r = ratio(u, { unite_stock: e.unite_stock, unites: e.unites ?? [], donnees: e.donnees ?? {} });
  const parUnite = (v) => (v === null || v === undefined || v === '' ? null : nombre(D(v).times(r)));
  return { pa: parUnite(e.pa), pv: parUnite(e.pv), unite: u, ratio: S(r) };
}

/** Valeurs d'une ligne pour un article. */
export function valeursArticle(e, bibDocument, proprietes = {}) {
  const { ratio: r, ...p } = prixArticle(e);
  return {
    ...p, ...techniquesLigne(e), lig_code: codeAppel(e, bibDocument), lig_art_id: e.id, lig_nat_id: e.nat_id ?? null, lig_libelle_html: e.libelle_html,
    lig_proprietes: { ...proprietes, element: lien(e, { unite: p.lig_unt_code, ratio: r }) },
  };
}

/** Valeurs d'une ligne de pied pour un poste de la bibliothèque ; taux : taux de TVA du document (code du poste → taux). */
export function valeursPoste(e, bibDocument, taux = []) {
  const p = e.poste ?? {};
  const mode = p.mode ?? 'M';
  return {
    lig_code: codeAppel(e, bibDocument), lig_art_id: e.id, lig_libelle_html: e.libelle_html,
    lig_pied_mode: mode, lig_pied_base: mode === 'M' || !p.base || p.base === 'CUMUL' ? null : p.base,
    lig_pied_sens: p.sens === 'AJOUT' ? 1 : -1, lig_pied_valeur: nombre(p.valeur), lig_pied_retenue: p.retenue === true,
    lig_cpt_code: p.compte || null, ...(p.tva ? { lig_tva_id: taux.find((t) => t.ttv_code === p.tva)?.ttv_id ?? null } : {}),
    lig_proprietes: { element: lien(e) },
  };
}

/** Contenu à insérer pour un ouvrage (format du presse-papiers) : la racine reçoit l'appel, les composantes suivent. */
export function contenuOuvrage(e, bibDocument, { quantite = 1 } = {}) {
  const c = e.composition ?? { lignes: [] };
  const lignes = structuredClone(c.lignes ?? []).map((l) => ({ ...l, lig_origine_id: null }));
  const racine = lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.OUVRAGE);
  if (!racine) return null;
  Object.assign(racine, {
    ...techniquesLigne(e),
    lig_code: codeAppel(e, bibDocument), lig_art_id: e.id, lig_nat_id: e.nat_id ?? null, lig_libelle_html: e.libelle_html, lig_unt_code: e.unite_stock,
    lig_qte: quantite, lig_coef_fg: nombre(e.coef_fg ?? 1), lig_coef_benef: nombre(e.coef_benef ?? 1), lig_coef_remise: nombre(e.coef_remise ?? 1),
    // PV fixe de l'ouvrage de la bibliothèque : imposé à la ligne (sinon, prix de la composition).
    lig_pv_fixe: e.pv_fixe === true || e.pv_fixe === 'true', ...(e.pv_fixe === true || e.pv_fixe === 'true' ? { lig_pv: nombre(e.pv) } : {}),
    lig_proprietes: { ...(racine.lig_proprietes ?? {}), element: lien(e, { unite: e.unite_stock }) },
  });
  return { racines: [racine.lig_id], lignes, metres: structuredClone(c.metres ?? []), variables: structuredClone(c.variables ?? []) };
}

/**
 * Contenu à insérer pour un ensemble (structure réutilisable) : la tranche racine (titre) reçoit l'appel et le lien vers
 * l'élément ; ses lignes (vendues, options, variantes), métrés et variables de tranche suivent.
 */
export function contenuEnsemble(e, bibDocument) {
  const c = e.composition ?? { lignes: [] };
  const lignes = structuredClone(c.lignes ?? []).map((l) => ({ ...l, lig_origine_id: null }));
  const racine = lignes.find((l) => l.lig_parent_id === null && l.lig_tyl_id === TL.TITRE);
  if (!racine) return null;
  // Le libellé de la tranche est celui de la composition (il peut citer les paramètres : {{$largeur}}…).
  Object.assign(racine, {
    lig_code: codeAppel(e, bibDocument), lig_art_id: e.id, lig_nat_id: e.nat_id ?? null, lig_libelle_html: racine.lig_libelle_html || e.libelle_html,
    lig_proprietes: { ...(racine.lig_proprietes ?? {}), element: lien(e) },
  });
  return { racines: [racine.lig_id], lignes, metres: structuredClone(c.metres ?? []), variables: structuredClone(c.variables ?? []) };
}

/** Ligne sans contenu saisi (le code vient d'y être tapé) : elle peut être remplacée. */
/** Contenu d'un texte de la bibliothèque : une ligne de texte avec son libellé (sans prix), liée à l'élément. */
function contenuTexte(ed, e, bib) {
  const ligne = {
    ...ed.nouvelleLigne(1, TL.TEXTE, ed.saisie.document.ent_id), lig_code: codeAppel(e, bib), lig_libelle_html: e.libelle_html,
    lig_proprietes: { element: lien(e) },
  };
  return { racines: [1], lignes: [ligne], metres: [], variables: [] };
}

const ligneVide = (l) => !l.lig_libelle_html && (l.lig_pa === null || l.lig_pa === undefined) && !l.lig_art_id;

export class AppelBibliotheque {
  /**
   * fournisseur : FournisseurBibliotheque… ; editeur() : éditeur courant ; bibliotheque() : code de la bibliothèque du
   * document (null : bibliothèque par défaut) ; message(texte, niveau).
   */
  constructor({ fournisseur, editeur, bibliotheque = () => null, message = () => {}, postes = true }) {
    this.postes = postes;
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
      if (x.statut !== 404 && x.code !== 'INTROUVABLE') { this.message(x.message ?? String(x), 'erreur'); return; }
      // Code absent de la bibliothèque du document : élément de même code d'une autre bibliothèque (le seul : pris
      // d'office ; plusieurs : liste de ces éléments, appelés ensuite par BIB:CODE), sinon recherche.
      const memeCode = await this.memeCode(code);
      if (memeCode.length === 1) {
        await this.deployer(ligId, await this.fournisseur.element(memeCode[0].id), { surLigne: true });
        return;
      }
      if (memeCode.length > 1) {
        this.message(texte('bibliotheque_btp.appel.plusieurs', { code }), 'avertissement');
        const choisi = await this.choisir(code, { memeCode: true });
        if (choisi) await this.deployer(ligId, await this.fournisseur.element(choisi.id), { surLigne: true });
        return;
      }
      this.message(texte('bibliotheque_btp.appel.introuvable', { code }), 'avertissement');
      await this.rechercher(ligId, code, { surLigne: true });
    }
  }

  /** Éléments de toutes les bibliothèques dont le code est celui saisi (sans préfixe de bibliothèque, casse ignorée). */
  async memeCode(code) {
    const c = String(code ?? '').trim();
    if (!c || c.includes(':')) return [];
    const cle = c.toLocaleLowerCase('fr');
    return (await this.fournisseur.rechercher({ recherche: c, type: null }).catch(() => []))
      .filter((e) => String(e.code ?? '').toLocaleLowerCase('fr') === cle);
  }

  /** F3 : recherche puis déploiement de l'élément choisi (après la ligne courante, ou à sa place si elle est vide). */
  async rechercher(ligId, cherche = '', { surLigne = false } = {}) {
    const choisi = await this.choisir(cherche);
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
    if (e.type === 'POSTE_PIED') {
      this.deployerPoste(ligId, e, bib, { surLigne });
      return;
    }
    if (e.type === 'TEXTE') {
      ed.insererContenu(contenuTexte(ed, e, bib), ligId, texte('bibliotheque_btp.appel.etapes.TEXTE', { code: e.code }), { remplacer: Boolean(l) && !aEnfants && ligneVide(l) });
    } else if (e.type === 'ENSEMBLE') {
      // Ensemble : sa tranche et ses lignes, après la ligne (ou à sa place si elle est vide).
      const contenu = contenuEnsemble(e, bib);
      if (!contenu) { this.message(texte('bibliotheque_btp.appel.sans_tranche', { code: e.code }), 'avertissement'); return; }
      ed.insererContenu(contenu, ligId, texte('bibliotheque_btp.appel.etapes.ENSEMBLE', { code: e.code }), { remplacer: surPlace && ligneVide(l) });
    } else if (e.type === 'OUVRAGE') {
      const contenu = contenuOuvrage(e, bib, { quantite: surPlace && l.lig_qte ? l.lig_qte : 1 });
      if (!contenu) { this.message(texte('bibliotheque_btp.appel.sans_composition', { code: e.code }), 'avertissement'); return; }
      ed.insererContenu(contenu, ligId, texte('bibliotheque_btp.appel.etapes.OUVRAGE', { code: e.code }), { remplacer: surPlace });
    } else if (surPlace) {
      // Article sur la ligne où le code est saisi : quantité, position et métré conservés.
      ed.magasin.modifier((d) => {
        const x = d.lignes.find((y) => y.lig_id === ligId);
        Object.assign(x, valeursArticle(e, bib, x.lig_proprietes ?? {}));
        x.lig_tyl_id = TL.ELEMENT;
        if ((x.lig_qte === null || x.lig_qte === undefined) && x.lig_qte_source !== 'M') x.lig_qte = 1;
        ed.regles.appliquerContexte(d, ligId, ed.definition.taux_tva);
      }, texte('bibliotheque_btp.appel.etapes.ARTICLE', { code: e.code }));
    } else {
      const ligne = { ...ed.nouvelleLigne(1, TL.ELEMENT, ed.saisie.document.ent_id), ...valeursArticle(e, bib), lig_qte: 1 };
      ed.insererContenu({ racines: [1], lignes: [ligne], metres: [], variables: [] }, ligId, texte('bibliotheque_btp.appel.etapes.ARTICLE', { code: e.code }));
    }
    this.message(`${codeAppel(e, bib)} – ${e.libelle ?? ''}`.slice(0, 120));
  }

  /**
   * Poste de pied : la ligne de pied du même niveau où le code est saisi le reçoit ; sinon une ligne de pied est ajoutée
   * dans le pied de la portée (section racine de la ligne pour un poste HT d'un document à sections, sinon la racine).
   */
  deployerPoste(ligId, e, bib, { surLigne = false } = {}) {
    const ed = this.editeur();
    if (!this.postes || !ed.insererPoste) { this.message(texte('bibliotheque_btp.appel.poste_hors_pied', { code: e.code }), 'avertissement'); return; }
    const taux = ed.definition.taux_tva ?? [];
    const valeurs = valeursPoste(e, bib, taux);
    const cle = e.poste?.niveau === 'TTC' ? 'TTC' : 'HT';
    const type = cle === 'HT' ? TL.PIED_HT : TL.PIED_TTC;
    const lignes = ed.saisie.lignes;
    const l = lignes.find((x) => x.lig_id === ligId) ?? null;
    if (l && surLigne && l.lig_tyl_id === type) {
      ed.magasin.modifier((d) => {
        const x = d.lignes.find((y) => y.lig_id === ligId);
        Object.assign(x, valeurs, { lig_proprietes: { ...(x.lig_proprietes ?? {}), ...valeurs.lig_proprietes } });
        ed.regles.appliquerContexte(d, ligId, taux);
      }, texte('bibliotheque_btp.appel.etapes.POSTE_PIED', { code: e.code }));
    } else {
      let section = null;
      const vide = ed.groupesVides?.get(ligId);
      if (vide) section = vide.cle === cle ? vide.section : null;
      else if (cle === 'HT') {
        const parId = new Map(lignes.map((x) => [x.lig_id, x]));
        let x = l;
        while (x && x.lig_parent_id !== null) x = parId.get(x.lig_parent_id);
        if (x?.lig_tyl_id === TL.SECTION) section = x.lig_id;
        else if (lignes.some((y) => y.lig_parent_id === null && y.lig_tyl_id === TL.SECTION)) {
          this.message(texte('bibliotheque_btp.appel.poste_section'), 'avertissement');
          return;
        }
      }
      const id = ed.insererPoste({ cle, section }, valeurs);
      ed.grille?.selectionner(id);
    }
    this.message(`${codeAppel(e, bib)} – ${e.libelle ?? ''} ${texte('bibliotheque_btp.appel.poste_insere', { niveau: cle })}`.slice(0, 120));
  }

  /** Contenu à insérer pour un élément (format du presse-papiers) : article, ouvrage ou ensemble. */
  contenuElement(e, bib) {
    const ed = this.editeur();
    if (e.type === 'OUVRAGE') return contenuOuvrage(e, bib);
    if (e.type === 'ENSEMBLE') return contenuEnsemble(e, bib);
    if (e.type === 'TEXTE') return contenuTexte(ed, e, bib);
    const ligne = { ...ed.nouvelleLigne(1, TL.ELEMENT, ed.saisie.document.ent_id), ...valeursArticle(e, bib), lig_qte: 1 };
    return { racines: [1], lignes: [ligne], metres: [], variables: [] };
  }

  /**
   * Éléments glissés depuis la fenêtre de la bibliothèque (un ou plusieurs, dans l'ordre de la liste), déposés avant
   * ou après une ligne (même niveau) ou dans une ligne (composante d'un ouvrage, fin d'une tranche) : une seule étape
   * d'annulation. Les éléments doivent venir de la même société (même base).
   */
  async deposer(donnees, refId, position) {
    try {
      const liste = Array.isArray(donnees) ? donnees : [donnees];
      if (liste.some((d) => d.societe && d.societe !== location.host)) {
        this.message(texte('bibliotheque_btp.appel.autre_societe'), 'avertissement');
        return;
      }
      const ed = this.editeur();
      const bib = await this.bibDocument();
      const tous = await Promise.all(liste.map((d) => this.fournisseur.element(d.id)));
      // Postes de pied : ajoutés dans le pied (portée de la ligne de dépôt), à part du contenu inséré.
      for (const e of tous.filter((x) => x.type === 'POSTE_PIED')) this.deployerPoste(refId, e, bib);
      const elements = tous.filter((x) => x.type !== 'POSTE_PIED');
      if (!elements.length) return;
      // Contenus renumérotés à la suite (identifiants temporaires distincts), puis réunis.
      const total = { racines: [], lignes: [], metres: [], variables: [] };
      let suivant = -1;
      const ignores = [];
      for (const e of elements) {
        const contenu = this.contenuElement(e, bib);
        if (!contenu) { ignores.push(e.code); continue; }
        const copie = ed.pressePapiers.renumeroter(contenu, suivant);
        for (const l of copie.lignes) l.lig_origine_id = null;
        for (const k of Object.keys(total)) total[k].push(...(copie[k] ?? []));
        const ids = [...copie.lignes.map((l) => l.lig_id), ...(copie.metres ?? []).map((m) => m.mtr_id),
          ...(copie.variables ?? []).map((v) => v.var_id)];
        suivant = Math.min(suivant, ...ids) - 1;
      }
      if (ignores.length) this.message(texte('bibliotheque_btp.appel.ignores', { codes: ignores.join(', ') }), 'avertissement');
      if (!total.racines.length) return;
      const libelle = elements.length > 1 ? texte('bibliotheque_btp.appel.glisses', { nombre: elements.length }) : texte('bibliotheque_btp.appel.glisse', { code: elements[0].code });
      const id = ed.insererContenu(total, refId, libelle, { position });
      if (id !== null) {
        this.message(elements.length > 1 ? texte('bibliotheque_btp.appel.inseres', { nombre: total.racines.length }) : texte('bibliotheque_btp.appel.insere', { element: `${codeAppel(elements[0], bib)} – ${elements[0].libelle ?? ''}` }).slice(0, 120));
      }
    } catch (x) {
      this.message(x.message ?? String(x), 'erreur');
    }
  }


  /** Reprend les prix et les données techniques de la bibliothèque (articles) pour les lignes choisies ; quantités et libellés conservés. */
  async actualiser(ids) {
    const ed = this.editeur();
    const lignes = ed.saisie.lignes.filter((l) => ids.includes(l.lig_id) && l.lig_art_id && l.lig_tyl_id === TL.ELEMENT);
    if (!lignes.length) { this.message(texte('bibliotheque_btp.appel.sans_article'), 'avertissement'); return; }
    const elements = new Map();
    for (const l of lignes) {
      try { elements.set(l.lig_id, await this.fournisseur.element(l.lig_art_id)); } catch { /* élément supprimé */ }
    }
    ed.magasin.modifier((d) => {
      for (const [id, e] of elements) {
        const x = d.lignes.find((y) => y.lig_id === id);
        const { ratio: r, ...p } = prixArticle(e);
        Object.assign(x, p, techniquesLigne(e), { lig_proprietes: { ...(x.lig_proprietes ?? {}), element: lien(e, { unite: p.lig_unt_code, ratio: r }) } });
      }
    }, texte('bibliotheque_btp.appel.etape_prix'));
    this.message(texte('bibliotheque_btp.appel.actualisees', { nombre: elements.size }), 'succes');
  }

  /**
   * Dialogue de recherche (tous types, toutes bibliothèques ; `type` présélectionné ; `memeCode` : seulement les
   * éléments dont le code est le texte cherché) ; résout avec l'élément choisi ou null.
   */
  choisir(cherche = '', { type = '', memeCode = false } = {}) {
    return new Promise((resoudre) => {
      const fond = document.createElement('dialog');
      fond.className = 'fiche-dialogue-fond dialogue-plein';
      fond.innerHTML = `<section class="fiche-dialogue element-recherche" role="dialog" aria-label="${texteHtml('bibliotheque_btp.appel.titre')}">
        <header><h2>${iconeHtml('bibliotheque_btp_page')} ${texteHtml('bibliotheque_btp.appel.titre')}</h2><button type="button" data-fermer title="${texteHtml('commun.fermer_echap')}">${iconeHtml('retirer')}</button></header>
        <div class="element-recherche-barre"><input type="search" placeholder="${texteHtml('bibliotheque_btp.appel.recherche')}" value="${echapper(cherche)}">
          <select data-type><option value="">${texteHtml('bibliotheque_btp.appel.types.tous')}</option>${['ARTICLE', 'OUVRAGE', 'ENSEMBLE', 'POSTE_PIED', 'TEXTE'].map((t) => `<option value="${t}">${texteHtml(`bibliotheque_btp.appel.types.${t}`)}</option>`).join('')}</select></div>
        <div class="element-resultats"></div>
        <p class="aide">${texteHtml('bibliotheque_btp.appel.aide')}</p></section>`;
      ouvrirModale(fond);
      fond.querySelector('[data-type]').value = type;
      const entree = fond.querySelector('input');
      const zone = fond.querySelector('.element-resultats');
      let resultats = [];
      let actif = 0;
      const fermer = (e) => { fond.remove(); resoudre(e ?? null); };
      const surligner = () => zone.querySelectorAll('tr[data-i]').forEach((tr) => tr.classList.toggle('actif', Number(tr.dataset.i) === actif));
      const chercher = async () => {
        resultats = await this.fournisseur.rechercher({ recherche: entree.value, type: fond.querySelector('[data-type]').value || null });
        // Même code dans plusieurs bibliothèques : tant que le texte cherché est ce code, seuls ses éléments sont listés.
        const cle = cherche.trim().toLocaleLowerCase('fr');
        if (memeCode && entree.value.trim().toLocaleLowerCase('fr') === cle) resultats = resultats.filter((e) => String(e.code ?? '').toLocaleLowerCase('fr') === cle);
        actif = 0;
        zone.innerHTML = resultats.length ? `<table class="bib-table"><thead><tr><th></th><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('bibliotheque_btp.appel.colonnes.unite')}</th><th>${texteHtml('analyse_btp.valeurs.pa')}</th><th>${texteHtml('bibliotheque_btp.appel.colonnes.pv_net')}</th></tr></thead><tbody>
          ${resultats.map((e, i) => `<tr data-i="${i}"><td>${iconeHtml(['OUVRAGE', 'ENSEMBLE', 'POSTE_PIED', 'TEXTE'].includes(e.type) ? `bibliotheque_btp_${e.type}` : 'bibliotheque_btp_ARTICLE')}</td><td><b>${echapper(e.bib_code)}:${echapper(e.code)}</b></td><td>${echapper(e.libelle ?? '')}</td>
            <td>${echapper(e.unite_stock)}</td><td class="nombre">${prix(e.pa)}</td><td class="nombre">${prix(e.pv_net)}</td></tr>`).join('')}</tbody></table>`
          : `<p class="aide">${texteHtml('bibliotheque_btp.appel.aucun')}</p>`;
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
