import { urlDocument } from '../codes.js';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Module Stock, lot 3 (ANALYSE-MODULE-STOCK.md § 5.4, S13 à S15) : approvisionnement d'un dépôt : ruptures à venir
// (stock, réservé, attendu, disponible, première rupture, disponible le plus bas), propositions de commande sous le mini
// à l'horizon (délai de l'article, sinon du dépôt ; arrondies au conditionnement de l'unité d'achat ; une commande en
// brouillon par fournisseur), seuils mini / maxi et délais ; projection d'un article jour par jour (réservations non
// honorées à leur date, commandes en retard).

const ONGLETS = { ruptures: 'Ruptures à venir', propositions: 'Propositions de commande', seuils: 'Mini / maxi' };
const jourFr = (d) => (d ? new Date(`${d}T00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : '');
const nombre = (v) => { const t = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? null : t; };

/** Approvisionnement d'un dépôt : /stock/approvisionnement?lieu=&onglet=. */
export class PageApprovisionnement extends PageBase {
  icone = '🚚';
  #modifie = false;

  get modifiee() { return this.#modifie; }

  async ouvrir() {
    this.titre = 'Approvisionnement';
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    this.onglet = ONGLETS[p.get('onglet')] ? p.get('onglet') : 'ruptures';
    this.conteneur.innerHTML = `<div class="page-parametres page-appro"><div class="entete-page"><h1 class="page-titre">🚚 Approvisionnement</h1>
      <span data-lieu></span><span data-parametres></span></div>
      <p class="aide">Disponible = stock − réservations restantes + commandes à recevoir, jour par jour (réservations à leur date de besoin, commandes à
        leur livraison prévue ; une commande en retard compte aujourd'hui).</p>
      <div class="onglets">${Object.entries(ONGLETS).map(([c, t]) => `<button type="button" data-onglet="${c}">${t}</button>`).join('')}</div><div data-corps></div></div>`;
    const lieux = (await api.stock.lieux()).filter((l) => l.depot);
    this.lieu = Number(p.get('lieu')) || lieux[0]?.id || null;
    const combo = creerCombo({ options: lieux.map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', vide: false });
    combo.addEventListener('change', () => { this.lieu = Number(combo.valeurCombo); this.#charger(); });
    this.conteneur.querySelector('[data-lieu]').append(combo);
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => { this.onglet = b.dataset.onglet; this.#charger(); }));
    this.articles = await api.stock.articles();
    await this.#charger();
  }

  async #charger() {
    this.conteneur.querySelectorAll('[data-onglet]').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === this.onglet));
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!this.lieu) { corps.innerHTML = '<p class="aide">Aucun dépôt.</p>'; return; }
    try {
      await this.#parametres();
      if (this.onglet === 'seuils') await this.#seuils(corps);
      else this.#synthese(corps, await api.stock.approvisionnement(this.lieu));
    } catch (e) { this.app.erreur(e); }
  }

  async #parametres() {
    const p = await api.stock.parametresLieu(this.lieu);
    const z = this.conteneur.querySelector('[data-parametres]');
    z.innerHTML = `<label title="Horizon des propositions quand l'article n'a pas de délai">Délai <input data-delai size="3" value="${p.delai_jours}"> j</label>
      <button type="button" data-enr-param title="Enregistrer le délai du dépôt">✓</button>`;
    z.querySelector('[data-enr-param]').addEventListener('click', async () => {
      try {
        await api.stock.enregistrerParametresLieu(this.lieu, { lieu: this.lieu, delai_jours: Number(z.querySelector('[data-delai]').value) || 0, frise_jours: p.frise_jours });
        await this.#charger();
      } catch (e) { this.app.erreur(e); }
    });
  }

  #lienProjection(l) { return `<a href="/stock/projection?lieu=${this.lieu}&article=${l.ele}" data-projection="${l.ele}">${echapper(l.code)}</a>`; }

  #synthese(corps, lignes) {
    const nb = (v, p) => (v === null || v === undefined ? '' : formatNombre(v, p));
    if (this.onglet === 'ruptures') {
      corps.innerHTML = lignes.length ? `<table class="tableau-compact"><thead><tr><th>Article</th><th>Libellé</th><th>Stock</th><th>Réservé</th><th>Attendu</th>
        <th>Disponible</th><th>U.</th><th>1re rupture</th><th>Plus bas</th><th>Mini</th><th>Maxi</th><th>À commander</th></tr></thead><tbody>
        ${lignes.map((l) => `<tr class="${l.premiere_rupture ? 'avertissement' : ''}"><td>${this.#lienProjection(l)}</td><td>${echapper(l.libelle)}</td>
          <td class="nombre">${nb(l.stock, l.precision)}</td><td class="nombre">${nb(l.reserve, l.precision)}</td><td class="nombre">${nb(l.attendu, l.precision)}${l.retards ? ' <span title="Commande ou réservation en retard">⏰</span>' : ''}</td>
          <td class="nombre"><b>${nb(l.disponible, l.precision)}</b></td><td>${echapper(l.unite)}</td><td>${l.premiere_rupture ? `⚠ ${jourFr(l.premiere_rupture)}` : ''}</td>
          <td class="nombre">${nb(l.minimum, l.precision)}${l.minimum_date && Number(l.minimum) < 0 ? ` <small>${jourFr(l.minimum_date)}</small>` : ''}</td>
          <td class="nombre">${nb(l.mini, l.precision)}</td><td class="nombre">${nb(l.maxi, l.precision)}</td>
          <td class="nombre">${l.proposition ? `${nb(l.proposition.quantite, l.precision)}` : ''}</td></tr>`).join('')}</tbody></table>`
        : '<p class="aide">Aucune réservation, commande en cours ou seuil dans ce dépôt.</p>';
    } else {
      const props = lignes.filter((l) => l.proposition);
      corps.innerHTML = props.length ? `<p class="aide">Articles dont le disponible passe sous le mini avant l'horizon : quantité pour revenir au maxi
        (sinon au mini), en unités d'achat du fournisseur principal (tarif principal de la bibliothèque).</p>
        <table class="tableau-compact"><thead><tr><th></th><th>Article</th><th>Libellé</th><th>Plus bas à l'horizon</th><th>Horizon</th><th>Mini</th><th>Maxi</th>
          <th>Unités d'achat</th><th>U. achat</th><th>= U. stock</th><th>Fournisseur</th><th>Prix</th></tr></thead><tbody>
        ${props.map((l, i) => `<tr data-i="${i}"><td><input type="checkbox" data-coche ${l.appro?.fournisseur_id ? 'checked' : 'disabled'}></td><td>${this.#lienProjection(l)}</td>
          <td>${echapper(l.libelle)}</td><td class="nombre">${nb(l.minimum_horizon, l.precision)}</td><td>${jourFr(l.horizon)}</td>
          <td class="nombre">${nb(l.mini, l.precision)}</td><td class="nombre">${nb(l.maxi, l.precision)}</td>
          <td><input data-unites size="6" value="${echapper(String(l.proposition.unites_achat))}"></td><td>${echapper(l.appro?.unite_achat ?? l.unite)}</td>
          <td class="nombre">${nb(l.proposition.quantite, l.precision)} ${echapper(l.unite)}</td>
          <td>${l.appro?.fournisseur_id ? echapper(l.appro.fournisseur) : '<span class="avertissement">Aucun tarif principal</span>'}</td>
          <td class="nombre">${nb(l.appro?.prix, 4)}</td></tr>`).join('')}</tbody></table>
        <p class="ligne"><button type="button" class="principal" data-commander>Créer les commandes (brouillons)</button></p>`
        : '<p class="aide">Aucune proposition : aucun article ne passe sous son mini avant l\'horizon.</p>';
      corps.querySelector('[data-commander]')?.addEventListener('click', async () => {
        const choisies = [...corps.querySelectorAll('tr[data-i]')].filter((tr) => tr.querySelector('[data-coche]').checked).map((tr) => {
          const l = props[Number(tr.dataset.i)];
          return { ele: l.ele, unites_achat: nombre(tr.querySelector('[data-unites]').value), fournisseur_id: l.appro?.fournisseur_id ?? null };
        });
        if (!choisies.length) { this.app.message('Cochez au moins un article', 'avertissement'); return; }
        try {
          const creees = await api.stock.commander(this.lieu, choisies);
          this.app.message(`${creees.length} commande(s) créée(s) : ${creees.map((c) => `${c.fournisseur ?? ''} (${c.lignes} ligne(s))`).join(', ')}`, 'succes');
          if (creees.length === 1) this.app.naviguer(urlDocument(creees[0].ent_id), { nouvelleFenetre: true });
          await this.#charger();
        } catch (e) { this.app.erreur(e); }
      });
    }
    corps.querySelectorAll('[data-projection]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.app.naviguer(a.getAttribute('href'), { nouvelleFenetre: e.ctrlKey });
    }));
  }

  async #seuils(corps) {
    const l = await api.stock.seuils(this.lieu);
    this.#modifie = false;
    const rendre = () => {
      corps.innerHTML = `<table class="tableau-compact"><thead><tr><th>Article</th><th>Libellé</th><th>U.</th><th>Mini</th><th>Maxi</th><th>Délai (j)</th><th class="cellule-boutons"></th></tr></thead><tbody>
        ${l.map((s, i) => `<tr data-i="${i}"><td>${echapper(s.code ?? '')}</td><td>${echapper(s.libelle ?? '')}</td><td>${echapper(s.unite ?? '')}</td>
          <td><input data-c="mini" size="7" value="${s.mini ?? ''}"></td><td><input data-c="maxi" size="7" value="${s.maxi ?? ''}"></td>
          <td><input data-c="delai_jours" size="3" value="${s.delai_jours ?? ''}" placeholder="dépôt"></td>
          <td class="cellule-boutons"><button type="button" data-retirer title="Retirer">✕</button></td></tr>`).join('')}</tbody></table>
        <p class="ligne"><span data-ajout></span> <button type="button" class="principal" data-enregistrer>Enregistrer les seuils</button></p>`;
      corps.querySelectorAll('tr[data-i]').forEach((tr) => {
        const s = l[Number(tr.dataset.i)];
        tr.querySelectorAll('[data-c]').forEach((x) => x.addEventListener('change', () => {
          s[x.dataset.c] = x.dataset.c === 'delai_jours' ? (x.value.trim() === '' ? null : Number(x.value)) : nombre(x.value);
          this.#modifie = true;
        }));
        tr.querySelector('[data-retirer]').addEventListener('click', () => { l.splice(l.indexOf(s), 1); this.#modifie = true; rendre(); });
      });
      const ajout = creerCombo({ options: this.articles.filter((a) => !l.some((s) => s.ele === a.id)).map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}` })), valeur: '', titre: 'Ajouter un article' });
      ajout.placeholder = '＋ article…';
      ajout.size = 36;
      ajout.addEventListener('change', () => {
        const a = this.articles.find((x) => x.id === Number(ajout.valeurCombo));
        if (!a) return;
        l.push({ ele: a.id, code: a.code, libelle: a.libelle, unite: a.unite, mini: null, maxi: null, delai_jours: null });
        this.#modifie = true;
        rendre();
        corps.querySelector('tr:last-child [data-c="mini"]')?.focus();
      });
      corps.querySelector('[data-ajout]').append(ajout);
      corps.querySelector('[data-enregistrer]').addEventListener('click', async () => {
        try {
          const r = await api.stock.enregistrerSeuils(this.lieu, l);
          l.splice(0, l.length, ...r);
          this.#modifie = false;
          rendre();
          this.app.message('Seuils enregistrés', 'succes');
        } catch (e) { this.app.erreur(e); }
      });
    };
    rendre();
  }
}

