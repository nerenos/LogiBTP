import { CFG_LIGNES as C, ordreAffichage, echapper, formatNombre, formatLibre, lireNombre } from '@logibtp/socle/ui';
import { TL, estChiffree, estPied } from '../src/index.js';

// Panneaux autour de la grille : entête, détail de la ligne, totaux, messages, écarts.
// Chaque champ modifié forme une étape d'annulation ; un panneau ne se redessine pas pendant une saisie.

export const opt = (valeur, libelle, courant) => `<option value="${echapper(valeur)}" ${String(valeur) === String(courant ?? '') ? 'selected' : ''}>${echapper(libelle)}</option>`;
const STYLES_NUM = [['1', '1, 2, 3'], ['A', 'A, B, C'], ['a', 'a, b, c']];

export function lier(zone, selecteur, appliquer) {
  zone.querySelectorAll(selecteur).forEach((el) => {
    el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : el.value;
      appliquer(el.dataset.champ, v, el);
    });
  });
}

export function valeurChamp(el, v) {
  if (el.type === 'checkbox') return v;
  if (el.dataset.nombre !== undefined) return lireNombre(v) ?? null;
  if (el.dataset.entier !== undefined) return v === '' ? null : Number(v);
  return v === '' ? null : v;
}

/** Générateurs de champs de formulaire liés à un objet (data-champ). */
export function champsFormulaire(objet) {
  return {
    sel: (champ, libelle, options, entier = false) =>
      `<label>${libelle}<select data-champ="${champ}" ${entier ? 'data-entier' : ''}>${options.map(([v, t]) => opt(v, t, objet[champ])).join('')}</select></label>`,
    txt: (champ, libelle, nombre = false) =>
      `<label>${libelle}<input data-champ="${champ}" ${nombre ? 'data-nombre' : ''} value="${echapper(nombre ? formatLibre(objet[champ]) : objet[champ] ?? '')}"></label>`,
    coche: (champ, libelle) => `<label class="coche"><input type="checkbox" data-champ="${champ}" ${objet[champ] ? 'checked' : ''}> ${libelle}</label>`,
  };
}

/**
 * Panneaux du document (classe mère). Points de spécialisation : champsEntete, sectionsEntete / lierEntete,
 * champsDetail, calculDetail, aideLigneAbsente, lignesTotaux.
 */
export class PanneauxDocument {
  constructor(editeur) {
    this.editeur = editeur;
  }

  get regles() { return this.editeur.regles; }

  // ------------------------------------------------------------------ entête

  /** Champs propres à la spécialisation, ajoutés après les champs génériques (data-champ sur le document). */
  champsEntete(_d) { return []; }

  /** Sections HTML ajoutées sous le formulaire d'entête. */
  sectionsEntete() { return ''; }

  /** Branchement des sections ajoutées. */
  lierEntete(_zone) {}

