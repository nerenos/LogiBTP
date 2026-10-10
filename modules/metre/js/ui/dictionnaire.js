// Dictionnaire des variables et données utilisables dans une formule de métré (classe mère).
// Le module ne connaît pas son hôte : la règle de visibilité d'une variable (accessible) et les données
// proposées (donnees) sont des points de spécialisation. Par défaut toutes les variables sont visibles.

const PORTEES = { '$$': 'document', '$': 'titre', '@@': 'ouvrage', '@': 'ligne' };

export class DictionnaireMetre {
  /** `hote` : { saisie, resultat } avec metres, metre_lignes et variables. */
  constructor(hote) {
    this.hote = hote;
  }

  /** La variable `portee` définie sur `proprietaireId` (ligne de l'hôte, null = document) est-elle lisible depuis `ligId` ? */
  accessible(_portee, _proprietaireId, _ligId) { return true; }

  /** Données de l'hôte proposées : [{ valeur: '{{ref}}', libelle, detail, groupe }]. */
  donnees(_ligId, _options) { return []; }

  /**
   * Entrées du dictionnaire pour une ligne : [{ valeur: '{{ref}}', libelle, detail, groupe }].
   * `pourDefinition` : formules de l'onglet Définition (évaluées après la quantité de la ligne).
   */
  entrees(ligId, options = {}) {
    const { saisie, resultat: res } = this.hote;
    const valeursVar = new Map(res.variables.map((v) => [v.var_id, v.var_valeur]));
    const metresCalc = new Map(res.metres.map((m) => [m.mtr_id, m]));
    const mliCalc = new Map(res.metre_lignes.map((m) => [m.mli_id, m]));
    const vus = new Map();
    const ajouter = (cible, proprietaireId, valeur, source) => {
      const m = /^(\$\$|\$|@@|@)(.+)$/.exec((cible ?? '').trim());
      if (!m || !this.accessible(m[1], proprietaireId ?? null, ligId)) return;
      vus.set(`${m[1]}${m[2]}`, { valeur, source, portee: m[1] });
    };
    for (const v of saisie.variables) ajouter(`${v.var_portee}${v.var_nom}`, v.var_lig_id, valeursVar.get(v.var_id), v.var_lig_id ? 'variable de ligne' : 'variable du document');
    for (const m of saisie.metres) if (m.mtr_variable) ajouter(m.mtr_variable, m.mtr_lig_id, metresCalc.get(m.mtr_id)?.mtr_resultat, 'résultat de métré');
    for (const x of saisie.metre_lignes) {
      if (!x.mli_variable) continue;
      const m = saisie.metres.find((y) => y.mtr_id === x.mli_mtr_id);
      ajouter(x.mli_variable, m?.mtr_lig_id, mliCalc.get(x.mli_id)?.mli_valeur, 'ligne de métré');
    }
    const entrees = [...vus].sort(([a], [b]) => a.localeCompare(b)).map(([ref, v]) => ({
      valeur: `{{${ref}}}`, libelle: `${PORTEES[v.portee]} · ${v.source}`, detail: v.valeur ?? '—', groupe: 'Variables',
    }));
    return [...entrees, ...this.donnees(ligId, options)];
  }
}
