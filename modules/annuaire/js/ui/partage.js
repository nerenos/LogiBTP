import { echapper } from '@logibtp/socle/ui';
import { NATURES, texteCoordonnee } from '../src/coordonnees.js';
import { choixAttendu } from './coordonnees.js';
import { dialogue } from './coordonnees.js';

// Choix à l'enregistrement d'une fiche, pour chaque coordonnée partagée modifiée : modification (la coordonnée change
// pour toutes les fiches qui la partagent : correction, déménagement…) ou autre information (nouvelle coordonnée
// propre à cette fiche ; les autres gardent l'ancienne valeur).

/**
 * Coordonnées partagées modifiées sans choix, dans des listes d'usages : [{ liste, index, contexte }].
 * listes : [{ usages, contexte }] (coordonnées de la fiche, de chaque rattachement…).
 */
export function choixRequis(listes) {
  return listes.flatMap(({ usages, contexte }, liste) => (usages ?? []).map((u, index) => ({ u, index, liste, contexte })).filter(({ u }) => choixAttendu(u)));
}

/**
 * Dialogue des choix ; résout avec les choix (MODIFICATION ou AUTRE) dans l'ordre des éléments, ou null (annulé).
 * elements : [{ u (usage modifié), contexte }].
 */
export async function demanderChoix(elements) {
  const fiches = (u) => u.partages.map((p) => echapper(p.libelle)).join(', ');
  const d = dialogue('🔗 Coordonnées partagées modifiées', `
    <p>Ces coordonnées sont aussi utilisées par d'autres fiches. Pour chacune, indiquez s'il s'agit d'une <b>modification</b> (elle change pour
    toutes les fiches) ou d'une <b>autre information</b> (propre à cette fiche, les autres fiches gardent l'ancienne valeur).</p>
    ${elements.map(({ u, contexte }, i) => `<fieldset class="partage-choix">
      <legend>${NATURES.find((n) => n.code === u.nature)?.icone ?? ''} ${echapper(contexte ? `${contexte} – ` : '')}${echapper(NATURES.find((n) => n.code === u.nature)?.un ?? '')}</legend>
      <p class="partage-valeurs"><s>${echapper(texteCoordonnee({ ...u.origine, nature: u.nature }))}</s> → <b>${echapper(texteCoordonnee(u))}</b></p>
      <label><input type="radio" name="choix-${i}" value="MODIFICATION"> ✏️ <b>Modification</b> : correction ou mise à jour pour toutes les fiches
        <small class="aide">(${u.partages.length} autre${u.partages.length > 1 ? 's' : ''} : ${fiches(u)})</small></label>
      <label><input type="radio" name="choix-${i}" value="AUTRE"> ➕ <b>Autre information</b> : propre à cette fiche seulement</label>
    </fieldset>`).join('')}
    <p class="partage-tout"><button type="button" data-tout="MODIFICATION">Tout en modification</button> <button type="button" data-tout="AUTRE">Tout en autre information</button></p>`,
  'Enregistrer', { large: true });
  const ok = d.fond.querySelector('[data-ok]');
  const lire = () => elements.map((_, i) => d.corps.querySelector(`input[name="choix-${i}"]:checked`)?.value ?? null);
  const maj = () => {
    const manque = lire().filter((x) => !x).length;
    ok.disabled = manque > 0;
    d.message.textContent = manque ? `${manque} choix à faire` : '';
  };
  d.corps.addEventListener('change', maj);
  d.corps.querySelectorAll('[data-tout]').forEach((b) => b.addEventListener('click', () => {
    d.corps.querySelectorAll(`input[value="${b.dataset.tout}"]`).forEach((r) => { r.checked = true; });
    maj();
  }));
  maj();
  return (await d.resultat) ? lire() : null;
}
