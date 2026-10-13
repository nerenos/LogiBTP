import { echapper } from '@logibtp/socle/ui';
import { VueGraphe, tronquer } from '@logibtp/graphe/ui';
import { fusionnerGraphes, enColonneAnnuaire, PROFONDEUR_MAX } from '../src/graphe.js';

// Graphe relationnel de l'annuaire : spécialisation de la vue du module Graphe. Couches par niveau (groupes en haut,
// sociétés, établissements, agences, dépôts, puis contacts en colonnes), hiérarchie, liens typés et rattachements ;
// réglages contacts, liens et nombre de contacts par personne (au-delà : « + N contacts ») ; couleur de la relation
// principale (client, fournisseur…) ; panneau : niveau, relations, ouvrir, centrer, développer, tous les contacts.

const LARGEUR = { personne: 184, individu: 150, groupe: 120 };
const HAUTEUR = { personne: 46, individu: 30, groupe: 28 };
const COULEURS_RELATION = {
  CLIENT: '#2e9d5b', PROSPECT: '#7cc497', FOURNISSEUR: '#2f6fd1', LOUEUR: '#5b8fe0', SOUS_TRAITANT: '#e07b24', COTRAITANT: '#c99a2e',
  INTERIM: '#b5651d', ARCHITECTE: '#8b5cf6', MOE: '#7c3aed', BE: '#6d5bd0', BC: '#0f9fa8', MOA: '#d14d72', BANQUE: '#64748b', ASSURANCE: '#475569',
};

export class VueGrapheAnnuaire extends VueGraphe {
  static CLE_REGLAGES = 'annuaireGraphe';

  /**
   * options (en plus de celles de VueGraphe) : annuaire (graphe(type, id, options)) ; referentiels { niveaux, casquettes } ;
   * ouvrirFiche({ type, id }, evenement).
   */
  constructor(conteneur, options) {
    super(conteneur, { profondeurMax: PROFONDEUR_MAX, ...options, ouvrir: options.ouvrirFiche ? (n, e) => options.ouvrirFiche({ type: n.type, id: n.id }, e) : null });
  }

  chargerGraphe(depart, reglages) { return this.options.annuaire.graphe(depart.type, depart.id, reglages); }

  developperGraphe(noeud, reglages, extra = {}) {
    return this.options.annuaire.graphe(noeud.type === 'groupe' ? 'personne' : noeud.type, noeud.id, { ...reglages, ...extra, profondeur: 1 });
  }

  fusionner(a, b) { return fusionnerGraphes(a, b); }

  reglagesDefaut() { return { contacts: true, liens: true, max_contacts: 8 }; }

  controlesReglages() {
    return [
      { code: 'contacts', libelle: 'Contacts', type: 'case' },
      { code: 'liens', libelle: 'Liens', type: 'case' },
      { code: 'max_contacts', libelle: 'Contacts par personne', titre: 'Au-delà, les contacts d\'une personne sont résumés (« + N contacts »)', type: 'liste', options: [4, 8, 15, 30, 100] },
    ];
  }

  enColonne(n) { return enColonneAnnuaire(n); }

  dimensions(n) { return { w: LARGEUR[n.type] ?? 150, h: HAUTEUR[n.type] ?? 30 }; }

  couleurNoeud(n) {
    if (n.type !== 'personne') return 'var(--discret)';
    const c = (n.casquettes ?? []).find((x) => COULEURS_RELATION[x]);
    return c ? COULEURS_RELATION[c] : 'var(--bord)';
  }

  #niveau(n) { return this.options.referentiels?.niveaux?.find((x) => x.code === n.niveau)?.libelle ?? n.niveau ?? ''; }

