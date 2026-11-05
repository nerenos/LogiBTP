import { echapper, creerCombo } from '@logibtp/socle/ui';
import { texteHtml, icone, iconeHtml } from '@logibtp/socle/dictionnaire';

/**
 * Choix multiple : étiquettes des valeurs retenues (✕ pour retirer) et combo d'ajout des options restantes (jamais de
 * <select multiple>). `valeurs` : valeurs retenues, dans l'ordre d'ajout ; aucune : `aucun` (« tous » par défaut).
 */
export function choixMultiple({ options, valeurs = [], titre = 'Ajouter', aucun = 'tous', changer = null }) {
  const racine = document.createElement('div');
  racine.className = 'choix-multiple';
  let retenues = [...valeurs];
  const egal = (a, b) => String(a) === String(b);
  const rendre = () => {
    const restantes = options.filter((o) => !retenues.some((v) => egal(v, o.valeur)));
    racine.innerHTML = `${retenues.length ? retenues.map((v, i) => `<span class="etiquette-choix">${echapper(options.find((o) => egal(o.valeur, v))?.libelle ?? String(v))}<button type="button" data-retirer="${i}" title="${texteHtml('commun.retirer')}" aria-label="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></span>`).join('')
      : `<span class="aide">${echapper(aucun)}</span>`}<span data-ajout></span>`;
    racine.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { retenues.splice(Number(b.dataset.retirer), 1); rendre(); changer?.([...retenues]); }));
    if (!restantes.length) return;
    const combo = creerCombo({ options: restantes, valeur: '', vide: true, titre });
    combo.placeholder = [icone('ajouter'), `${titre.toLowerCase()}…`].filter(Boolean).join(' ');
    combo.addEventListener('change', () => { if (combo.valeurCombo !== '' && !retenues.some((v) => egal(v, combo.valeurCombo))) { retenues.push(combo.valeurCombo); rendre(); changer?.([...retenues]); racine.querySelector('[data-ajout] input')?.focus(); } });
    racine.querySelector('[data-ajout]').append(combo);
  };
  Object.defineProperty(racine, 'valeurs', { get: () => [...retenues] });
  rendre();
  return racine;
}
