import { texte, texteHtml, iconeHtml } from '../dictionnaire/index.js';

/** Sépare un texte saisi ou collé en jetons (virgule, point-virgule ou saut de ligne), espaces retirés, vides ignorés. */
export function decouperJetons(saisie) {
  return String(saisie ?? '').split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean);
}

/** Ajoute les jetons du texte à la liste, doublons ignorés (casse comprise). Rend une nouvelle liste. */
export function ajouterJetons(liste, saisie) {
  const suite = [...liste];
  for (const j of decouperJetons(saisie)) if (!suite.includes(j)) suite.push(j);
  return suite;
}

/** Liste sans le jeton donné. */
export function retirerJeton(liste, jeton) {
  return liste.filter((j) => j !== jeton);
}

/**
 * Saisie de mots-clés en jetons : la valeur est un tableau de textes. Ajout par Entrée ou virgule (ou collage
 * « a, b »), retrait par la croix ou Retour arrière sur saisie vide ; la saisie en cours est ajoutée à la sortie du
 * champ. Doublons ignorés. Rend l'élément ; `valeurJetons` (lecture) et `definirValeur(tableau)` (sans événement) ;
 * événement `change` à chaque modification de la valeur.
 */
export function creerJetons({ valeur = [], titre = '' } = {}) {
  let jetons = ajouterJetons([], Array.isArray(valeur) ? valeur.join(',') : valeur);
  const racine = document.createElement('div');
  racine.className = 'jetons';
  if (titre) racine.title = titre;
  const saisie = document.createElement('input');
  saisie.type = 'text';
  saisie.autocomplete = 'off';
  saisie.className = 'jetons-saisie';
  if (titre) saisie.setAttribute('aria-label', titre);
  const dessiner = () => {
    racine.querySelectorAll('.jeton').forEach((n) => n.remove());
    for (const j of jetons) {
      const puce = document.createElement('span');
      puce.className = 'jeton';
      const lib = document.createElement('span');
      lib.textContent = j;
      const croix = document.createElement('button');
      croix.type = 'button';
      croix.className = 'jeton-retirer';
      croix.title = texte('socle.jetons.retirer', { jeton: j });
      croix.setAttribute('aria-label', croix.title);
      croix.innerHTML = iconeHtml('retirer');
      croix.addEventListener('click', () => { modifier(retirerJeton(jetons, j)); saisie.focus(); });
      puce.append(lib, croix);
      racine.insertBefore(puce, saisie);
    }
  };
  const modifier = (suite) => {
    const change = suite.length !== jetons.length;
    jetons = suite;
    dessiner();
    if (change) racine.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const valider = () => {
    const suite = ajouterJetons(jetons, saisie.value);
    saisie.value = '';
    modifier(suite);
  };
  saisie.placeholder = texte('socle.jetons.saisie');
  saisie.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); valider(); }
    else if (e.key === 'Backspace' && saisie.value === '' && jetons.length) modifier(jetons.slice(0, -1));
  });
  saisie.addEventListener('input', () => { if (/[,;\n]/.test(saisie.value)) valider(); });
  saisie.addEventListener('blur', valider);
  racine.addEventListener('click', (e) => { if (e.target === racine) saisie.focus(); });
  racine.append(saisie);
  Object.defineProperty(racine, 'valeurJetons', { get: () => [...jetons] });
  racine.definirValeur = (v) => { jetons = ajouterJetons([], Array.isArray(v) ? v.join(',') : v); dessiner(); };
  dessiner();
  return racine;
}
