import { texte, texteHtml, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper, lirePreferences, ecrirePreferences } from '@logibtp/socle/ui';

/** Gravités des notifications, de la plus forte à la plus faible (icône HTML et libellé lus dans le dictionnaire). */
const gravite = (cle, nom) => Object.freeze({ get icone() { return iconeHtml(nom); }, get libelle() { return texte(`document.notifications.${cle}`); } });
export const GRAVITES = Object.freeze({ erreur: gravite('erreurs', 'erreur'), avertissement: gravite('avertissements', 'avertissement') });
const ORDRE_GRAVITE = Object.keys(GRAVITES);

/**
 * Notifications du document, comme dans un IDE : erreurs et avertissements de toutes les sources (calcul du moteur et
 * sources de la spécialisation : contrôles de saisie, métrés…), dans l'ordre des lignes. Filtres par gravité, par
 * source et par type (code), gardés dans le navigateur (préférence `notificationsDocument` : éléments masqués). Un clic
 * va à la ligne ; `suivante(sens)` passe à la notification suivante ou précédente à partir de la ligne courante.
 * Rien n'est bloquant ici : la validation garde ses propres contrôles.
 *
 * editeur : { magasin, resultat (lignes, erreurs, avertissements), titreLigne(ligId), grille.courant } ;
 * options : sources [{ cle, libelle, messages() → [{ gravite, lig_id, code, message, ... }] }] (ajoutées à la source
 *           `calcul`), libelles { code: libellé du type } (filtres), aller(message) (défaut : allerA de l'éditeur),
 *           surCompte({ erreurs, avertissements }).
 */
