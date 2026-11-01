import { texte, texteHtml, textesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, confirmer, formatDateHeure } from '@logibtp/socle/ui';
import {
  ACTIONS, LIBELLES_ACTIONS, LIBELLES_PORTEES, PORTEES, MESSAGES_DROITS, actionsEffectives, cocher, decocher, reappliquer,
  controlerProfil, parent,
} from '@logibtp/droits';
import { api } from '../api.js';

// Événements du journal : icône ; libellé « droits_btp.evenements.<CODE> ».
const ICONES_EVENEMENTS = { CREATION: 'ajouter', MODIFICATION: 'droits_btp_modifier', SUPPRESSION: 'supprimer', DROITS: 'droits_btp_droits', LIMITE: 'droits_btp_limite' };
const LIBELLES_EVENEMENTS = textesParCode('droits_btp.evenements', Object.keys(ICONES_EVENEMENTS));
const evenement = (code) => (ICONES_EVENEMENTS[code] ? `${icone(ICONES_EVENEMENTS[code])} ${LIBELLES_EVENEMENTS[code]}` : code);

const montant = (v) => (v === undefined || v === null || String(v) === '-1' ? texte('droits_btp.profils.sans_limite') : texte('droits_btp.profils.montant', { montant: v }));
const limiteTexte = (l) => (l ? texte('droits_btp.profils.limite', { piece: montant(l.piece), cumul: montant(l.cumul), jours: l.jours }) : '—');
const texteJournal = (j, v) => (j.evenement === 'DROITS' ? actionsTexte(v) : j.evenement === 'LIMITE' ? limiteTexte(v) : JSON.stringify(v ?? ''));
const actionsTexte = (a) => (a ? Object.entries(a).map(([k, v]) => `${LIBELLES_ACTIONS[k] ?? k}${v === 'TOUT' ? '' : ` (${LIBELLES_PORTEES[v] ?? v})`}`).join(', ') || texte('droits_btp.profils.aucune') : '—');

/**
 * Profils et droits (module Droits, `administration/profils`) : liste des profils (système, total, comptes), arbre des
 * droits d'un profil : une colonne par action, case cochée = permise ; ligne héritée (grisée, source en bulle) ou propre ;
 * cocher coche les actions précédentes de la cascade, décocher ne retire que l'action ; portée (soi, son service, tout)
 * sur les nœuds qui la gèrent ; « Hériter » retire la ligne, « Réappliquer aux enfants » retire celles des descendants.
 * Enregistrement en bloc (contrôlé par le serveur), journal des modifications.
 */
export class PageParametresDroits extends PageBase {
  icone = icone('droits_btp_droits');
  /** Lignes saisies du profil affiché (copie modifiable) et état d'origine (modification en cours). */
  #lignes = null;
  /** Montants de validation saisis { nœud: { piece, cumul, jours } } (montants en texte, jamais en Number). */
  #limites = {};
  #origine = '';
  #ouverts = new Set();