  rendreEntete(zone) {
    if (zone.contains(document.activeElement)) return;
    const editeur = this.editeur;
    const d = editeur.saisie.document;
    const def = editeur.definition;
    const fmt = typeof d.ent_num_format === 'string' ? JSON.parse(d.ent_num_format) : d.ent_num_format ?? { separateur: '.', niveaux: [{ style: '1' }] };
    const niveaux = [0, 1, 2].map((i) => fmt.niveaux?.[i]?.style ?? '');
    const props = def.proprietes.filter((p) => p.prd_niveau === 'E');
    const valeurs = d.ent_proprietes ?? {};
    const statut = def.statuts?.find((s) => s.std_id === d.ent_std_id);
    zone.innerHTML = `
      <div class="entete-titre">
        <strong>${echapper(def.type.tyd_libelle)}</strong>
        <span class="numero">${echapper(d.ent_numero ?? 'non numéroté')}${d.ent_indice ? ` · indice ${echapper(d.ent_indice)}` : ''}</span>
        <span class="statut">${echapper(statut?.std_libelle ?? '')} · v${d.ent_version ?? 1}</span>
      </div>
      <div class="formulaire">
        <label class="large">Objet <input data-champ="ent_objet" value="${echapper(d.ent_objet ?? '')}"></label>
        <label>Date <input type="date" data-champ="ent_date" value="${echapper(d.ent_date ?? '')}"></label>
        <label>Tiers <input data-champ="ent_tiers_id" data-entier value="${echapper(d.ent_tiers_id ?? '')}"></label>
        ${this.champsEntete(d).join('')}
        <label>Décimales montants <input data-champ="ent_precision_montant" data-entier type="number" min="0" max="6" value="${d.ent_precision_montant ?? 2}"></label>
        <fieldset class="numerotation"><legend>Numérotation</legend>
          ${niveaux.map((s, i) => `<select data-niveau="${i}">${i > 0 ? opt('', '—', s) : ''}${STYLES_NUM.map(([v, l]) => opt(v, l, s)).join('')}</select>`).join('')}
          <input data-separateur maxlength="2" value="${echapper(fmt.separateur ?? '.')}" title="Séparateur">
        </fieldset>
        ${props.map((p) => {
          const v = valeurs[p.prd_code] ?? '';
          const libelle = `${echapper(p.prd_libelle)}${p.prd_obligatoire ? ' *' : ''}`;
          if (p.prd_type_donnee === 'liste') {
            const options = (p.prd_options ?? []).map((o) => (typeof o === 'string' ? { code: o, libelle: o } : o));
            return `<label>${libelle}<select data-prop="${p.prd_code}">${opt('', '—', v)}${options.map((o) => opt(o.code, o.libelle, v)).join('')}</select></label>`;
          }
          if (p.prd_type_donnee === 'booleen') return `<label>${libelle}<input type="checkbox" data-prop="${p.prd_code}" ${v ? 'checked' : ''}></label>`;
          const type = { entier: 'number', decimal: 'text', date: 'date' }[p.prd_type_donnee] ?? 'text';
          return `<label>${libelle}<input type="${type}" data-prop="${p.prd_code}" data-type="${p.prd_type_donnee}" value="${echapper(v)}"></label>`;
        }).join('')}
      </div>
      ${this.sectionsEntete()}`;

    const m = editeur.magasin;
    lier(zone.querySelector('.formulaire'), '[data-champ]', (champ, v, el) => m.modifier((b) => { b.document[champ] = valeurChamp(el, v); }, 'Entête'));
    const majFormat = () => {
      const styles = [...zone.querySelectorAll('[data-niveau]')].map((s) => s.value).filter(Boolean);
      const separateur = zone.querySelector('[data-separateur]').value || '.';
      m.modifier((b) => { b.document.ent_num_format = { separateur, niveaux: styles.map((style) => ({ style })) }; }, 'Numérotation');
    };
    zone.querySelectorAll('[data-niveau], [data-separateur]').forEach((el) => el.addEventListener('change', majFormat));
    zone.querySelectorAll('[data-prop]').forEach((el) => el.addEventListener('change', () => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.type === 'entier') v = v === '' ? null : Number(v);
      if (el.dataset.type === 'decimal') v = v === '' ? null : Number(lireNombre(v));
      m.modifier((b) => { b.document.ent_proprietes = { ...(b.document.ent_proprietes ?? {}), [el.dataset.prop]: v === '' ? null : v }; }, 'Propriété');
    }));
    this.lierEntete(zone);
  }

  // ------------------------------------------------------------------ détail de la ligne

  /** Message affiché quand la ligne sélectionnée n'est pas saisie (ligne calculée…). */
  aideLigneAbsente(_calculee) { return '<p class="aide">Sélectionnez une ligne.</p>'; }

  /**
   * Champs du détail de la ligne `l` (saisie). `f` fournit sel, txt et coche. Une spécialisation
   * complète ou remplace la liste renvoyée par super.champsDetail.
   */
  champsDetail(l, f) {
    const lignes = this.editeur.saisie.lignes;
    const taux = this.editeur.definition.taux_tva;
    const champs = [];
    if (l.lig_tyl_id === TL.TITRE) {
      champs.push(f.sel('lig_tva_id', 'TVA par défaut', [['', '—'], ...taux.map((t) => [t.ttv_id, t.ttv_libelle])], true));
      champs.push('<button data-action="appliquer-tva" title="Écrase le taux de toutes les lignes de prix descendantes">Appliquer ce taux aux lignes</button>');
      champs.push(f.txt('lig_num_depart', 'Départ de numérotation'));
    }
    if (estChiffree(l)) {
      if (this.regles.ouvrageAncetre(lignes, l.lig_id)) champs.push(f.sel('lig_qte_type', 'Quantité', [['R', 'Relative (par unité du parent)'], ['A', 'Absolue pour le parent']]));
      champs.push(f.sel('lig_precision_qte', 'Décimales quantité', [0, 1, 2, 3, 4, 5, 6].map((n) => [n, n]), true));
      champs.push(f.sel('lig_precision_pv', 'Décimales PV', [0, 1, 2, 3, 4, 5, 6].map((n) => [n, n]), true));
      champs.push(f.sel('lig_type_prix', 'Type de prix', [['V', 'Vendu'], ['O', 'Option'], ['M', 'Pour mémoire'], ['A', 'Variante']]));
      champs.push(f.txt('lig_code', 'Code article'));
      champs.push(f.txt('lig_art_id', 'ID article'));
      champs.push(f.txt('lig_num_depart', 'Départ de numérotation'));
    }
    if (l.lig_tyl_id === TL.SOUS_TOTAL) {
      const precedents = ordreAffichage(C, lignes).map((r) => r.item).filter((x) => x.lig_tyl_id === TL.SOUS_TOTAL && x.lig_id !== l.lig_id);
      champs.push(f.sel('lig_st_depuis_id', 'Additionner depuis', [['', 'Le début du document'], ...precedents.map((x) => [x.lig_id, `Sous-total : ${x.lig_libelle_html ?? x.lig_id}`])], true));
    }
    if (l.lig_tyl_id === TL.PIED_HT || l.lig_tyl_id === TL.PIED_TTC) {
      champs.push(f.sel('lig_pied_mode', 'Mode', [['P', 'Pourcentage'], ['M', 'Montant']]));
      champs.push(f.sel('lig_pied_base', 'Base', [['CUMUL', 'Cumul à ce point'], ['TOTAL_HT', 'Total HT du corps'], ['TOTAL_TTC', 'Total TTC du corps']]));
      champs.push(f.sel('lig_pied_sens', 'Sens', [[1, 'Ajout'], [-1, 'Déduction']], true));
      champs.push(f.txt('lig_pied_valeur', 'Valeur', true));
      champs.push(f.sel('lig_type_prix', 'Traitement', [['V', 'Dans le net à payer'], ['M', 'Pour mémoire']]));
    }
    if (!estPied(l)) champs.push(f.coche('lig_is_non_editee', 'Ne pas imprimer'));
    return champs;
  }

  /** Valeurs calculées affichées sous le formulaire : [libellé, valeur formatée]. */
  calculDetail(c) {
    if (estChiffree(c)) {
      return [['Qté vendue', formatLibre(c.lig_qte_vendue)], ['Qté totale', formatLibre(c.lig_qte_totale)],
        ['PV net', formatNombre(c.lig_pv_remise, c.lig_precision_pv ?? 2)], ['Montant HT', formatNombre(c.lig_montant_ht, 2)]];
    }
    if (estPied(c) && c.lig_base_calcul !== undefined) return [['Base', formatNombre(c.lig_base_calcul, 2)]];
    return [];
  }

  rendreDetail(zone, ligId) {
    if (zone.contains(document.activeElement)) return;
    const editeur = this.editeur;
    const l = editeur.saisie.lignes.find((x) => x.lig_id === ligId);
    const c = editeur.resultat.lignes.find((x) => x.lig_id === ligId);
    if (!l || !c) {
      zone.innerHTML = this.aideLigneAbsente(c);
      return;
    }
    const champs = this.champsDetail(l, champsFormulaire(l));
    const props = editeur.definition.proprietes.filter((p) => p.prd_niveau === 'L');
    const valeurs = l.lig_proprietes ?? {};
    const calcul = this.calculDetail(c);

    zone.innerHTML = `
      <h3>${echapper(c.lig_numerotation ?? '')} ${echapper(c.lig_libelle_brut ?? '')}</h3>
      <div class="formulaire">${champs.join('')}
        ${props.map((p) => `<label>${echapper(p.prd_libelle)}<input data-prop="${p.prd_code}" value="${echapper(valeurs[p.prd_code] ?? '')}"></label>`).join('')}
      </div>
      ${calcul.length ? `<dl class="calcul">${calcul.map(([t, v]) => `<dt>${echapper(t)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}`;

    const m = editeur.magasin;
    lier(zone, '[data-champ]', (champ, v, el) => editeur.modifierLigne(ligId, champ, champ === 'lig_art_id' ? (v === '' ? null : Number(v)) : valeurChamp(el, v)));
    zone.querySelectorAll('[data-prop]').forEach((el) => el.addEventListener('change', () => {
      m.modifier((b) => {
        const x = b.lignes.find((y) => y.lig_id === ligId);
        x.lig_proprietes = { ...(x.lig_proprietes ?? {}), [el.dataset.prop]: el.value || null };
      }, 'Propriété');
    }));
    zone.querySelector('[data-action="appliquer-tva"]')?.addEventListener('click', () => {
      m.modifier((b) => this.regles.appliquerTauxTitre(b, ligId), 'TVA du titre');
    });
  }

  // ------------------------------------------------------------------ totaux, messages, écarts

  /** Lignes ajoutées aux totaux : [libellé, valeur formatée], affichées sous le net à payer. */
  lignesTotaux(_document) { return []; }

  rendreTotaux(zone, { compact = false } = {}) {
    const editeur = this.editeur;
    const r = editeur.resultat;
    const d = r.document;
    const pm = editeur.saisie.document.ent_precision_montant ?? 2;
    const extra = this.lignesTotaux(d);
    if (compact) {
      const detailTva = r.tva.map((t) => `${t.tva_code} : ${formatNombre(t.tva_montant_net, pm)} sur ${formatNombre(t.tva_base_ht, pm)}`).join(' · ');
      zone.innerHTML = `
        <span><small>Total HT</small> ${formatNombre(d.ent_total_ht, pm)}</span>
        <span title="${echapper(detailTva)}"><small>TVA</small> ${formatNombre(d.ent_total_tva, pm)}</span>
        <span><small>TTC</small> ${formatNombre(d.ent_total_ttc, pm)}</span>
        <span class="net"><small>Net à payer</small> ${formatNombre(d.ent_net_a_payer, pm)}</span>
        ${extra.map(([t, v]) => `<span><small>${echapper(t)}</small> ${v}</span>`).join('')}`;
      return;
    }
    zone.innerHTML = `<h3>Totaux</h3>
      <table class="totaux">
        <tr><th>Total HT</th><td>${formatNombre(d.ent_total_ht, pm)}</td></tr>
        ${r.tva.map((t) => `
          <tr class="tva"><th>${echapper(t.tva_code)} · base ${formatNombre(t.tva_base_ht, pm)}</th><td>${formatNombre(t.tva_montant, pm)}</td></tr>
          ${Number(t.tva_montant_annulation) !== 0 ? `<tr class="tva annulation"><th>Annulation ${echapper(t.tva_code)}</th><td>${formatNombre(t.tva_montant_annulation, pm)}</td></tr>` : ''}
          ${t.tva_mention ? `<tr class="mention"><td colspan="2">${echapper(t.tva_mention)}</td></tr>` : ''}`).join('')}
        <tr><th>Total TVA</th><td>${formatNombre(d.ent_total_tva, pm)}</td></tr>
        <tr><th>Total TTC</th><td>${formatNombre(d.ent_total_ttc, pm)}</td></tr>
        <tr class="net"><th>Net à payer</th><td>${formatNombre(d.ent_net_a_payer, pm)}</td></tr>
        ${extra.map(([t, v]) => `<tr class="mention"><th>${echapper(t)}</th><td>${v}</td></tr>`).join('')}
      </table>`;
  }

  rendreMessages(zone, selectionner) {
    const r = this.editeur.resultat;
    const items = [...r.erreurs.map((e) => ({ ...e, niveau: 'erreur' })), ...r.avertissements.map((e) => ({ ...e, niveau: 'avertissement' }))];
    zone.hidden = items.length === 0;
    zone.innerHTML = `<h3>Contrôles (${items.length})</h3><ul>${items.map((e) =>
      `<li class="${e.niveau}" data-lig="${e.lig_id ?? ''}"><code>${echapper(e.code)}</code> ${echapper(e.message)}</li>`).join('')}</ul>`;
    zone.querySelectorAll('li[data-lig]').forEach((li) => li.addEventListener('click', () => {
      if (li.dataset.lig) selectionner(Number(li.dataset.lig));
    }));
  }

  /** Arbitrage des écarts client / serveur, ligne par ligne : S serveur validé, A anomalie. */
  rendreEcarts(zone, ecarts, arbitrer) {
    zone.hidden = !ecarts?.length;
    if (!ecarts?.length) return;
    zone.innerHTML = `
      <h3>Écarts entre le calcul du client et celui du serveur (${ecarts.length})</h3>
      <table><thead><tr><th>Ligne</th><th>Champ</th><th>Client</th><th>Serveur</th></tr></thead>
      <tbody>${ecarts.map((e) => `<tr><td>${e.lig_id ?? 'document'}</td><td><code>${echapper(e.champ)}</code></td>
        <td>${echapper(e.valeur_client ?? '∅')}</td><td>${echapper(e.valeur_serveur ?? '∅')}</td></tr>`).join('')}</tbody></table>
      <label>Commentaire <input data-commentaire></label>
      <div class="boutons">
        <button data-decision="S" title="Le résultat serveur est correct : anomalie du moteur client">S – Serveur validé</button>
        <button data-decision="A" title="Le résultat attendu n'est ni l'un ni l'autre, ou le client a raison">A – Anomalie</button>
      </div>`;
    zone.querySelectorAll('[data-decision]').forEach((b) => b.addEventListener('click', () => {
      arbitrer(b.dataset.decision, zone.querySelector('[data-commentaire]').value);
    }));
  }
}
