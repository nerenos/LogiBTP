import { calculerDocument, TL, CODES_TL, estChiffree, estPied, accepteEnfants } from '../calcul/index.js';
import { CFG_LIGNES as C, ordreAffichage, parId, placer, indenter, desindenter, decaler, supprimer, racinesSelection } from './arbre.js';
import { Magasin } from './etat.js';
import { GrilleArbre } from './grille.js';
import { appliquerContexte, apresModification, depotAutorise, estLigneDePrix, heterogeneiteTva, tauxParDefaut } from './regles.js';
import * as pp from './presse-papiers.js';
import { formatNombre, formatLibre, htmlSur, lireNombre, estHtml, decoderEntites, echapper } from './format.js';
import { editerLibelle } from './editeur-riche.js';
import { lirePreferences, ecrirePreferences } from './preferences.js';

const LIBELLES_TYPE = {
  TITRE: 'Titre', OUVRAGE: 'Ouvrage', ELEMENT: 'Élément', TEXTE: 'Texte', SOUS_TOTAL: 'S-total',
  IMAGE: 'Image', SAUT_PAGE: 'Saut', PIED_HT: 'Pied HT', PIED_TTC: 'Pied TTC', TVA: 'TVA',
};

/** Nouvelle ligne avec les valeurs par défaut du DDL. */
export function nouvelleLigne(id, type, entId) {
  return {
    lig_id: id, lig_ent_id: entId ?? 0, lig_parent_id: null, lig_ordre: 0, lig_tyl_id: type,
    lig_numerotation: null, lig_num_depart: null, lig_num_manuelle: false, lig_libelle_html: '',
    lig_qte: estChiffreeType(type) ? null : null, lig_qte_type: null, lig_qte_source: 'S', lig_coef_perte: 1, lig_precision_qte: 2,
    lig_pa: null, lig_coef_fg: 1, lig_coef_benef: 1, lig_coef_remise: 1, lig_precision_pv: 2,
    lig_pv_fixe: false, lig_pv_affiche_fixe: false, lig_type_prix: 'V', lig_is_ecart_arrondi: false,
    lig_pied_mode: type === TL.PIED_HT || type === TL.PIED_TTC ? 'P' : null, lig_pied_base: null,
    lig_pied_sens: type === TL.PIED_HT || type === TL.PIED_TTC ? -1 : null, lig_pied_valeur: null, lig_pied_is_fa: false,
    lig_tva_id: null, lig_is_non_editee: false, lig_proprietes: {},
  };
}
const estChiffreeType = (t) => t === TL.OUVRAGE || t === TL.ELEMENT;

/**
 * Éditeur d'un document : état de saisie, recalcul local à chaque modification, grille des lignes.
 * Les panneaux (entête, détail, totaux, métré) s'abonnent au magasin.
 */
export class EditeurDocument {
  constructor(conteneur, { definition, saisie, surSelection, surMessage, ouvrirMetre }) {
    this.definition = definition;
    this.surSelection = surSelection;
    this.surMessage = surMessage;
    this.ouvrirMetreExterne = ouvrirMetre;
    this.coupees = new Set();
    this.libellesUneLigne = lirePreferences().libelles === 'ligne';
    conteneur.classList.toggle('libelles-une-ligne', this.libellesUneLigne);
    this.magasin = new Magasin(saisie, { recalculer: (s) => calculerDocument(this.entree(s)) });
    this.grille = new GrilleArbre(conteneur, {
      cle: 'lig_id',
      colonnes: this.colonnes(),
      lignes: (replies) => this.lignesGrille(replies),
      actions: this.actions(),
    });
    this.magasin.abonner(() => this.grille.rendre());
    this.grille.rendre();
  }

  get saisie() { return this.magasin.saisie; }
  get resultat() { return this.magasin.resultat; }

  entree(saisie) {
    const statut = this.definition.statuts?.find((s) => s.std_id === saisie.document.ent_std_id);
    return {
      document: saisie.document,
      lignes: saisie.lignes,
      metres: saisie.metres,
      metre_lignes: saisie.metre_lignes,
      variables: saisie.variables,
      taux_tva: this.definition.taux_tva,
      entites: saisie.entites ?? {},
      options: { libelles_figes: statut ? !statut.std_modifiable : false },
    };
  }

  // ---------------------------------------------------------------- lignes affichées

