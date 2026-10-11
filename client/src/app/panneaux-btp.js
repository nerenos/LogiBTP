import { echapper, formatNombre, formatLibre } from '@logibtp/socle/ui';
import { PanneauxDocument, opt } from '@logibtp/document/ui';
import { TL, estChiffree } from '../calcul/index.js';

/**
 * Panneaux du devis BTP : mode de calcul des ouvrages et variables du document ($$) dans l'entête,
 * quantité issue du métré, perte et blocages de prix dans le détail, déboursé et marge, coefficient de frais annexes.
 */
export class PanneauxBtp extends PanneauxDocument {
  /** options.bibliotheques : bibliothèques proposées pour l'appel des éléments (bibliothèque du document). */
  constructor(editeur, { bibliotheques = [] } = {}) {
    super(editeur);
    this.bibliotheques = bibliotheques;
  }

  champsEntete(d) {
    const defaut = this.bibliotheques.find((b) => b.defaut);
    return [`<label>Calcul des ouvrages
      <select data-champ="ent_mode_calcul_ouvrage">${opt('V', 'Somme des PV', d.ent_mode_calcul_ouvrage)}${opt('D', 'Déboursé', d.ent_mode_calcul_ouvrage)}</select></label>`,
    `<label title="Bibliothèque des codes saisis sans préfixe ; les autres s'appellent par BIB:CODE">Bibliothèque
      <select data-champ="ent_bib_id" data-entier>${opt('', `Par défaut${defaut ? ` (${defaut.code})` : ''}`, d.ent_bib_id ?? '')}${this.bibliotheques.filter((b) => b.actif || b.id === d.ent_bib_id)
        .map((b) => opt(String(b.id), `${b.code} – ${b.libelle}`, d.ent_bib_id === null || d.ent_bib_id === undefined ? '' : String(d.ent_bib_id))).join('')}</select></label>`];
  }

  variablesDocument() {
    return this.editeur.saisie.variables.filter((v) => v.var_lig_id === null && v.var_mtr_id === null);
  }

  sectionsEntete() {
    const varsDoc = this.variablesDocument();
    const calc = new Map(this.editeur.resultat.variables.map((v) => [v.var_id, v.var_valeur]));
    return `
      <details class="variables-document" ${varsDoc.length ? 'open' : ''}><summary>Variables du document ($$)</summary>
        <table class="variables"><tbody>${varsDoc.map((v) => `
          <tr data-var="${v.var_id}"><td>$$<input data-vchamp="var_nom" value="${echapper(v.var_nom)}"></td>
          <td><select data-vchamp="var_operation">${opt('=', '=', v.var_operation)}${opt('+=', '+=', v.var_operation)}</select></td>
          <td><input data-vchamp="var_formule" value="${echapper(v.var_formule)}"></td>
          <td class="col-nombre">${formatLibre(calc.get(v.var_id))}</td><td><button data-supprimer="${v.var_id}">✕</button></td></tr>`).join('')}
        </tbody></table><button data-action="ajouter-variable">Ajouter</button>
      </details>`;
  }

  lierEntete(zone) {
    const m = this.editeur.magasin;
    zone.querySelectorAll('[data-vchamp]').forEach((el) => el.addEventListener('change', () => {
      const id = Number(el.closest('tr').dataset.var);
      m.modifier((b) => { b.variables.find((v) => v.var_id === id)[el.dataset.vchamp] = el.value; }, 'Variable');
    }));
    zone.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.supprimer);
      m.modifier((s) => { s.variables = s.variables.filter((v) => v.var_id !== id); }, 'Variable');
    }));
    zone.querySelector('[data-action="ajouter-variable"]').addEventListener('click', () => {
      const id = m.prochainId();
      const ordre = this.variablesDocument().length + 1;
      m.modifier((s) => {
        s.variables.push({ var_id: id, var_ent_id: s.document.ent_id, var_lig_id: null, var_mtr_id: null, var_portee: '$$',
          var_nom: 'variable', var_operation: '=', var_formule: '0', var_ordre: ordre });
      }, 'Variable');
    });
  }

  aideLigneAbsente(calculee) {
    return calculee?.lig_is_ecart_arrondi
      ? '<p class="aide">Ligne d\'écart d\'arrondi : calculée, non modifiable, masquée à l\'impression.</p>'
      : super.aideLigneAbsente(calculee);
  }

  champsDetail(l, f) {
    const champs = super.champsDetail(l, f);
    if (estChiffree(l)) {
      // Après la quantité relative / absolue et avant les décimales.
      const i = champs.findIndex((c) => c.includes('data-champ="lig_precision_qte"'));
      champs.splice(i, 0,
        f.sel('lig_qte_source', 'Source de la quantité', [['S', 'Saisie'], ['M', 'Métré (F4)']]),
        f.txt('lig_coef_perte', 'Coefficient de perte', true));
      const j = champs.findIndex((c) => c.includes('data-champ="lig_code"'));
      const blocages = [f.coche('lig_pv_fixe', 'PV fixe (avant frais annexes et remise)')];
      if (this.regles.estLigneDePrix(this.editeur.saisie.lignes, l)) {
        blocages.push(f.coche('lig_pv_affiche_fixe', 'PV affiché fixe (avec frais annexes)'), f.txt('lig_pv_affiche', 'PV affiché imposé', true));
      }
      champs.splice(j, 0, ...blocages);
    }
    if (l.lig_tyl_id === TL.PIED_HT) {
      const k = champs.findIndex((c) => c.includes('data-champ="lig_is_non_editee"'));
      champs.splice(k < 0 ? champs.length : k, 0, f.coche('lig_pied_is_fa', 'Frais annexe ventilé dans les prix'));
    }
    return champs;
  }

  calculDetail(c) {
    if (!estChiffree(c)) return super.calculDetail(c);
    return [
      ['Qté vendue', formatLibre(c.lig_qte_vendue)], ['Qté totale', formatLibre(c.lig_qte_totale)],
      ['PR', formatNombre(c.lig_pr, 4)], ['PV affiché', formatNombre(c.lig_pv_affiche, c.lig_precision_pv ?? 2)],
      ['Coef FA', formatLibre(c.lig_coef_fa)], ['Déboursé', formatNombre(c.lig_montant_pa, 2)],
      ['Revient', formatNombre(c.lig_montant_pr, 2)], ['Marge', formatNombre(Number(c.lig_montant_ht ?? 0) - Number(c.lig_montant_pr ?? 0), 2)],
    ];
  }

  lignesTotaux(d) {
    return Number(d.ent_coef_fa) !== 1 ? [['Coef. frais annexes', formatLibre(d.ent_coef_fa)]] : [];
  }
}
