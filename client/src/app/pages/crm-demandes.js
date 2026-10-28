import { dateLocale } from '@logibtp/socle';
import { PageBase } from '@logibtp/navigation';
import { echapper, creerCombo, formatNombre, formatDate } from '@logibtp/socle/ui';
import { ETATS_DEMANDE, ETATS_DEMANDE_CLOS, MOTIFS_SANS_SUITE } from '@logibtp/crm';
import { api } from '../api.js';
import { lienElement } from '../crm/crm.js';

const VUES = [
  { code: 'mes', libelle: 'Mes demandes', aide: 'Demandes dont je suis responsable, ouvertes' },
  { code: 'a_prendre', libelle: 'À prendre', aide: 'Demandes en attente dans mes services' },
  { code: 'creees', libelle: 'Créées par moi', aide: 'Demandes que j\'ai saisies' },
  { code: 'toutes', libelle: 'Toutes', aide: 'Toutes les demandes' },
];

/** Pastille d'état d'une demande. */
export const pastilleDemande = (d) => `<span class="crm-etat crm-dem-${String(d.etat).toLowerCase()}">${echapper(ETATS_DEMANDE.find((e) => e.valeur === d.etat)?.libelle ?? d.etat)}${d.motif ? ` · ${echapper(MOTIFS_SANS_SUITE.find((m) => m.valeur === d.motif)?.libelle ?? d.motif)}` : ''}</span>`;

/**
 * Demandes (module CRM, veille commerciale) : `/crm/demandes?vue=&etat=&recherche=`. Pré-dossiers suivis avant la
 * création du projet, triés par réponse attendue ; prise en charge des demandes en attente dans mes services.
 */
export class PageDemandesCrm extends PageBase {
  icone = '📨';

  async ouvrir() {
    const app = this.app;
    const r = this.requete;
    this.filtre = { vue: VUES.some((v) => v.code === r.vue) ? r.vue : 'toutes', etat: r.etat ?? 'ouvertes', recherche: r.recherche ?? '', page: 1 };
    this.titre = 'Demandes';
    this.conteneur.innerHTML = `<div class="page-parametres page-crm"><h1 class="page-titre">📨 Demandes (veille commerciale)</h1>
      <nav class="onglets crm-vues">${VUES.map((v) => `<button type="button" data-vue="${v.code}" title="${echapper(v.aide)}">${echapper(v.libelle)}</button>`).join('')}</nav>
      <div class="crm-filtres"><input type="search" data-recherche placeholder="Rechercher (numéro, objet, origine)" value="${echapper(this.filtre.recherche)}"><span data-etat></span>
        <button type="button" class="principal" data-nouvelle title="Nouvelle demande (Ctrl : autre fenêtre)">＋ Nouvelle demande</button></div>
      <div data-corps></div></div>`;
    const $ = (s) => this.conteneur.querySelector(s);
    this.conteneur.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => { this.filtre.vue = b.dataset.vue; this.filtre.page = 1; this.charger(); }));
    const etat = creerCombo({ options: [{ valeur: 'ouvertes', libelle: 'Ouvertes' }, ...ETATS_DEMANDE], valeur: this.filtre.etat });
    etat.addEventListener('change', () => { this.filtre.etat = etat.valeurCombo; this.filtre.page = 1; this.charger(); });
    $('[data-etat]').replaceWith(etat);
    let minuterie;
    $('[data-recherche]').addEventListener('input', (e) => { clearTimeout(minuterie); minuterie = setTimeout(() => { this.filtre.recherche = e.target.value; this.filtre.page = 1; this.charger(); }, 300); });
    $('[data-nouvelle]').addEventListener('click', (e) => app.naviguer('/crm/demande/nouveau', { nouvelleFenetre: e.ctrlKey || e.shiftKey }));
    this.desabonner = app.abonner('crm', () => this.charger());
    await this.charger();
  }

  urlCourante() {
    const f = this.filtre;
    if (!f) return null;
    return `/crm/demandes?${new URLSearchParams(Object.entries({ vue: f.vue, etat: f.etat === 'ouvertes' ? '' : f.etat, recherche: f.recherche }).filter(([, v]) => v))}`;
  }

  async reprendre() { await this.charger(); }

  fermer() { this.desabonner?.(); }

  async charger() {
    const corps = this.conteneur.querySelector('[data-corps]');
    if (!corps) return;
    this.conteneur.querySelectorAll('[data-vue]').forEach((b) => b.classList.toggle('actif', b.dataset.vue === this.filtre.vue));
    this.app.routeur?.remplacerUrl(this.urlCourante());
    let page;
    try { page = await api.crm.demandes({ ...this.filtre, taille: 50 }); } catch (e) { corps.innerHTML = `<p class="erreur">${echapper(e.message)}</p>`; return; }
    if (!page.demandes.length) { corps.innerHTML = '<p class="aide">Aucune demande.</p>'; return; }
    const pages = Math.ceil(page.total / page.taille);
    const aujourdhui = dateLocale();
    corps.innerHTML = `<table class="crm-table"><thead><tr><th>N°</th><th>Objet</th><th>Tiers</th><th>État</th><th>Responsable</th><th>Réponse attendue</th><th class="nombre">Montant estimé</th><th>Projet</th><th></th></tr></thead>
      <tbody>${page.demandes.map((d) => {
        const clos = ETATS_DEMANDE_CLOS.includes(d.etat);
        return `<tr class="${clos ? 'discret' : ''}"><td><a href="/crm/demande/${d.id}">${echapper(d.numero)}</a></td><td>${echapper(d.objet)}${d.nb_notes ? ` <span class="aide">💬 ${d.nb_notes}</span>` : ''}</td>
          <td>${lienElement(d.tiers)}</td><td>${pastilleDemande(d)}</td><td>${echapper(d.responsable ?? (d.service ? `${d.service} (à prendre)` : ''))}</td>
          <td class="${!clos && d.echeance && d.echeance < aujourdhui ? 'crm-retard' : ''}">${d.echeance ? formatDate(d.echeance) : ''}</td>
          <td class="nombre">${d.montant_estime === null || d.montant_estime === undefined ? '' : formatNombre(d.montant_estime, 0)}</td><td>${lienElement(d.cible)}</td>
          <td>${d.a_prendre ? `<button type="button" data-prendre="${d.id}">Prendre</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>
      <p class="aide">${page.total} demande(s)${pages > 1 ? ` · page ${page.page} / ${pages} <button type="button" data-page="-1" ${page.page <= 1 ? 'disabled' : ''}>◀</button> <button type="button" data-page="1" ${page.page >= pages ? 'disabled' : ''}>▶</button>` : ''}</p>`;
    corps.querySelectorAll('[data-prendre]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.crm.prendreDemande(Number(b.dataset.prendre)); this.app.message('Demande prise en charge', 'succes'); this.app.publier('crm', {}); } catch (e) { this.app.erreur(e); }
    }));
    corps.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { this.filtre.page += Number(b.dataset.page); this.charger(); }));
  }
}
