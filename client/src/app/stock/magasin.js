import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Module Stock, lot 4 (ANALYSE-MODULE-STOCK.md § 5.5, § 5.6, S16 à S21) : magasin (comptoir de sortie et de retour
// d'un dépôt, pour un chantier ou en dotation d'un salarié : articles choisis par code, libellé ou marque ; retour
// réutilisable ou mis au rebut), visuel des dotations (salariés × articles sur une période : sorti, rendu, rebut, net
// doté ; dates au survol ; export CSV) et onglet Dotations de la fiche salarié.

const DOTATIONS = { EPI: 'EPI', OUTILLAGE: 'Outillage' };
const nombre = (v) => { const t = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); return t === '' ? null : t; };
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const nomSalarie = (s) => `${s.nom} ${s.prenom}${s.code ? ` (${s.code})` : ''}`;

/** Comptoir du magasin : /stock/magasin?lieu=&mode=sortie|retour&salarie=. */
export class PageMagasin extends PageBase {
  icone = '🏪';
  #panier = [];

  get modifiee() { return this.#panier.length > 0; }

  async ouvrir() {
    this.titre = 'Magasin';
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    this.mode = p.get('mode') === 'retour' ? 'retour' : 'sortie';
    this.conteneur.innerHTML = `<div class="page-parametres page-magasin"><div class="entete-page"><h1 class="page-titre">🏪 Magasin</h1>
      <span data-lieu></span><span class="onglets"><button type="button" data-mode="sortie">📤 Sortie</button><button type="button" data-mode="retour">📥 Retour</button></span></div>
      <p class="ligne"><label><input type="radio" name="benef" value="salarie" checked> Dotation d'un salarié</label> <label><input type="radio" name="benef" value="chantier"> Chantier</label>
        <span data-beneficiaire></span></p>
      <p class="ligne"><span data-marques></span> <span data-article></span> <label>Quantité <input data-quantite size="6" value="1"></label>
        <button type="button" data-ajouter>＋ Ajouter</button></p>
      <div data-panier></div>
      <p class="ligne"><label>Commentaire <input data-commentaire size="40"></label> <button type="button" class="principal" data-valider>Valider</button></p>
      <div data-resultat></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-panier]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    const [lieux, articles, marques, salaries, refs] = await Promise.all([api.stock.lieux(), api.stock.articles(), api.stock.marques(), api.stock.salaries(),
      (await this.app.services()).structure?.referentiels().catch(() => null)]);
    this.articles = articles;
    this.salaries = salaries;
    const depots = lieux.filter((l) => l.depot);
    this.lieu = Number(p.get('lieu')) || depots[0]?.id || null;
    const lieu = creerCombo({ options: depots.map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', vide: false });
    lieu.addEventListener('change', () => { this.lieu = Number(lieu.valeurCombo); });
    this.conteneur.querySelector('[data-lieu]').append(lieu);
    this.comboSalarie = creerCombo({ options: salaries.map((s) => ({ valeur: s.id, libelle: nomSalarie(s) })), valeur: Number(p.get('salarie')) || '', titre: 'Salarié' });
    this.comboSalarie.placeholder = 'Salarié…';
    this.comboSalarie.size = 30;
    this.comboChantier = creerCombo({ options: (refs?.chantiers ?? []).filter((c) => !String(c.code).startsWith('DOT-')).map((c) => ({ valeur: c.id, libelle: `${c.code} – ${c.libelle ?? ''}` })), valeur: '', titre: 'Chantier' });
    this.comboChantier.placeholder = 'Chantier…';
    this.comboChantier.size = 30;
    const zoneBenef = this.conteneur.querySelector('[data-beneficiaire]');
    const benef = () => { zoneBenef.replaceChildren(this.#benef() === 'salarie' ? this.comboSalarie : this.comboChantier); };
    this.conteneur.querySelectorAll('input[name="benef"]').forEach((r) => r.addEventListener('change', benef));
    benef();
    // Marques : filtre rapide des articles proposés.
    this.marque = null;
    const zoneMarques = this.conteneur.querySelector('[data-marques]');
    zoneMarques.innerHTML = marques.filter((m) => m.actif).map((m) => `<button type="button" class="pastille" data-marque="${echapper(m.code)}" style="border-color:${echapper(m.couleur ?? '')}">${echapper(m.libelle)}</button>`).join(' ');
    zoneMarques.querySelectorAll('[data-marque]').forEach((b) => b.addEventListener('click', () => {
      this.marque = this.marque === b.dataset.marque ? null : b.dataset.marque;
      zoneMarques.querySelectorAll('[data-marque]').forEach((x) => x.classList.toggle('actif', x.dataset.marque === this.marque));
      this.#comboArticle();
    }));
    this.#comboArticle();
    this.conteneur.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.mode; this.#rendre(); }));
    this.conteneur.querySelector('[data-ajouter]').addEventListener('click', () => this.#ajouter());
    this.conteneur.querySelector('[data-quantite]').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.#ajouter(); });
    this.conteneur.querySelector('[data-valider]').addEventListener('click', () => this.#valider());
    this.#rendre();
  }

  #benef() { return this.conteneur.querySelector('input[name="benef"]:checked').value; }

  #comboArticle() {
    const liste = this.articles.filter((a) => !this.marque || a.marques.includes(this.marque));
    this.comboArticle = creerCombo({ options: liste.map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}${a.dotation ? ` [${DOTATIONS[a.dotation]}]` : ''}` })), valeur: '', titre: 'Article' });
    this.comboArticle.placeholder = 'Article (code ou libellé)…';
    this.comboArticle.size = 40;
    this.conteneur.querySelector('[data-article]').replaceChildren(this.comboArticle);
  }

  #ajouter() {
    const a = this.articles.find((x) => x.id === Number(this.comboArticle.valeurCombo));
    const q = nombre(this.conteneur.querySelector('[data-quantite]').value);
    if (!a || !q || Number(q) <= 0) { this.app.message('Article et quantité positive', 'avertissement'); return; }
    const l = this.#panier.find((x) => x.ele === a.id && !x.rebut);
    if (l) l.quantite = String(Number(l.quantite) + Number(q)); else this.#panier.push({ ele: a.id, code: a.code, libelle: a.libelle, unite: a.unite, quantite: q, rebut: false });
    this.conteneur.querySelector('[data-quantite]').value = '1';
    this.comboArticle.value = '';
    this.comboArticle.focus();
    this.#rendre();
  }

  #rendre() {
    this.conteneur.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('actif', b.dataset.mode === this.mode));
    const retour = this.mode === 'retour';
    this.conteneur.querySelector('[data-valider]').textContent = retour ? 'Valider le retour' : 'Valider la sortie';
    const zone = this.conteneur.querySelector('[data-panier]');
    zone.innerHTML = this.#panier.length ? `<table class="tableau-compact"><thead><tr><th>Article</th><th>Libellé</th><th>Quantité</th><th>U.</th>
      ${retour ? '<th title="Hors d\'usage : mis au rebut (sinon remis en stock)">Rebut</th>' : ''}<th class="cellule-boutons"></th></tr></thead><tbody>
      ${this.#panier.map((l, i) => `<tr data-i="${i}"><td>${echapper(l.code)}</td><td>${echapper(l.libelle)}</td><td><input data-q size="6" value="${echapper(String(l.quantite))}"></td>
        <td>${echapper(l.unite)}</td>${retour ? `<td><input type="checkbox" data-rebut ${l.rebut ? 'checked' : ''}></td>` : ''}
        <td class="cellule-boutons"><button type="button" data-retirer title="Retirer">✕</button></td></tr>`).join('')}</tbody></table>`
      : `<p class="aide">${retour ? 'Articles rendus : réutilisables (remis au dépôt) ou au rebut.' : 'Articles à sortir du dépôt.'}</p>`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const l = this.#panier[Number(tr.dataset.i)];
      tr.querySelector('[data-q]').addEventListener('change', (e) => { l.quantite = nombre(e.target.value); });
      tr.querySelector('[data-rebut]')?.addEventListener('change', (e) => { l.rebut = e.target.checked; });
      tr.querySelector('[data-retirer]').addEventListener('click', () => { this.#panier.splice(this.#panier.indexOf(l), 1); this.#rendre(); });
    });
  }

  async #valider() {
    const salarie = this.#benef() === 'salarie' ? Number(this.comboSalarie.valeurCombo) || null : null;
    const chantier = this.#benef() === 'chantier' ? Number(this.comboChantier.valeurCombo) || null : null;
    if (!salarie && !chantier) { this.app.message('Choisissez le salarié ou le chantier', 'avertissement'); return; }
    if (!this.#panier.length) { this.app.message('Aucun article', 'avertissement'); return; }
    const saisie = { lieu: this.lieu, salarie, chantier, commentaire: this.conteneur.querySelector('[data-commentaire]').value,
      lignes: this.#panier.map((l) => ({ ele: l.ele, quantite: l.quantite, rebut: this.mode === 'retour' && l.rebut })) };
    try {
      const pieces = await (this.mode === 'retour' ? api.stock.retourMagasin(saisie) : api.stock.sortieMagasin(saisie));
      this.#panier = [];
      this.#rendre();
      this.conteneur.querySelector('[data-resultat]').innerHTML = `<p class="succes">✔ ${pieces.map((p) => `<a href="/document/${p.ent_id}" data-doc>${echapper(p.numero ?? '')}</a> (${p.lignes} ligne(s))`).join(', ')}</p>`;
      this.conteneur.querySelectorAll('[data-doc]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(a.getAttribute('href'), { nouvelleFenetre: true }); }));
      this.app.message(this.mode === 'retour' ? 'Retour enregistré' : 'Sortie enregistrée', 'succes');
    } catch (e) { this.app.erreur(e); }
  }
}

/** Dotations par salarié sur une période : /stock/dotations?du=&au=. */
export class PageDotations extends PageBase {
  icone = '🦺';

  async ouvrir() {
    this.titre = 'Dotations des salariés';
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    const an = new Date(); an.setFullYear(an.getFullYear() - 1);
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">🦺 Dotations des salariés</h1>
      <label>Du <input type="date" data-du value="${p.get('du') ?? an.toISOString().slice(0, 10)}"></label> <label>au <input type="date" data-au value="${p.get('au') ?? new Date().toISOString().slice(0, 10)}"></label>
      <span data-type></span><input type="search" data-recherche placeholder="Salarié, service…" size="20"> <button type="button" data-csv>⭳ CSV</button></div>
      <p class="aide">Quantité nette dotée sur la période (sorties − retours) ; au survol : les dates. ✱ : encore en dotation aujourd'hui (net).</p><div data-corps></div></div>`;
    if (!this.app.enLigne) { this.conteneur.querySelector('[data-corps]').innerHTML = '<p class="aide">En ligne seulement.</p>'; return; }
    this.articlesStock = new Map((await api.stock.articles()).map((a) => [a.id, a]));
    const type = creerCombo({ options: [{ valeur: 'EPI', libelle: 'EPI' }, { valeur: 'OUTILLAGE', libelle: 'Outillage' }], valeur: '', titre: 'Tous les articles' });
    type.placeholder = 'EPI, outillage…';
    type.addEventListener('change', () => { this.type = type.valeurCombo || null; this.#rendre(); });
    this.conteneur.querySelector('[data-type]').append(type);
    this.conteneur.querySelectorAll('[data-du], [data-au]').forEach((x) => x.addEventListener('change', () => this.#charger()));
    this.conteneur.querySelector('[data-recherche]').addEventListener('input', () => this.#rendre());
    this.conteneur.querySelector('[data-csv]').addEventListener('click', () => this.#exporter());
    await this.#charger();
  }

  async #charger() {
    this.donnees = await api.stock.dotations({ du: this.conteneur.querySelector('[data-du]').value, au: this.conteneur.querySelector('[data-au]').value });
    this.#rendre();
  }

  #vue() {
    const q = this.conteneur.querySelector('[data-recherche]').value.trim().toLowerCase();
    const articles = this.donnees.articles.filter((a) => !this.type || this.articlesStock.get(a.id)?.dotation === this.type);
    const ids = new Set(articles.map((a) => a.id));
    const salaries = this.donnees.salaries.filter((s) => (!q || `${s.nom} ${s.prenom} ${s.code ?? ''} ${s.service ?? ''}`.toLowerCase().includes(q))
      && s.articles.some((a) => ids.has(a.ele)));
    return { articles, salaries };
  }

  #rendre() {
    const { articles, salaries } = this.#vue();
    const cellule = (s, a) => {
      const x = s.articles.find((y) => y.ele === a.id);
      if (!x) return '<td></td>';
      const net = Number(x.sorti) - Number(x.rendu) - Number(x.rebut);
      const dates = x.mouvements.map((m) => `${dateFr(m.date)} ${Number(m.quantite) > 0 ? '+' : ''}${formatNombre(m.quantite, 2)} ${m.numero ?? ''}`).join('\n');
      return `<td class="nombre" title="${echapper(`Sorti ${formatNombre(x.sorti, 2)}, rendu ${formatNombre(x.rendu, 2)}, rebut ${formatNombre(x.rebut, 2)}\n${dates}`)}">${net ? formatNombre(net, 2) : ''}${Number(x.net) ? ' ✱' : ''}</td>`;
    };
    this.conteneur.querySelector('[data-corps]').innerHTML = salaries.length ? `<table class="tableau-compact"><thead><tr><th>Salarié</th><th>Service</th>
      ${articles.map((a) => `<th title="${echapper(a.libelle ?? '')}">${echapper(a.code ?? '')}</th>`).join('')}</tr></thead><tbody>
      ${salaries.map((s) => `<tr><td><a href="/fiche/salarie/${s.id}" data-sal>${echapper(nomSalarie(s))}</a></td><td>${echapper(s.service ?? '')}</td>${articles.map((a) => cellule(s, a)).join('')}</tr>`).join('')}
      </tbody></table>` : '<p class="aide">Aucune dotation sur la période.</p>';
    this.conteneur.querySelectorAll('[data-sal]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(a.getAttribute('href'), { nouvelleFenetre: e.ctrlKey }); }));
  }

  #exporter() {
    const { articles, salaries } = this.#vue();
    const cel = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const lignes = [['Salarié', 'Service', 'Article', 'Libellé', 'Sorti', 'Rendu', 'Rebut', 'Net doté aujourd\'hui', 'Dates'].map(cel).join(';')];
    for (const s of salaries) {
      for (const x of s.articles) {
        const a = articles.find((y) => y.id === x.ele);
        if (!a) continue;
        lignes.push([cel(nomSalarie(s)), cel(s.service), cel(a.code), cel(a.libelle), x.sorti, x.rendu, x.rebut, x.net,
          cel(x.mouvements.map((m) => `${dateFr(m.date)} ${m.quantite}`).join(' | '))].map((v) => String(v).replace('.', ',')).join(';'));
      }
    }
    const lien = document.createElement('a');
    lien.href = URL.createObjectURL(new Blob([`﻿${lignes.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    lien.download = `dotations-${this.donnees.du}-${this.donnees.au}.csv`;
    lien.click();
    URL.revokeObjectURL(lien.href);
  }
}

/** Onglet Dotations de la fiche salarié : articles encore dotés et historique (toutes dates). */
export async function rendreDotationsSalarie(corps, { salarie, naviguer }) {
  corps.innerHTML = '<p class="aide">Chargement…</p>';
  const d = await api.stock.dotations({ du: '2000-01-01', salarie });
  const s = d.salaries[0];
  const art = new Map(d.articles.map((a) => [a.id, a]));
  if (!s) { corps.innerHTML = `<p class="aide">Aucune dotation. <a href="/stock/magasin?salarie=${salarie}" data-url>🏪 Doter au magasin</a></p>`; }
  else {
    corps.innerHTML = `<p class="ligne"><a href="/stock/magasin?salarie=${salarie}" data-url>🏪 Doter au magasin</a> · <a href="/stock/magasin?mode=retour&salarie=${salarie}" data-url>📥 Retour</a></p>
      <table class="tableau-compact"><thead><tr><th>Article</th><th>Libellé</th><th>Doté aujourd'hui</th><th>Sorti</th><th>Rendu</th><th>Rebut</th><th>Mouvements</th></tr></thead><tbody>
      ${s.articles.map((x) => { const a = art.get(x.ele); return `<tr><td>${echapper(a?.code ?? '')}</td><td>${echapper(a?.libelle ?? '')}</td><td class="nombre"><b>${formatNombre(x.net, 2)}</b> ${echapper(a?.unite ?? '')}</td>
        <td class="nombre">${formatNombre(x.sorti, 2)}</td><td class="nombre">${formatNombre(x.rendu, 2)}</td><td class="nombre">${formatNombre(x.rebut, 2)}</td>
        <td>${x.mouvements.map((m) => `${dateFr(m.date)} ${Number(m.quantite) > 0 ? '+' : ''}${formatNombre(m.quantite, 2)} <a href="/document/${m.ent_id}" data-url>${echapper(m.numero ?? '')}</a>`).join('<br>')}</td></tr>`; }).join('')}
      </tbody></table>`;
  }
  corps.querySelectorAll('[data-url]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(a.getAttribute('href'), e); }));
}
