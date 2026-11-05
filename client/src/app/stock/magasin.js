import { texte, texteHtml, pluriel, textesParCode, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { urlDocument, urlFiche, TYPE_FICHE, MODELE_EDITION } from '../codes.js';
import { dateLocale, aujourdhui } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, formatNombre, creerCombo, lirePreferences, ecrirePreferences, formatDate, formatDateHeure, telechargerCsv, celluleCsv, nombreSaisi, saisir } from '@logibtp/socle/ui';
import { api } from '../api.js';

// Module Stock, lot 4 (ANALYSE-MODULE-STOCK.md § 5.5, § 5.6, S16 à S21) : magasin (comptoir de sortie et de retour
// d'un dépôt, pour un chantier ou en dotation d'un salarié : articles choisis par code, libellé ou marque ; retour
// réutilisable ou mis au rebut), visuel des dotations (salariés × articles sur une période : sorti, rendu, rebut, net
// doté ; dates au survol ; export CSV) et onglet Dotations de la fiche salarié.

const DOTATIONS = textesParCode('stock_btp.magasin.dotations', ['EPI', 'OUTILLAGE']);
const nomSalarie = (s) => `${s.nom} ${s.prenom}${s.code ? ` (${s.code})` : ''}`;

/** Comptoir du magasin : /stock/magasin?lieu=&mode=sortie|retour&salarie=. */
export class PageMagasin extends PageBase {
  icone = icone('stock_btp_magasin');
  #panier = [];

