import { echapper, formatNombre, formatLibre } from '@logibtp/socle/ui';
import { PanneauxDocument, opt } from '@logibtp/document/ui';
import { TL, estChiffree, estTranche, natureObligatoire, controlesValidation } from '../calcul/index.js';
import { sectionVariablesTranche, lierVariablesTranche } from './variables-tranche.js';
import { TableIntervenants } from './structure/intervenants.js';
import { intervenantPropre } from './structure/structure.js';
import { champRattachement } from './structure/selection.js';

/**
 * Panneaux du devis BTP : mode de calcul des ouvrages et variables du document ($$) dans l'entête,
 * quantité issue du métré, perte et blocages de prix dans le détail, déboursé et marge, coefficient de frais annexes.
 */
export class PanneauxBtp extends PanneauxDocument {
  /** options.bibliotheques : bibliothèques proposées pour l'appel des éléments (bibliothèque du document). */
  constructor(editeur, { bibliotheques = [], structure = null, rattacher = null, annuaire = null, intervenants = null, actualiserPrix = null, versBibliotheque = null } = {}) {
    super(editeur);
    this.bibliotheques = bibliotheques;
    // Structure des affaires : référentiels (projets, affaires, chantiers, marchés) et rattachement (page : document
    // modifiable → saisie ; validé → classement direct par l'API).
    this.structure = structure;
    this.rattacher = rattacher;
    // Annuaire du document : annuaire du cœur (recherche des tiers, contacts) ; intervenants(type, id) de la structure.
    this.annuaire = annuaire;
    this.intervenantsStructure = intervenants;
    this.actualiserPrix = actualiserPrix;
    this.versBibliotheque = versBibliotheque;
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

  /**
   * Rattachement à la structure des affaires : pour chaque niveau, libellé, zone de saisie du code (double-clic ou F4 :
   * liste de choix) et, dessous, le libellé de l'élément en lien vers sa fiche (composant champRattachement).
   */
  sectionRattachement() {
    return this.structure ? '<fieldset class="rattachement-document"><legend>Rattachement</legend><div class="rattachements" data-rattachements></div></fieldset>' : '';
  }

  /** Rattachement modifié sur un niveau : les parents suivent (completerRattachement), un enfant incohérent est retiré. */
  changerRattachement(cle, id) {
    const d = this.editeur.saisie.document;
    const s = this.structure;
    const r = { ent_projet_id: d.ent_projet_id ?? null, ent_affaire_id: d.ent_affaire_id ?? null, ent_chantier_id: d.ent_chantier_id ?? null, ent_marche_id: d.ent_marche_id ?? null };
    r[cle] = id;
    if (cle === 'ent_affaire_id' && r.ent_chantier_id && s.chantiers.find((c) => c.id === r.ent_chantier_id)?.aff_id !== id) { r.ent_chantier_id = null; r.ent_marche_id = null; }
    if (cle === 'ent_chantier_id' && r.ent_marche_id && s.marches.find((x) => x.id === r.ent_marche_id)?.cha_id !== id) r.ent_marche_id = null;
    if (cle === 'ent_projet_id' && r.ent_chantier_id && s.chantiers.find((c) => c.id === r.ent_chantier_id)?.prj_id && s.chantiers.find((c) => c.id === r.ent_chantier_id)?.prj_id !== id) {
      r.ent_chantier_id = null; r.ent_marche_id = null;
    }
    this.rattacher?.(r);
  }

  sectionsEntete() {
    // Variables du document ($$) : dans le métré de la ligne de section (F4) ; sans section, rappel seulement.
    const section = this.editeur.saisie.lignes.some((l) => l.lig_tyl_id === TL.SECTION);
    const nbVars = this.variablesDocument().length;
    return `${this.sectionRattachement(this.editeur.saisie.document)}
      ${this.annuaire ? '<fieldset class="annuaire-document"><legend>Annuaire du document</legend><div data-intervenants></div></fieldset>' : ''}
      ${!section && nbVars ? `<p class="aide">${nbVars} variable(s) du document ($$) : ajoutez une ligne de section pour les modifier (F4 sur la section).</p>` : ''}`;
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
    const ratt = zone.querySelector('[data-rattachements]');
    if (ratt) {
      const d = this.editeur.saisie.document;
      const niveau = (type, cle, titre, filtre = null) => champRattachement({
        type, titre, refs: this.structure, valeur: d[cle], filtre, choisir: (id) => this.changerRattachement(cle, id),
      });
      ratt.append(
        niveau('projet', 'ent_projet_id', 'Projet'),
        niveau('affaire', 'ent_affaire_id', 'Affaire'),
        niveau('chantier', 'ent_chantier_id', 'Chantier', d.ent_affaire_id ? { libelle: 'Chantiers de l\'affaire', test: (x) => x.aff_id === d.ent_affaire_id } : null),
        niveau('marche', 'ent_marche_id', 'Marché', d.ent_chantier_id ? { libelle: 'Marchés du chantier', test: (x) => x.cha_id === d.ent_chantier_id } : null),
      );
    }
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
      // Nature (obligatoire pour valider) : avant le code article.
      const natures = (this.editeur.natures ?? []).filter((n) => n.actif !== false || n.id === l.lig_nat_id);
      const k = champs.findIndex((c) => c.includes('data-champ="lig_code"'));
      champs.splice(k < 0 ? 0 : k, 0, f.sel('lig_nat_id', `Nature${natureObligatoire(l) ? ' *' : ''}`, [['', '—'], ...natures.map((n) => [n.id, `${n.code} – ${n.libelle}`])], true));
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

  /**
   * Détail de la ligne : actions de la bibliothèque (prix, envoi) sur la sélection ou la ligne ; pour une tranche
   * (titre, section), ses paramètres ($largeur, $hauteur…) sous le formulaire ; pour la section, les variables du
   * document ($$) dans son métré (F4).
   */
  rendreDetail(zone, ligId) {
    if (zone.contains(document.activeElement)) return;
    super.rendreDetail(zone, ligId);
    const l = this.editeur.saisie.lignes.find((x) => x.lig_id === ligId);
    if (!l) return;
    const lecture = !!this.editeur.magasin.lectureSeule;
    const ids = () => {
      const sel = this.editeur.grille.selection ?? [];
      return sel.includes(ligId) ? sel : [ligId];
    };
    const actions = [
      this.actualiserPrix && !lecture ? '<button type="button" data-action-ligne="prix" title="Reprendre les prix de la bibliothèque (lignes sélectionnées ou cette ligne)">⟳ Prix bibliothèque</button>' : '',
      this.versBibliotheque && !lecture ? '<button type="button" data-action-ligne="envoi" title="Mettre à jour ou créer les éléments de la bibliothèque (élément → article, ouvrage → ouvrage, titre → ensemble)">📤 Vers la bibliothèque</button>' : '',
      l.lig_tyl_id === TL.SECTION ? '<button type="button" data-action-ligne="variables" title="Variables du document ($$) dans le métré de la section (F4)">$$ Variables du document</button>' : '',
    ].filter(Boolean);
    if (actions.length) {
      const h3 = zone.querySelector('h3');
      (h3 ?? zone.firstChild)?.insertAdjacentHTML?.('afterend', `<div class="actions-ligne">${actions.join('')}</div>`);
      zone.querySelector('[data-action-ligne="prix"]')?.addEventListener('click', () => this.actualiserPrix(ids()));
      zone.querySelector('[data-action-ligne="envoi"]')?.addEventListener('click', () => this.versBibliotheque(ids()));
      zone.querySelector('[data-action-ligne="variables"]')?.addEventListener('click', () => this.editeur.creerMetre(ligId));
    }
    if (!estTranche(l)) return;
    zone.insertAdjacentHTML('beforeend', sectionVariablesTranche(this.editeur, ligId, { modifiable: !this.editeur.magasin.lectureSeule }));
    lierVariablesTranche(zone, this.editeur);
  }
}
