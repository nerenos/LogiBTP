import { GrilleArbre, formatLibre, echapper } from '@logibtp/socle/ui';
import { analyserScript } from '../src/script/analyseur.js';
import { modifierDeclaration, litteral } from '../src/script/edition.js';
import { FONCTIONS } from '../src/script/fonctions.js';
import { DictionnaireMetre } from './dictionnaire.js';
import { EditeurScript, STRUCTURES, modeleFonction } from './editeur-script.js';

const PORTEES = [
  { valeur: '@', libelle: '@ ligne' }, { valeur: '@@', libelle: '@@ ouvrage' },
  { valeur: '$', libelle: '$ titre' }, { valeur: '$$', libelle: '$$ document' },
];
const OPERATIONS = [{ valeur: '=', libelle: '= affecter' }, { valeur: '+=', libelle: '+= incrémenter' }];
const RE_NOM = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const TYPES = { N: 'numérique', C: 'chaîne', B: 'booléen' };
const ATTENTE_SAISIE = 300;
const RE_NOMBRE = /^-?\d+([.,]\d+)?$/;

/** Valeur affichée : nombre mis en forme ; texte (chaîne, Vrai / Faux, —) tel quel. */
const afficher = (v) => (v === null || v === undefined || v === '' ? '—'
  : typeof v === 'number' || RE_NOMBRE.test(String(v)) ? formatLibre(v) : String(v));

/**
 * Panneau de métré (classe mère) : métré de la ligne sélectionnée dans l'hôte (le panneau suit la sélection).
 * Éditeur de code (EditeurScript : coloration, complétion, erreurs soulignées), variables non locales (les paramètres
 * — déclarés et jamais réaffectés — sont modifiables : la valeur par défaut est réécrite dans le script), erreurs et
 * avertissements (clic : position dans le script). Une ligne sans métré ferme le panneau ; une section du document
 * présente les variables du document ($$). Dictionnaire en arbre repliable : variables et données (par groupe :
 * variables, ligne, entête…), fonctions, structures du langage ; un clic les insère dans le script (fonctions et
 * structures : modèles à compléter, Tab : champ suivant).
 * Une pause de saisie = une étape de la pile d'annulation de l'hôte ; l'éditeur garde sa propre annulation de frappe.
 *
 * Interface de l'hôte (`hote`) :
 *   magasin, saisie, resultat   état partagé : saisie.metres, saisie.variables, saisie.document.ent_id ;
 *                               resultat.metres, variables, erreurs, scripts ([{ mtr_id, erreurs, avertissements }])
 *   titreLigne(ligId)           titre affiché dans l'entête du panneau
 *   metreDeLigne(ligId)         ID du métré de la ligne, ou null
 *   peutAvoirMetre(ligId)       la ligne accepte-t-elle un métré ?
 *   creerMetre(ligId)           crée le métré de la ligne (une étape d'annulation) et l'ouvre
 *   variablesDocumentSur(ligId) facultatif : la ligne (section du document) présente les variables du document ($$,
 *                               sans ligne ni métré) au lieu d'un métré
 * Options : fermer(ligId), message(texte), dictionnaire (instance de DictionnaireMetre ou dérivée), fonctions (fonctions
 * propres à l'hôte, les mêmes que celles passées au moteur : complétion, dictionnaire et contrôle de l'éditeur ; par
 * défaut `dictionnaire.fonctions()`).
 */