  lignesGrille(replies) {
    const calc = this.resultat.lignes;
    const saisies = parId(C, this.saisie.lignes);
    const erreurs = new Map();
    for (const e of [...this.resultat.erreurs, ...this.resultat.avertissements]) {
      if (e.lig_id === null) continue;
      if (!erreurs.has(e.lig_id)) erreurs.set(e.lig_id, []);
      erreurs.get(e.lig_id).push(e);
    }
    const avecEnfants = new Set(calc.map((l) => l.lig_parent_id).filter((p) => p !== null));
    return ordreAffichage(C, calc, replies).map(({ item, profondeur }) => ({
      item: saisies.get(item.lig_id) ?? item,
      calcule: item,
      profondeur,
      aEnfants: avecEnfants.has(item.lig_id),
      messages: erreurs.get(item.lig_id) ?? [],
      estEcart: !!item.lig_is_ecart_arrondi,
    }));
  }

  libelleTaux = (id) => this.definition.taux_tva.find((t) => t.ttv_id === id)?.ttv_code ?? '—';

  colonnes() {
    const saisissable = (l) => !l.lig_is_ecart_arrondi;
    const chiffree = (l) => saisissable(l) && estChiffree(l);
    const nombre = (champ, cond) => ({
      editeur: 'nombre', editable: cond, champ: () => champ, lire: (l) => (l[champ] === null || l[champ] === undefined ? '' : formatLibre(l[champ])),
    });
    const ecrireType = this.definition.types_ligne;
    return [
      {
        cle: 'num', titre: 'N°', classe: 'col-num', arbre: true, editeur: 'texte',
        editable: (l) => saisissable(l) && (l.lig_tyl_id <= 3),
        champ: () => 'lig_numerotation', lire: (l) => (l.lig_num_manuelle ? l.lig_numerotation ?? '' : ''),
        valeur: (r) => (r.calcule.lig_numerotation ?? '') + (r.item.lig_num_manuelle ? ' ✎' : ''),
      },
      {
        cle: 'type', titre: 'Type', classe: 'col-type', editeur: 'select', editable: saisissable,
        champ: () => 'lig_tyl_id', lire: (l) => l.lig_tyl_id,
        options: () => ecrireType.map((t) => ({ valeur: t.tyl_id, libelle: t.tyl_libelle })),
        valeur: (r) => (r.estEcart ? 'Écart' : LIBELLES_TYPE[CODES_TL[r.item.lig_tyl_id]] ?? ''),
      },
      {
        // Saisie en ligne pour un texte simple ; éditeur de mise en forme au double-clic.
        cle: 'libelle', titre: 'Libellé', classe: 'col-libelle', editeur: 'texte', editable: saisissable,
        champ: () => 'lig_libelle_html',
        lire: (l) => (estHtml(l.lig_libelle_html) ? l.lig_libelle_html : decoderEntites(l.lig_libelle_html ?? '')),
        valeur: (r) => ({
          html: htmlSur(r.calcule.lig_libelle_affiche ?? r.item.lig_libelle_html ?? ''),
          titre: this.libellesUneLigne ? r.calcule.lig_libelle_brut ?? '' : null,
        }),
        riche: {
          auto: (l) => estHtml(l.lig_libelle_html),
          ouvrir: (l) => editerLibelle({
            html: l.lig_libelle_html,
            titre: [this.resultat.lignes.find((x) => x.lig_id === l.lig_id)?.lig_numerotation, LIBELLES_TYPE[CODES_TL[l.lig_tyl_id]]].filter(Boolean).join(' · '),
            variables: this.variablesLibelle(),
          }),
        },
        enteteBouton: {
          texte: () => (this.libellesUneLigne ? '⇕' : '⇔'),
          titre: () => (this.libellesUneLigne ? 'Afficher les libellés en entier' : 'Afficher les libellés sur une seule ligne'),
          clic: () => {
            this.libellesUneLigne = !this.libellesUneLigne;
            ecrirePreferences({ libelles: this.libellesUneLigne ? 'ligne' : 'complet' });
            this.grille.conteneur.classList.toggle('libelles-une-ligne', this.libellesUneLigne);
          },
        },
      },
      {
        cle: 'qte', titre: 'Qté', classe: 'col-nombre', editeur: 'nombre',
        editable: (l) => chiffree(l) || (saisissable(l) && (l.lig_tyl_id === TL.PIED_HT || l.lig_tyl_id === TL.PIED_TTC)),
        champ: (l) => (estPied(l) ? 'lig_pied_valeur' : 'lig_qte'),
        lire: (l) => formatLibre(estPied(l) ? l.lig_pied_valeur : l.lig_qte),
        valeur: (r) => {
          const c = r.calcule;
          if (estPied(c)) return c.lig_tyl_id === TL.TVA ? '' : `${formatLibre(c.lig_pied_valeur)}${c.lig_pied_mode === 'P' ? ' %' : ' €'}`;
          if (!estChiffree(c)) return '';
          return (c.lig_qte_source === 'M' ? 'ⓜ ' : '') + formatNombre(c.lig_qte_vendue, c.lig_precision_qte ?? 2);
        },
      },
      {
        cle: 'unite', titre: 'U', classe: 'col-unite', editeur: 'liste', editable: chiffree,
        champ: () => 'lig_unt_code', lire: (l) => l.lig_unt_code ?? '', valeur: (r) => r.calcule.lig_unt_code ?? '',
        suggestions: () => this.suggestionsUnites(),
      },
      {
        cle: 'pa', titre: 'PA', classe: 'col-nombre', ...nombre('lig_pa', (l) => chiffree(l) && !this.estCompose(l)),
        valeur: (r) => (estChiffree(r.calcule) ? formatNombre(r.calcule.lig_pa, 2) : ''),
      },
      {
        cle: 'fg', titre: 'FG', classe: 'col-coef', ...nombre('lig_coef_fg', chiffree),
        valeur: (r) => (estChiffree(r.calcule) ? formatLibre(r.calcule.lig_coef_fg, 4) : ''),
      },
      {
        cle: 'benef', titre: 'Bénéf.', classe: 'col-coef', ...nombre('lig_coef_benef', chiffree),
        valeur: (r) => (estChiffree(r.calcule) ? formatLibre(r.calcule.lig_coef_benef, 4) : ''),
      },
      {
        // Saisir un PV impose un prix fixe (avant frais annexes et remise) ; vider la cellule le retire.
        cle: 'pv', titre: 'PV', classe: 'col-nombre', ...nombre('lig_pv', chiffree),
        lire: (l) => (l.lig_pv_fixe ? formatLibre(l.lig_pv) : ''),
        valeur: (r) => (estChiffree(r.calcule) ? `${r.item.lig_pv_fixe ? '🔒 ' : r.calcule.lig_pv_fixe ? '⇣ ' : ''}${formatNombre(r.calcule.lig_pv, r.calcule.lig_precision_pv ?? 2)}` : ''),
      },
      {
        cle: 'remise', titre: 'Remise', classe: 'col-coef', ...nombre('lig_coef_remise', chiffree),
        valeur: (r) => (estChiffree(r.calcule) && Number(r.calcule.lig_coef_remise) !== 1 ? formatLibre(r.calcule.lig_coef_remise, 4) : ''),
      },
      {
        cle: 'pvnet', titre: 'PV net', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (estChiffree(r.calcule) ? `${r.item.lig_pv_affiche_fixe ? '🔒 ' : ''}${formatNombre(r.calcule.lig_pv_remise, r.calcule.lig_precision_pv ?? 2)}` : ''),
      },
      {
        cle: 'montant', titre: 'Montant HT', classe: 'col-nombre col-montant', editable: () => false,
        valeur: (r) => {
          const c = r.calcule;
          if (c.lig_tyl_id === TL.TVA) return formatNombre(c.lig_montant_tva, 2);
          return formatNombre(c.lig_montant_ht, this.saisie.document.ent_precision_montant ?? 2);
        },
      },
      {
        cle: 'tva', titre: 'TVA', classe: 'col-tva', editeur: 'select',
        editable: (l) => saisissable(l) && (l.lig_tyl_id === TL.TITRE || estLigneDePrix(this.saisie.lignes, l) || l.lig_tyl_id === TL.PIED_HT),
        champ: () => 'lig_tva_id', lire: (l) => l.lig_tva_id ?? '',
        options: () => [{ valeur: '', libelle: '—' }, ...this.definition.taux_tva.map((t) => ({ valeur: t.ttv_id, libelle: t.ttv_code }))],
        valeur: (r) => {
          const l = r.item;
          if (l.lig_tyl_id === TL.TITRE) {
            const h = heterogeneiteTva(this.saisie.lignes, l, this.libelleTaux);
            const s = document.createElement('span');
            s.textContent = l.lig_tva_id ? this.libelleTaux(l.lig_tva_id) : '';
            if (h.heterogene) {
              const m = document.createElement('span');
              m.className = 'tva-heterogene';
              m.textContent = ' ◆';
              m.title = h.detail;
              s.appendChild(m);
            }
            return s;
          }
          return l.lig_tva_id ? this.libelleTaux(l.lig_tva_id) : '';
        },
      },
    ];
  }

