// Module MCP, journal des agents : appels d'outils (lecture comprise) filtrés par compte, agent, élément et période,
// export CSV. Composant sans métier : l'application fournit l'appel (GET /api/mcp/journal) et l'ouverture d'une proposition.
import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { aujourdhui } from '@logibtp/socle';
import { echapper, formatDateHeure, champDate, telechargerCsv, lireStockage, ecrireStockage, declarerRaccourcis, actionDe } from '@logibtp/socle/ui';
import { filtrerJournal, lignesCsvJournal, texteElements, COLONNES_JOURNAL } from './modeles.js';

export const GROUPE_RACCOURCIS_JOURNAL = 'mcp_journal';
declarerRaccourcis(GROUPE_RACCOURCIS_JOURNAL, {
  libelle: texte('mcp.raccourcis.groupe_journal'),
  actions: { actualiser: { libelle: texte('mcp.raccourcis.actualiser'), defaut: 'Alt+R' } },
});

/** Clé du navigateur des derniers filtres du journal (préférence d'affichage, jamais en base). */
export const CLE_FILTRES = 'mcpJournalFiltres';

/** Tableau du journal (HTML) ; `tous` : colonne du compte. */
export function journalHtml(lignes, { tous = false } = {}) {
  if (!lignes?.length) return `<p class="aide">${texteHtml('mcp.journal.aucun')}</p>`;
  return `<table class="tableau-compact mcp-table mcp-journal"><thead><tr><th>${texteHtml('mcp.journal.colonnes.date')}</th>${tous ? `<th>${texteHtml('mcp.journal.colonnes.compte')}</th>` : ''}
      <th>${texteHtml('mcp.journal.colonnes.client')}</th><th>${texteHtml('mcp.journal.colonnes.outil')}</th><th>${texteHtml('mcp.journal.colonnes.classe')}</th>
      <th>${texteHtml('mcp.journal.colonnes.statut')}</th><th>${texteHtml('mcp.journal.colonnes.lus')}</th><th>${texteHtml('mcp.journal.colonnes.ecrits')}</th>
      <th>${texteHtml('mcp.journal.colonnes.duree_ms')}</th><th>${texteHtml('mcp.journal.colonnes.erreur')}</th></tr></thead><tbody>
    ${lignes.map((l) => `<tr class="mcp-statut-${echapper(String(l.statut ?? '').toLowerCase())}"><td>${formatDateHeure(l.date)}</td>${tous ? `<td>${echapper(l.compte)}</td>` : ''}
      <td title="${echapper(l.delegation ?? '')}">${iconeHtml('mcp_agent')} ${echapper(l.client || texte('mcp.journal.client_inconnu'))}</td>
      <td>${echapper(l.outil)}${l.proposition ? ` <a href="#" data-proposition="${echapper(l.proposition)}">${texteHtml('mcp.journal.proposition', { id: l.proposition })}</a>` : ''}${l.humain ? ` <span class="aide">${texteHtml('mcp.journal.humain', { humain: l.humain })}</span>` : ''}</td>
      <td>${echapper(texte(`mcp.classes.${l.classe}`))}</td><td>${echapper(texte(`mcp.statuts.${l.statut}`))}</td>
      <td>${echapper(texteElements(l.lus))}${l.nb_lus ? ` <span class="aide">(${echapper(l.nb_lus)})</span>` : ''}</td><td>${echapper(texteElements(l.ecrits))}</td>
      <td class="nombre">${echapper(l.duree_ms ?? '')}</td><td>${echapper(l.erreur ?? '')}</td></tr>`).join('')}</tbody></table>`;
}

/**
 * Journal. options : { api: { journal({ tous, du, au, limite }) }, tous (administrateur : tout le journal), ouvrirProposition(id, e),
 * erreur(e) }. Compte, agent et élément sont filtrés dans les lignes lues (1 000 au plus), la période par le serveur.
 */
