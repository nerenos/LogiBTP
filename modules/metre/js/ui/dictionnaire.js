// Dictionnaire des variables et données utilisables dans une formule de métré (classe mère).
// Le module ne connaît pas son hôte : la règle de visibilité d'une variable (accessible) et les données
// proposées (donnees) sont des points de spécialisation. Par défaut toutes les variables sont visibles.

import { texte, pairesParCode } from '@logibtp/socle/dictionnaire';


const PORTEES = pairesParCode('metre.dictionnaire.portees', [['$$', 'document'], ['$', 'titre'], ['@@', 'ouvrage'], ['@', 'ligne']]);
const NOM_PORTEE = (p) => PORTEES.find(([c]) => c === p)?.[1] ?? p;

export class DictionnaireMetre {
  /** `hote` : { saisie, resultat } avec metres et variables. */
  constructor(hote) {
    this.hote = hote;
  }

  /** La variable `portee` définie sur `proprietaireId` (ligne de l'hôte, null = document) est-elle lisible depuis `ligId` ? */
  accessible(_portee, _proprietaireId, _ligId) { return true; }

  /** Données de l'hôte proposées : [{ valeur: '{{ref}}', libelle, detail, groupe }]. */
  donnees(_ligId, _options) { return []; }

  /** Fonctions propres à l'hôte (nom normalisé → définition), les mêmes que celles que son moteur passe aux scripts. */
  fonctions() { return {}; }

  /**
   * Entrées du dictionnaire pour une ligne : [{ valeur: '{{ref}}', libelle, detail, groupe }].
   * `pourDefinition` : formules de l'onglet Définition (évaluées après la quantité de la ligne).
   */
  entrees(ligId, options = {}) {
    const { saisie, resultat: res } = this.hote;
    const metresCalc = new Map(res.metres.map((m) => [m.mtr_id, m]));
    const vus = new Map();
    const ajouter = (cible, proprietaireId, valeur, source) => {
      const m = /^(\$\$|\$|@@|@)(.+)$/.exec((cible ?? '').trim());
      if (!m || !this.accessible(m[1], proprietaireId ?? null, ligId)) return;
      vus.set(`${m[1]}${m[2]}`, { valeur, source, portee: m[1] });
    };
    // Variables du résultat : celles de la saisie et celles produites par les scripts des métrés.
    for (const v of res.variables ?? saisie.variables) {
      const source = v.var_mtr_id !== null && v.var_mtr_id !== undefined ? texte('metre.dictionnaire.sources.metre') : v.var_lig_id ? texte('metre.dictionnaire.sources.ligne') : texte('metre.dictionnaire.sources.document');
      const valeur = (v.var_type ?? 'N') === 'N' ? v.var_valeur : v.var_valeur_texte;
      ajouter(`${v.var_portee}${v.var_nom}`, v.var_lig_id, valeur, source);
    }
    for (const m of saisie.metres) if (m.mtr_variable) ajouter(m.mtr_variable, m.mtr_lig_id, metresCalc.get(m.mtr_id)?.mtr_resultat, texte('metre.dictionnaire.sources.resultat'));
    const entrees = [...vus].sort(([a], [b]) => a.localeCompare(b)).map(([ref, v]) => ({
      valeur: `{{${ref}}}`, libelle: texte('metre.dictionnaire.libelle', { portee: NOM_PORTEE(v.portee), source: v.source }), detail: v.valeur ?? '—', groupe: texte('metre.dictionnaire.groupe_variables'),
    }));
    return [...entrees, ...this.donnees(ligId, options)];
  }
}
