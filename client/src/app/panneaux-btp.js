import { echapper, formatNombre, formatLibre } from '@logibtp/socle/ui';
import { PanneauxDocument, opt } from '@logibtp/document/ui';
import { TL, estChiffree, estTranche } from '../calcul/index.js';
import { sectionVariablesTranche, lierVariablesTranche } from './variables-tranche.js';
import { TableIntervenants } from './structure/intervenants.js';
import { intervenantPropre } from './structure/structure.js';

/**
 * Panneaux du devis BTP : mode de calcul des ouvrages et variables du document ($$) dans l'entête,
 * quantité issue du métré, perte et blocages de prix dans le détail, déboursé et marge, coefficient de frais annexes.
 */
export class PanneauxBtp extends PanneauxDocument {
  /** options.bibliotheques : bibliothèques proposées pour l'appel des éléments (bibliothèque du document). */
  constructor(editeur, { bibliotheques = [], structure = null, rattacher = null, annuaire = null, intervenants = null } = {}) {
    super(editeur);
    this.bibliotheques = bibliotheques;
    // Structure des affaires : référentiels (projets, affaires, chantiers, marchés) et rattachement (page : document
    // modifiable → saisie ; validé → classement direct par l'API).
    this.structure = structure;
    this.rattacher = rattacher;
    // Annuaire du document : annuaire du cœur (recherche des tiers, contacts) ; intervenants(type, id) de la structure.
    this.annuaire = annuaire;
    this.intervenantsStructure = intervenants;
  }

  /** Tiers saisi dans l'annuaire du document (première ligne : client ou fournisseur). */
  champTiers(d) { return this.annuaire ? '' : super.champTiers(d); }

  /** Fonction du tiers du document : fournisseur pour un achat, client sinon. */
  fonctionTiers() { return this.editeur.definition.type?.tyd_famille === 'A' ? 'FOURNISSEUR' : 'CLIENT'; }

  /** Intervenants du document, le tiers du document (ent_tiers_id) en première ligne. */
  intervenantsDocument(d = this.editeur.saisie.document) {
    const liste = [...(d.ent_intervenants ?? [])];
    const fixe = this.fonctionTiers();
    const i = liste.findIndex((x) => x.fonction === fixe);
    const tiers = i >= 0 ? liste.splice(i, 1)[0] : d.ent_tiers_id ? { fonction: fixe, per_id: d.ent_tiers_id, principal: true } : null;
    return tiers ? [tiers, ...liste] : liste;
  }

  /** Enregistre la liste dans la saisie ; le tiers de la première ligne devient le tiers du document. */
  modifierIntervenants(liste, libelle = 'Annuaire du document') {
    const fixe = this.fonctionTiers();
    this.editeur.magasin.modifier((b) => {
      b.document.ent_intervenants = liste.map(intervenantPropre);
      const tiers = liste.find((x) => x.fonction === fixe);
      if (tiers?.per_id) b.document.ent_tiers_id = Number(tiers.per_id);
    }, libelle);
  }

