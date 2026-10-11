import {
  CFG_LIGNES as C, ordreAffichage, parId, placer, indenter, desindenter, decaler, supprimer, racinesSelection,
  Magasin, GrilleArbre, formatNombre, formatLibre, htmlSur, lireNombre, estHtml, decoderEntites, echapper,
  editerLibelle, lirePreferences, ecrirePreferences,
} from '@logibtp/socle/ui';
import { calculerDocument, TL, CODES_TL, estChiffree, estPied, accepteEnfants } from '../src/index.js';
import { ReglesDocument } from './regles.js';
import { PressePapiers } from './presse-papiers.js';

export const LIBELLES_TYPE = {
  TITRE: 'Titre', OUVRAGE: 'Ouvrage', ELEMENT: 'Élément', TEXTE: 'Texte', SOUS_TOTAL: 'S-total',
  IMAGE: 'Image', SAUT_PAGE: 'Saut', PIED_HT: 'Pied HT', PIED_TTC: 'Pied TTC', TVA: 'TVA',
};

/** Remplace (fusionne) la colonne `cle` d'une liste de colonnes. */
export function modifierColonne(colonnes, cle, modif) {
  const i = colonnes.findIndex((c) => c.cle === cle);
  if (i >= 0) colonnes[i] = { ...colonnes[i], ...modif };
  return colonnes;
}

/** Insère des colonnes avant la colonne `cle` (à la fin si elle n'existe pas). */
export function insererColonnes(colonnes, avantCle, nouvelles) {
  const i = colonnes.findIndex((c) => c.cle === avantCle);
  colonnes.splice(i < 0 ? colonnes.length : i, 0, ...nouvelles);
  return colonnes;
}

/**
 * Éditeur d'un document (classe mère) : état de saisie, recalcul local à chaque modification, grille des lignes.
 * Les panneaux (entête, détail, totaux…) s'abonnent au magasin.
 *
 * Points de spécialisation : calculer (moteur), entree, identifiants, nouvelleLigne, creerRegles, creerPressePapiers,
 * colonnes, saisissable, estLigneCalculee, variablesLibelle, apresSuppression, actions.
 *
 * Options de l'hôte : appelerCode(ligId, code) (saisie dans la colonne Code : appel d'une référence, ex. bibliothèque),
 * rechercher(ligId) (F3 : recherche d'une référence).
 */