/** Projection d'un article dans un dépôt : /stock/projection?lieu=&article=. */
export class PageProjection extends PageBase {
  icone = '📈';

  async ouvrir() {
    this.titre = 'Projection du stock';
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    const r = await api.stock.projection(Number(p.get('lieu')), Number(p.get('article')));
    this.titre = `Projection ${r.code}`;
    const nb = (v) => (v === null || v === undefined ? '' : formatNombre(v, r.precision));
    const resa = new Map(r.projection.reservations.map((x) => [x.id, x]));
    let dispo = Number(r.stock);
    const lignes = [...r.evenements].sort((a, b) => {
      const da = a.retard ? r.aujourdhui : a.date;
      const db = b.retard ? r.aujourdhui : b.date;
      return da < db ? -1 : da > db ? 1 : (a.type === b.type ? 0 : a.type === 'ENTREE' ? -1 : 1);
    });
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">📈 ${echapper(r.code)} – ${echapper(r.libelle)}</h1>
      <a href="/stock/approvisionnement?lieu=${r.lieu}" data-retour>↩ Approvisionnement</a></div>
      <p>Stock présent : <b>${nb(r.stock)} ${echapper(r.unite)}</b>${r.projection.premiere_rupture ? ` · <span class="avertissement">⚠ rupture le ${jourFr(r.projection.premiere_rupture)}</span>` : ' · aucune rupture prévue'}
        · plus bas : ${nb(r.projection.minimum.disponible)} le ${jourFr(r.projection.minimum.date)}
        ${r.seuil ? ` · mini ${nb(r.seuil.mini)} · maxi ${nb(r.seuil.maxi)}` : ''}${r.proposition ? ` · <b>à commander : ${nb(r.proposition.quantite)} ${echapper(r.unite)}</b> (${formatNombre(r.proposition.unites_achat, 0)} ${echapper(r.appro?.unite_achat ?? '')})` : ''}</p>
      <div data-frise></div>
      <table class="tableau-compact"><thead><tr><th>Date</th><th>Pièce</th><th>Type</th><th>Chantier / tiers</th><th>Entrée</th><th>Sortie</th><th>Disponible</th><th>Réservation</th></tr></thead><tbody>
      <tr><td>${jourFr(r.aujourdhui)}</td><td colspan="5">Stock présent</td><td class="nombre"><b>${nb(r.stock)}</b></td><td></td></tr>
      ${lignes.map((e) => {
        dispo += e.type === 'ENTREE' ? Number(e.quantite) : -Number(e.quantite);
        const x = resa.get(e.id);
        return `<tr class="${dispo < 0 ? 'avertissement' : ''}"><td>${jourFr(e.date)}${e.retard ? ' <span title="En retard : compté aujourd\'hui">⏰</span>' : ''}</td>
          <td><a href="${urlDocument(e.ent_id)}" data-doc="${e.ent_id}">${echapper(e.numero ?? '')}</a></td><td>${echapper(e.type_piece)}</td><td>${echapper(e.chantier ?? e.tiers ?? '')}</td>
          <td class="nombre">${e.type === 'ENTREE' ? nb(e.quantite) : ''}</td><td class="nombre">${e.type === 'SORTIE' ? nb(e.quantite) : ''}</td><td class="nombre"><b>${nb(dispo)}</b></td>
          <td>${x ? (Number(x.manque) ? `servi ${nb(x.servi)} / ${nb(x.demande)}, manque ${nb(x.manque)}${x.couverte_le ? ` jusqu'au ${jourFr(x.couverte_le)}` : ' (non couvert)'}` : 'honorée') : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    this.#frise(r);
    this.conteneur.querySelectorAll('[data-doc], [data-retour]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      this.app.naviguer(a.getAttribute('href'), { nouvelleFenetre: e.ctrlKey });
    }));
  }

  /** Frise en escalier du disponible (zéro et mini tracés). */
  #frise(r) {
    const points = [{ date: r.aujourdhui, disponible: Number(r.stock) }, ...r.projection.points.map((p) => ({ date: p.date, disponible: Number(p.disponible) }))];
    if (points.length < 2) return;
    const l = 760; const h = 160; const m = 30;
    const t0 = new Date(points[0].date).getTime();
    const t1 = Math.max(new Date(points.at(-1).date).getTime() + 86400000, t0 + 86400000 * 7);
    const vals = [...points.map((p) => p.disponible), 0, Number(r.seuil?.mini ?? 0)];
    const vmin = Math.min(...vals); const vmax = Math.max(...vals, 1);
    const x = (d) => m + ((new Date(d).getTime() - t0) / (t1 - t0)) * (l - 2 * m);
    const y = (v) => h - m / 2 - ((v - vmin) / (vmax - vmin || 1)) * (h - m);
    let chemin = `M ${x(points[0].date)} ${y(points[0].disponible)}`;
    for (let i = 1; i < points.length; i++) chemin += ` H ${x(points[i].date)} V ${y(points[i].disponible)}`;
    chemin += ` H ${l - m}`;
    const mini = r.seuil?.mini !== null && r.seuil?.mini !== undefined ? `<line x1="${m}" x2="${l - m}" y1="${y(Number(r.seuil.mini))}" y2="${y(Number(r.seuil.mini))}" class="frise-mini"/>` : '';
    this.conteneur.querySelector('[data-frise]').innerHTML = `<svg class="frise-stock" viewBox="0 0 ${l} ${h}" role="img" aria-label="Disponible projeté">
      <line x1="${m}" x2="${l - m}" y1="${y(0)}" y2="${y(0)}" class="frise-zero"/>${mini}<path d="${chemin}" class="frise-courbe"/>
      ${points.map((p) => `<circle cx="${x(p.date)}" cy="${y(p.disponible)}" r="3" class="${p.disponible < 0 ? 'frise-rupture' : 'frise-point'}"><title>${jourFr(p.date)} : ${formatNombre(p.disponible, r.precision)}</title></circle>`).join('')}</svg>`;
  }
}