  /**
   * Reprise des intervenants du marché, du chantier puis du projet (fonctions proposées dans les documents), sans
   * doublon (même fonction, même tiers et même contact) ni seconde occurrence d'une fonction unique. Retourne le
   * nombre d'intervenants ajoutés.
   */
  async reprendreIntervenants() {
    const d = this.editeur.saisie.document;
    if (!this.intervenantsStructure || this.editeur.magasin.lectureSeule) return 0;
    const sources = [['marche', d.ent_marche_id], ['chantier', d.ent_chantier_id], ['projet', d.ent_projet_id]].filter(([, id]) => id);
    const fonctions = this.structure?.fonctions ?? [];
    const liste = this.intervenantsDocument();
    let ajoutes = 0;
    for (const [type, id] of sources) {
      for (const x of await this.intervenantsStructure(type, id).catch(() => [])) {
        const f = fonctions.find((y) => y.code === x.fonction);
        if (!f || f.portee === 'S') continue;
        if (liste.some((y) => y.fonction === x.fonction && (f.unique || (y.per_id === x.per_id && y.ind_id === x.ind_id)))) continue;
        liste.push({ ...x });
        ajoutes++;
      }
    }
    if (ajoutes) this.modifierIntervenants(liste, 'Reprise des intervenants');
    return ajoutes;
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

  /** Rattachement à la structure des affaires : listes filtrées (marchés du chantier, chantiers de l'affaire). */
  sectionRattachement(d) {
    const s = this.structure;
    if (!s) return '';
    const choix = (champ, liste, valeur, filtre = () => true) => `<select data-rattachement="${champ}">${opt('', '—', valeur ?? '')}${liste
      .filter((x) => x.id === Number(valeur) || (filtre(x) && !['CLOSE', 'CLOS', 'PERDU', 'ABANDONNE', 'RESILIE'].includes(x.statut)))
      .map((x) => opt(String(x.id), `${x.code} – ${x.libelle}`, valeur === null || valeur === undefined ? '' : String(valeur))).join('')}</select>`;
    const lien = (type, id) => (id ? ` <a href="/fiche/${type}/${Number(id)}" title="Ouvrir la fiche">↗</a>` : '');
    return `<fieldset class="rattachement-document"><legend>Rattachement</legend>
      <label>Projet${lien('projet', d.ent_projet_id)} ${choix('ent_projet_id', s.projets, d.ent_projet_id)}</label>
      <label>Affaire${lien('affaire', d.ent_affaire_id)} ${choix('ent_affaire_id', s.affaires, d.ent_affaire_id)}</label>
      <label>Chantier${lien('chantier', d.ent_chantier_id)} ${choix('ent_chantier_id', s.chantiers, d.ent_chantier_id, (c) => !d.ent_affaire_id || c.aff_id === d.ent_affaire_id)}</label>
      <label>Marché${lien('marche', d.ent_marche_id)} ${choix('ent_marche_id', s.marches, d.ent_marche_id, (m) => !d.ent_chantier_id || m.cha_id === d.ent_chantier_id)}</label>
    </fieldset>`;
  }

  sectionsEntete() {
    const varsDoc = this.variablesDocument();
    const calc = new Map(this.editeur.resultat.variables.map((v) => [v.var_id, v.var_valeur]));
    return `${this.sectionRattachement(this.editeur.saisie.document)}
      ${this.annuaire ? '<fieldset class="annuaire-document"><legend>Annuaire du document</legend><div data-intervenants></div></fieldset>' : ''}
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
    const conteneur = zone.querySelector('[data-intervenants]');
    if (conteneur) {
      const d = this.editeur.saisie.document;
      const lecture = !!m.lectureSeule;
      conteneur.append(new TableIntervenants({
        annuaire: this.annuaire, fonctions: this.structure?.fonctions ?? [], portee: 'D', lecture, fixe: this.fonctionTiers(),
        surChange: (liste) => this.modifierIntervenants(liste),
        actions: !lecture && (d.ent_marche_id || d.ent_chantier_id || d.ent_projet_id) ? [{
          libelle: '↧ Reprendre du marché / chantier', titre: 'Ajoute les intervenants du marché, du chantier et du projet (client, payeur, sous-traitants…)',
          action: () => this.reprendreIntervenants().then((n) => this.editeur.surMessage?.(n ? `${n} intervenant(s) repris` : 'Aucun intervenant à reprendre')),
        }] : [],
      }).rendre(this.intervenantsDocument(d)));
    }
    zone.querySelectorAll('[data-rattachement]').forEach((el) => el.addEventListener('change', () => {
      const d = this.editeur.saisie.document;
      const r = { ent_projet_id: d.ent_projet_id ?? null, ent_affaire_id: d.ent_affaire_id ?? null, ent_chantier_id: d.ent_chantier_id ?? null, ent_marche_id: d.ent_marche_id ?? null };
      r[el.dataset.rattachement] = el.value === '' ? null : Number(el.value);
      el.blur(); // l'entête se redessine (listes filtrées) une fois le focus sorti
      // Cohérence descendante : une autre affaire libère le chantier et le marché, un autre chantier le marché.
      const s = this.structure;
      if (el.dataset.rattachement === 'ent_affaire_id' && r.ent_chantier_id && s.chantiers.find((c) => c.id === r.ent_chantier_id)?.aff_id !== r.ent_affaire_id) {
        r.ent_chantier_id = null; r.ent_marche_id = null;
      }
      if (el.dataset.rattachement === 'ent_chantier_id' && r.ent_marche_id && s.marches.find((x) => x.id === r.ent_marche_id)?.cha_id !== r.ent_chantier_id) r.ent_marche_id = null;
      this.rattacher?.(r);
    }));
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
      ['Coef FA', formatLibre(c.lig_coef_fa)],
      ...(this.regles.estLigneDePrix(this.editeur.saisie.lignes, c) ? [['Coef prorata', formatLibre(c.lig_coef_prorata ?? 1)]] : []), ['Déboursé', formatNombre(c.lig_montant_pa, 2)],
      ['Revient', formatNombre(c.lig_montant_pr, 2)], ['Marge', formatNombre(Number(c.lig_montant_ht ?? 0) - Number(c.lig_montant_pr ?? 0), 2)],
    ];
  }

  lignesTotaux(d) {
    return Number(d.ent_coef_fa) !== 1 ? [['Coef. frais annexes', formatLibre(d.ent_coef_fa)]] : [];
  }

  /** Détail d'une tranche (titre, section) : ses paramètres ($largeur, $hauteur…) sous le formulaire. */
  rendreDetail(zone, ligId) {
    if (zone.contains(document.activeElement)) return;
    super.rendreDetail(zone, ligId);
    const l = this.editeur.saisie.lignes.find((x) => x.lig_id === ligId);
    if (!l || !estTranche(l)) return;
    zone.insertAdjacentHTML('beforeend', sectionVariablesTranche(this.editeur, ligId, { modifiable: !this.editeur.magasin.lectureSeule }));
    lierVariablesTranche(zone, this.editeur);
  }
}