  /** Variables proposées dans l'éditeur de libellé : données de la ligne et du document, variables de calcul. */
  variablesLibelle() {
    const donnees = [
      ['lig_qte_vendue', 'Quantité vendue'], ['lig_unt_code', 'Unité'], ['lig_pv_remise', 'PV net'], ['lig_montant_ht', 'Montant HT'],
      ['lig_numerotation', 'Numéro de ligne'], ['document.ent_numero', 'Numéro du document'], ['document.ent_objet', 'Objet du document'],
    ].map(([v, l]) => ({ valeur: `{{${v}}}`, libelle: `${l} – {{${v}}}` }));
    const calcul = new Set();
    for (const v of this.resultat.variables) calcul.add(`${v.var_portee}${v.var_nom}`);
    for (const m of this.saisie.metres) if (m.mtr_variable) calcul.add(m.mtr_variable.trim());
    for (const x of this.saisie.metre_lignes) if (x.mli_variable) calcul.add(x.mli_variable.trim());
    return [...donnees, ...[...calcul].sort().map((v) => ({ valeur: `{{${v}}}`, libelle: `Variable {{${v}}}` }))];
  }

  /** Unités du référentiel, complétées par les unités saisies librement dans le document. */
  suggestionsUnites() {
    const connues = (this.definition.unites ?? []).map((u) => ({ valeur: u.unt_code, libelle: u.unt_libelle }));
    const codes = new Set(connues.map((u) => u.valeur));
    const saisies = [...new Set(this.saisie.lignes.map((l) => l.lig_unt_code).filter((c) => c && !codes.has(c)))]
      .sort().map((c) => ({ valeur: c, libelle: 'Saisie libre', detail: 'dans ce document' }));
    return [...connues, ...saisies];
  }

