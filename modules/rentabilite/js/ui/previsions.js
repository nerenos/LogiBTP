// Saisies prévisionnelles du Détail (ANALYSE-MODULE-ANALYSE.md § 10.1, lot 6) : liste des saisies d'un chantier (état
// ouverte, échue, soldée), saisie et modification, solde (pièce réelle proposée ou motif), réouverture, suppression,
// journal des modifications. Composant sans métier : l'application fournit les appels (actions), le choix d'un tiers et
// l'ouverture d'une pièce.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { formatNombre, formatDate, formatDateHeure, echapper, creerCombo, champDate, lireNombre, ouvrirDialogue, confirmer } from '@logibtp/socle/ui';
import { INDICATEUR, COMPOSANTE, ETAT_PREVISION, ERREUR_PREVISION } from '../src/codes.js';

/** Indicateurs d'une saisie, dans l'ordre du Détail. */
export const INDICATEURS_PREVISION = Object.freeze([INDICATEUR.BUDGET, INDICATEUR.BUDGET_EXECUTION, INDICATEUR.ENGAGE, INDICATEUR.DEBOURSE, INDICATEUR.FACTURE]);

/** Composantes d'un coût prévu (engagé, déboursé). */
export const COMPOSANTES_COUT = Object.freeze([COMPOSANTE.ACHAT, COMPOSANTE.SOUS_TRAITANCE, COMPOSANTE.MO, COMPOSANTE.MATERIEL, COMPOSANTE.STOCK]);

/** Montants saisissables selon l'indicateur : le facturé n'a que du PV, l'engagé et le déboursé que des coûts. */
export function champsMontants(indicateur) {
  if (indicateur === INDICATEUR.FACTURE) return { cout: false, pv: true };
  if (indicateur === INDICATEUR.ENGAGE || indicateur === INDICATEUR.DEBOURSE) return { cout: true, pv: false };
  return { cout: true, pv: true };
}

const montant = (v) => (v === null || v === undefined ? '' : formatNombre(v, 2));
const saisieMontant = (v) => (v === null || v === undefined || Number(v) === 0 ? '' : formatNombre(v, 2).replace(/[\s  ]/g, ''));

/**
 * Panneau des saisies prévisionnelles d'un chantier. options : { peut: { creer, modifier, supprimer }, actions: { creer(saisie),
 * modifier(id, saisie), solder(id, { le, ent_id, motif }), rouvrir(id), supprimer(id), journal(id) } (promesses),
 * choisirTiers() → Promise<{ id, libelle } | null>, ouvrirPiece(entId, nouvelleFenetre), apresEcriture(), erreur(e) }.
 */
