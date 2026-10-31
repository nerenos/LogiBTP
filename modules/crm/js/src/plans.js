// Nom des fichiers de plans (suivi des validations) : repère, nom, lot et indice lus dans le nom d'un fichier déposé
// à la création d'un plan ou d'un indice, selon le format global du module (paramètres du CRM).
//
// Format : texte avec des champs entre accolades, séparés par des caractères fixes : {repere}, {nom}, {lot},
// {indice}, {*} (partie ignorée). Exemple : « {repere}_{nom}_{indice} » lit « R01_Plan de masse_B.pdf » en repère R01,
// nom « Plan de masse », indice B. Un indice en fin de format est facultatif (« R01_Plan de masse.pdf » : indice
// vide, le premier) ; il s'écrit en une ou deux lettres majuscules. L'extension est retirée ; les « _ » restants du
// nom deviennent des espaces quand le séparateur n'est pas « _ ».
import { texte } from '@logibtp/socle/dictionnaire';

export const FORMAT_PLAN_DEFAUT = '{repere}_{nom}_{indice}';
export const CHAMPS_FORMAT_PLAN = ['repere', 'nom', 'lot', 'indice', '*'];

const echapperRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Morceaux d'un format : [{ champ }|{ texte }] ; erreur si un champ est inconnu ou si aucun champ n'est présent. */
export function analyserFormatPlan(format) {
  const morceaux = [];
  const re = /\{([^{}]*)\}/g;
  let dernier = 0;
  let m;
  const chaine = String(format ?? '');
  while ((m = re.exec(chaine))) {
    if (m.index > dernier) morceaux.push({ texte: chaine.slice(dernier, m.index) });
    const champ = m[1].trim().toLowerCase();
    if (!CHAMPS_FORMAT_PLAN.includes(champ)) return { erreur: texte('crm.plans.champ_inconnu', { champ: `{${m[1]}}`, champs: CHAMPS_FORMAT_PLAN.map((c) => `{${c}}`).join(', ') }) };
    morceaux.push({ champ });
    dernier = re.lastIndex;
  }
  if (dernier < chaine.length) morceaux.push({ texte: chaine.slice(dernier) });
  if (!morceaux.some((x) => x.champ && x.champ !== '*')) return { erreur: texte('crm.plans.aucun_champ') };
  for (let i = 1; i < morceaux.length; i++) if (morceaux[i].champ && morceaux[i - 1].champ) return { erreur: texte('crm.plans.separateur') };
  return { morceaux };
}

/**
 * Informations d'un nom de fichier : { repere, nom, lot, indice } (chaînes, vides si absentes) ou null si le nom ne
 * suit pas le format (le nom du fichier sans extension devient alors le nom du plan).
 */
export function extraireNomPlan(nomFichier, format = FORMAT_PLAN_DEFAUT) {
  const base = String(nomFichier ?? '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  const { morceaux } = analyserFormatPlan(format);
  const vide = { repere: '', nom: '', lot: '', indice: '' };
  if (!morceaux || !base) return null;
  const champs = [];
  let source = '';
  const fin = morceaux.length - 1;
  // Indice en fin de format (précédé de son séparateur) : facultatif.
  const indiceFinal = morceaux[fin].champ === 'indice' && fin > 0 && morceaux[fin - 1].texte !== undefined;
  morceaux.forEach((x, i) => {
    if (indiceFinal && i >= fin - 1) return;
    if (x.texte !== undefined) source += echapperRegex(x.texte);
    else if (x.champ === 'indice') { champs.push('indice'); source += '([A-Z]{1,2})'; }
    else { champs.push(x.champ); source += '(.+?)'; }
  });
  if (indiceFinal) { champs.push('indice'); source += `(?:${echapperRegex(morceaux[fin - 1].texte)}([A-Z]{1,2}))?`; }
  const m = new RegExp(`^${source}$`).exec(base);
  if (!m) return null;
  const separateurs = morceaux.filter((x) => x.texte !== undefined).map((x) => x.texte);
  const r = { ...vide };
  champs.forEach((c, i) => {
    if (c === '*') return;
    let v = (m[i + 1] ?? '').trim();
    if (c === 'nom' && !separateurs.includes('_')) v = v.replace(/_/g, ' ').trim();
    r[c] = v;
  });
  return r;
}
