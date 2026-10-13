import { echapper, formatLibre } from '@logibtp/socle/ui';
import { opt } from '@logibtp/document/ui';

// Paramètres d'une tranche (titre, section) : variables de portée « $ » portées par la ligne, lues par les métrés et
// les libellés de ses lignes ({{$largeur}}, {{$hauteur}}…). Un ensemble de la bibliothèque (fenêtre paramétrable,
// volet en option…) les reçoit avec ses lignes ; on les ajuste dans le devis sur le titre inséré.

/** Variables de la tranche `ligId`. */
export const variablesTranche = (saisie, ligId) => saisie.variables.filter((v) => v.var_lig_id === ligId && (v.var_mtr_id === null || v.var_mtr_id === undefined));

/** Section HTML des paramètres de la tranche (valeurs calculées en regard). */
export function sectionVariablesTranche(editeur, ligId, { modifiable = true, titre = 'Paramètres de la tranche ($)' } = {}) {
  const vars = variablesTranche(editeur.saisie, ligId).sort((a, b) => (a.var_ordre ?? 0) - (b.var_ordre ?? 0));
  const calc = new Map((editeur.resultat.variables ?? []).map((v) => [v.var_id, v.var_valeur]));
  const ro = modifiable ? '' : 'disabled';
  return `<details class="variables-tranche" data-tranche="${ligId}" ${vars.length ? 'open' : ''}><summary>${echapper(titre)}</summary>
    <p class="aide">Utilisables dans les métrés et libellés des lignes de la tranche : {{$nom}}.</p>
    <table class="variables"><tbody>${vars.map((v) => `
      <tr data-var="${v.var_id}"><td>$<input data-vt="var_nom" value="${echapper(v.var_nom)}" size="12" ${ro}></td>
      <td><select data-vt="var_operation" ${ro}>${opt('=', '=', v.var_operation)}${opt('+=', '+=', v.var_operation)}</select></td>
      <td><input data-vt="var_formule" value="${echapper(v.var_formule ?? '')}" size="10" ${ro}></td>
      <td class="col-nombre">${formatLibre(calc.get(v.var_id))}</td>${modifiable ? `<td><button type="button" data-vt-supprimer="${v.var_id}" title="Supprimer">✕</button></td>` : ''}</tr>`).join('')}
    </tbody></table>${modifiable ? '<button type="button" data-vt-ajouter>Ajouter un paramètre</button>' : ''}
  </details>`;
}

/** Branchement de la section (une étape d'annulation par modification). */
export function lierVariablesTranche(zone, editeur) {
  const m = editeur.magasin;
  const section = zone.querySelector('.variables-tranche');
  if (!section) return;
  const ligId = Number(section.dataset.tranche);
  section.querySelectorAll('[data-vt]').forEach((el) => el.addEventListener('change', () => {
    const id = Number(el.closest('tr').dataset.var);
    const valeur = el.dataset.vt === 'var_nom' ? el.value.trim().replace(/[^\p{L}\p{N}_]/gu, '_') : el.value;
    m.modifier((b) => { b.variables.find((v) => v.var_id === id)[el.dataset.vt] = valeur; }, 'Paramètre de tranche');
  }));
  section.querySelectorAll('[data-vt-supprimer]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.vtSupprimer);
    m.modifier((s) => { s.variables = s.variables.filter((v) => v.var_id !== id); }, 'Paramètre de tranche');
  }));
  section.querySelector('[data-vt-ajouter]')?.addEventListener('click', () => {
    const id = m.prochainId();
    const existants = variablesTranche(editeur.saisie, ligId);
    let n = existants.length + 1;
    while (existants.some((v) => v.var_nom === `parametre${n}`)) n += 1;
    m.modifier((s) => {
      s.variables.push({ var_id: id, var_ent_id: s.document.ent_id, var_lig_id: ligId, var_mtr_id: null, var_portee: '$',
        var_nom: `parametre${n}`, var_operation: '=', var_formule: '0', var_ordre: existants.length + 1 });
    }, 'Paramètre de tranche');
  });
}