export class PanneauMetre {
  constructor(racine, hote, { fermer, message, dictionnaire, fonctions } = {}) {
    this.racine = racine;
    this.hote = hote;
    this.dictionnaire = dictionnaire ?? new DictionnaireMetre(hote);
    this.fonctionsHote = fonctions ?? this.dictionnaire.fonctions?.() ?? {};
    this.fermerExterne = fermer;
    this.message = message;
    this.mtrId = null;
    this.ligId = null;
    this.minuterie = null;
    racine.innerHTML = `
      <header class="metre-entete">
        <h2>Métré <span class="metre-titre"></span></h2>
        <div class="metre-resultat"></div>
        <button class="principal" data-action="valider" title="Revenir à la ligne avec la quantité calculée (Échap)">Valider</button>
      </header>
      <div class="metre-corps">
        <div class="metre-principal">
          <section class="metre-vide" hidden></section>
          <section class="metre-script">
            <div class="metre-editeur" aria-label="Script du métré"></div>
            <div class="metre-messages"></div>
            <h3>Variables du métré</h3>
            <div class="metre-variables-script"></div>
          </section>
          <section class="metre-variables-document" hidden>
            <h3>Variables du document ($$) : évaluées avant toutes les lignes</h3>
            <div class="metre-variables"></div>
            <button data-action="ajouter-variable">Ajouter une variable</button>
          </section>
        </div>
        <aside class="dictionnaire">
          <h3>Dictionnaire</h3>
          <input type="search" placeholder="Filtrer…" data-filtre>
          <div class="dictionnaire-liste"></div>
          <p class="aide">Clic : insérer dans le script à la position du curseur (Tab : champ suivant d'un modèle).</p>
        </aside>
      </div>
      <p class="aide metre-aide">Script : déclarations en tête (<code>Largeur est un numérique = 1.2</code>, <code>local</code> : interne),
        instructions, <code>Renvoyer</code> = quantité de la ligne · Ctrl+Espace : complétion · Ctrl+/ : commentaire ·
        Tab : indentation · Échap : revenir au devis</p>`;
    racine.querySelector('[data-action="valider"]').addEventListener('click', () => this.fermer());
    racine.querySelector('[data-action="ajouter-variable"]').addEventListener('click', () => {
      const id = this.actionsVariables().inserer('apres', this.grilleVariables.courant);
      this.grilleVariables.selectionner(id, { colonne: 0 });
      this.grilleVariables.editer(1);
    });
    racine.querySelector('[data-filtre]').addEventListener('input', () => this.rendreDictionnaire());

    this.ouverts = new Set(['variables', 'g:Variables', 'g:Ligne']);
    const zoneEditeur = racine.querySelector('.metre-editeur');
    this.editeur = new EditeurScript(zoneEditeur, {
      surChangement: () => this.planifierEnregistrement(),
      surEchap: () => this.fermer(),
      dictionnaire: () => (this.ligId === null ? [] : this.entreesDictionnaire()),
      fonctions: () => this.fonctionsHote,
      // Erreurs d'exécution : seulement pour le texte que le moteur a calculé.
      diagnostics: (texte) => (texte === (this.metre()?.mtr_script ?? '') ? this.diagnostic() : null),
    });
    zoneEditeur.addEventListener('focusout', (e) => { if (!zoneEditeur.contains(e.relatedTarget)) this.enregistrerScript(); });

    this.grilleVariables = new GrilleArbre(racine.querySelector('.metre-variables'), {
      cle: 'var_id', colonnes: this.colonnesVariables(), lignes: () => this.variables(), actions: this.actionsVariables(),
    });
    this.grilleVariables.conteneur.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.grilleVariables.edition) this.fermer(); });
    hote.magasin.abonner(() => { if (!this.racine.hidden) this.rendre(); });
  }

  get saisie() { return this.hote.saisie; }

  /** Variables du document présentées sur la ligne (section) au lieu d'un métré. */
  get modeDocument() { return this.ligId !== null && !!this.hote.variablesDocumentSur?.(this.ligId); }

  metre() { return this.saisie.metres.find((m) => m.mtr_id === this.mtrId) ?? null; }

  /** Ouvre le métré ; `position` { ligne, colonne } : curseur placé dans le script (erreur choisie…). */
  ouvrir(ligId, mtrId, position = null) {
    this.enregistrerScript();
    this.ligId = ligId;
    this.mtrId = mtrId;
    this.racine.hidden = false;
    this.rendre();
    // Focus après l'événement qui ouvre le panneau (F4 dans la grille : la grille reprendrait le focus).
    setTimeout(() => {
      if (this.racine.hidden) return;
      if (this.modeDocument) this.grilleVariables.focus();
      else if (position && this.metre()) this.editeur.allerA(position.ligne, position.colonne);
      else if (this.metre()) this.editeur.focus();
    });
  }

  /** Le panneau suit la ligne sélectionnée dans le devis ; une ligne sans métré (hors section) le ferme. */
  suivre(ligId) {
    if (this.racine.hidden || ligId === this.ligId) return;
    this.enregistrerScript();
    this.ligId = ligId;
    this.mtrId = ligId === null ? null : this.hote.metreDeLigne(ligId);
    this.grilleVariables.courant = null;
    if (this.mtrId === null && !this.modeDocument) {
      this.racine.hidden = true;
      return;
    }
    this.rendre();
  }

  fermer() {
    this.enregistrerScript();
    this.racine.hidden = true;
    this.fermerExterne?.(this.ligId);
  }

  rendre() {
    if (this.modeDocument) { this.rendreVariablesDocument(); return; }
    this.racine.classList.remove('metre-mode-document');
    const m = this.metre();
    this.racine.querySelector('.metre-titre').textContent = this.ligId === null ? '' : this.hote.titreLigne(this.ligId);
    const vide = this.racine.querySelector('.metre-vide');
    vide.hidden = !!m;
    this.racine.querySelector('.metre-script').hidden = !m;
    this.racine.querySelector('.metre-variables-document').hidden = true;
    this.rendreDictionnaire();
    if (!m) {
      this.racine.querySelector('.metre-resultat').textContent = '';
      const possible = this.ligId !== null && this.hote.peutAvoirMetre(this.ligId);
      vide.innerHTML = possible
        ? '<p>Cette ligne n\'a pas de métré.</p><button class="principal" data-action="creer">Créer le métré</button>'
        : `<p>${echapper(this.aideSansMetre())}</p>`;
      vide.querySelector('[data-action="creer"]')?.addEventListener('click', () => this.hote.creerMetre(this.ligId));
      return;
    }
    const calc = this.hote.resultat.metres.find((x) => x.mtr_id === this.mtrId);
    const diagnostic = this.diagnostic();
    this.racine.querySelector('.metre-resultat').innerHTML = diagnostic.erreurs.length
      ? `<span class="erreur">${diagnostic.erreurs.length} erreur(s)</span>`
      : calc?.mtr_resultat === null || calc?.mtr_resultat === undefined
        ? '<span class="avertissement">Pas de quantité (« Renvoyer » absent)</span>'
        : `Résultat : <strong>${formatLibre(calc.mtr_resultat)}</strong> ${echapper(m.mtr_unt_code ?? '')}`;
    this.rendreScript(m, diagnostic);
  }

  /** Section du document : variables du document ($$) au lieu d'un métré. */
  rendreVariablesDocument() {
    this.racine.classList.add('metre-mode-document');
    this.racine.querySelector('.metre-titre').textContent = `${this.hote.titreLigne(this.ligId)} · variables du document`;
    this.racine.querySelector('.metre-vide').hidden = true;
    this.racine.querySelector('.metre-script').hidden = true;
    this.racine.querySelector('.metre-variables-document').hidden = false;
    this.racine.querySelector('.metre-resultat').textContent = '';
    this.rendreDictionnaire();
    this.grilleVariables.rendre();
  }

  /** Message quand la ligne sélectionnée ne peut pas porter de métré. */
  aideSansMetre() { return 'Sélectionnez une ligne qui accepte un métré.'; }

  /** Exécution du script par le moteur : { erreurs, avertissements } (positionnés dans le script). */
  diagnostic() {
    const d = (this.hote.resultat.scripts ?? []).find((s) => s.mtr_id === this.mtrId);
    return { erreurs: d?.erreurs ?? [], avertissements: d?.avertissements ?? [] };
  }

  // ---------------------------------------------------------------- script

  rendreScript(m, diagnostic) {
    // Texte de l'hôte (annulation, grille des variables, autre ligne) ; jamais pendant une saisie en attente.
    if (this.minuterie === null) this.editeur.remplacer(m.mtr_script ?? '');
    this.editeur.rafraichirDiagnostics();
    const messages = [
      ...diagnostic.erreurs.map((e) => ({ ...e, classe: 'erreur' })),
      ...diagnostic.avertissements.map((a) => ({ ...a, classe: 'avertissement' })),
    ];
    const zone = this.racine.querySelector('.metre-messages');
    zone.innerHTML = messages.map((x, i) => `<button type="button" class="${x.classe}" data-message="${i}">
      ${x.ligne ? `<code>${x.ligne}:${x.colonne}</code> ` : ''}${echapper(x.message)}</button>`).join('');
    zone.querySelectorAll('[data-message]').forEach((b) => b.addEventListener('click', () => {
      const x = messages[Number(b.dataset.message)];
      if (x.ligne) this.allerA(x.ligne, x.colonne);
    }));
    this.rendreVariablesScript(m);
  }

  /** Place le curseur dans le script (ligne et colonne à partir de 1). */
  allerA(ligne, colonne) {
    this.editeur.allerA(ligne, colonne);
  }

  /** Variables non locales : paramètres modifiables (valeur par défaut réécrite dans le script), autres en lecture. */
  rendreVariablesScript(m) {
    const zone = this.racine.querySelector('.metre-variables-script');
    if (zone.contains(document.activeElement)) return;
    const declarations = analyserScript(m.mtr_script ?? '').declarations.filter((d) => !d.local && !d.implicite);
    const calcul = new Map((this.hote.resultat.variables ?? []).filter((v) => v.var_mtr_id === this.mtrId).map((v) => [v.var_nom, v]));
    // Valeur calculée ; sans calcul (script en erreur), la valeur par défaut déclarée d'un paramètre.
    const valeur = (d) => {
      const v = calcul.get(d.nom);
      const calculee = !v ? null : d.type === 'N' ? v.var_valeur : v.var_valeur_texte;
      if (calculee !== null && calculee !== undefined) return calculee;
      const defaut = d.parametre ? d.defaut?.texte ?? '' : '';
      return d.type === 'C' ? defaut.replace(/^"(.*)"$/s, '$1').replaceAll('""', '"') : defaut;
    };
    zone.innerHTML = declarations.length ? `<table class="metre-table-variables"><thead><tr><th>Nom</th><th>Type</th><th>Valeur</th></tr></thead><tbody>
      ${declarations.map((d) => `<tr><td><code>${echapper(d.nom)}</code></td><td>${TYPES[d.type]}</td><td>${d.parametre
        ? `<input data-variable="${echapper(d.nom)}" data-type="${d.type}" value="${echapper(valeur(d) === '' ? '' : afficher(valeur(d)))}" title="Paramètre : la valeur par défaut est réécrite dans le script">`
        : `<span title="Calculée par le script">${echapper(afficher(valeur(d)))}</span>`}</td></tr>`).join('')}
      </tbody></table>` : '<p class="aide">Aucune variable non locale déclarée.</p>';
    zone.querySelectorAll('[data-variable]').forEach((i) => i.addEventListener('change', () => {
      const texte = modifierDeclaration(this.metre().mtr_script ?? '', i.dataset.variable, litteral(i.value, i.dataset.type));
      this.editeur.remplacer(texte);
      this.enregistrerScript();
    }));
  }

  planifierEnregistrement() {
    clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => this.enregistrerScript(), ATTENTE_SAISIE);
  }

  /** Une pause de saisie (ou la sortie du script) = une étape d'annulation. */
  enregistrerScript() {
    clearTimeout(this.minuterie);
    this.minuterie = null;
    const m = this.metre();
    const texte = this.editeur.valeur;
    if (!m || this.modeDocument || texte === (m.mtr_script ?? '')) return;
    this.hote.magasin.modifier((d) => { d.metres.find((x) => x.mtr_id === m.mtr_id).mtr_script = texte; }, 'Script du métré');
  }

  // ---------------------------------------------------------------- dictionnaire

  entreesDictionnaire() {
    return this.dictionnaire.entrees(this.ligId, { pourDefinition: this.modeDocument });
  }

  /** Fonctions proposées : celles du langage (l'hôte peut surcharger pour ajouter les siennes). */
  fonctions() { return { ...FONCTIONS, ...this.fonctionsHote }; }

  /**
   * Dictionnaire en groupes repliables : variables et données (avec valeurs), fonctions (signature, description),
   * structures du langage. Fonctions et structures seulement pour un script (pas pour les variables du document).
   */
  rendreDictionnaire() {
    const zone = this.racine.querySelector('.dictionnaire-liste');
    const filtre = this.racine.querySelector('[data-filtre]').value.trim().toLowerCase();
    const garde = (...textes) => !filtre || textes.some((x) => (x ?? '').toLowerCase().includes(filtre));
    const entrees = this.ligId === null ? [] : this.entreesDictionnaire().filter((e) => garde(e.valeur, e.libelle));
    const section = (cle, titre, contenu) => `<details data-groupe="${cle}"${this.ouverts.has(cle) || filtre ? ' open' : ''}>
      <summary>${echapper(titre)}</summary>${contenu}</details>`;
    // Variables et données : une branche repliable par groupe (Variables, Ligne, Entête…), dans l'ordre des entrées.
    const groupes = [...new Set(entrees.map((e) => e.groupe))];
    const variables = groupes.map((g) => section(`g:${g}`, g, entrees.filter((e) => e.groupe === g).map((e) => `
      <button type="button" data-ref="${echapper(e.valeur)}" title="${echapper(e.libelle)}">
        <code>${echapper(e.valeur)}</code><span>${echapper(afficher(e.detail))}</span></button>`).join(''))).join('')
      || '<p class="aide">Aucune variable définie avant cette ligne.</p>';
    const script = !this.modeDocument && this.metre();
    const fonctions = Object.values(this.fonctions()).filter((f) => garde(f.signature, f.description));
    const structures = STRUCTURES.filter((s) => garde(s.libelle, s.modele));
    zone.innerHTML = section('variables', 'Variables et données', `<div class="branches">${variables}</div>`) + (script ? section('fonctions', 'Fonctions',
      fonctions.map((f, i) => `<button type="button" data-fonction="${i}" title="${echapper(f.description)}"><code>${echapper(f.signature)}</code></button>`).join(''))
      + section('structures', 'Structures', structures.map((s, i) => `<button type="button" data-structure="${i}" title="${echapper(s.modele.replaceAll('${', '').replaceAll('}', ''))}"><span>${echapper(s.libelle)}</span></button>`).join('')) : '');
    zone.querySelectorAll('details').forEach((d) => d.addEventListener('toggle', (e) => {
      e.stopPropagation();
      if (filtre) return; // filtre en cours : tout est déplié, l'état choisi est gardé
      if (d.open) this.ouverts.add(d.dataset.groupe);
      else this.ouverts.delete(d.dataset.groupe);
    }));
    zone.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault())); // le script garde le focus
    zone.querySelectorAll('[data-ref]').forEach((b) => b.addEventListener('click', () => this.insererReference(b.dataset.ref)));
    zone.querySelectorAll('[data-fonction]').forEach((b) => b.addEventListener('click', () => this.editeur.insererModele(modeleFonction(fonctions[Number(b.dataset.fonction)]))));
    zone.querySelectorAll('[data-structure]').forEach((b) => b.addEventListener('click', () => this.editeur.insererModele(structures[Number(b.dataset.structure)].modele)));
  }

  /** Insère la référence dans le script à la position du curseur (variables du document : formule en saisie). */
  insererReference(ref) {
    if (!this.modeDocument && this.metre()) {
      this.editeur.inserer(ref);
      return;
    }
    const g = this.grilleVariables;
    if (!g.insererReference(ref, g.courant !== null ? 3 : undefined)) {
      navigator.clipboard?.writeText(ref).catch(() => {});
      this.message?.(`${ref} copié : sélectionnez une ligne pour l'insérer`);
    }
  }

  // ---------------------------------------------------------------- variables du document (section)

  variableAffichee(v) {
    return (v.var_lig_id === null || v.var_lig_id === undefined) && (v.var_mtr_id === null || v.var_mtr_id === undefined);
  }

  variables() {
    const calc = new Map(this.hote.resultat.variables.map((v) => [v.var_id, v]));
    return this.saisie.variables
      .filter((v) => this.variableAffichee(v))
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
        suggestions: () => this.entreesDictionnaire() },
      { cle: 'valeur', titre: 'Valeur', classe: 'col-nombre', editable: () => false,
        valeur: (r) => (r.calcule.var_valeur === null || r.calcule.var_valeur === undefined ? '—' : formatLibre(r.calcule.var_valeur)) },
    ];
  }

  /** Nom libre : variable1, variable2… */
  nomLibre() {
    const noms = new Set(this.saisie.variables.map((v) => v.var_nom));
    let n = 1;
    while (noms.has(`variable${n}`)) n++;
    return `variable${n}`;
  }

  actionsVariables() {
    const m = () => this.hote.magasin;
    const liste = (d) => d.variables.filter((v) => this.variableAffichee(v)).sort((a, b) => (a.var_ordre - b.var_ordre) || (a.var_id - b.var_id));
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
          d.variables.push({
            var_id: id, var_ent_id: d.document.ent_id, var_lig_id: null, var_mtr_id: null,
            var_portee: ref?.var_portee ?? '$$', var_nom: nom, var_operation: memeType && ref ? ref.var_operation : '=',
            var_formule: '0', var_ordre: 0,
          });
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
      titreLigne: (r) => (r.calcule.var_valeur === null || r.calcule.var_valeur === undefined ? 'Non calculée : voir les messages du document' : ''),
    };
  }
}