  estCompose(l) {
    return l.lig_tyl_id === TL.OUVRAGE && this.saisie.lignes.some((x) => x.lig_parent_id === l.lig_id);
  }

  // ---------------------------------------------------------------- actions

  modifierLigne(id, champ, valeur) {
    this.magasin.modifier((d) => {
      const l = d.lignes.find((x) => x.lig_id === id);
      if (!l) return;
      l[champ] = valeur;
      apresModification(d, id, champ);
    }, `Modification ${champ}`);
  }

  actions() {
    const m = this.magasin;
    const taux = this.definition.taux_tva;
    return {
      modifier: (id, champ, texte, colonne) => {
        let valeur = texte;
        if (colonne.editeur === 'nombre') {
          valeur = lireNombre(texte);
          if (valeur === undefined) { this.surMessage?.('Nombre invalide'); return false; }
        }
        if (champ === 'lig_tyl_id') {
          const type = Number(texte);
          const l = this.saisie.lignes.find((x) => x.lig_id === id);
          const aEnfants = this.saisie.lignes.some((x) => x.lig_parent_id === id);
          if (aEnfants && !accepteEnfants({ lig_tyl_id: type })) { this.surMessage?.('Ce type n\'accepte pas de lignes enfants'); return false; }
          if ((type >= TL.PIED_HT) !== estPied(l) && (l.lig_parent_id !== null || aEnfants)) { this.surMessage?.('Les lignes de pied sont au niveau racine'); return false; }
          m.modifier((d) => {
            const x = d.lignes.find((y) => y.lig_id === id);
            x.lig_tyl_id = type;
            if (estPied(x)) { x.lig_pied_mode ??= 'P'; x.lig_pied_sens ??= -1; }
            appliquerContexte(d, id, taux);
          }, 'Type de ligne');
          return true;
        }
        if (champ === 'lig_tva_id') valeur = texte === '' ? null : Number(texte);
        if (champ === 'lig_pv') {
          m.modifier((d) => {
            const x = d.lignes.find((y) => y.lig_id === id);
            x.lig_pv = valeur;
            x.lig_pv_fixe = valeur !== null;
            apresModification(d, id, 'lig_pv_fixe');
          }, 'PV fixe');
          return true;
        }
        // Saisie en ligne : texte simple, échappé (la mise en forme passe par l'éditeur riche).
        if (champ === 'lig_libelle_html') valeur = valeur.trim() === '' ? null : echapper(valeur);
        if (champ === 'lig_unt_code' && valeur.trim() === '') valeur = null;
        if (champ === 'lig_unt_code' && valeur) valeur = valeur.trim().slice(0, 10);
        this.modifierLigne(id, champ, valeur);
        return true;
      },

      inserer: (position, refId, { memeType = false } = {}) => {
        const ref = this.saisie.lignes.find((x) => x.lig_id === refId);
        let pos = position;
        let type = TL.ELEMENT;
        if (ref) {
          if (pos === 'enfant' && !accepteEnfants(ref)) pos = 'apres';
          if (memeType || pos !== 'enfant') type = ref.lig_tyl_id === TL.TVA ? TL.PIED_TTC : ref.lig_tyl_id;
          if (!memeType && pos !== 'enfant' && (type === TL.SOUS_TOTAL || type === TL.TEXTE)) type = TL.ELEMENT;
        }
        const id = m.prochainId();
        m.modifier((d) => {
          const l = nouvelleLigne(id, type, d.document.ent_id);
          d.lignes.push(l);
          const x = d.lignes.at(-1);
          placer(C, d.lignes, [x], ref ? refId : null, ref ? pos : 'racine');
          appliquerContexte(d, id, taux);
          if (estLigneDePrix(d.lignes, x) && x.lig_tva_id === null) x.lig_tva_id = tauxParDefaut(d.lignes, id, taux);
        }, 'Insertion');
        return id;
      },

      deplacer: (ids, cibleId, position) => {
        m.modifier((d) => {
          const racines = racinesSelection(C, d.lignes, ids);
          placer(C, d.lignes, racines, cibleId, position);
          for (const r of racines) appliquerContexte(d, r.lig_id, taux);
        }, 'Déplacement');
        this.coupees.clear();
      },

      indenter: (ids) => m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids)) {
          if (!estPied(r) && indenter(C, d.lignes, r.lig_id, accepteEnfants)) appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Descendre d\'un niveau'),