export class EditeurDocument {
  constructor(conteneur, { definition, saisie, surSelection, surMessage, appelerCode = null, rechercher = null }) {
    this.definition = definition;
    this.appelerCode = appelerCode;
    this.rechercherExterne = rechercher;
    this.surSelection = surSelection;
    this.surMessage = surMessage;
    this.regles = this.creerRegles();
    this.pressePapiers = this.creerPressePapiers();
    this.coupees = new Set();
    this.libellesUneLigne = lirePreferences().libelles === 'ligne';
    conteneur.classList.toggle('libelles-une-ligne', this.libellesUneLigne);
    this.magasin = new Magasin(saisie, {
      recalculer: (s) => this.calculer(this.entree(s)),
      identifiants: (s, r) => this.identifiants(s, r),
    });
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

  // ---------------------------------------------------------------- spécialisation

  creerRegles() { return new ReglesDocument(); }
  creerPressePapiers() { return new PressePapiers(); }

  /** Moteur de calcul local. */
  calculer(entree) { return calculerDocument(entree); }

  entree(saisie) {
    const statut = this.definition.statuts?.find((s) => s.std_id === saisie.document.ent_std_id);
    return {
      document: saisie.document,
      lignes: saisie.lignes,
      taux_tva: this.definition.taux_tva,
      entites: saisie.entites ?? {},
      options: { libelles_figes: statut ? !statut.std_modifiable : false },
    };
  }

  /** Nouvelle ligne avec les valeurs par défaut du DDL. */
  nouvelleLigne(id, type, entId) {
    const pied = type === TL.PIED_HT || type === TL.PIED_TTC;
    return {
      lig_id: id, lig_ent_id: entId ?? 0, lig_parent_id: null, lig_ordre: 0, lig_tyl_id: type,
      lig_numerotation: null, lig_num_depart: null, lig_num_manuelle: false, lig_libelle_html: '',
      lig_qte: null, lig_qte_type: null, lig_precision_qte: 2, lig_pv: null, lig_coef_remise: 1, lig_precision_pv: 2,
      lig_type_prix: 'V', lig_pied_mode: pied ? 'P' : null, lig_pied_base: null, lig_pied_sens: pied ? -1 : null,
      lig_pied_valeur: null, lig_tva_id: null, lig_is_non_editee: false, lig_proprietes: {},
    };
  }

  /** ID déjà utilisés (lignes saisies et calculées, compléments) : base des ID temporaires négatifs. */
  identifiants(saisie, resultat) {
    return [...saisie.lignes.map((l) => l.lig_id), ...(resultat?.lignes ?? []).map((l) => l.lig_id)];
  }

  /** Ligne modifiable par l'utilisateur (une ligne calculée par le moteur ne l'est pas). */
  saisissable(l) { return !this.magasin?.lectureSeule && !this.estLigneCalculee(l); }

  /** Ligne créée par le moteur (écart d'arrondi…). */
  estLigneCalculee(_l) { return false; }

  /** Compléments à retirer avec des lignes supprimées (métrés…). */
  apresSuppression(_brouillon, _supprimees) {}

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
      estCalculee: this.estLigneCalculee(item),
    }));
  }

  libelleTaux = (id) => this.definition.taux_tva.find((t) => t.ttv_id === id)?.ttv_code ?? '—';

  libelleType(r) { return LIBELLES_TYPE[CODES_TL[r.item.lig_tyl_id]] ?? ''; }

  /** Colonne numérique saisissable (texte libre converti, vide = null). */
  colonneNombre(champ, editable) {
    return {
      editeur: 'nombre', editable, champ: () => champ,
      lire: (l) => (l[champ] === null || l[champ] === undefined ? '' : formatLibre(l[champ])),
    };
  }

  colonnes() {
    const saisissable = (l) => this.saisissable(l);
    const chiffree = (l) => saisissable(l) && estChiffree(l);
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
        options: () => this.definition.types_ligne.map((t) => ({ valeur: t.tyl_id, libelle: t.tyl_libelle })),
        valeur: (r) => this.libelleType(r),
      },
      {
        // Code d'appel d'une référence (article…) : résolu par l'hôte ; sinon texte libre.
        cle: 'code', titre: 'Code', classe: 'col-code', editeur: 'texte', editable: saisissable,
        champ: () => 'lig_code', lire: (l) => l.lig_code ?? '', valeur: (r) => r.calcule.lig_code ?? '',
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
          return formatNombre(c.lig_qte_vendue, c.lig_precision_qte ?? 2);
        },
      },
      {
        cle: 'unite', titre: 'U', classe: 'col-unite', editeur: 'liste', editable: chiffree,
        champ: () => 'lig_unt_code', lire: (l) => l.lig_unt_code ?? '', valeur: (r) => r.calcule.lig_unt_code ?? '',
        suggestions: () => this.suggestionsUnites(),
      },
      {
        cle: 'pv', titre: 'PV', classe: 'col-nombre', ...this.colonneNombre('lig_pv', (l) => chiffree(l) && !this.estCompose(l)),
        valeur: (r) => (estChiffree(r.calcule) ? formatNombre(r.calcule.lig_pv, r.calcule.lig_precision_pv ?? 2) : ''),
      },
      {
        cle: 'remise', titre: 'Remise', classe: 'col-coef', ...this.colonneNombre('lig_coef_remise', chiffree),
        valeur: (r) => (estChiffree(r.calcule) && Number(r.calcule.lig_coef_remise) !== 1 ? formatLibre(r.calcule.lig_coef_remise, 4) : ''),
      },
      {
        cle: 'pvnet', titre: 'PV net', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (estChiffree(r.calcule) ? formatNombre(r.calcule.lig_pv_remise, r.calcule.lig_precision_pv ?? 2) : ''),
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
        editable: (l) => saisissable(l) && (l.lig_tyl_id === TL.TITRE || this.regles.estLigneDePrix(this.saisie.lignes, l) || l.lig_tyl_id === TL.PIED_HT),
        champ: () => 'lig_tva_id', lire: (l) => l.lig_tva_id ?? '',
        options: () => [{ valeur: '', libelle: '—' }, ...this.definition.taux_tva.map((t) => ({ valeur: t.ttv_id, libelle: t.ttv_code }))],
        valeur: (r) => {
          const l = r.item;
          if (l.lig_tyl_id === TL.TITRE) {
            const h = this.regles.heterogeneiteTva(this.saisie.lignes, l, this.libelleTaux);
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

  /** Variables proposées dans l'éditeur de libellé : données de la ligne et du document. */
  variablesLibelle() {
    return [
      ['lig_qte_vendue', 'Quantité vendue'], ['lig_unt_code', 'Unité'], ['lig_pv_remise', 'PV net'], ['lig_montant_ht', 'Montant HT'],
      ['lig_numerotation', 'Numéro de ligne'], ['document.ent_numero', 'Numéro du document'], ['document.ent_objet', 'Objet du document'],
    ].map(([v, l]) => ({ valeur: `{{${v}}}`, libelle: `${l} – {{${v}}}` }));
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
      this.regles.apresModification(d, id, champ);
    }, `Modification ${champ}`);
  }

  /**
   * Saisie d'une cellule : renvoie true si la valeur est acceptée. Une spécialisation traite ses champs
   * puis délègue le reste à super.modifierCellule.
   */
  modifierCellule(id, champ, texte, colonne) {
    const m = this.magasin;
    const taux = this.definition.taux_tva;
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
        this.regles.appliquerContexte(d, id, taux);
      }, 'Type de ligne');
      return true;
    }
    if (champ === 'lig_code') {
      const code = String(texte ?? '').trim();
      if (code && this.appelerCode) { this.appelerCode(id, code); return true; }
      this.modifierLigne(id, 'lig_code', code || null);
      return true;
    }
    if (champ === 'lig_tva_id') valeur = texte === '' ? null : Number(texte);
    // Saisie en ligne : texte simple, échappé (la mise en forme passe par l'éditeur riche).
    if (champ === 'lig_libelle_html') valeur = valeur.trim() === '' ? null : echapper(valeur);
    if (champ === 'lig_unt_code' && valeur.trim() === '') valeur = null;
    if (champ === 'lig_unt_code' && valeur) valeur = valeur.trim().slice(0, 10);
    this.modifierLigne(id, champ, valeur);
    return true;
  }

  actions() {
    const m = this.magasin;
    const taux = this.definition.taux_tva;
    const regles = this.regles;
    const pp = this.pressePapiers;
    return {
      modifier: (id, champ, texte, colonne) => this.modifierCellule(id, champ, texte, colonne),

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
          d.lignes.push(this.nouvelleLigne(id, type, d.document.ent_id));
          const x = d.lignes.at(-1);
          placer(C, d.lignes, [x], ref ? refId : null, ref ? pos : 'racine');
          regles.appliquerContexte(d, id, taux);
          if (regles.estLigneDePrix(d.lignes, x) && x.lig_tva_id === null) x.lig_tva_id = regles.tauxParDefaut(d.lignes, id, taux);
        }, 'Insertion');
        return id;
      },

      deplacer: (ids, cibleId, position) => {
        m.modifier((d) => {
          const racines = racinesSelection(C, d.lignes, ids);
          placer(C, d.lignes, racines, cibleId, position);
          for (const r of racines) regles.appliquerContexte(d, r.lig_id, taux);
        }, 'Déplacement');
        this.coupees.clear();
      },

      indenter: (ids) => m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids)) {
          if (!estPied(r) && indenter(C, d.lignes, r.lig_id, accepteEnfants)) regles.appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Descendre d\'un niveau'),

      desindenter: (ids) => m.modifier((d) => {
        for (const r of racinesSelection(C, d.lignes, ids).reverse()) {
          if (desindenter(C, d.lignes, r.lig_id)) regles.appliquerContexte(d, r.lig_id, taux);
        }
      }, 'Remonter d\'un niveau'),

      decaler: (id, sens) => m.modifier((d) => { decaler(C, d.lignes, id, sens); }, 'Ordre'),

      supprimer: (ids) => {
        const suivante = this.#ligneApres(ids);
        m.modifier((d) => {
          const supprimees = supprimer(C, d.lignes, racinesSelection(C, d.lignes, ids).map((r) => r.lig_id));
          this.apresSuppression(d, supprimees);
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
          // Couper-coller dans le même document : déplacement, les ID, compléments et liens sont conservés.
          if (contenu.racines.includes(refId)) return;
          if (!regles.depotAutorise(this.saisie.lignes, contenu.racines, this.saisie.lignes.find((l) => l.lig_id === refId), 'apres')) {
            this.surMessage?.('Position de collage interdite');
            return;
          }
          this.grille.o.actions.deplacer(contenu.racines, refId, 'apres');
          pp.oublierCoupe();
          return;
        }
        this.#insererContenu(contenu, refId, 'Coller');
      },

      modifierRiche: (id, champ, html) => this.modifierLigne(id, champ, html),
      rechercher: (id) => this.rechercherExterne?.(id),
      annuler: () => m.annuler(),
      retablir: () => m.retablir(),

      depotAutorise: (ids, cibleId, position) => {
        const cible = this.saisie.lignes.find((l) => l.lig_id === cibleId);
        if (!cible) return false;
        return regles.depotAutorise(this.saisie.lignes, racinesSelection(C, this.saisie.lignes, ids).map((r) => r.lig_id), cible, position);
      },

      classeLigne: (r) => [
        `type-${(CODES_TL[r.calcule.lig_tyl_id] ?? '').toLowerCase()}`,
        r.estCalculee ? 'calculee' : '',
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
    const apres = lignes.slice(i + 1).find((r) => !sel.has(r.item.lig_id) && !r.estCalculee);
    const avant = lignes.slice(0, Math.max(0, i)).reverse().find((r) => !r.estCalculee);
    return (apres ?? avant)?.item.lig_id ?? null;
  }

  /**
   * Insère un contenu (sous-arbres et compléments, format du presse-papiers) après la ligne de référence, ou à sa place
   * (remplacer : la ligne de référence est retirée dans la même étape d'annulation). Renvoie l'ID de la première racine.
   */
  insererContenu(contenu, refId, libelle, { remplacer = false } = {}) {
    const copie = this.pressePapiers.renumeroter(contenu, this.magasin.prochainId());
    const ref = this.saisie.lignes.find((l) => l.lig_id === refId);
    if (ref && !this.regles.depotAutorise([...this.saisie.lignes, ...copie.lignes], copie.racines, ref, 'apres')) {
      this.surMessage?.('Position d\'insertion interdite');
      return null;
    }
    this.magasin.modifier((d) => {
      d.lignes.push(...copie.lignes);
      this.pressePapiers.insererComplements(d, copie);
      const racines = copie.racines.map((id) => d.lignes.find((l) => l.lig_id === id));
      placer(C, d.lignes, racines, ref ? refId : null, ref ? 'apres' : 'racine');
      if (ref && remplacer) this.apresSuppression(d, supprimer(C, d.lignes, [refId]));
      for (const r of racines) this.regles.appliquerContexte(d, r.lig_id, this.definition.taux_tva);
    }, libelle);
    this.grille.selectionner(copie.racines[0]);
    return copie.racines[0];
  }

  /** Insère une copie (nouveaux ID temporaires) des sous-arbres après la ligne de référence. */
  #insererContenu(contenu, refId, libelle) {
    const copie = this.pressePapiers.renumeroter(contenu, this.magasin.prochainId());
    const ref = this.saisie.lignes.find((l) => l.lig_id === refId);
    if (ref && !this.regles.depotAutorise([...this.saisie.lignes, ...copie.lignes], copie.racines, ref, 'apres')) {
      this.surMessage?.('Position de collage interdite');
      return;
    }
    this.magasin.modifier((d) => {
      d.lignes.push(...copie.lignes);
      this.pressePapiers.insererComplements(d, copie);
      const racines = copie.racines.map((id) => d.lignes.find((l) => l.lig_id === id));
      placer(C, d.lignes, racines, ref ? refId : null, ref ? 'apres' : 'racine');
      for (const r of racines) this.regles.appliquerContexte(d, r.lig_id, this.definition.taux_tva);
    }, libelle);
    this.grille.selectionner(copie.racines[0]);
  }
}