export class PanneauPrevisions {
  #zone;
  #o;
  #d = null;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { peut: {}, actions: {}, ouvrirPiece: () => {}, apresEcriture: () => {}, erreur: () => {}, ...options };
  }

  /** donnees : { previsions: [{ prevision, etat, tiers, solde_piece }], propositions, natures, ordres, voir_couts } du serveur. */
  rendre(donnees) {
    this.#d = donnees;
    const { peut } = this.#o;
    const l = donnees.previsions ?? [];
    const couts = donnees.voir_couts;
    const echues = l.filter((x) => x.etat === ETAT_PREVISION.ECHUE).length;
    const entete = `<h2 class="titre-actions">${iconeHtml('rentabilite_prevision')} ${texteHtml('rentabilite.previsions.titre')}
      ${peut.creer ? `<button type="button" data-nouvelle title="${echapper(texte('rentabilite.previsions.nouvelle_titre'))}">${iconeHtml('rentabilite_ajouter')} ${texteHtml('rentabilite.previsions.nouvelle')}</button>` : ''}</h2>
      ${echues ? `<p class="rentabilite-anomalie">${iconeHtml('rentabilite_anomalie')} ${echapper(texte(echues > 1 ? 'rentabilite.previsions.echues_autre' : 'rentabilite.previsions.echues_un', { nombre: echues }))}</p>` : ''}`;
    if (!l.length) {
      this.#zone.innerHTML = `${entete}<p class="aide">${texteHtml('rentabilite.previsions.aucune')}</p>`;
      this.#brancher();
      return;
    }
    const nature = (id) => donnees.natures?.find((n) => n.id === id);
    const ordre = (id) => donnees.ordres?.find((o) => o.id === id);
    const propositions = (id) => (donnees.propositions ?? []).filter((p) => p.prevision_id === id);
    const piece = (p) => (p ? `${p.type_libelle ?? p.type} ${p.numero ?? ''}${p.indice ? ` (${p.indice})` : ''}`.trim() : '');
    const ligne = ({ prevision: p, etat, tiers, solde_piece: sp }) => {
      const n = nature(p.nat_id);
      const o = ordre(p.ordre_id);
      const actions = [
        p.soldee_le === null && peut.modifier ? `<button type="button" data-modifier="${p.id}" title="${echapper(texte('rentabilite.previsions.modifier'))}">${iconeHtml('rentabilite_modifier')}</button>` : '',
        p.soldee_le === null && peut.modifier ? `<button type="button" data-solder="${p.id}" title="${echapper(texte('rentabilite.previsions.solder'))}">${iconeHtml('rentabilite_solder')}</button>` : '',
        p.soldee_le !== null && peut.modifier ? `<button type="button" data-rouvrir="${p.id}" title="${echapper(texte('rentabilite.previsions.rouvrir'))}">${iconeHtml('rentabilite_rouvrir')}</button>` : '',
        `<button type="button" data-journal="${p.id}" title="${echapper(texte('rentabilite.previsions.journal'))}">${iconeHtml('rentabilite_journal')}</button>`,
        peut.supprimer ? `<button type="button" data-supprimer="${p.id}" title="${echapper(texte('rentabilite.previsions.supprimer'))}">${iconeHtml('rentabilite_supprimer')}</button>` : '',
      ].join('');
      const attendu = [p.piece_attendue, p.echeance ? texte('rentabilite.previsions.echeance_le', { date: formatDate(p.echeance) }) : ''].filter(Boolean).join(' · ');
      const solde = p.soldee_le !== null
        ? `${echapper(texte('rentabilite.previsions.soldee_le', { date: formatDate(p.soldee_le), par: p.solde_par ?? '' }))}${sp ? ` · <a href="#" data-piece="${sp.ent_id}">${echapper(piece(sp))}</a>` : ''}${p.solde_motif ? ` · ${echapper(p.solde_motif)}` : ''}`
        : echapper(attendu);
      const props = p.soldee_le === null ? propositions(p.id).map((x) => `<tr class="rentabilite-proposition"><td></td>
        <td colspan="${couts ? 9 : 7}">${iconeHtml('rentabilite_proposition')} ${echapper(texte('rentabilite.previsions.proposition', { piece: piece(x.piece) || `#${x.ent_id}`, tiers: x.piece?.tiers ?? '' }))}
          ${x.piece ? `<a href="#" data-piece="${x.ent_id}">${iconeHtml('rentabilite_ouvrir')}</a>` : ''}</td>
        <td class="montant">${montant(x.pv && Number(x.pv) !== 0 ? x.pv : couts ? x.pa : '')}</td>
        <td class="cellule-boutons">${peut.modifier ? `<button type="button" data-solder-par="${p.id}:${x.ent_id}" title="${echapper(texte('rentabilite.previsions.solder_par_titre'))}">${iconeHtml('rentabilite_solder')} ${texteHtml('rentabilite.previsions.solder_par')}</button>` : ''}</td></tr>`).join('') : '';
      return `<tr class="rentabilite-prevision-${etat.toLowerCase()}" title="${echapper([p.motif, texte('rentabilite.previsions.cree_par', { par: p.cree_par, le: formatDateHeure(p.cree_le) })].filter(Boolean).join('\n'))}">
        <td>${texteHtml(`rentabilite.previsions.etats.${etat}`)}</td><td>${formatDate(p.date)}</td>
        <td>${texteHtml(`rentabilite.indicateurs.${p.indicateur}`)}${p.composante !== COMPOSANTE.VENTE ? ` · ${texteHtml(`rentabilite.composantes.${p.composante}`)}` : ''}</td>
        <td>${echapper(n ? `${n.code} – ${n.libelle}` : '')}</td><td>${echapper(o ? o.numero ?? `#${o.id}` : '')}</td>
        <td>${echapper(p.libelle)}</td><td>${echapper(tiers ?? '')}</td>
        ${couts ? `<td class="montant">${montant(p.pa)}</td><td class="montant">${montant(p.pr)}</td>` : ''}
        <td class="montant">${montant(p.pv)}</td><td>${solde}</td><td class="cellule-boutons">${actions}</td></tr>${props}`;
    };
    const th = (cle, classe = '') => `<th${classe ? ` class="${classe}"` : ''}>${texteHtml(`rentabilite.previsions.colonnes.${cle}`)}</th>`;
    this.#zone.innerHTML = `${entete}
      <table class="tableau-compact rentabilite-previsions"><thead><tr>${th('etat')}${th('date')}${th('indicateur')}${th('nature')}${th('ordre')}${th('libelle')}${th('tiers')}
        ${couts ? `${th('pa', 'montant')}${th('pr', 'montant')}` : ''}${th('pv', 'montant')}${th('attendu')}<th class="cellule-boutons"></th></tr></thead>
      <tbody>${l.map(ligne).join('')}</tbody></table>
      <p class="aide">${texteHtml('rentabilite.previsions.aide')}</p>`;
    this.#brancher();
  }

  #trouver(id) { return this.#d.previsions.find((x) => x.prevision.id === Number(id))?.prevision; }

  async #executer(f, succes) {
    try {
      await f();
      await this.#o.apresEcriture(succes);
    } catch (e) { this.#o.erreur(e); }
  }

  #brancher() {
    const z = this.#zone;
    const a = this.#o.actions;
    z.querySelector('[data-nouvelle]')?.addEventListener('click', async () => {
      const s = await this.#saisir(null);
      if (s) await this.#executer(() => a.creer(s), 'creee');
    });
    z.querySelectorAll('[data-modifier]').forEach((b) => b.addEventListener('click', async () => {
      const p = this.#trouver(b.dataset.modifier);
      const s = await this.#saisir(p);
      if (s) await this.#executer(() => a.modifier(p.id, s), 'modifiee');
    }));
    z.querySelectorAll('[data-solder]').forEach((b) => b.addEventListener('click', async () => {
      const p = this.#trouver(b.dataset.solder);
      const r = await this.#solde(p, null);
      if (r) await this.#executer(() => a.solder(p.id, r), 'soldee');
    }));
    z.querySelectorAll('[data-solder-par]').forEach((b) => b.addEventListener('click', async () => {
      const [id, ent] = b.dataset.solderPar.split(':').map(Number);
      const r = await this.#solde(this.#trouver(id), ent);
      if (r) await this.#executer(() => a.solder(id, r), 'soldee');
    }));
    z.querySelectorAll('[data-rouvrir]').forEach((b) => b.addEventListener('click', () => this.#executer(() => a.rouvrir(Number(b.dataset.rouvrir)), 'rouverte')));
    z.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', async () => {
      const p = this.#trouver(b.dataset.supprimer);
      if (!await confirmer(texte('rentabilite.previsions.supprimer_confirmer', { libelle: p.libelle }))) return;
      await this.#executer(() => a.supprimer(p.id), 'supprimee');
    }));
    z.querySelectorAll('[data-journal]').forEach((b) => b.addEventListener('click', () => this.#journal(Number(b.dataset.journal))));
    z.querySelectorAll('a[data-piece]').forEach((x) => x.addEventListener('click', (ev) => {
      ev.preventDefault();
      this.#o.ouvrirPiece(Number(x.dataset.piece), ev.ctrlKey || ev.metaKey);
    }));
  }

  /** Fenêtre de saisie (création si `p` est null) : renvoie la saisie à envoyer, ou null. */
  #saisir(p) {
    const d = this.#d;
    const couts = d.voir_couts;
    let tiers = p ? { id: p.tiers_id, libelle: d.previsions.find((x) => x.prevision.id === p.id)?.tiers ?? '' } : { id: null, libelle: '' };
    const ligne = (cle, champ) => `<label for="prv-${cle}">${texteHtml(`rentabilite.previsions.champs.${cle}`)}</label><span data-champ="${cle}">${champ ?? ''}</span>`;
    const html = `<div class="grille-saisie">
      ${ligne('indicateur')}${ligne('composante')}
      ${ligne('date', `<input type="date" id="prv-date" value="${p?.date ?? aujourdhui()}">`)}
      ${ligne('libelle', `<input type="text" id="prv-libelle" size="40" maxlength="200" value="${echapper(p?.libelle ?? '')}">`)}
      ${ligne('nature')}${ligne('ordre')}
      ${couts ? ligne('pa', `<input type="text" id="prv-pa" size="12" class="montant" value="${saisieMontant(p?.pa)}">`) : ''}
      ${couts ? ligne('pr', `<input type="text" id="prv-pr" size="12" class="montant" value="${saisieMontant(p?.pr)}" placeholder="${echapper(texte('rentabilite.previsions.pr_defaut'))}">`) : ''}
      ${ligne('pv', `<input type="text" id="prv-pv" size="12" class="montant" value="${saisieMontant(p?.pv)}">`)}
      ${ligne('tiers', `<span data-tiers>${echapper(tiers.libelle ?? '')}</span> ${this.#o.choisirTiers ? `<button type="button" data-choisir-tiers title="${echapper(texte('rentabilite.previsions.choisir_tiers'))}">${iconeHtml('rentabilite_chercher')}</button>` : ''}
        <button type="button" data-vider-tiers title="${echapper(texte('rentabilite.previsions.vider_tiers'))}">${iconeHtml('retirer')}</button>`)}
      ${ligne('piece_attendue', `<input type="text" id="prv-piece_attendue" size="30" maxlength="200" value="${echapper(p?.piece_attendue ?? '')}">`)}
      ${ligne('echeance', `<input type="date" id="prv-echeance" value="${p?.echeance ?? ''}">`)}
      ${ligne('motif', `<textarea id="prv-motif" rows="2" cols="40">${echapper(p?.motif ?? '')}</textarea>`)}
    </div><p class="aide">${texteHtml('rentabilite.previsions.aide_saisie')}</p>`;
    let combos;
    const actualiser = (dlg) => {
      const m = champsMontants(combos.indicateur.valeurCombo);
      // Composante : seulement pour un coût seul (engagé, déboursé) ; budget et facturé sont de la vente.
      dlg.querySelectorAll('[data-champ="composante"], label[for="prv-composante"]').forEach((el) => { el.hidden = !(m.cout && !m.pv); });
      for (const cle of ['pa', 'pr']) dlg.querySelectorAll(`[data-champ="${cle}"], label[for="prv-${cle}"]`).forEach((el) => { el.hidden = !m.cout; });
      dlg.querySelectorAll('[data-champ="pv"], label[for="prv-pv"]').forEach((el) => { el.hidden = !m.pv; });
    };
    const lire = (dlg) => {
      const nombre = (id) => {
        const el = dlg.querySelector(`#prv-${id}`);
        if (!el || el.closest('[hidden]')) return null;
        const v = lireNombre(el.value);
        el.classList.toggle('invalide', v === undefined);
        return v;
      };
      const s = {
        indicateur: combos.indicateur.valeurCombo, composante: combos.composante.valeurCombo || null,
        date: dlg.querySelector('#prv-date').value, libelle: dlg.querySelector('#prv-libelle').value.trim(),
        nat_id: combos.nature.valeurCombo ? Number(combos.nature.valeurCombo) : null, ordre_id: combos.ordre.valeurCombo ? Number(combos.ordre.valeurCombo) : null,
        pa: nombre('pa'), pr: nombre('pr'), pv: nombre('pv'), tiers_id: tiers.id ?? null,
        piece_attendue: dlg.querySelector('#prv-piece_attendue').value.trim() || null, echeance: dlg.querySelector('#prv-echeance').value || null,
        motif: dlg.querySelector('#prv-motif').value.trim() || null, version: p?.version ?? null,
      };
      const erreurs = [];
      if (!s.date) erreurs.push('date');
      if (!s.libelle) erreurs.push('libelle');
      if ([s.pa, s.pr, s.pv].includes(undefined)) erreurs.push('montant');
      else if (![s.pa, s.pr, s.pv].some((v) => v !== null && Number(v) !== 0)) erreurs.push('montant');
      dlg.querySelector('#prv-libelle').classList.toggle('invalide', erreurs.includes('libelle'));
      dlg.querySelector('[data-erreur]').textContent = erreurs.length
        ? texte(erreurs.includes('montant') ? `rentabilite.previsions.erreurs.${ERREUR_PREVISION.MONTANT}` : 'rentabilite.previsions.erreurs.obligatoires') : '';
      return erreurs.length ? undefined : s;
    };
    return ouvrirDialogue({
      titre: texte(p ? 'rentabilite.previsions.modifier' : 'rentabilite.previsions.nouvelle'),
      classe: 'rentabilite-prevision-saisie',
      html: `${html}<p class="rentabilite-anomalie" data-erreur></p>`,
      focus: '#prv-libelle',
      boutons: [
        { libelle: texte('commun.annuler'), valeur: null },
        { libelle: texte('commun.enregistrer'), principal: true, valeur: (dlg) => lire(dlg) ?? null },
      ],
      construire: (dlg, fermer) => {
        combos = {
          indicateur: creerCombo({ options: INDICATEURS_PREVISION.map((i) => ({ valeur: i, libelle: texte(`rentabilite.indicateurs.${i}`) })), valeur: p?.indicateur ?? INDICATEUR.DEBOURSE, vide: false }),
          composante: creerCombo({ options: COMPOSANTES_COUT.map((c) => ({ valeur: c, libelle: texte(`rentabilite.composantes.${c}`) })),
            valeur: p && COMPOSANTES_COUT.includes(p.composante) ? p.composante : COMPOSANTE.ACHAT, vide: false }),
          nature: creerCombo({ options: (d.natures ?? []).map((n) => ({ valeur: String(n.id), libelle: `${n.code} – ${n.libelle}`, groupe: n.groupe_libelle ?? n.groupe ?? '' })),
            valeur: p?.nat_id ? String(p.nat_id) : '' }),
          ordre: creerCombo({ options: (d.ordres ?? []).map((o) => ({ valeur: String(o.id), libelle: `${o.numero ?? `#${o.id}`} ${o.libelle ?? ''}`.trim(), detail: o.statut })),
            valeur: p?.ordre_id ? String(p.ordre_id) : '' }),
        };
        for (const [cle, c] of Object.entries(combos)) {
          c.id = `prv-${cle}`;
          dlg.querySelector(`[data-champ="${cle}"]`).append(c);
        }
        dlg.querySelectorAll('input[type="date"]').forEach(champDate);
        combos.indicateur.addEventListener('change', () => actualiser(dlg));
        actualiser(dlg);
        dlg.querySelector('[data-choisir-tiers]')?.addEventListener('click', async () => {
          const t = await this.#o.choisirTiers();
          if (!t) return;
          tiers = t;
          dlg.querySelector('[data-tiers]').textContent = t.libelle ?? '';
        });
        dlg.querySelector('[data-vider-tiers]').addEventListener('click', () => {
          tiers = { id: null, libelle: '' };
          dlg.querySelector('[data-tiers]').textContent = '';
        });
        // Une saisie incomplète garde la fenêtre ouverte (le bouton Enregistrer ne ferme qu'une saisie valable).
        const enregistrer = dlg.querySelector('.dialogue-boutons .principal');
        enregistrer.addEventListener('click', (e) => {
          if (lire(dlg) !== undefined) return;
          e.stopImmediatePropagation();
        }, { capture: true });
        dlg.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.ctrlKey) { const s = lire(dlg); if (s) fermer(s); }
        });
      },
    });
  }

  /** Fenêtre de solde : pièce proposée (ou aucune), date, motif ; une pièce ou un motif est exigé. */
  #solde(p, entPropose) {
    const props = (this.#d.propositions ?? []).filter((x) => x.prevision_id === p.id);
    const libellePiece = (x) => `${x.piece ? `${x.piece.type_libelle ?? x.piece.type} ${x.piece.numero ?? ''}` : `#${x.ent_id}`}${x.piece?.tiers ? ` – ${x.piece.tiers}` : ''}`;
    let combo;
    return ouvrirDialogue({
      titre: texte('rentabilite.previsions.solder_titre', { libelle: p.libelle }),
      classe: 'rentabilite-prevision-saisie',
      html: `<div class="grille-saisie">
        <label>${texteHtml('rentabilite.previsions.champs.piece')}</label><span data-piece-solde></span>
        <label for="prv-le">${texteHtml('rentabilite.previsions.champs.le')}</label><span><input type="date" id="prv-le" value="${aujourdhui()}"></span>
        <label for="prv-solde-motif">${texteHtml('rentabilite.previsions.champs.motif_solde')}</label><span><textarea id="prv-solde-motif" rows="2" cols="40"></textarea></span>
      </div><p class="aide">${texteHtml('rentabilite.previsions.aide_solde')}</p><p class="rentabilite-anomalie" data-erreur></p>`,
      boutons: [
        { libelle: texte('commun.annuler'), valeur: null },
        {
          libelle: texte('rentabilite.previsions.solder'), principal: true,
          valeur: (dlg) => ({ le: dlg.querySelector('#prv-le').value || null, ent_id: combo.valeurCombo ? Number(combo.valeurCombo) : null,
            motif: dlg.querySelector('#prv-solde-motif').value.trim() || null }),
        },
      ],
      construire: (dlg) => {
        combo = creerCombo({ options: props.map((x) => ({ valeur: String(x.ent_id), libelle: libellePiece(x) })), valeur: entPropose ? String(entPropose) : '' });
        dlg.querySelector('[data-piece-solde]').append(combo);
        dlg.querySelectorAll('input[type="date"]').forEach(champDate);
        dlg.querySelector('.dialogue-boutons .principal').addEventListener('click', (e) => {
          if (combo.valeurCombo || dlg.querySelector('#prv-solde-motif').value.trim()) return;
          dlg.querySelector('[data-erreur]').textContent = texte(`rentabilite.previsions.erreurs.${ERREUR_PREVISION.SOLDEE}`);
          e.stopImmediatePropagation();
        }, { capture: true });
      },
    });
  }

  /** Journal d'une saisie : action, auteur, date, champs changés (avant → après). */
  async #journal(id) {
    let lignes;
    try { lignes = await this.#o.actions.journal(id); } catch (e) { this.#o.erreur(e); return; }
    const lireJson = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
    const CHAMPS = ['indicateur', 'composante', 'date', 'nat_id', 'ordre_id', 'pa', 'pr', 'pv', 'libelle', 'motif', 'tiers_id', 'echeance', 'piece_attendue',
      'soldee_le', 'solde_ent_id', 'solde_motif'];
    const ecarts = (av, ap) => CHAMPS.filter((c) => String(av?.[c] ?? '') !== String(ap?.[c] ?? ''))
      .map((c) => `${texte(`rentabilite.previsions.journal_champs.${c}`)} : ${av?.[c] ?? '—'} → ${ap?.[c] ?? '—'}`);
    const corps = lignes.map((l) => {
      const av = lireJson(l.avant);
      const ap = lireJson(l.apres);
      const details = av && ap ? ecarts(av, ap) : [];
      return `<tr><td>${formatDateHeure(l.le)}</td><td>${echapper(l.par)}</td><td>${texteHtml(`rentabilite.previsions.actions.${l.action}`)}</td>
        <td>${details.map(echapper).join('<br>')}</td></tr>`;
    }).join('');
    await ouvrirDialogue({
      titre: texte('rentabilite.previsions.journal'),
      html: `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite.previsions.journal_le')}</th><th>${texteHtml('rentabilite.previsions.journal_par')}</th>
        <th>${texteHtml('rentabilite.previsions.journal_action')}</th><th>${texteHtml('rentabilite.previsions.journal_details')}</th></tr></thead><tbody>${corps}</tbody></table>`,
      boutons: [{ libelle: texte('commun.fermer'), principal: true, valeur: null }],
    });
  }
}
