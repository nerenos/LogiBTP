import { CFG_METRE as M, ordreAffichage, placer, indenter, desindenter, decaler, descendants, racinesSelection, enfants } from './arbre.js';
import { GrilleArbre } from './grille.js';
import { formatLibre, echapper } from './format.js';
import { dictionnaire } from './dictionnaire.js';
import { estChiffree } from '../calcul/index.js';

const TYPES = [{ valeur: 'V', libelle: 'Valeur' }, { valeur: 'D', libelle: 'Sous-détail' }, { valeur: 'S', libelle: 'Sous-total' }];
const OPERATEURS = [{ valeur: '+', libelle: '+' }, { valeur: '-', libelle: '−' }, { valeur: '*', libelle: '×' }, { valeur: '/', libelle: '÷' }];
const PORTEES = [
  { valeur: '@', libelle: '@ ligne' }, { valeur: '@@', libelle: '@@ ouvrage' },
  { valeur: '$', libelle: '$ titre' }, { valeur: '$$', libelle: '$$ document' },
];
const OPERATIONS = [{ valeur: '=', libelle: '= affecter' }, { valeur: '+=', libelle: '+= incrémenter' }];
const RE_NOM = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/**
 * Métré de la ligne chiffrée sélectionnée dans le devis (le panneau suit la sélection) :
 * onglet Définition (libellé, unité, variables en tableau avec saisie en cascade) et onglet Lignes.
 * Le dictionnaire liste les variables et données utilisables ; un clic insère la référence dans la
 * formule en cours de saisie. Même composant de grille et même pile d'annulation que le document.
 */
