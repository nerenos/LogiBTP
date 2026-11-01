import { texte, texteHtml, icone, iconeHtml, pluriel } from '@logibtp/socle/dictionnaire';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, champDate, formatNombre, formatDate, formatDateHeure, lireStockage, ecrireStockage, confirmer } from '@logibtp/socle/ui';
import { aujourdhui } from '@logibtp/socle';
import { COUT } from '@logibtp/rentabilite';
import { TableauDetail, TableauFaits } from '@logibtp/rentabilite/ui';
import { TYPE_FICHE, ROLE_RENTABILITE, urlFiche, urlDocument } from '../codes.js';
import { api } from '../api.js';
import { champRattachement } from '../structure/selection.js';

// Module Rentabilité, lot 1 (ANALYSE-MODULE-ANALYSE.md § 7, § 8, § 10) : choix d'un chantier, Détail d'un chantier et de
// ses ordres (natures, total en haut, montants anormaux en rouge), faits d'un chiffre (double-clic, Ctrl : nouvelle
// fenêtre), rapprochement des pièces et des faits, paramètres (rôle des types, taux horaires, frais généraux).

const CLE_COUT = 'rentabiliteCout';
const montant = (v) => formatNombre(v, 2);

/** Adresse de la page des faits d'un chiffre. */
export function urlFaits(chantier, f) {
  const p = new URLSearchParams({ chantier });
  if (f.indicateurs?.length) p.set('indicateur', f.indicateurs.join(','));
  if (f.natures?.length) p.set('nature', f.natures.join(','));
  if (f.composante) p.set('composante', f.composante);
  if (f.ordre !== undefined && f.ordre !== null && f.ordre !== '') p.set('ordre', f.ordre);
  if (f.au) p.set('au', f.au);
  if (f.colonne) p.set('colonne', f.colonne);
  if (f.ligne) p.set('ligne', f.ligne);
  return `/rentabilite/faits?${p}`;
}

/** Fraîcheur des chiffres : dernier calcul, attente dans la file, erreur. */
function fraicheurHtml(f) {
  const d = f.dernier;
  const parts = [];
  if (d) {
    parts.push(texteHtml('rentabilite_btp.fraicheur.calcule', { date: formatDateHeure(d.fin ?? d.debut), declencheur: texte(`rentabilite_btp.declencheurs.${d.declencheur}`) }));
    if (d.etat === 'ERREUR') parts.push(`<span class="rentabilite-anomalie">${iconeHtml('rentabilite_anomalie')} ${texteHtml('rentabilite_btp.fraicheur.erreur', { message: d.message ?? '' })}</span>`);
    if (d.version !== f.version_regles) parts.push(texteHtml('rentabilite_btp.fraicheur.version'));
  } else parts.push(texteHtml('rentabilite_btp.fraicheur.jamais'));
  if (f.en_attente) parts.push(`${iconeHtml('rentabilite_btp_attente')} ${texteHtml('rentabilite_btp.fraicheur.attente', { raison: f.raison ?? '' })}`);
  if (f.erreur) parts.push(`<span class="rentabilite-anomalie">${echapper(f.erreur)}</span>`);
  return parts.join(' · ');
}

/** Accueil du module : choix d'un chantier, état de la file, recalcul général (administrateur). */
export class PageRentabilite extends PageBase {
  icone = icone('rentabilite_detail');

