import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
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
  const d = dialogue(texte('annuaire.partage.titre', { icone: icone('annuaire_partage') }), `
    <p>${texteHtml('annuaire.partage.aide_html')}</p>
    ${elements.map(({ u, contexte }, i) => `<fieldset class="partage-choix">
      <legend>${NATURES.find((n) => n.code === u.nature)?.icone ?? ''} ${contexte ? texteHtml('annuaire.partage.dans_contexte', { contexte, nature: NATURES.find((n) => n.code === u.nature)?.un ?? '' }) : echapper(NATURES.find((n) => n.code === u.nature)?.un ?? '')}</legend>
      <p class="partage-valeurs"><s>${echapper(texteCoordonnee({ ...u.origine, nature: u.nature }))}</s> → <b>${echapper(texteCoordonnee(u))}</b></p>
      <label><input type="radio" name="choix-${i}" value="MODIFICATION"> ${iconeHtml('annuaire_modification')} ${texteHtml('annuaire.partage.modification_html')}
        <small class="aide">(${pluriel('annuaire.partage.autres', u.partages.length)} : ${fiches(u)})</small></label>
      <label><input type="radio" name="choix-${i}" value="AUTRE"> ${iconeHtml('annuaire_autre_information')} ${texteHtml('annuaire.partage.autre_html')}</label>
    </fieldset>`).join('')}
    <p class="partage-tout"><button type="button" data-tout="MODIFICATION">${texteHtml('annuaire.partage.tout_modification')}</button> <button type="button" data-tout="AUTRE">${texteHtml('annuaire.partage.tout_autre')}</button></p>`,
  texte('commun.enregistrer'), { large: true });
  const ok = d.fond.querySelector('[data-ok]');
  const lire = () => elements.map((_, i) => d.corps.querySelector(`input[name="choix-${i}"]:checked`)?.value ?? null);
  const maj = () => {
    const manque = lire().filter((x) => !x).length;
    ok.disabled = manque > 0;
    d.message.textContent = manque ? pluriel('annuaire.partage.manque', manque) : '';
  };
  d.corps.addEventListener('change', maj);
  d.corps.querySelectorAll('[data-tout]').forEach((b) => b.addEventListener('click', () => {
    d.corps.querySelectorAll(`input[value="${b.dataset.tout}"]`).forEach((r) => { r.checked = true; });
    maj();
  }));
  maj();
  return (await d.resultat) ? lire() : null;
}