  async ouvrir() {
    const app = this.app;
    this.titre = texte('droits_btp.profils.titre');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('droits_btp_droits')} ${texteHtml('droits_btp.profils.titre')}</h1></div><div data-corps></div></div>`;
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!app.acces('administration/profils')) { corps.innerHTML = `<p class="aide">${texteHtml('droits_btp.profils.reserve')}</p>`; return; }
    this.peutModifier = app.peut('administration/profils', 'MODIFIER');
    [this.catalogue, this.profils] = await Promise.all([api.droits.catalogue(), api.droits.profils()]);
    this.permises = Object.fromEntries(this.catalogue.map((n) => [n.cle, n.actions]));
    this.colonnes = [...ACTIONS, ...[...new Set(this.catalogue.flatMap((n) => n.actions))].filter((a) => !ACTIONS.includes(a))];
    corps.innerHTML = `<p class="aide">${texteHtml('droits_btp.profils.intro')}</p>
      <section class="carte"><h2 class="titre-actions">${texteHtml('droits_btp.profils.profils')} <span>${this.peutModifier ? `<button type="button" data-nouveau>${iconeHtml('ajouter')} ${texteHtml('droits_btp.profils.nouveau')}</button>` : ''}</span></h2>
        <div data-creation></div><div data-profils></div></section>
      <section class="carte" data-profil hidden></section>`;
    corps.querySelector('[data-nouveau]')?.addEventListener('click', () => this.#rendreCreation(corps.querySelector('[data-creation]')));
    this.#rendreProfils(corps);
    const id = this.requete.profil ?? this.profils.find((p) => !p.total)?.id;
    if (id) await this.#ouvrirProfil(corps, id);
  }

  urlCourante() { return this.requete.profil ? `/parametres/droits?profil=${this.requete.profil}` : '/parametres/droits'; }

  get modifiee() { return this.#lignes !== null && this.#etat() !== this.#origine; }

  #etat() { return JSON.stringify({ lignes: this.#lignes, limites: this.#limites }); }

  #rendreProfils(corps) {
    corps.querySelector('[data-profils]').innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('commun.code')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('droits_btp.profils.description')}</th><th class="nombre">${texteHtml('droits_btp.profils.comptes')}</th><th></th></tr></thead><tbody>
      ${this.profils.map((p) => `<tr data-id="${p.id}" class="${p.id === this.requete.profil ? 'selection' : ''}"><td><a href="/parametres/droits?profil=${p.id}" data-ouvrir="${p.id}">${echapper(p.code)}</a></td>
        <td>${echapper(p.libelle)}</td><td>${echapper(p.description ?? '')}</td><td class="nombre">${p.comptes || ''}</td>
        <td>${p.total ? `<span class="pastille">${texteHtml('droits_btp.profils.tous_droits')}</span>` : ''} ${p.systeme ? `<span class="pastille">${texteHtml('droits_btp.profils.systeme')}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
    corps.querySelectorAll('[data-ouvrir]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.#ouvrirProfil(corps, a.dataset.ouvrir).catch((x) => this.app.erreur(x));
    }));
  }

  #rendreCreation(zone) {
    const modeles = creerCombo({ options: this.profils.filter((p) => !p.total).map((p) => ({ valeur: p.id, libelle: p.libelle, detail: p.code })), titre: texte('droits_btp.profils.copier_de') });
    zone.innerHTML = `<p class="ligne"><input data-code placeholder="${texteHtml('droits_btp.profils.code_indice')}" size="14" maxlength="30"> <input data-libelle placeholder="${texteHtml('commun.libelle')}" size="28" maxlength="100">
      <label>${texteHtml('droits_btp.profils.copier_de')} <span data-modele></span></label> <button type="button" data-creer>${texteHtml('commun.creer')}</button> <button type="button" data-annuler>${texteHtml('commun.annuler')}</button></p><p class="erreur" data-erreur></p>`;
    zone.querySelector('[data-modele]').append(modeles);
    const code = zone.querySelector('[data-code]');
    code.addEventListener('input', () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''); });
    zone.querySelector('[data-annuler]').addEventListener('click', () => { zone.innerHTML = ''; });
    zone.querySelector('[data-creer]').addEventListener('click', async () => {
      const p = { code: code.value, libelle: zone.querySelector('[data-libelle]').value, copie_de: modeles.valeurCombo || null };
      const erreurs = controlerProfil(p);
      zone.querySelector('[data-erreur]').textContent = erreurs.map((c) => MESSAGES_DROITS[c]).join(' · ');
      if (erreurs.length) return;
      try {
        const cree = await api.droits.creerProfil(p);
        this.app.naviguer(`/parametres/droits?profil=${cree.id}`);
      } catch (e) { this.app.erreur(e); }
    });
  }

  async #ouvrirProfil(corps, id) {
    if (this.modifiee && !await confirmer(texte('droits_btp.profils.abandonner'))) return;
    this.requete.profil = id;
    history.replaceState(history.state, '', this.urlCourante());
    const { profil, lignes, limites } = await api.droits.lignes(id);
    this.profil = profil;
    this.#charger(lignes, limites);
    corps.querySelectorAll('[data-profils] tr').forEach((tr) => tr.classList.toggle('selection', tr.dataset.id === id));
    const zone = corps.querySelector('[data-profil]');
    zone.hidden = false;
    this.#rendreProfil(zone);
  }

  #charger(lignes, limites) {
    this.#lignes = this.profil.total ? null : lignes;
    this.#limites = Object.fromEntries(Object.entries(limites ?? {}).map(([n, l]) => [n, { piece: String(l.piece), cumul: String(l.cumul), jours: String(l.jours) }]));
    this.#origine = this.#etat();
  }

  #rendreProfil(zone) {
    const p = this.profil;
    const modifiable = this.peutModifier;
    zone.innerHTML = `<h2 class="titre-actions">${echapper(p.libelle)} <small class="aide">${echapper(p.code)}</small>
        <span>${modifiable && !p.total ? `<button type="button" data-enregistrer>${iconeHtml('enregistrer')} ${texteHtml('commun.enregistrer')}</button> <button type="button" data-retablir>${iconeHtml('droits_btp_retablir')} ${texteHtml('droits_btp.profils.retablir')}</button>` : ''}
        ${modifiable && !p.systeme ? `<button type="button" data-supprimer>${iconeHtml('supprimer')} ${texteHtml('droits_btp.profils.supprimer')}</button>` : ''}</span></h2>
      ${modifiable ? `<p class="ligne"><label>${texteHtml('commun.libelle')} <input data-libelle value="${echapper(p.libelle)}" size="28" maxlength="100"></label>
        <label>${texteHtml('droits_btp.profils.description')} <input data-description value="${echapper(p.description ?? '')}" size="50"></label> <button type="button" data-renommer>${iconeHtml('droits_btp_modifier')} ${texteHtml('commun.modifier')}</button></p>` : ''}
      ${p.total ? `<p class="aide">${texteHtml('droits_btp.profils.total')}</p>` : `<div data-arbre class="tableau-defilant"></div>
        <h3>${texteHtml('droits_btp.profils.limites')}</h3><p class="aide">${texteHtml('droits_btp.profils.limites_aide')}</p><div data-limites></div>`}
      <details data-journal><summary>${texteHtml('droits_btp.profils.journal')}</summary><div data-lignes-journal></div></details>`;
    if (!p.total) {
      this.#rendreArbre(zone.querySelector('[data-arbre]'), modifiable);
      this.#rendreLimites(zone.querySelector('[data-limites]'), modifiable);
    }
    zone.querySelector('[data-enregistrer]')?.addEventListener('click', async () => {
      try {
        const limites = Object.fromEntries(Object.entries(this.#limites).map(([n, l]) => [n, { piece: l.piece.trim() || '-1', cumul: l.cumul.trim() || '-1', jours: l.jours || '30' }]));
        const r = await api.droits.remplacer(p.id, this.#lignes, limites);
        this.#charger(r.lignes, r.limites);
        this.app.message(texte('droits_btp.profils.enregistres'), 'succes');
        this.#rendreProfil(zone);
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-retablir]')?.addEventListener('click', () => {
      const o = JSON.parse(this.#origine);
      this.#lignes = o.lignes;
      this.#limites = o.limites;
      this.#rendreProfil(zone);
    });
    zone.querySelector('[data-supprimer]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('droits_btp.profils.confirmer_suppression', { code: p.code }))) return;
      try {
        await api.droits.supprimerProfil(p.id);
        this.#lignes = null;
        this.app.naviguer('/parametres/droits');
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-renommer]')?.addEventListener('click', async () => {
      try {
        const m = await api.droits.modifierProfil(p.id, { libelle: zone.querySelector('[data-libelle]').value, description: zone.querySelector('[data-description]').value });
        Object.assign(this.profil, m);
        this.app.message(texte('droits_btp.profils.modifie'), 'succes');
      } catch (e) { this.app.erreur(e); }
    });
    zone.querySelector('[data-journal]').addEventListener('toggle', async (e) => {
      if (!e.target.open) return;
      const journal = await api.droits.journal(p.code).catch((x) => { this.app.erreur(x); return []; });
      zone.querySelector('[data-lignes-journal]').innerHTML = journal.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('authentification_btp.comptes.quand')}</th><th>${texteHtml('authentification_btp.comptes.par')}</th><th>${texteHtml('authentification_btp.comptes.evenement')}</th><th>${texteHtml('droits_btp.profils.noeud')}</th><th>${texteHtml('droits_btp.profils.avant')}</th><th>${texteHtml('droits_btp.profils.apres')}</th></tr></thead><tbody>
        ${journal.map((j) => `<tr><td>${formatDateHeure(j.le)}</td><td>${echapper(j.par)}</td><td>${echapper(evenement(j.evenement))}</td><td>${echapper(j.noeud ?? '')}</td>
          <td>${echapper(texteJournal(j, j.avant))}</td><td>${echapper(texteJournal(j, j.apres))}</td></tr>`).join('')}</tbody></table>`
        : `<p class="aide">${texteHtml('droits_btp.profils.aucune_modification')}</p>`;
    });
  }

  /** Nœud visible : racine, ou tous ses ancêtres dépliés. */
  #visible(cle) {
    for (let n = parent(cle); n; n = parent(n)) if (!this.#ouverts.has(n)) return false;
    return true;
  }

  #rendreArbre(zone, modifiable) {
    const droits = { total: false, lignes: this.#lignes };
    const enfants = new Set(this.catalogue.map((n) => parent(n.cle)).filter(Boolean));
    const lignes = this.catalogue.filter((n) => this.#visible(n.cle)).map((n) => {
      const e = actionsEffectives(droits, n.cle);
      const propre = Object.hasOwn(this.#lignes, n.cle);
      const niveau = n.cle.split('/').length - 1;
      const cellules = this.colonnes.map((a) => {
        if (!n.actions.includes(a)) return '<td></td>';
        const p = e.actions[a];
        if (n.portee) {
          return `<td class="cellule-portee" data-noeud="${n.cle}" data-action="${a}" data-portee="${p ?? ''}"></td>`;
        }
        return `<td class="centre"><input type="checkbox" data-noeud="${n.cle}" data-action="${a}" ${p ? 'checked' : ''} ${modifiable ? '' : 'disabled'}
          title="${texteHtml('droits_btp.profils.case_aide', { action: LIBELLES_ACTIONS[a] ?? a, noeud: n.libelle })}"></td>`;
      }).join('');
      const descendants = Object.keys(this.#lignes).some((x) => x.startsWith(`${n.cle}/`));
      return `<tr class="${propre ? '' : 'herite'}"><td style="padding-left: ${0.4 + niveau * 1.2}rem">
          ${enfants.has(n.cle) ? `<button type="button" class="bouton-icone" data-deplier="${n.cle}" aria-label="${texteHtml('droits_btp.profils.deplier')}">${this.#ouverts.has(n.cle) ? iconeHtml('droits_btp_deplie') : iconeHtml('droits_btp_replie')}</button>` : '<span class="espace-icone"></span>'}
          ${n.icone ? `${n.icone} ` : ''}<span title="${echapper(n.aide ?? n.cle)}">${echapper(n.libelle)}</span></td>
        <td class="aide">${propre ? texteHtml('droits_btp.profils.propre') : e.source ? texteHtml('droits_btp.profils.herite', { source: this.#libelle(e.source) }) : texteHtml('droits_btp.profils.aucun_droit')}</td>
        ${cellules}
        <td class="cellule-boutons">${modifiable && propre && parent(n.cle) ? `<button type="button" class="bouton-icone" data-heriter="${n.cle}" title="${texteHtml('droits_btp.profils.heriter')}">${iconeHtml('droits_btp_heriter')}</button>` : ''}
          ${modifiable && descendants ? `<button type="button" class="bouton-icone" data-reappliquer="${n.cle}" title="${texteHtml('droits_btp.profils.reappliquer')}">${iconeHtml('droits_btp_reappliquer')}</button>` : ''}</td></tr>`;
    }).join('');
    zone.innerHTML = `<table class="tableau-compact droits-arbre"><thead><tr><th>${texteHtml('droits_btp.profils.noeud_colonne')}</th><th>${texteHtml('droits_btp.profils.origine')}</th>
      ${this.colonnes.map((a) => `<th class="centre">${echapper(LIBELLES_ACTIONS[a] ?? a)}</th>`).join('')}<th></th></tr></thead><tbody>${lignes}</tbody></table>`;
    const redessiner = () => this.#rendreArbre(zone, modifiable);
    zone.querySelectorAll('[data-deplier]').forEach((b) => b.addEventListener('click', () => {
      const c = b.dataset.deplier;
      if (this.#ouverts.has(c)) this.#ouverts.delete(c); else this.#ouverts.add(c);
      redessiner();
    }));
    const changer = (noeud, action, portee) => {
      const actuelles = actionsEffectives(droits, noeud).actions;
      const permises = this.permises[noeud];
      const base = Object.fromEntries(Object.entries(actuelles).filter(([a]) => permises.includes(a)));
      const suivantes = portee ? cocher(base, action, portee) : decocher(base, action);
      this.#lignes = { ...this.#lignes, [noeud]: Object.fromEntries(Object.entries(suivantes).filter(([a]) => permises.includes(a))) };
      redessiner();
    };
    zone.querySelectorAll('input[type="checkbox"][data-noeud]').forEach((c) => c.addEventListener('change', () => changer(c.dataset.noeud, c.dataset.action, c.checked ? 'TOUT' : null)));
    zone.querySelectorAll('.cellule-portee').forEach((td) => {
      const combo = creerCombo({ options: PORTEES.map((p) => ({ valeur: p, libelle: LIBELLES_PORTEES[p] })), valeur: td.dataset.portee, titre: texte('droits_btp.profils.portee', { action: LIBELLES_ACTIONS[td.dataset.action] }) });
      combo.size = 7;
      if (!modifiable) combo.disabled = true;
      combo.addEventListener('change', () => changer(td.dataset.noeud, td.dataset.action, combo.valeurCombo || null));
      td.append(combo);
    });
    zone.querySelectorAll('[data-heriter]').forEach((b) => b.addEventListener('click', () => {
      const { [b.dataset.heriter]: _, ...reste } = this.#lignes;
      this.#lignes = reste;
      redessiner();
    }));
    zone.querySelectorAll('[data-reappliquer]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmer(texte('droits_btp.profils.confirmer_reappliquer'))) return;
      this.#lignes = reappliquer(this.#lignes, b.dataset.reappliquer);
      redessiner();
    }));
  }

  /** Montants de validation : une ligne par nœud de documents qui en porte, ajout par combo. */
  #rendreLimites(zone, modifiable) {
    const noeuds = this.catalogue.filter((n) => n.cle === 'documents' || n.cle.startsWith('documents/'));
    const affiche = (v) => (v === '-1' ? '' : v);
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('droits_btp.profils.documents')}</th><th class="nombre">${texteHtml('droits_btp.profils.par_piece')}</th><th class="nombre">${texteHtml('droits_btp.profils.cumul')}</th><th class="nombre">${texteHtml('droits_btp.profils.jours')}</th><th></th></tr></thead><tbody>
      ${Object.entries(this.#limites).sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, l]) => `<tr data-noeud="${n}"><td>${echapper(this.#libelle(n))}</td>
        <td><input data-champ="piece" value="${echapper(affiche(l.piece))}" size="10" inputmode="decimal" ${modifiable ? '' : 'disabled'}></td>
        <td><input data-champ="cumul" value="${echapper(affiche(l.cumul))}" size="10" inputmode="decimal" ${modifiable ? '' : 'disabled'}></td>
        <td><input data-champ="jours" value="${echapper(l.jours)}" size="4" inputmode="numeric" ${modifiable ? '' : 'disabled'}></td>
        <td class="cellule-boutons">${modifiable ? `<button type="button" class="bouton-icone" data-retirer title="${texteHtml('droits_btp.profils.retirer_limite')}">${iconeHtml('retirer')}</button>` : ''}</td></tr>`).join('')
        || `<tr><td colspan="5" class="aide">${texteHtml('droits_btp.profils.aucune_limite')}</td></tr>`}</tbody></table>
      ${modifiable ? `<p class="ligne"><span data-ajout></span> <button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('droits_btp.profils.ajouter_limite')}</button></p>` : ''}`;
    zone.querySelectorAll('tr[data-noeud] input').forEach((i) => i.addEventListener('input', () => {
      const v = i.value.replace(',', '.').trim();
      this.#limites[i.closest('tr').dataset.noeud][i.dataset.champ] = i.dataset.champ === 'jours' ? v : v || '-1';
    }));
    zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => {
      delete this.#limites[b.closest('tr').dataset.noeud];
      this.#rendreLimites(zone, modifiable);
    }));
    if (!modifiable) return;
    const combo = creerCombo({ options: noeuds.filter((n) => !this.#limites[n.cle]).map((n) => ({ valeur: n.cle, libelle: n.libelle, detail: n.cle })), titre: texte('droits_btp.profils.documents') });
    zone.querySelector('[data-ajout]').append(combo);
    zone.querySelector('[data-ajouter]').addEventListener('click', () => {
      if (!combo.valeurCombo) return;
      this.#limites[combo.valeurCombo] = { piece: '-1', cumul: '-1', jours: '30' };
      this.#rendreLimites(zone, modifiable);
    });
  }

  #libelle(cle) { return this.catalogue.find((n) => n.cle === cle)?.libelle ?? cle; }
}