export class PanneauMetre {
  constructor(racine, editeur, { fermer, message }) {
    this.racine = racine;
    this.editeur = editeur;
    this.fermerExterne = fermer;
    this.message = message;
    this.mtrId = null;
    this.ligId = null;
    this.onglet = 'lignes';
    racine.innerHTML = `
      <header class="metre-entete">
        <h2>Métré <span class="metre-titre"></span></h2>
        <nav><button data-onglet="definition">Définition</button><button data-onglet="lignes">Lignes</button></nav>
        <div class="metre-resultat"></div>
        <button class="principal" data-action="valider" title="Revenir à la ligne avec la quantité calculée (Échap)">Valider</button>
      </header>
      <div class="metre-corps">
        <div class="metre-principal">
          <section class="metre-vide" hidden></section>
          <section class="metre-definition">
            <div class="metre-formulaire"></div>
            <h3>Variables définies ou incrémentées par ce métré</h3>
            <div class="metre-variables"></div>
            <p class="aide">Évaluées après les lignes du métré et la quantité de la ligne, dans l'ordre du tableau :
              une variable peut reprendre le résultat (<code>{{@surface}}</code>) ou une autre variable.
              Entrée : cellule suivante, nouvelle variable après la dernière · Ctrl+Entrée : insérer · Suppr · Alt+↑↓ : ordre ·
              <code>{{</code> ou Ctrl+Espace : variables utilisables.</p>
            <button data-action="ajouter-variable">Ajouter une variable</button>
          </section>
          <section class="metre-lignes"></section>
        </div>
        <aside class="dictionnaire">
          <h3>Dictionnaire</h3>
          <input type="search" placeholder="Filtrer…" data-filtre>
          <div class="dictionnaire-liste"></div>
          <p class="aide">Clic : insérer dans la formule en cours de saisie.</p>
        </aside>
      </div>
      <p class="aide metre-aide">Lignes : Tab / Maj+Tab : niveau de sous-détail · Ctrl+Entrée : insérer · Suppr · Ctrl+Z : annuler ·
        <code>{{</code> ou Ctrl+Espace dans une formule : variables utilisables · Échap : revenir au devis</p>`;
    racine.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => this.afficherOnglet(b.dataset.onglet)));
    racine.querySelector('[data-action="valider"]').addEventListener('click', () => this.fermer());
    racine.querySelector('[data-action="ajouter-variable"]').addEventListener('click', () => {
      const id = this.actionsVariables().inserer('apres', this.grilleVariables.courant);
      this.grilleVariables.selectionner(id, { colonne: 0 });
      this.grilleVariables.editer(1);
    });
    racine.querySelector('[data-filtre]').addEventListener('input', () => this.rendreDictionnaire());

    this.grille = new GrilleArbre(racine.querySelector('.metre-lignes'), {
      cle: 'mli_id', colonnes: this.colonnesLignes(), lignes: (replies) => this.lignes(replies), actions: this.actionsLignes(),
    });
    this.grilleVariables = new GrilleArbre(racine.querySelector('.metre-variables'), {
      cle: 'var_id', colonnes: this.colonnesVariables(), lignes: () => this.variables(), actions: this.actionsVariables(),
    });
    for (const g of [this.grille, this.grilleVariables]) {
      g.conteneur.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !g.edition) this.fermer(); });
    }
    editeur.magasin.abonner(() => { if (!this.racine.hidden) this.rendre(); });
  }

  get saisie() { return this.editeur.saisie; }
  metre() { return this.saisie.metres.find((m) => m.mtr_id === this.mtrId) ?? null; }

  ouvrir(ligId, mtrId) {
    this.ligId = ligId;
    this.mtrId = mtrId;
    this.racine.hidden = false;
    this.afficherOnglet(this.onglet);
  }

  /** Le panneau suit la ligne sélectionnée dans le devis. */
  suivre(ligId) {
    if (this.racine.hidden || ligId === this.ligId) return;
    const l = this.saisie.lignes.find((x) => x.lig_id === ligId);
    this.ligId = ligId;
    this.mtrId = l && this.saisie.metres.some((m) => m.mtr_id === l.lig_mtr_id) ? l.lig_mtr_id : null;
    this.grille.courant = null;
    this.grilleVariables.courant = null;
    this.rendre();
  }

  fermer() {
    this.racine.hidden = true;
    this.fermerExterne?.(this.ligId);
  }

  afficherOnglet(o) {
    this.onglet = o;
    this.rendre();
    if (o === 'lignes') this.grille.focus();
    else this.grilleVariables.focus();
  }

  rendre() {
    const ligne = this.editeur.resultat.lignes.find((l) => l.lig_id === this.ligId);
    const saisie = this.saisie.lignes.find((l) => l.lig_id === this.ligId);
    const m = this.metre();
    this.racine.querySelector('.metre-titre').textContent = `${ligne?.lig_numerotation ?? ''} ${ligne?.lig_libelle_brut ?? ''}`;
    this.racine.querySelectorAll('[data-onglet]').forEach((b) => { b.classList.toggle('actif', b.dataset.onglet === this.onglet); b.disabled = !m; });
    const vide = this.racine.querySelector('.metre-vide');
    vide.hidden = !!m;
    this.racine.querySelector('.metre-definition').hidden = !m || this.onglet !== 'definition';
    this.racine.querySelector('.metre-lignes').hidden = !m || this.onglet !== 'lignes';
    this.rendreDictionnaire();
    if (!m) {
      this.racine.querySelector('.metre-resultat').textContent = '';
      const chiffree = saisie && estChiffree(saisie) && !saisie.lig_is_ecart_arrondi;
      vide.innerHTML = chiffree
        ? '<p>Cette ligne n\'a pas de métré.</p><button class="principal" data-action="creer">Créer le métré</button>'
        : '<p>Sélectionnez une ligne chiffrée (ouvrage ou élément) dans le devis.</p>';
      vide.querySelector('[data-action="creer"]')?.addEventListener('click', () => this.editeur.ouvrirMetre(this.ligId));
      return;
    }
    const calc = this.editeur.resultat.metres.find((x) => x.mtr_id === this.mtrId);
    const erreurs = this.editeur.resultat.erreurs.filter((e) => e.lig_id === this.ligId);
    this.racine.querySelector('.metre-resultat').innerHTML = erreurs.length
      ? `<span class="erreur">${echapper(erreurs.map((e) => e.message).join(' · '))}</span>`
      : `Résultat : <strong>${formatLibre(calc?.mtr_resultat)}</strong> ${echapper(m.mtr_unt_code ?? '')}`;
    if (this.onglet === 'definition') {
      this.rendreFormulaire(m);
      this.grilleVariables.rendre();
    } else this.grille.rendre();
  }

  // ---------------------------------------------------------------- dictionnaire

  entreesDictionnaire(pourDefinition) {
    return dictionnaire(this.editeur, this.ligId, { pourDefinition });
  }

  rendreDictionnaire() {
    const zone = this.racine.querySelector('.dictionnaire-liste');
    const filtre = this.racine.querySelector('[data-filtre]').value.trim().toLowerCase();
    const entrees = this.ligId === null ? [] : this.entreesDictionnaire(this.onglet === 'definition')
      .filter((e) => !filtre || e.valeur.toLowerCase().includes(filtre) || e.libelle.toLowerCase().includes(filtre));
    let groupe = null;
    zone.innerHTML = entrees.map((e) => {
      const titre = e.groupe !== groupe ? `<p class="groupe">${echapper(e.groupe)}</p>` : '';
      groupe = e.groupe;
      return `${titre}<button type="button" data-ref="${echapper(e.valeur)}" title="${echapper(e.libelle)}">
        <code>${echapper(e.valeur)}</code><span>${echapper(formatLibre(e.detail) || String(e.detail ?? ''))}</span></button>`;
    }).join('') || '<p class="aide">Aucune variable définie avant cette ligne.</p>';
    zone.querySelectorAll('[data-ref]').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault()); // la cellule en saisie garde le focus
      b.addEventListener('click', () => this.insererReference(b.dataset.ref));
    });
  }

  /** Insère la référence dans la formule en cours de saisie, sinon dans la formule de la ligne courante. */
  insererReference(ref) {
    const g = this.onglet === 'definition' ? this.grilleVariables : this.grille;
    const colFormule = this.onglet === 'definition' ? 3 : 2;
    if (!g.insererReference(ref, g.courant !== null ? colFormule : undefined)) {
      navigator.clipboard?.writeText(ref).catch(() => {});
      this.message?.(`${ref} copié : sélectionnez une ligne pour l'insérer`);
    }
  }

  // ---------------------------------------------------------------- onglet Définition

  rendreFormulaire(m) {
    const zone = this.racine.querySelector('.metre-formulaire');
    if (zone.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    zone.innerHTML = `
      <div class="formulaire">
        <label>Libellé <input data-champ="mtr_libelle" value="${echapper(m.mtr_libelle ?? '')}"></label>
        <label>Unité du résultat <input data-champ="mtr_unt_code" value="${echapper(m.mtr_unt_code ?? '')}"></label>
        <label>Affecter le résultat à <input data-champ="mtr_variable" placeholder="@surface" value="${echapper(m.mtr_variable ?? '')}"></label>
      </div>`;
    zone.querySelectorAll('[data-champ]').forEach((i) => i.addEventListener('change', () => {
      this.editeur.magasin.modifier((d) => { d.metres.find((x) => x.mtr_id === m.mtr_id)[i.dataset.champ] = i.value.trim() || null; }, 'Métré');
    }));
  }

  variables() {
    const calc = new Map(this.editeur.resultat.variables.map((v) => [v.var_id, v]));
    return this.saisie.variables
      .filter((v) => v.var_mtr_id === this.mtrId && this.mtrId !== null)
      .sort((a, b) => (a.var_ordre - b.var_ordre) || (a.var_id - b.var_id))
      .map((v) => ({ item: v, calcule: calc.get(v.var_id) ?? v, profondeur: 0, aEnfants: false }));
  }

  colonnesVariables() {
    return [
      { cle: 'portee', titre: 'Portée', editeur: 'select', editable: () => true, options: () => PORTEES,
        champ: () => 'var_portee', lire: (v) => v.var_portee, valeur: (r) => PORTEES.find((p) => p.valeur === r.item.var_portee)?.libelle },
      { cle: 'nom', titre: 'Nom', editeur: 'texte', editable: () => true, champ: () => 'var_nom', lire: (v) => v.var_nom,
        valeur: (r) => `${r.item.var_portee}${r.item.var_nom}` },
      { cle: 'operation', titre: 'Opération', editeur: 'select', editable: () => true, options: () => OPERATIONS,
        champ: () => 'var_operation', lire: (v) => v.var_operation, valeur: (r) => (r.item.var_operation === '+=' ? '+=' : '=') },
      { cle: 'formule', titre: 'Formule', classe: 'col-formule', editeur: 'formule', editable: () => true,
        champ: () => 'var_formule', lire: (v) => v.var_formule, valeur: (r) => r.item.var_formule,
        suggestions: () => this.entreesDictionnaire(true) },
      { cle: 'valeur', titre: 'Valeur', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (r.calcule.var_valeur === null || r.calcule.var_valeur === undefined ? '—' : formatLibre(r.calcule.var_valeur)) },
    ];
  }

  /** Nom libre dans le métré : variable1, variable2… */
  nomLibre() {
    const noms = new Set(this.saisie.variables.map((v) => v.var_nom));
    let n = 1;
    while (noms.has(`variable${n}`)) n++;
    return `variable${n}`;
  }

  actionsVariables() {
    const m = () => this.editeur.magasin;
    const liste = (d) => d.variables.filter((v) => v.var_mtr_id === this.mtrId).sort((a, b) => (a.var_ordre - b.var_ordre) || (a.var_id - b.var_id));
    const renumeroter = (vars) => vars.forEach((v, i) => { v.var_ordre = i + 1; });
    return {
      modifier: (id, champ, valeur) => {
        const v = valeur.trim();
        if (champ === 'var_nom' && !RE_NOM.test(v)) { this.message?.('Nom de variable invalide (lettres, chiffres, _)'); return false; }
        if (champ === 'var_formule' && !v) { this.message?.('Formule obligatoire'); return false; }
        m().modifier((d) => { d.variables.find((x) => x.var_id === id)[champ] = v; }, 'Variable');
        return true;
      },
      inserer: (position, refId, { memeType = false } = {}) => {
        const id = m().prochainId();
        const nom = this.nomLibre();
        m().modifier((d) => {
          const vars = liste(d);
          const ref = vars.find((v) => v.var_id === refId);
          const nouvelle = {
            var_id: id, var_ent_id: d.document.ent_id, var_lig_id: this.ligId, var_mtr_id: this.mtrId,
            var_portee: ref?.var_portee ?? '@', var_nom: nom, var_operation: memeType && ref ? ref.var_operation : '=',
            var_formule: '0', var_ordre: 0,
          };
          d.variables.push(nouvelle);
          const i = ref ? vars.indexOf(ref) + (position === 'avant' ? 0 : 1) : vars.length;
          vars.splice(i, 0, d.variables.at(-1));
          renumeroter(vars);
        }, 'Nouvelle variable');
        return id;
      },
      deplacer: (ids, cibleId, position) => m().modifier((d) => {
        const vars = liste(d);
        const deplacees = vars.filter((v) => ids.includes(v.var_id));
        const reste = vars.filter((v) => !ids.includes(v.var_id));
        const i = reste.findIndex((v) => v.var_id === cibleId);
        reste.splice(i < 0 ? reste.length : i + (position === 'avant' ? 0 : 1), 0, ...deplacees);
        renumeroter(reste);
      }, 'Ordre des variables'),
      decaler: (id, sens) => m().modifier((d) => {
        const vars = liste(d);
        const i = vars.findIndex((v) => v.var_id === id);
        const j = i + sens;
        if (i < 0 || j < 0 || j >= vars.length) return;
        [vars[i], vars[j]] = [vars[j], vars[i]];
        renumeroter(vars);
      }, 'Ordre des variables'),
      supprimer: (ids) => m().modifier((d) => {
        d.variables = d.variables.filter((v) => !ids.includes(v.var_id));
        renumeroter(liste(d));
      }, 'Suppression de variable'),
      dupliquer: (ids) => {
        for (const id of ids) {
          const source = this.saisie.variables.find((v) => v.var_id === id);
          const nouveau = this.actionsVariables().inserer('apres', id);
          m().modifier((d) => {
            const v = d.variables.find((x) => x.var_id === nouveau);
            Object.assign(v, { var_portee: source.var_portee, var_operation: source.var_operation, var_formule: source.var_formule });
          }, 'Dupliquer');
        }
      },
      indenter: () => {},
      desindenter: () => {},
      annuler: () => m().annuler(),
      retablir: () => m().retablir(),
      depotAutorise: (ids, cibleId, position) => position !== 'enfant' && !ids.includes(cibleId),
      classeLigne: (r) => (r.calcule.var_valeur === null || r.calcule.var_valeur === undefined ? 'avertissement' : ''),
      titreLigne: (r) => (r.calcule.var_valeur === null || r.calcule.var_valeur === undefined ? 'Non calculée : voir le message du métré' : ''),
    };
  }

  // ---------------------------------------------------------------- onglet Lignes

  lignes(replies) {
    if (this.mtrId === null) return [];
    const items = this.saisie.metre_lignes.filter((x) => x.mli_mtr_id === this.mtrId);
    const calc = new Map(this.editeur.resultat.metre_lignes.map((x) => [x.mli_id, x]));
    const parents = new Set(items.map((x) => x.mli_parent_id).filter((p) => p !== null));
    return ordreAffichage(M, items, replies).map(({ item, profondeur }) => ({
      item, calcule: calc.get(item.mli_id) ?? item, profondeur, aEnfants: parents.has(item.mli_id),
    }));
  }

  colonnesLignes() {
    const texte = (champ) => ({ editeur: 'texte', champ: () => champ, lire: (x) => x[champ] ?? '' });
    return [
      { cle: 'type', titre: 'Type', arbre: true, editeur: 'select', editable: () => true, options: () => TYPES,
        champ: () => 'mli_type', lire: (x) => x.mli_type, valeur: (r) => TYPES.find((t) => t.valeur === r.item.mli_type)?.libelle },
      { cle: 'op', titre: 'Opérateur', classe: 'col-op', editeur: 'select', editable: (x) => x.mli_type !== 'S', options: () => OPERATEURS,
        champ: () => 'mli_operateur', lire: (x) => x.mli_operateur ?? '+',
        valeur: (r) => (r.item.mli_type === 'S' ? '' : OPERATEURS.find((o) => o.valeur === (r.item.mli_operateur ?? '+'))?.libelle) },
      { cle: 'formule', titre: 'Formule', classe: 'col-formule', editeur: 'formule', champ: () => 'mli_formule', lire: (x) => x.mli_formule ?? '',
        editable: (x) => x.mli_type === 'V', suggestions: () => this.entreesDictionnaire(false),
        valeur: (r) => (r.item.mli_type === 'D' ? 'Sous-détail' : r.item.mli_type === 'S' ? (r.item.mli_st_depuis_id ? 'Depuis le sous-total pointé' : 'Depuis le début') : r.item.mli_formule ?? '') },
      { cle: 'valeur', titre: 'Valeur', classe: 'col-nombre', editable: () => false, valeur: (r) => formatLibre(r.calcule.mli_valeur) },
      { cle: 'commentaire', titre: 'Commentaire', classe: 'col-libelle', ...texte('mli_commentaire'), editable: () => true, valeur: (r) => r.item.mli_commentaire ?? '' },
      // La valeur de la ligne (valeur, sous-détail ou sous-total) peut être affectée à une variable, ex. @lineaire.
      { cle: 'variable', titre: 'Affecter à', ...texte('mli_variable'), editable: () => true, valeur: (r) => r.item.mli_variable ?? '' },
    ];
  }

  actionsLignes() {
    const m = () => this.editeur.magasin;
    const items = (d) => d.metre_lignes.filter((x) => x.mli_mtr_id === this.mtrId);
    // Tab sous une valeur sans formule la transforme en sous-détail.
    const accepte = (x) => x.mli_type === 'D' || (x.mli_type === 'V' && !x.mli_formule && ((x.mli_type = 'D'), true));
    return {
      modifier: (id, champ, valeur) => {
        if (champ === 'mli_variable' && valeur.trim() && !/^(\$\$|\$|@@|@)[\p{L}_][\p{L}\p{N}_]*$/u.test(valeur.trim())) {
          this.message?.('Variable cible invalide : @nom, @@nom, $nom ou $$nom');
          return false;
        }
        m().modifier((d) => {
          const x = d.metre_lignes.find((y) => y.mli_id === id);
          x[champ] = valeur.trim() === '' ? null : valeur.trim();
          if (champ === 'mli_type' && valeur !== 'S') x.mli_st_depuis_id = null;
        }, 'Ligne de métré');
        return true;
      },
      inserer: (position, refId, { memeType = false } = {}) => {
        const id = m().prochainId();
        m().modifier((d) => {
          const liste = items(d);
          const ref = liste.find((x) => x.mli_id === refId);
          const pos = position === 'enfant' && ref?.mli_type !== 'D' ? 'apres' : position;
          d.metre_lignes.push({ mli_id: id, mli_mtr_id: this.mtrId, mli_parent_id: null, mli_ordre: 0,
            mli_type: memeType && ref ? ref.mli_type : 'V', mli_operateur: '+', mli_formule: null, mli_commentaire: null });
          placer(M, [...liste, d.metre_lignes.at(-1)], [d.metre_lignes.at(-1)], ref ? refId : null, ref ? pos : 'racine');
        }, 'Ligne de métré');
        return id;
      },
      deplacer: (ids, cibleId, position) => m().modifier((d) => {
        const liste = items(d);
        placer(M, liste, racinesSelection(M, liste, ids), cibleId, position);
      }, 'Déplacement'),
      indenter: (ids) => m().modifier((d) => {
        const liste = items(d);
        for (const r of racinesSelection(M, liste, ids)) indenter(M, liste, r.mli_id, accepte);
      }, 'Niveau'),
      desindenter: (ids) => m().modifier((d) => {
        const liste = items(d);
        for (const r of racinesSelection(M, liste, ids).reverse()) desindenter(M, liste, r.mli_id);
      }, 'Niveau'),
      decaler: (id, sens) => m().modifier((d) => { decaler(M, items(d), id, sens); }, 'Ordre'),
      supprimer: (ids) => m().modifier((d) => {
        const liste = items(d);
        const aSupprimer = new Set(ids);
        for (const id of ids) for (const x of descendants(M, liste, id)) aSupprimer.add(x);
        d.metre_lignes = d.metre_lignes.filter((x) => !aSupprimer.has(x.mli_id));
        const restantes = items(d);
        for (const p of new Set(restantes.map((x) => x.mli_parent_id))) enfants(M, restantes, p).forEach((x, i) => { x.mli_ordre = i + 1; });
      }, 'Suppression'),
      dupliquer: () => {},
      annuler: () => m().annuler(),
      retablir: () => m().retablir(),
      depotAutorise: (ids, cibleId, position) => {
        const liste = items(this.saisie);
        const cible = liste.find((x) => x.mli_id === cibleId);
        if (!cible) return false;
        if (ids.some((id) => id === cibleId || descendants(M, liste, id).has(cibleId))) return false;
        return position !== 'enfant' || cible.mli_type === 'D';
      },
      classeLigne: (r) => `metre-${r.item.mli_type}`,
    };
  }
}