      desindenter: (ids) => m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids).reverse()) {
          if (desindenter(C, d.lignes, r.lig_id)) appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Remonter d\'un niveau'),

      decaler: (id, sens) => m.modifier((d) => { decaler(C, d.lignes, id, sens); }, 'Ordre'),

      supprimer: (ids) => {
        const suivante = this.#ligneApres(ids);
        m.modifier((d) => {
          const supprimees = supprimer(C, d.lignes, racinesSelection(C, d.lignes, ids).map((r) => r.lig_id));
          const metres = new Set(d.metres.filter((x) => supprimees.has(x.mtr_lig_id)).map((x) => x.mtr_id));
          d.metres = d.metres.filter((x) => !metres.has(x.mtr_id));
          d.metre_lignes = d.metre_lignes.filter((x) => !metres.has(x.mli_mtr_id));
          d.variables = d.variables.filter((v) => !supprimees.has(v.var_lig_id) && !metres.has(v.var_mtr_id));
        }, 'Suppression');
        if (suivante !== null) this.grille.selectionner(suivante);
      },

      dupliquer: (ids) => {
        const contenu = pp.extraire(this.saisie, ids, { entId: this.saisie.document.ent_id, coupe: false });
        this.#insererContenu(contenu, contenu.racines.at(-1), 'Dupliquer');
      },

      copier: async (ids, couper) => {
        const contenu = pp.extraire(this.saisie, ids, { entId: this.saisie.document.ent_id, coupe: couper });
        await pp.ecrire(contenu);
        this.coupees = couper ? new Set(contenu.lignes.map((l) => l.lig_id)) : new Set();
        this.grille.rendre();
        this.surMessage?.(`${contenu.racines.length} ligne(s) ${couper ? 'coupée(s)' : 'copiée(s)'}`);
      },

      coller: async (refId) => {
        const contenu = await pp.lire();
        if (!contenu) { this.surMessage?.('Presse-papiers vide ou non compatible'); return; }
        const memeDocument = contenu.source_ent_id === this.saisie.document.ent_id;
        const presentes = contenu.racines.every((id) => this.saisie.lignes.some((l) => l.lig_id === id));
        if (contenu.coupe && memeDocument && presentes) {
          // Couper-coller dans le même document : déplacement, les ID, métrés et liens sont conservés.
          if (contenu.racines.includes(refId)) return;
          if (!depotAutorise(this.saisie.lignes, contenu.racines, this.saisie.lignes.find((l) => l.lig_id === refId), 'apres')) {
            this.surMessage?.('Position de collage interdite');
            return;
          }
          this.actions().deplacer(contenu.racines, refId, 'apres');
          pp.oublierCoupe();
          return;
        }
        this.#insererContenu(contenu, refId, 'Coller');
      },

      modifierRiche: (id, champ, html) => this.modifierLigne(id, champ, html),
      annuler: () => m.annuler(),
      retablir: () => m.retablir(),
      ouvrirMetre: (id) => this.ouvrirMetre(id),

      depotAutorise: (ids, cibleId, position) => {
        const cible = this.saisie.lignes.find((l) => l.lig_id === cibleId);
        if (!cible) return false;
        return depotAutorise(this.saisie.lignes, racinesSelection(C, this.saisie.lignes, ids).map((r) => r.lig_id), cible, position);
      },

      classeLigne: (r) => [
        `type-${(CODES_TL[r.calcule.lig_tyl_id] ?? '').toLowerCase()}`,
        r.estEcart ? 'ecart' : '',
        r.messages.some((x) => this.resultat.erreurs.includes(x)) ? 'erreur' : r.messages.length ? 'avertissement' : '',
        (r.calcule.lig_type_prix ?? 'V') !== 'V' ? 'hors-total' : '',
        r.calcule.lig_is_non_editee ? 'non-editee' : '',
        this.coupees.has(r.item.lig_id) ? 'coupee' : '',
      ].join(' '),

      titreLigne: (r) => r.messages.map((x) => x.message).join('\n'),
      selection: (id) => this.surSelection?.(id),
    };
  }

  #ligneApres(ids) {
    const lignes = this.grille.lignesAffichees;
    const sel = new Set(ids);
    const i = lignes.findIndex((r) => sel.has(r.item.lig_id));
    const apres = lignes.slice(i + 1).find((r) => !sel.has(r.item.lig_id) && !r.estEcart);
    const avant = lignes.slice(0, Math.max(0, i)).reverse().find((r) => !r.estEcart);
    return (apres ?? avant)?.item.lig_id ?? null;
  }

  /** Insère une copie (nouveaux ID temporaires) des sous-arbres après la ligne de référence. */
  #insererContenu(contenu, refId, libelle) {
    const copie = pp.renumeroter(contenu, this.magasin.prochainId());
    const ref = this.saisie.lignes.find((l) => l.lig_id === refId);
    if (ref && !depotAutorise([...this.saisie.lignes, ...copie.lignes], copie.racines, ref, 'apres')) {
      this.surMessage?.('Position de collage interdite');
      return;
    }
    this.magasin.modifier((d) => {
      d.lignes.push(...copie.lignes);
      d.metres.push(...copie.metres);
      d.metre_lignes.push(...copie.metre_lignes);
      d.variables.push(...copie.variables.map((v) => ({ ...v, var_ent_id: d.document.ent_id })));
      const racines = copie.racines.map((id) => d.lignes.find((l) => l.lig_id === id));
      placer(C, d.lignes, racines, ref ? refId : null, ref ? 'apres' : 'racine');
      for (const r of racines) appliquerContexte(d, r.lig_id, this.definition.taux_tva);
    }, libelle);
    this.grille.selectionner(copie.racines[0]);
  }

  /** F4 : ouvre le métré de la ligne chiffrée, en le créant au besoin (une seule étape d'annulation). */
  ouvrirMetre(id) {
    const l = this.saisie.lignes.find((x) => x.lig_id === id);
    if (!l || !estChiffree(l) || l.lig_is_ecart_arrondi) { this.surMessage?.('Le métré concerne les lignes chiffrées'); return; }
    let mtrId = l.lig_mtr_id;
    if (mtrId === null || mtrId === undefined || !this.saisie.metres.some((x) => x.mtr_id === mtrId)) {
      mtrId = this.magasin.prochainId();
      const mliId = mtrId - 1;
      this.magasin.modifier((d) => {
        d.metres.push({ mtr_id: mtrId, mtr_lig_id: id, mtr_libelle: null, mtr_unt_code: l.lig_unt_code ?? null, mtr_variable: null, mtr_resultat: null });
        d.metre_lignes.push({ mli_id: mliId, mli_mtr_id: mtrId, mli_parent_id: null, mli_ordre: 1, mli_type: 'V', mli_operateur: '+', mli_formule: l.lig_qte ? String(l.lig_qte).replace('.', ',') : '', mli_commentaire: null });
        const x = d.lignes.find((y) => y.lig_id === id);
        x.lig_mtr_id = mtrId;
        x.lig_qte_source = 'M';
      }, 'Création du métré');
    }
    this.ouvrirMetreExterne?.(id, mtrId);
  }
}