export class JournalAgents {
  #zone;
  #o;
  #lignes = [];
  #filtres;

  constructor(zone, options = {}) {
    this.#zone = zone;
    this.#o = { api: {}, tous: false, ouvrirProposition: () => {}, erreur: () => {}, ...options };
    this.#filtres = { compte: '', agent: '', element: '', du: '', au: '', ...lireStockage(CLE_FILTRES, {}) };
    this.#zone.addEventListener('keydown', (e) => {
      if (actionDe(e, GROUPE_RACCOURCIS_JOURNAL) === 'actualiser') { e.preventDefault(); this.charger(); }
    });
  }

  get filtres() { return { ...this.#filtres }; }

  async charger() {
    const { du, au } = this.#filtres;
    try {
      this.#lignes = (await this.#o.api.journal({ tous: this.#o.tous, du, au, limite: 1000 })) ?? [];
    } catch (e) {
      this.#o.erreur(e);
    }
    this.#rendre();
  }

  lignes() { return filtrerJournal(this.#lignes, this.#filtres); }

  #rendre() {
    const f = this.#filtres;
    const champ = (cle) => `<label>${texteHtml(`mcp.journal.filtres.${cle}`)} <input type="text" data-filtre="${cle}" value="${echapper(f[cle])}" size="12"></label>`;
    this.#zone.innerHTML = `<h2 class="titre-actions">${iconeHtml('mcp_journal')} ${texteHtml(this.#o.tous ? 'mcp.journal.titre_tous' : 'mcp.journal.titre')}</h2>
      <div class="barre-outils mcp-filtres"><div class="groupe-outils">${this.#o.tous ? champ('compte') : ''}${champ('agent')}${champ('element')}</div>
        <div class="groupe-outils"><label>${texteHtml('mcp.journal.filtres.du')} <input type="date" data-filtre="du" value="${echapper(f.du)}"></label>
          <label>${texteHtml('mcp.journal.filtres.au')} <input type="date" data-filtre="au" value="${echapper(f.au)}"></label></div>
        <div class="groupe-outils"><button type="button" data-actualiser title="${echapper(texte('mcp.journal.actualiser'))}">${iconeHtml('mcp_actualiser')}</button>
          <button type="button" data-csv title="${echapper(texte('mcp.journal.csv_aide'))}">${iconeHtml('mcp_csv')} ${texteHtml('mcp.journal.csv')}</button></div></div>
      <div data-tableau></div>`;
    this.#zone.querySelectorAll('input[type="date"]').forEach(champDate);
    this.#zone.querySelectorAll('[data-filtre]').forEach((c) => c.addEventListener(c.dataset.filtre === 'du' || c.dataset.filtre === 'au' ? 'change' : 'input', () => {
      this.#filtres[c.dataset.filtre] = c.value;
      ecrireStockage(CLE_FILTRES, this.#filtres);
      if (c.dataset.filtre === 'du' || c.dataset.filtre === 'au') this.charger();
      else this.#rendreTableau();
    }));
    this.#zone.querySelector('[data-actualiser]').addEventListener('click', () => this.charger());
    this.#zone.querySelector('[data-csv]').addEventListener('click', () => this.exporter());
    this.#rendreTableau();
  }

  #rendreTableau() {
    const zone = this.#zone.querySelector('[data-tableau]');
    zone.innerHTML = journalHtml(this.lignes(), { tous: this.#o.tous });
    zone.querySelectorAll('[data-proposition]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); this.#o.ouvrirProposition(a.dataset.proposition, e); }));
  }

  /** Export CSV des lignes affichées (outil commun du socle : BOM, CRLF). */
  exporter() {
    const entetes = Object.fromEntries(COLONNES_JOURNAL.map((c) => [c, texte(`mcp.journal.colonnes.${c}`)]));
    telechargerCsv(`${texte('mcp.journal.fichier')}-${aujourdhui()}.csv`, lignesCsvJournal(this.lignes(), entetes));
  }
}