  titreNoeud(n) { return [n.libelle, this.#niveau(n), n.sous_titre].filter(Boolean).join(' – '); }

  corpsNoeud(n, { x, y, w, h, bord, cx }) {
    if (n.type === 'personne') {
      const relations = (n.casquettes ?? []).map((c) => this.options.referentiels?.casquettes?.find((x2) => x2.code === c)?.icone ?? '').join('');
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="var(--surface)" ${bord}/>
        <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${this.couleurNoeud(n)}"/>
        <text x="${x + 14}" y="${y + 19}" font-size="13">${echapper(n.icone ?? '🏢')}</text>
        <text x="${x + 34}" y="${y + 19}" font-size="12" font-weight="600" fill="var(--texte)">${echapper(tronquer(n.libelle, 22))}</text>
        <text x="${x + 34}" y="${y + 35}" font-size="10" fill="var(--discret)">${echapper(tronquer([this.#niveau(n), n.sous_titre].filter(Boolean).join(' · '), 22))}</text>
        ${relations ? `<text x="${x + w - 6}" y="${y + 35}" font-size="10" text-anchor="end">${echapper(relations)}</text>` : ''}`;
    }
    if (n.type === 'individu') {
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--fond)" ${bord}/>
        <text x="${x + 10}" y="${y + 20}" font-size="12">👤</text>
        <text x="${x + 28}" y="${y + 19}" font-size="11" fill="var(--texte)">${echapper(tronquer(n.libelle, 19))}</text>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--fond)" stroke="var(--discret)" stroke-dasharray="3 3"/>
      <text x="${cx}" y="${y + 18}" font-size="11" text-anchor="middle" fill="var(--discret)">👥 ${echapper(n.libelle)}</text>`;
  }

  styleArete(a) {
    return {
      hierarchie: 'stroke="var(--discret)" stroke-width="1.8" marker-end="url(#graphe-fleche)"',
      lien: 'stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="6 4" marker-end="url(#graphe-fleche-lien)"',
      rattachement: 'stroke="var(--discret)" stroke-width="1" opacity="0.7"',
      groupe: 'stroke="var(--discret)" stroke-width="1" stroke-dasharray="2 3"',
    }[a.type] ?? super.styleArete(a);
  }

  /** Libellé des liens toujours visible ; fonction d'un contact au survol seulement. */
  libelleArete(a) {
    if (!a.libelle || !['lien', 'rattachement'].includes(a.type)) return null;
    return { texte: a.libelle, secondaire: a.type === 'rattachement', couleur: a.type === 'lien' ? 'var(--accent)' : 'var(--discret)' };
  }

  legende() {
    return [{ classe: 'l-hier', libelle: 'Hiérarchie' }, { classe: 'l-lien', libelle: 'Lien' }, { classe: 'l-rat', libelle: 'Contact' }, { classe: 'l-inactif', libelle: 'Inactif' }];
  }

  compte(g) {
    return g.noeuds.length
      ? `${g.noeuds.filter((n) => n.type === 'personne').length} personne(s), ${g.noeuds.filter((n) => n.type === 'individu').length} contact(s), ${g.aretes.length} relation(s)` : 'Fiche introuvable';
  }

  infosNoeud(n) {
    const ref = this.options.referentiels ?? {};
    const relations = (n.casquettes ?? []).map((c) => ref.casquettes?.find((x) => x.code === c)).filter(Boolean);
    return `<p class="aide">${n.type === 'personne' ? echapper(this.#niveau(n)) : n.type === 'individu' ? 'Individu' : 'Contacts non affichés'}${n.sous_titre ? ` · ${echapper(n.sous_titre)}` : ''}
        · ${n.distance === 0 ? 'fiche de départ' : `à ${n.distance} saut${n.distance > 1 ? 's' : ''}`}${n.actif ? '' : ' · inactif'}</p>
      ${relations.length ? `<p class="annuaire-pastilles">${relations.map((r) => `<span class="pastille cochee">${echapper(r.icone ?? '')} ${echapper(r.libelle)}</span>`).join('')}</p>` : ''}`;
  }

  peutOuvrir(n) { return n.type !== 'groupe' && super.peutOuvrir(n); }

  boutonsNoeud(n) {
    if (n.type === 'groupe') {
      return [{ code: 'tous', libelle: 'Afficher tous les contacts', action: () => this.developper(n, { max_contacts: 200 }).catch((e) => this.erreur(e)) }];
    }
    return super.boutonsNoeud(n);
  }

  relationVoisin(a, n) {
    if (a.type === 'hierarchie') return a.de === n.cle ? 'Niveau inférieur' : 'Niveau supérieur';
    if (a.type === 'lien') return `${a.libelle ?? 'Lien'}${a.vers === n.cle ? ' (vers cette fiche)' : ''}`;
    if (a.type === 'rattachement') return a.libelle ?? 'Contact';
    return 'Contacts';
  }
}