  urlCourante() { return '/rentabilite'; }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.accueil');
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_detail')} ${texteHtml('rentabilite_btp.routes.accueil')}</h1></div>
      <p class="aide">${texteHtml('rentabilite_btp.accueil.aide')}</p>
      <p class="ligne" data-choix></p>
      <h2>${texteHtml('rentabilite_btp.accueil.file')}</h2><p data-file></p>
      ${this.app.estAdmin() ? `<p><button type="button" data-tout title="${texteHtml('rentabilite_btp.accueil.tout_titre')}">${iconeHtml('rentabilite_btp_recalculer')} ${texteHtml('rentabilite_btp.accueil.tout')}</button></p>` : ''}</div>`;
    const refs = await api.structureReferentiels();
    this.conteneur.querySelector('[data-choix]').append(champRattachement({
      type: TYPE_FICHE.CHANTIER, refs, valeur: null, titre: texte('rentabilite_btp.accueil.chantier'),
      choisir: (id) => { if (id) this.app.naviguer(`/rentabilite/chantier/${id}`); },
    }));
    this.conteneur.querySelector('.rattachement-code')?.focus();
    this.conteneur.querySelector('[data-tout]')?.addEventListener('click', async () => {
      if (!await confirmer(texte('rentabilite_btp.accueil.tout_confirmer'))) return;
      try {
        const r = await api.rentabilite.recalculerTout();
        this.app.message(pluriel('rentabilite_btp.accueil.tout_fait', r.chantiers, { nombre: r.chantiers }), 'succes');
        await this.#file();
      } catch (e) { this.app.erreur(e); }
    });
    await this.#file();
  }

  reprendre() { this.#file(); }

  async #file() {
    const zone = this.conteneur.querySelector('[data-file]');
    try {
      const f = await api.rentabilite.file();
      zone.innerHTML = f.attente
        ? `${echapper(pluriel('rentabilite_btp.accueil.attente', f.attente, { nombre: f.attente }))}${f.erreurs ? ` · <span class="rentabilite-anomalie">${echapper(pluriel('rentabilite_btp.accueil.erreurs', f.erreurs, { nombre: f.erreurs }))}</span>` : ''}`
        : texteHtml('rentabilite_btp.accueil.file_vide');
    } catch (e) { this.app.erreur(e); }
  }
}

/** Détail d'un chantier (§ 7) : ordre (tout, sans ordre, un ordre), coût PA ou PR, jusqu'au, contrôles. */
export class PageRentabiliteChantier extends PageBase {
  icone = icone('rentabilite_detail');

  urlCourante() {
    const p = new URLSearchParams(Object.entries({ ordre: this.filtre?.ordre, au: this.filtre?.au }).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return `/rentabilite/chantier/${encodeURIComponent(this.params.id)}${p.size ? `?${p}` : ''}`;
  }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.chantier');
    this.filtre = { ordre: this.requete.ordre ?? '', au: this.requete.au ?? '', cout: lireStockage(CLE_COUT, COUT.PR) === COUT.PA ? COUT.PA : COUT.PR };
    this.conteneur.innerHTML = '<div class="page-parametres page-rentabilite" data-corps></div>';
    await this.#charger();
  }

  reprendre() { this.#charger(); }

  async #charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    let d;
    try { d = await api.rentabilite.chantier(this.params.id, this.filtre.au); } catch (e) { this.app.erreur(e); corps.innerHTML = `<p class="aide">${texteHtml('rentabilite_btp.chantier.introuvable')}</p>`; return; }
    this.donnees = d;
    const c = d.chantier;
    this.titre = texte('rentabilite_btp.chantier.titre', { code: c.code });
    if (!d.voir_couts) this.filtre.cout = COUT.PR;
    corps.innerHTML = `<div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_detail')} <a href="${urlFiche(TYPE_FICHE.CHANTIER, c.id)}">${echapper(c.code)}</a> ${echapper(c.libelle ?? '')}</h1>
        <div class="barre-outils"><div class="groupe-outils">
          <button type="button" data-recalculer title="${texteHtml('rentabilite_btp.chantier.recalculer_titre')}">${iconeHtml('rentabilite_btp_recalculer')} ${texteHtml('rentabilite_btp.chantier.recalculer')}</button>
          <a class="bouton" href="/rentabilite/rapprochement/${Number(c.id)}" title="${texteHtml('rentabilite_btp.chantier.rapprochement_titre')}">${iconeHtml('rentabilite_btp_rapprochement')} ${texteHtml('rentabilite_btp.chantier.rapprochement')}</a>
        </div></div></div>
      <p class="aide">${[c.affaire ? texteHtml('rentabilite_btp.chantier.affaire', { affaire: c.affaire }) : '', c.charge ? texteHtml('rentabilite_btp.chantier.charge', { nom: c.charge }) : ''].filter(Boolean).join(' · ')}</p>
      <p class="aide" data-fraicheur>${fraicheurHtml(d.fraicheur)}</p>
      <p class="ligne"><label>${texteHtml('rentabilite_btp.chantier.ordre')} <span data-ordre></span></label>
        ${d.voir_couts ? `<label>${texteHtml('rentabilite_btp.chantier.cout')} <span data-cout></span></label>` : ''}
        <label title="${texteHtml('rentabilite_btp.chantier.au_titre')}">${texteHtml('rentabilite_btp.chantier.au')} <input type="date" data-au value="${echapper(this.filtre.au)}"></label></p>
      <div data-detail></div>
      <div data-controles></div>
      <p class="aide">${texteHtml('rentabilite.detail.ouvrir_faits')}</p>`;
    const ordres = creerCombo({
      options: [{ valeur: '0', libelle: texte('rentabilite_btp.chantier.sans_ordre') },
        ...d.ordres.map((o) => ({ valeur: String(o.id), libelle: `${o.numero ?? `#${o.id}`} ${o.libelle ?? ''}`.trim(), detail: o.statut }))],
      valeur: this.filtre.ordre, vide: true, titre: texte('rentabilite_btp.chantier.ordre_titre'),
    });
    corps.querySelector('[data-ordre]').append(ordres);
    ordres.addEventListener('change', () => { this.filtre.ordre = ordres.valeurCombo ?? ''; this.#memoriser(); this.#rendreDetail(); });
    if (d.voir_couts) {
      const cout = creerCombo({ options: [{ valeur: COUT.PR, libelle: texte('rentabilite_btp.chantier.cout_pr') }, { valeur: COUT.PA, libelle: texte('rentabilite_btp.chantier.cout_pa') }], valeur: this.filtre.cout, vide: false });
      corps.querySelector('[data-cout]').append(cout);
      cout.addEventListener('change', () => { this.filtre.cout = cout.valeurCombo; ecrireStockage(CLE_COUT, this.filtre.cout); this.#rendreDetail(); });
    }
    const au = champDate(corps.querySelector('[data-au]'));
    au.addEventListener('change', () => { this.filtre.au = au.value; this.#memoriser(); this.#charger(); });
    corps.querySelector('[data-recalculer]').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await api.rentabilite.recalculer(c.id);
        this.app.message(texte('rentabilite_btp.chantier.recalcule', { ajouts: r.ajouts, retraits: r.retraits, modifies: r.modifies }), r.etat === 'ERREUR' ? 'erreur' : 'succes');
        await this.#charger();
      } catch (e) { this.app.erreur(e); ev.target.disabled = false; }
    });
    this.tableau = new TableauDetail(corps.querySelector('[data-detail]'), {
      ouvrirFaits: (f, nouvelle) => this.app.naviguer(urlFaits(c.id, { ...f, au: this.filtre.au }), { nouvelleFenetre: nouvelle }),
    });
    this.#rendreDetail();
    this.#rendreControles(corps.querySelector('[data-controles]'));
  }

  #memoriser() { this.app.routeur?.remplacerUrl?.(this.urlCourante()); }

  #rendreDetail() {
    this.tableau.rendre(this.donnees, { cout: this.filtre.cout, ordre: this.filtre.ordre === '' ? undefined : this.filtre.ordre });
  }

  /** Contrôles (§ 10) : pointages non valorisés, valorisés au taux du service, sorties sans prix, tâches sans taux. */
  #rendreControles(zone) {
    const l = this.donnees.controles ?? [];
    if (!l.length) { zone.innerHTML = ''; return; }
    zone.innerHTML = `<h2>${iconeHtml('rentabilite_anomalie')} ${texteHtml('rentabilite_btp.controles.titre')}</h2>
      <table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.controles.regle')}</th><th class="montant">${texteHtml('rentabilite_btp.controles.nombre')}</th>
        <th class="montant">${texteHtml('rentabilite_btp.controles.heures')}</th>${this.donnees.voir_couts ? `<th class="montant">${texteHtml('rentabilite_btp.controles.montant')}</th>` : ''}</tr></thead>
      <tbody>${l.map((x) => `<tr><td><a href="${urlFaits(this.donnees.chantier.id, { au: this.filtre.au })}&regle=${encodeURIComponent(x.regle)}">${texteHtml(`rentabilite_btp.regles.${x.regle}`)}</a></td>
        <td class="montant">${x.nb}</td><td class="montant">${x.heures === null ? '' : montant(x.heures)}</td>${this.donnees.voir_couts ? `<td class="montant">${montant(x.pa)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
}

/** Faits d'un chiffre (§ 8) : regroupés par pièce, pièces annulées masquées par défaut, ⧉ nouvelle fenêtre. */
export class PageRentabiliteFaits extends PageBase {
  icone = icone('rentabilite_faits');

  urlCourante() {
    const p = new URLSearchParams(Object.entries(this.requete).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return `/rentabilite/faits?${p}`;
  }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.faits');
    const r = this.requete;
    this.annulees = false;
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre" data-titre>${iconeHtml('rentabilite_faits')} ${texteHtml('rentabilite_btp.routes.faits')}</h1>
        <div class="barre-outils"><div class="groupe-outils"><button type="button" data-fenetre title="${texteHtml('rentabilite_btp.faits.fenetre')}">${iconeHtml('rentabilite_nouvelle_fenetre')}</button></div></div></div>
      <p class="aide" data-filtre></p>
      <p class="ligne"><label><input type="checkbox" data-annulees> ${texteHtml('rentabilite.faits.annulees')}</label></p>
      <div data-faits></div></div>`;
    this.conteneur.querySelector('[data-fenetre]').addEventListener('click', () => this.app.naviguer(this.urlCourante(), { nouvelleFenetre: true }));
    this.conteneur.querySelector('[data-annulees]').addEventListener('change', (e) => { this.annulees = e.target.checked; this.#rendre(); });
    try {
      this.donnees = await api.rentabilite.faits(r.chantier, { indicateur: r.indicateur, nature: r.nature, ordre: r.ordre, composante: r.composante, piece: r.piece, du: r.du, au: r.au });
    } catch (e) { this.app.erreur(e); return; }
    const d = this.donnees;
    if (r.regle) d.faits = d.faits.filter((f) => f.afa_regle === r.regle);
    const c = d.chantier;
    this.titre = texte('rentabilite_btp.faits.titre', { code: c.code });
    this.conteneur.querySelector('[data-titre]').innerHTML = `${iconeHtml('rentabilite_faits')} ${texteHtml('rentabilite_btp.faits.titre', { code: c.code })}`;
    const colonne = r.colonne ? texte(`rentabilite.colonnes.${r.colonne}.libelle`) : (r.indicateur ?? '').split(',').filter(Boolean).map((i) => texte(`rentabilite.indicateurs.${i}`)).join(', ');
    this.conteneur.querySelector('[data-filtre]').innerHTML = [
      `<a href="/rentabilite/chantier/${Number(c.id)}">${iconeHtml('rentabilite_detail')} ${echapper(c.code)} ${echapper(c.libelle ?? '')}</a>`,
      colonne ? echapper(colonne) : '', r.ligne ? echapper(r.ligne) : '', r.regle ? texteHtml(`rentabilite_btp.regles.${r.regle}`) : '',
      r.au ? texteHtml('rentabilite_btp.faits.jusquau', { date: formatDate(r.au) }) : '',
    ].filter(Boolean).join(' · ');
    this.#rendre();
  }

  #rendre() {
    const d = this.donnees;
    if (!d) return;
    const natures = new Map(d.natures.map((n) => [n.id, `${n.code} – ${n.libelle}`]));
    const ordres = new Map(d.ordres.map((o) => [o.id, o.numero ?? `#${o.id}`]));
    new TableauFaits(this.conteneur.querySelector('[data-faits]'), {
      annulees: this.annulees, voirCouts: d.voir_couts,
      libelleRegle: (code) => texte(`rentabilite_btp.regles.${code}`),
      libelleNature: (id) => (id === null || id === undefined ? texte('rentabilite.detail.non_ventile') : natures.get(id) ?? ''),
      libelleOrdre: (id) => (id === null || id === undefined ? '' : ordres.get(id) ?? ''),
      ouvrirPiece: (id, nouvelle) => this.app.naviguer(urlDocument(id), { nouvelleFenetre: nouvelle }),
    }).rendre(d);
  }
}

/** Rapprochement (§ 8) : total de chaque pièce ou source et somme de ses faits ; écart non nul en rouge. */
export class PageRentabiliteRapprochement extends PageBase {
  icone = icone('rentabilite_btp_rapprochement');

  urlCourante() { return `/rentabilite/rapprochement/${encodeURIComponent(this.params.id)}`; }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.rapprochement');
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_btp_rapprochement')} ${texteHtml('rentabilite_btp.routes.rapprochement')}</h1></div>
      <p class="aide">${texteHtml('rentabilite_btp.rapprochement.aide')}</p>
      <p class="ligne"><label><input type="checkbox" data-ecarts checked> ${texteHtml('rentabilite_btp.rapprochement.ecarts_seuls')}</label>
        <a href="/rentabilite/chantier/${Number(this.params.id)}">${iconeHtml('rentabilite_detail')} ${texteHtml('rentabilite_btp.rapprochement.retour')}</a></p>
      <div data-lignes></div></div>`;
    try { this.lignes = await api.rentabilite.rapprochement(this.params.id); } catch (e) { this.app.erreur(e); return; }
    const ecarts = this.conteneur.querySelector('[data-ecarts]');
    ecarts.addEventListener('change', () => this.#rendre(ecarts.checked));
    this.#rendre(ecarts.checked);
  }

  #rendre(ecartsSeuls) {
    const zone = this.conteneur.querySelector('[data-lignes]');
    const nonNul = (v) => Number(v) !== 0;
    const lignes = ecartsSeuls ? this.lignes.filter((l) => nonNul(l.ecart)) : this.lignes;
    if (!lignes.length) {
      zone.innerHTML = `<p class="aide">${texteHtml(ecartsSeuls ? 'rentabilite_btp.rapprochement.aucun_ecart' : 'rentabilite_btp.rapprochement.aucune')}</p>`;
      return;
    }
    const piece = (l) => (l.piece ? `<a href="${urlDocument(l.ent_id)}">${echapper(`${l.piece.type_libelle ?? l.piece.type} ${l.piece.numero ?? ''}`)}</a>` : echapper(l.libelle));
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.rapprochement.piece')}</th><th>${texteHtml('rentabilite_btp.rapprochement.indicateur')}</th>
        <th>${texteHtml('rentabilite_btp.rapprochement.champ')}</th><th class="montant">${texteHtml('rentabilite_btp.rapprochement.attendu')}</th>
        <th class="montant">${texteHtml('rentabilite_btp.rapprochement.faits')}</th><th class="montant">${texteHtml('rentabilite_btp.rapprochement.ecart')}</th></tr></thead>
      <tbody>${lignes.map((l) => `<tr><td>${piece(l)}</td><td>${texteHtml(`rentabilite.indicateurs.${l.indicateur}`)}</td><td>${echapper(l.champ)}</td>
        <td class="montant">${montant(l.attendu)}</td>
        <td class="montant"><a href="${urlFaits(this.params.id, { indicateurs: [l.indicateur] })}${l.ent_id ? `&piece=${Number(l.ent_id)}` : ''}">${montant(l.faits)}</a></td>
        <td class="montant${nonNul(l.ecart) ? ' rentabilite-anomalie' : ''}"${nonNul(l.ecart) ? ` title="${texteHtml('rentabilite_btp.rapprochement.ecart_titre')}"` : ''}>${montant(l.ecart)}</td></tr>`).join('')}</tbody></table>`;
  }
}

/** Paramètres (administrateur) : rôle de chaque type de pièce, taux horaire par service, coefficients de frais généraux. */
export class PageParametresRentabilite extends PageBase {
  icone = icone('rentabilite_detail');
  #modifie = false;

  get modifiee() { return this.#modifie; }

  urlCourante() { return '/parametres/rentabilite'; }

  async ouvrir() {
    this.titre = texte('rentabilite_btp.routes.parametres');
    const admin = this.app.estAdmin();
    this.conteneur.innerHTML = `<div class="page-parametres page-rentabilite"><div class="entete-page"><h1 class="page-titre">${iconeHtml('rentabilite_detail')} ${texteHtml('rentabilite_btp.routes.parametres')}</h1></div>
      <h2>${texteHtml('rentabilite_btp.parametres.roles')}</h2><p class="aide">${texteHtml('rentabilite_btp.parametres.roles_aide')}</p><div data-roles></div>
      <h2>${texteHtml('rentabilite_btp.parametres.taux')}</h2><p class="aide">${texteHtml('rentabilite_btp.parametres.taux_aide')}</p><div data-taux></div>
      <h2>${texteHtml('rentabilite_btp.parametres.coefs')}</h2><p class="aide">${texteHtml('rentabilite_btp.parametres.coefs_aide')}</p><div data-coefs></div>
      ${admin ? `<p class="aide">${texteHtml('rentabilite_btp.parametres.recalcul')}</p>` : `<p class="aide">${texteHtml('rentabilite_btp.parametres.lecture')}</p>`}</div>`;
    let p;
    try { p = await api.rentabilite.parametres(); } catch (e) { this.app.erreur(e); return; }
    this.#roles(p.roles, admin);
    this.#taux(p.taux, admin);
    this.#coefs(p.coefs, p.natures, admin);
  }

  #bouton(zone, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = texte('commun.enregistrer');
    b.addEventListener('click', async () => {
      try { await action(); this.#modifie = false; this.app.message(texte('rentabilite_btp.parametres.enregistre'), 'succes'); } catch (e) { this.app.erreur(e); }
    });
    const p = document.createElement('p');
    p.append(b);
    zone.append(p);
  }

  #roles(roles, admin) {
    const zone = this.conteneur.querySelector('[data-roles]');
    const options = Object.values(ROLE_RENTABILITE).map((r) => ({ valeur: r, libelle: texte(`rentabilite_btp.roles.${r}`), detail: r }));
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.parametres.type')}</th><th>${texteHtml('rentabilite_btp.parametres.famille')}</th>
      <th>${texteHtml('rentabilite_btp.parametres.role')}</th></tr></thead><tbody>${roles.map((r, i) => `<tr data-i="${i}"><td>${echapper(r.libelle)} <small>${echapper(r.type)}</small></td>
      <td>${echapper(r.famille)}</td><td data-role></td></tr>`).join('')}</tbody></table>`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const r = roles[Number(tr.dataset.i)];
      if (!admin) { tr.querySelector('[data-role]').textContent = r.role ? texte(`rentabilite_btp.roles.${r.role}`) : '—'; return; }
      const c = creerCombo({ options, valeur: r.role ?? '', vide: true });
      c.addEventListener('change', () => { r.role = c.valeurCombo || null; this.#modifie = true; });
      tr.querySelector('[data-role]').append(c);
    });
    if (admin) this.#bouton(zone, () => api.rentabilite.enregistrerRoles(roles));
  }

  #taux(taux, admin) {
    const zone = this.conteneur.querySelector('[data-taux]');
    zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.parametres.service')}</th><th class="montant">${texteHtml('rentabilite_btp.parametres.taux_horaire')}</th></tr></thead>
      <tbody>${taux.map((t, i) => `<tr><td>${echapper(t.service)}</td><td><input data-i="${i}" size="8" inputmode="decimal" class="montant" value="${t.taux === null ? '' : echapper(formatNombre(t.taux, 2))}" ${admin ? '' : 'readonly'}></td></tr>`).join('')}</tbody></table>`;
    zone.querySelectorAll('input[data-i]').forEach((input) => input.addEventListener('change', () => {
      const v = input.value.trim().replace(/\s/g, '').replace(',', '.');
      taux[Number(input.dataset.i)].taux = v === '' ? null : v;
      this.#modifie = true;
    }));
    if (admin) this.#bouton(zone, () => api.rentabilite.enregistrerTaux(taux));
  }

  #coefs(coefs, natures, admin) {
    const zone = this.conteneur.querySelector('[data-coefs]');
    const options = natures.map((n) => ({ valeur: String(n.id), libelle: `${n.code} – ${n.libelle}`, detail: n.code }));
    const rendre = () => {
      zone.innerHTML = `<table class="tableau-compact"><thead><tr><th>${texteHtml('rentabilite_btp.parametres.nature')}</th><th>${texteHtml('rentabilite_btp.parametres.depuis')}</th>
        <th class="montant">${texteHtml('rentabilite_btp.parametres.coef')}</th>${admin ? '<th class="cellule-boutons"></th>' : ''}</tr></thead>
        <tbody>${coefs.map((c, i) => `<tr data-i="${i}"><td data-nature></td><td><input type="date" data-depuis value="${echapper(c.depuis ?? '')}" ${admin ? '' : 'readonly'}></td>
          <td><input data-coef size="8" inputmode="decimal" class="montant" value="${echapper(formatNombre(c.coef, 4))}" ${admin ? '' : 'readonly'}></td>
          ${admin ? `<td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('rentabilite_btp.parametres.retirer')}">${iconeHtml('retirer')}</button></td>` : ''}</tr>`).join('')}</tbody></table>
        ${admin ? `<p><button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('rentabilite_btp.parametres.ajouter')}</button></p>` : ''}`;
      zone.querySelectorAll('tr[data-i]').forEach((tr) => {
        const c = coefs[Number(tr.dataset.i)];
        const nature = creerCombo({ options, valeur: c.nat_id === null ? '' : String(c.nat_id), vide: true, titre: texte('rentabilite_btp.parametres.toutes') });
        if (!admin) nature.readOnly = true;
        nature.placeholder = texte('rentabilite_btp.parametres.toutes');
        nature.addEventListener('change', () => { c.nat_id = nature.valeurCombo ? Number(nature.valeurCombo) : null; this.#modifie = true; });
        tr.querySelector('[data-nature]').append(nature);
        const depuis = champDate(tr.querySelector('[data-depuis]'));
        depuis.addEventListener('change', () => { c.depuis = depuis.value; this.#modifie = true; });
        tr.querySelector('[data-coef]').addEventListener('change', (e) => { c.coef = e.target.value.trim().replace(/\s/g, '').replace(',', '.'); this.#modifie = true; });
        tr.querySelector('[data-retirer]')?.addEventListener('click', () => { coefs.splice(Number(tr.dataset.i), 1); this.#modifie = true; rendre(); });
      });
      zone.querySelector('[data-ajouter]')?.addEventListener('click', () => {
        coefs.push({ nat_id: null, depuis: aujourdhui(), coef: '1' });
        this.#modifie = true;
        rendre();
      });
      if (admin) this.#bouton(zone, () => api.rentabilite.enregistrerCoefs(coefs));
    };
    rendre();
  }
}