export class NotificationsDocument {
  constructor(racine, editeur, { sources = [], libelles = {}, aller = null, surCompte = null } = {}) {
    this.racine = racine;
    this.editeur = editeur;
    this.libelles = libelles;
    this.aller = aller ?? ((m) => editeur.allerA(m.lig_id));
    this.surCompte = surCompte;
    this.sources = [{ cle: 'calcul', get libelle() { return texte('document.notifications.calcul'); }, messages: () => this.messagesCalcul() }, ...sources];
    this.courant = null;
    const p = lirePreferences().notificationsDocument ?? {};
    this.masques = { gravites: new Set(p.gravites ?? []), sources: new Set(p.sources ?? []), codes: new Set(p.codes ?? []) };
    racine.classList.add('notifications-document');
    racine.addEventListener('click', (e) => this.#clic(e));
    editeur.magasin.abonner(() => this.rendre());
    this.rendre();
  }

  /** Erreurs et avertissements du moteur de calcul. */
  messagesCalcul() {
    const r = this.editeur.resultat;
    return [...(r.erreurs ?? []).map((e) => ({ ...e, gravite: 'erreur' })), ...(r.avertissements ?? []).map((e) => ({ ...e, gravite: 'avertissement' }))];
  }

  /** Toutes les notifications (sans filtre), triées par ligne puis gravité : { gravite, source, lig_id, code, message… }. */
  tous() {
    if (this.cache?.resultat === this.editeur.resultat) return this.cache.messages;
    const rang = new Map((this.editeur.resultat.lignes ?? []).map((l, i) => [l.lig_id, i]));
    const rangDe = (m) => (m.lig_id === null || m.lig_id === undefined ? -1 : rang.get(m.lig_id) ?? Infinity);
    const messages = this.sources.flatMap((s) => s.messages().map((m) => ({ ...m, source: s.cle, gravite: m.gravite ?? 'avertissement' })))
      .map((m, i) => ({ ...m, rang: rangDe(m), i }))
      .sort((a, b) => (a.rang - b.rang) || (ORDRE_GRAVITE.indexOf(a.gravite) - ORDRE_GRAVITE.indexOf(b.gravite)) || (a.i - b.i));
    const parLigne = new Map();
    for (const m of messages) {
      if (!parLigne.has(m.lig_id)) parLigne.set(m.lig_id, []);
      parLigne.get(m.lig_id).push(m);
    }
    this.cache = { resultat: this.editeur.resultat, messages, parLigne };
    return messages;
  }

  /** Notifications affichées : filtres de gravité, de source et de type appliqués. */
  filtres() {
    const { gravites, sources, codes } = this.masques;
    return this.tous().filter((m) => !gravites.has(m.gravite) && !sources.has(m.source) && !codes.has(m.code));
  }

  /** Notifications d'une ligne (sans filtre). */
  messagesLigne(ligId) {
    this.tous();
    return this.cache.parLigne.get(ligId) ?? [];
  }

  /** Va à la notification suivante (sens 1) ou précédente (−1) à partir de la notification ou de la ligne courante. */
  suivante(sens = 1) {
    const liste = this.filtres();
    if (!liste.length) return null;
    let k = this.courant ? liste.findIndex((m) => cle(m) === this.courant) : -1;
    const ligne = this.editeur.grille?.courant;
    // La ligne courante a changé depuis : on repart d'elle.
    if (k < 0 || liste[k].lig_id !== ligne) {
      const rang = new Map((this.editeur.resultat.lignes ?? []).map((l, i) => [l.lig_id, i]));
      const r = rang.get(ligne) ?? -1;
      k = sens > 0 ? liste.findIndex((m) => m.rang > r) : findLastIndex(liste, (m) => m.rang < r);
      if (k < 0) k = sens > 0 ? 0 : liste.length - 1;
    } else k = (k + sens + liste.length) % liste.length;
    this.ouvrir(liste[k]);
    return liste[k];
  }

  /** Première notification d'une ligne sélectionnée dans le panneau (clic droit, icône de la grille). */
  montrerLigne(ligId) {
    const m = this.filtres().find((x) => x.lig_id === ligId) ?? this.messagesLigne(ligId)[0];
    if (!m) return;
    this.courant = cle(m);
    this.rendre();
    this.racine.querySelector('.courante')?.scrollIntoView({ block: 'nearest' });
  }

  ouvrir(m) {
    this.courant = cle(m);
    this.rendre();
    this.racine.querySelector('.courante')?.scrollIntoView({ block: 'nearest' });
    if (m.lig_id !== null && m.lig_id !== undefined) this.aller(m);
  }

  rendre() {
    const tous = this.tous();
    const liste = this.filtres();
    const compte = (f) => tous.filter(f).length;
    const erreurs = compte((m) => m.gravite === 'erreur');
    this.surCompte?.({ erreurs, avertissements: tous.length - erreurs });
    const { gravites, sources, codes } = this.masques;
    const bouton = (genre, valeur, html, titre, n) => `<button type="button" class="filtre${(this.masques[genre].has(valeur) ? '' : ' actif')}"
      data-filtre="${genre}" data-valeur="${echapper(valeur)}" title="${echapper(titre)}" aria-pressed="${!this.masques[genre].has(valeur)}">${html} <span class="nombre">${n}</span></button>`;
    const codesPresents = [...new Set(tous.map((m) => m.code))].sort();
    this.liste = liste;
    this.racine.innerHTML = `
      <div class="filtres-notifications">
        ${ORDRE_GRAVITE.map((g) => bouton('gravites', g, GRAVITES[g].icone, texte('document.notifications.basculer', { nom: GRAVITES[g].libelle }), compte((m) => m.gravite === g))).join('')}
        ${this.sources.length > 1 ? `<span class="sep"></span>${this.sources.map((s) => bouton('sources', s.cle, echapper(s.libelle), texte('document.notifications.basculer_source', { nom: s.libelle }), compte((m) => m.source === s.cle))).join('')}` : ''}
        ${codesPresents.length ? `<span class="sep"></span>${codesPresents.map((c) => bouton('codes', c, echapper(this.libelles[c] ?? c), texte('document.notifications.basculer', { nom: c }), compte((m) => m.code === c))).join('')}` : ''}
        ${gravites.size || sources.size || codes.size ? `<button type="button" class="tout-afficher" data-tout-afficher title="${texteHtml('document.notifications.retirer_filtres')}">${iconeHtml('retirer')} ${texteHtml('document.notifications.tout_afficher')}</button>` : ''}
      </div>
      ${liste.length ? `<ul>${liste.map((m, i) => `<li><button type="button" class="${m.gravite}${cle(m) === this.courant ? ' courante' : ''}" data-message="${i}"
          title="${texteHtml(m.lig_id === null || m.lig_id === undefined ? 'document.notifications.aide_document' : 'document.notifications.aide_ligne')}">
          <span class="icone">${GRAVITES[m.gravite]?.icone ?? iconeHtml('document_puce')}</span>
          <span class="ligne">${echapper(m.lig_id === null || m.lig_id === undefined ? texte('document.notifications.document') : (this.editeur.titreLigne?.(m.lig_id) ?? String(m.lig_id)).trim())}</span>
          <span class="message">${echapper(m.message)}</span>
          <code>${echapper(m.code)}</code>
        </button></li>`).join('')}</ul>`
        : `<p class="aide">${texteHtml(tous.length ? 'document.notifications.aucune_filtre' : 'document.notifications.aucune')}</p>`}`;
  }

  #clic(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toutAfficher !== undefined) {
      for (const s of Object.values(this.masques)) s.clear();
      this.#memoriser();
    } else if (b.dataset.filtre) {
      const s = this.masques[b.dataset.filtre];
      if (s.has(b.dataset.valeur)) s.delete(b.dataset.valeur); else s.add(b.dataset.valeur);
      this.#memoriser();
    } else if (b.dataset.message !== undefined) this.ouvrir(this.liste[Number(b.dataset.message)]);
  }

  #memoriser() {
    const { gravites, sources, codes } = this.masques;
    ecrirePreferences({ notificationsDocument: { gravites: [...gravites], sources: [...sources], codes: [...codes] } });
    this.rendre();
  }
}

const cle = (m) => `${m.source}|${m.lig_id ?? ''}|${m.code}|${m.message}`;

function findLastIndex(t, f) {
  for (let i = t.length - 1; i >= 0; i--) if (f(t[i])) return i;
  return -1;
}