  get modifiee() { return this.#panier.length > 0; }

  async ouvrir() {
    this.titre = texte('stock_btp.routes.magasin');
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    this.mode = p.get('mode') === 'retour' ? 'retour' : 'sortie';
    this.conteneur.innerHTML = `<div class="page-parametres page-magasin"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_magasin')} ${texteHtml('stock_btp.routes.magasin')}</h1>
      <span data-lieu></span><span class="onglets"><button type="button" data-mode="sortie">${iconeHtml('stock_btp_sortie')} ${texteHtml('stock_btp.magasin.sortie')}</button><button type="button" data-mode="retour">${iconeHtml('stock_btp_entree')} ${texteHtml('stock_btp.magasin.retour')}</button></span></div>
      <p class="ligne"><label><input type="radio" name="benef" value="salarie" checked> ${texteHtml('stock_btp.magasin.benef_salarie')}</label> <label><input type="radio" name="benef" value="chantier"> ${texteHtml('stock_btp.magasin.chantier')}</label>
        <span data-beneficiaire></span></p>
      <p class="ligne"><span data-marques></span> <span data-article></span> <label>${texteHtml('stock_btp.colonnes.quantite')} <input data-quantite size="6" value="1"></label>
        <button type="button" data-ajouter>${iconeHtml('ajouter')} ${texteHtml('commun.ajouter')}</button></p>
      <div data-panier></div>
      <p class="ligne"><label>${texteHtml('stock_btp.magasin.commentaire')} <input data-commentaire size="40"></label> <button type="button" class="principal" data-valider>${texteHtml('commun.valider')}</button></p>
      <div data-resultat></div></div>`;
    const [lieux, articles, marques, salaries, refs] = await Promise.all([api.stock.lieux(), api.stock.articles(), api.stock.marques(), api.stock.salaries(),
      (await this.app.services()).structure?.referentiels().catch(() => null)]);
    this.articles = articles;
    this.salaries = salaries;
    const depots = lieux.filter((l) => l.depot);
    this.lieu = Number(p.get('lieu')) || depots[0]?.id || null;
    const lieu = creerCombo({ options: depots.map((l) => ({ valeur: l.id, libelle: `${l.code} – ${l.libelle}` })), valeur: this.lieu ?? '', vide: false });
    lieu.addEventListener('change', () => { this.lieu = Number(lieu.valeurCombo); });
    this.conteneur.querySelector('[data-lieu]').append(lieu);
    this.comboSalarie = creerCombo({ options: salaries.map((s) => ({ valeur: s.id, libelle: nomSalarie(s) })), valeur: Number(p.get('salarie')) || '', titre: texte('stock_btp.magasin.salarie') });
    this.comboSalarie.placeholder = texte('stock_btp.magasin.salarie_placeholder');
    this.comboSalarie.size = 30;
    this.comboChantier = creerCombo({ options: (refs?.chantiers ?? []).filter((c) => !String(c.code).startsWith('DOT-')).map((c) => ({ valeur: c.id, libelle: `${c.code} – ${c.libelle ?? ''}` })), valeur: '', titre: texte('stock_btp.magasin.chantier') });
    this.comboChantier.placeholder = texte('stock_btp.magasin.chantier_placeholder');
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
    this.comboArticle = creerCombo({ options: liste.map((a) => ({ valeur: a.id, libelle: `${a.code} – ${a.libelle}${a.dotation ? ` [${DOTATIONS[a.dotation]}]` : ''}` })), valeur: '', titre: texte('stock_btp.colonnes.article') });
    this.comboArticle.placeholder = texte('stock_btp.magasin.article_placeholder');
    this.comboArticle.size = 40;
    this.conteneur.querySelector('[data-article]').replaceChildren(this.comboArticle);
  }

  #ajouter() {
    const a = this.articles.find((x) => x.id === Number(this.comboArticle.valeurCombo));
    const q = nombreSaisi(this.conteneur.querySelector('[data-quantite]').value);
    if (!a || !q || Number(q) <= 0) { this.app.message(texte('stock_btp.magasin.article_quantite'), 'avertissement'); return; }
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
    this.conteneur.querySelector('[data-valider]').textContent = retour ? texte('stock_btp.magasin.valider_retour') : texte('stock_btp.magasin.valider_sortie');
    const zone = this.conteneur.querySelector('[data-panier]');
    zone.innerHTML = this.#panier.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.article')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.colonnes.quantite')}</th><th>${texteHtml('stock_btp.colonnes.unite_court')}</th>
      ${retour ? `<th title="${texteHtml('stock_btp.magasin.rebut_titre')}">${texteHtml('stock_btp.magasin.rebut')}</th>` : ''}<th class="cellule-boutons"></th></tr></thead><tbody>
      ${this.#panier.map((l, i) => `<tr data-i="${i}"><td>${echapper(l.code)}</td><td>${echapper(l.libelle)}</td><td><input data-q size="6" value="${echapper(String(l.quantite))}"></td>
        <td>${echapper(l.unite)}</td>${retour ? `<td><input type="checkbox" data-rebut ${l.rebut ? 'checked' : ''}></td>` : ''}
        <td class="cellule-boutons"><button type="button" data-retirer title="${texteHtml('commun.retirer')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}</tbody></table>`
      : `<p class="aide">${retour ? texteHtml('stock_btp.magasin.aide_retour') : texteHtml('stock_btp.magasin.aide_sortie')}</p>`;
    zone.querySelectorAll('tr[data-i]').forEach((tr) => {
      const l = this.#panier[Number(tr.dataset.i)];
      tr.querySelector('[data-q]').addEventListener('change', (e) => { l.quantite = nombreSaisi(e.target.value); });
      tr.querySelector('[data-rebut]')?.addEventListener('change', (e) => { l.rebut = e.target.checked; });
      tr.querySelector('[data-retirer]').addEventListener('click', () => { this.#panier.splice(this.#panier.indexOf(l), 1); this.#rendre(); });
    });
  }

  async #valider() {
    const salarie = this.#benef() === 'salarie' ? Number(this.comboSalarie.valeurCombo) || null : null;
    const chantier = this.#benef() === 'chantier' ? Number(this.comboChantier.valeurCombo) || null : null;
    if (!salarie && !chantier) { this.app.message(texte('stock_btp.magasin.beneficiaire'), 'avertissement'); return; }
    if (!this.#panier.length) { this.app.message(texte('stock_btp.magasin.aucun_article'), 'avertissement'); return; }
    const saisie = { lieu: this.lieu, salarie, chantier, commentaire: this.conteneur.querySelector('[data-commentaire]').value,
      lignes: this.#panier.map((l) => ({ ele: l.ele, quantite: l.quantite, rebut: this.mode === 'retour' && l.rebut })) };
    try {
      const pieces = await (this.mode === 'retour' ? api.stock.retourMagasin(saisie) : api.stock.sortieMagasin(saisie));
      this.#panier = [];
      this.#rendre();
      this.conteneur.querySelector('[data-resultat]').innerHTML = `<p class="succes">${iconeHtml('stock_btp_valider')} ${pieces.map((p) => `<a href="${urlDocument(p.ent_id)}" data-doc>${echapper(p.numero ?? '')}</a> (${echapper(pluriel('stock_btp.magasin.lignes', p.lignes))})`).join(', ')}</p>`;
      this.conteneur.querySelectorAll('[data-doc]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(a.getAttribute('href'), { nouvelleFenetre: true }); }));
      this.app.message(this.mode === 'retour' ? texte('stock_btp.magasin.retour_ok') : texte('stock_btp.magasin.sortie_ok'), 'succes');
    } catch (e) { this.app.erreur(e); }
  }
}

/** Dotations par salarié sur une période : /stock/dotations?du=&au=. */
export class PageDotations extends PageBase {
  icone = icone('stock_btp_dotation');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.dotations');
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    const an = new Date(); an.setFullYear(an.getFullYear() - 1);
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_dotation')} ${texteHtml('stock_btp.routes.dotations')}</h1>
      <label>${texteHtml('stock_btp.dotations.du')} <input type="date" data-du value="${p.get('du') ?? dateLocale(an)}"></label> <label>${texteHtml('stock_btp.dotations.au')} <input type="date" data-au value="${p.get('au') ?? aujourdhui()}"></label>
      <span data-type></span><input type="search" data-recherche placeholder="${texteHtml('stock_btp.dotations.recherche')}" size="20"> <button type="button" data-csv>${iconeHtml('stock_btp_csv')} ${texteHtml('stock_btp.etat.csv')}</button></div>
      <p class="aide">${texteHtml('stock_btp.dotations.aide', { marque: icone('stock_btp_en_dotation') })}</p><div data-corps></div></div>`;
    this.articlesStock = new Map((await api.stock.articles()).map((a) => [a.id, a]));
    const type = creerCombo({ options: ['EPI', 'OUTILLAGE'].map((valeur) => ({ valeur, libelle: DOTATIONS[valeur] })), valeur: '', titre: texte('stock_btp.dotations.tous') });
    type.placeholder = texte('stock_btp.dotations.type_placeholder');
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
      const dates = x.mouvements.map((m) => `${formatDate(m.date)} ${Number(m.quantite) > 0 ? '+' : ''}${formatNombre(m.quantite, 2)} ${m.numero ?? ''}`).join('\n');
      return `<td class="nombre" title="${echapper(`${texte('stock_btp.dotations.survol', { sorti: formatNombre(x.sorti, 2), rendu: formatNombre(x.rendu, 2), rebut: formatNombre(x.rebut, 2) })}\n${dates}`)}">${net ? formatNombre(net, 2) : ''}${Number(x.net) ? ` ${iconeHtml('stock_btp_en_dotation')}` : ''}${pastilleRenouvellement(x)}</td>`;
    };
    this.conteneur.querySelector('[data-corps]').innerHTML = salaries.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.magasin.salarie')}</th><th>${texteHtml('stock_btp.dotations.service')}</th>
      ${articles.map((a) => `<th title="${echapper(a.libelle ?? '')}">${echapper(a.code ?? '')}</th>`).join('')}</tr></thead><tbody>
      ${salaries.map((s) => `<tr><td><a href="${urlFiche(TYPE_FICHE.SALARIE, s.id)}" data-sal>${echapper(nomSalarie(s))}</a></td><td>${echapper(s.service ?? '')}</td>${articles.map((a) => cellule(s, a)).join('')}</tr>`).join('')}
      </tbody></table>` : `<p class="aide">${texteHtml('stock_btp.dotations.aucune')}</p>`;
    this.conteneur.querySelectorAll('[data-sal]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(a.getAttribute('href'), { nouvelleFenetre: e.ctrlKey }); }));
  }

  #exporter() {
    const { articles, salaries } = this.#vue();
    const cel = celluleCsv;
    const lignes = [[texte('stock_btp.magasin.salarie'), texte('stock_btp.dotations.service'), texte('stock_btp.colonnes.article'), texte('commun.libelle'), texte('stock_btp.dotations.sorti'), texte('stock_btp.dotations.rendu'), texte('stock_btp.magasin.rebut'), texte('stock_btp.dotations.net'), texte('stock_btp.dotations.dates')].map(cel).join(';')];
    for (const s of salaries) {
      for (const x of s.articles) {
        const a = articles.find((y) => y.id === x.ele);
        if (!a) continue;
        lignes.push([cel(nomSalarie(s)), cel(s.service), cel(a.code), cel(a.libelle), x.sorti, x.rendu, x.rebut, x.net,
          cel(x.mouvements.map((m) => `${formatDate(m.date)} ${m.quantite}`).join(' | '))].map((v) => String(v).replace('.', ',')).join(';'));
      }
    }
    telechargerCsv(`dotations-${this.donnees.du}-${this.donnees.au}.csv`, lignes);
  }
}

/** Renouvellement d'un article doté : ⏰ si échu, ⌛ dans les 30 jours (date de la dernière sortie + durée de vie). */
export function pastilleRenouvellement(x) {
  if (!x?.renouveler_le || !(Number(x.net) > 0)) return '';
  const jours = (new Date(`${x.renouveler_le}T00:00`) - new Date(new Date().toDateString())) / 86400000;
  if (jours > 30) return '';
  return ` <span class="${jours < 0 ? 'avertissement' : ''}" title="${texteHtml('stock_btp.dotations.renouveler', { date: formatDate(x.renouveler_le) })}">${iconeHtml(jours < 0 ? 'stock_btp_renouveler_echu' : 'stock_btp_renouveler_bientot')}</span>`;
}

/** Saisies de la borne à valider (S17, S18) : /stock/a-valider ; accepter, ou refuser avec un motif (pièce annulée). */
export class PageSaisiesAValider extends PageBase {
  icone = icone('stock_btp_valide');

  async ouvrir() {
    this.titre = texte('stock_btp.routes.a_valider');
    this.conteneur.innerHTML = `<div class="page-parametres"><div class="entete-page"><h1 class="page-titre">${iconeHtml('stock_btp_valide')} ${texteHtml('stock_btp.routes.a_valider')}</h1></div>
      <p class="aide">${texteHtml('stock_btp.a_valider.aide')}</p>
      <div data-corps></div></div>`;
    await this.#charger();
  }

  async #charger() {
    const l = await api.stock.aValider();
    const z = this.conteneur.querySelector('[data-corps]');
    z.innerHTML = l.length ? `<table class="tableau-compact"><thead><tr><th>${texteHtml('stock_btp.colonnes.date')}</th><th>${texteHtml('stock_btp.colonnes.piece')}</th><th>${texteHtml('stock_btp.magasin.salarie')}</th><th>${texteHtml('stock_btp.a_valider.de')}</th><th>${texteHtml('stock_btp.a_valider.vers')}</th><th>${texteHtml('stock_btp.a_valider.articles')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${l.map((x) => `<tr data-id="${x.ent_id}"><td>${formatDateHeure(x.date)}</td>
        <td><a href="${urlDocument(x.ent_id)}" data-doc>${echapper(x.numero ?? '')}</a> <small>${echapper(x.type)}</small></td><td>${echapper(x.nom ?? '')}</td>
        <td>${echapper(x.origine ?? '')}</td><td>${echapper(x.destination ?? '')}</td><td>${echapper(x.lignes)}</td>
        <td class="cellule-boutons"><button type="button" class="bouton-icone" data-accepter title="${texteHtml('stock_btp.a_valider.accepter')}">${iconeHtml('stock_btp_valider')}</button><button type="button" class="bouton-icone" data-refuser title="${texteHtml('stock_btp.a_valider.refuser')}">${iconeHtml('retirer')}</button></td></tr>`).join('')}
      </tbody></table>` : `<p class="aide">${texteHtml('stock_btp.a_valider.aucune')}</p>`;
    z.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = Number(tr.dataset.id);
      tr.querySelector('[data-accepter]').addEventListener('click', async () => { try { await api.stock.traiterSaisie(id, true); await this.#charger(); } catch (e) { this.app.erreur(e); } });
      tr.querySelector('[data-refuser]').addEventListener('click', async () => {
        const motif = await saisir(texte('stock_btp.a_valider.motif'), '', { obligatoire: true });
        if (!motif) return;
        try { await api.stock.traiterSaisie(id, false, motif); await this.#charger(); } catch (e) { this.app.erreur(e); }
      });
      tr.querySelector('[data-doc]').addEventListener('click', (e) => { e.preventDefault(); this.app.naviguer(e.target.getAttribute('href'), { nouvelleFenetre: true }); });
    });
  }
}

/** Fiche de dotation à signer (S26) : /stock/dotations/fiche?salarie=&du=&au= ; imprimée par le navigateur. */
export class PageFicheDotation extends PageBase {
  icone = icone('stock_btp_imprimer');

  async ouvrir() {
    const p = new URLSearchParams(globalThis.location?.search ?? '');
    const salarie = Number(p.get('salarie'));
    const d = await api.stock.dotations({ du: p.get('du') ?? '2000-01-01', au: p.get('au') ?? null, salarie });
    const s = d.salaries[0];
    const art = new Map(d.articles.map((a) => [a.id, a]));
    this.titre = s ? texte('stock_btp.fiche.titre_salarie', { nom: `${s.prenom} ${s.nom}` }) : texte('stock_btp.routes.fiche_dotation');
    const lignes = (s?.articles ?? []).flatMap((x) => x.mouvements.map((m) => ({ ...m, a: art.get(x.ele) }))).sort((a, b) => new Date(a.date) - new Date(b.date));
    this.conteneur.innerHTML = `<div class="page-parametres fiche-dotation"><div class="entete-page sans-impression"><h1 class="page-titre">${iconeHtml('stock_btp_imprimer')} ${texteHtml('stock_btp.routes.fiche_dotation')}</h1>
        <button type="button" class="principal" data-imprimer title="${texteHtml('stock_btp.fiche.edition_titre')}">${iconeHtml('stock_btp_imprimer')} ${texteHtml('stock_btp.inventaire.imprimer')}</button></div>
      <h2>${texteHtml('stock_btp.fiche.titre')}</h2>
      <p>${texteHtml('stock_btp.fiche.salarie')} <b>${s ? echapper(`${s.prenom} ${s.nom}`) : '—'}</b>${s?.code ? ` (${echapper(s.code)})` : ''}${s?.service ? ` · ${echapper(s.service)}` : ''} · ${texteHtml('stock_btp.fiche.periode', { du: formatDate(d.du), au: formatDate(d.au) })}</p>
      <table class="tableau-compact pleine-largeur"><thead><tr><th>${texteHtml('stock_btp.colonnes.date')}</th><th>${texteHtml('stock_btp.colonnes.article')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.fiche.remis')}</th><th>${texteHtml('stock_btp.dotations.rendu')}</th><th>${texteHtml('stock_btp.colonnes.piece')}</th></tr></thead><tbody>
        ${lignes.map((m) => `<tr><td>${formatDate(m.date)}</td><td>${echapper(m.a?.code ?? '')}</td><td>${echapper(m.a?.libelle ?? '')}</td>
          <td class="nombre">${Number(m.quantite) > 0 ? formatNombre(m.quantite, 2) : ''}</td><td class="nombre">${Number(m.quantite) < 0 ? formatNombre(-m.quantite, 2) : ''}</td>
          <td>${echapper(m.numero ?? '')}</td></tr>`).join('') || `<tr><td colspan="6">${texteHtml('stock_btp.article.aucun_mouvement')}</td></tr>`}</tbody></table>
      <p>${texteHtml('stock_btp.fiche.engagement')}</p>
      <h2>${texteHtml('stock_btp.fiche.signees')}</h2><div data-signees><p class="aide">${texteHtml('stock_btp.article.chargement')}</p></div></div>`;
    // Impression par le module Édition (modèle FICHE_DOTATION) : même fiche que celle signée à la borne et rangée en GED.
    const edition = (parametres) => `/edition?${new URLSearchParams({ source: 'fiche', id: `${TYPE_FICHE.SALARIE}/${salarie}`, modele: MODELE_EDITION.FICHE_DOTATION, ...parametres })}`;
    const ouvrir = (e, url) => { e.preventDefault(); this.app.naviguer(url, { nouvelleFenetre: true }); };
    this.conteneur.querySelector('[data-imprimer]').addEventListener('click', (e) => ouvrir(e, edition({ p_du: d.du, p_au: d.au })));
    const zone = this.conteneur.querySelector('[data-signees]');
    const f = await api.stock.fichesDotation(salarie);
    zone.innerHTML = `<p class="aide">${f.a_signer.nombre ? echapper(pluriel('stock_btp.fiche.a_signer', f.a_signer.nombre, { du: formatDate(f.a_signer.du), au: formatDate(f.a_signer.au) })) : texteHtml('stock_btp.fiche.rien_a_signer')}</p>
      ${f.fiches.length ? `<table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('stock_btp.fiche.periode_colonne')}</th><th>${texteHtml('stock_btp.fiche.signee_le')}</th><th>${texteHtml('stock_btp.fiche.lieu')}</th><th class="cellule-boutons"></th></tr></thead><tbody>
      ${f.fiches.map((x) => `<tr><td>${texteHtml('stock_btp.fiche.periode', { du: formatDate(x.du), au: formatDate(x.au) })}</td><td>${x.signe_le ? `${formatDateHeure(x.signe_le)} ${echapper(x.signataire ?? '')}` : '—'}</td>
        <td>${texteHtml(`stock_btp.fiche.lieux.${x.lieu}`)}</td><td class="cellule-boutons"><a href="${edition({ p_fiche: x.id })}" data-edition="${x.id}" title="${texteHtml('stock_btp.fiche.reimprimer')}">${iconeHtml('stock_btp_imprimer')}</a></td></tr>`).join('')}</tbody></table>`
      : `<p class="aide">${texteHtml('stock_btp.fiche.aucune_signee')}</p>`}`;
    zone.querySelectorAll('[data-edition]').forEach((a) => a.addEventListener('click', (e) => ouvrir(e, a.getAttribute('href'))));
  }
}

/** Périodes de l'onglet Dotations : mouvements depuis N mois (null : toutes dates). */
const LIBELLES_PERIODES = textesParCode('stock_btp.dotations.periodes', ['1M', '6M', '1A', 'TOUT']);
const PERIODES_DOTATION = [{ code: '1M', mois: 1 }, { code: '6M', mois: 6 }, { code: '1A', mois: 12 }, { code: 'TOUT', mois: null }]
  .map((p) => ({ ...p, get libelle() { return LIBELLES_PERIODES[p.code]; } }));

/**
 * Onglet Dotations de la fiche salarié : articles encore dotés (au jour) ; sorti, rendu, rebut et mouvements de la
 * période choisie (1 mois, 6 mois, 1 an, tout ; préférence `dotationsPeriode`) ; totaux par unité en pied.
 */
export async function rendreDotationsSalarie(corps, { salarie, naviguer }) {
  const periode = PERIODES_DOTATION.find((p) => p.code === lirePreferences().dotationsPeriode) ?? PERIODES_DOTATION[2];
  const debut = new Date();
  if (periode.mois) debut.setMonth(debut.getMonth() - periode.mois);
  corps.innerHTML = `<p class="aide">${texteHtml('stock_btp.article.chargement')}</p>`;
  const d = await api.stock.dotations({ du: periode.mois ? dateLocale(debut) : '2000-01-01', salarie });
  const s = d.salaries[0];
  const art = new Map(d.articles.map((a) => [a.id, a]));
  const boutons = PERIODES_DOTATION.map((p) => `<button type="button" data-periode="${p.code}" class="${p === periode ? 'actif principal' : ''}" title="${p.mois ? texteHtml('stock_btp.dotations.periode_titre', { periode: p.libelle }) : texteHtml('stock_btp.dotations.periode_tout')}">${echapper(p.libelle)}</button>`).join('');
  const liens = `<a href="/stock/magasin?salarie=${salarie}" data-url>${iconeHtml('stock_btp_magasin')} ${texteHtml('stock_btp.dotations.doter')}</a> · <a href="/stock/magasin?mode=retour&salarie=${salarie}" data-url>${iconeHtml('stock_btp_entree')} ${texteHtml('stock_btp.magasin.retour')}</a>
      · <a href="/stock/dotations/fiche?salarie=${salarie}" data-url>${iconeHtml('stock_btp_imprimer')} ${texteHtml('stock_btp.dotations.fiche')}</a>`;
  if (!s) { corps.innerHTML = `<div class="titre-actions"><span class="titre-actions-boutons">${boutons}</span></div><p class="aide">${texteHtml('stock_btp.dotations.aucune')} ${liens}</p>`; }
  else {
    // Totaux par unité (quantités de même unité seulement).
    const totaux = new Map();
    for (const x of s.articles) {
      const u = art.get(x.ele)?.unite ?? '';
      const t = totaux.get(u) ?? { net: 0, sorti: 0, rendu: 0, rebut: 0, n: 0 };
      for (const k of ['net', 'sorti', 'rendu', 'rebut']) t[k] += Number(x[k]) || 0;
      t.n += 1;
      totaux.set(u, t);
    }
    corps.innerHTML = `<div class="titre-actions"><p class="ligne">${liens}</p><span class="titre-actions-boutons">${boutons}</span></div>
      <table class="tableau-compact largeur-contenu"><thead><tr><th>${texteHtml('stock_btp.colonnes.article')}</th><th>${texteHtml('commun.libelle')}</th><th>${texteHtml('stock_btp.dotations.dote')}<br><small>${texteHtml('stock_btp.dotations.aujourdhui')}</small></th><th>${texteHtml('stock_btp.dotations.sorti')}<br><small>${echapper(periode.libelle)}</small></th><th>${texteHtml('stock_btp.dotations.rendu')}<br><small>${echapper(periode.libelle)}</small></th><th>${texteHtml('stock_btp.magasin.rebut')}<br><small>${echapper(periode.libelle)}</small></th><th>${texteHtml('stock_btp.dotations.mouvements')}</th></tr></thead><tbody>
      ${s.articles.map((x) => { const a = art.get(x.ele); return `<tr><td>${echapper(a?.code ?? '')}</td><td>${echapper(a?.libelle ?? '')}</td><td class="nombre"><b>${formatNombre(x.net, 2)}</b> ${echapper(a?.unite ?? '')}${pastilleRenouvellement(x)}</td>
        <td class="nombre">${formatNombre(x.sorti, 2)}</td><td class="nombre">${formatNombre(x.rendu, 2)}</td><td class="nombre">${formatNombre(x.rebut, 2)}</td>
        <td>${x.mouvements.map((m) => `${formatDate(m.date)} ${Number(m.quantite) > 0 ? '+' : ''}${formatNombre(m.quantite, 2)} <a href="${urlDocument(m.ent_id)}" data-url>${echapper(m.numero ?? '')}</a>`).join('<br>')}</td></tr>`; }).join('')}
      </tbody><tfoot>${[...totaux].map(([u, t]) => `<tr><th colspan="2">${texteHtml('commun.total')}${u ? ` (${echapper(u)})` : ''} <small>${echapper(pluriel('stock_btp.dotations.articles', t.n))}</small></th>
        <th class="nombre">${formatNombre(t.net, 2)}</th><th class="nombre">${formatNombre(t.sorti, 2)}</th><th class="nombre">${formatNombre(t.rendu, 2)}</th><th class="nombre">${formatNombre(t.rebut, 2)}</th><th></th></tr>`).join('')}</tfoot></table>`;
  }
  corps.querySelectorAll('[data-periode]').forEach((b) => b.addEventListener('click', () => {
    ecrirePreferences({ dotationsPeriode: b.dataset.periode });
    rendreDotationsSalarie(corps, { salarie, naviguer });
  }));
  corps.querySelectorAll('[data-url]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); naviguer(a.getAttribute('href'), e); }));
}
