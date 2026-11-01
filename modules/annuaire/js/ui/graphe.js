import { texte, texteHtml, pluriel, icone, iconeHtml } from '@logibtp/socle/dictionnaire';
import { echapper } from '@logibtp/socle/ui';
import { VueGraphe, tronquer } from '@logibtp/graphe/ui';
import { fusionnerGraphes, enColonneAnnuaire, PROFONDEUR_MAX } from '../src/graphe.js';

// Graphe relationnel de l'annuaire : spécialisation de la vue du module Graphe. Couches par niveau (groupes en haut,
// sociétés, établissements, agences, dépôts, puis contacts en colonnes), hiérarchie, liens typés et rattachements ;
// réglages contacts, liens et nombre de contacts par personne (au-delà : « + N contacts ») ; couleur de la relation
// principale (client, fournisseur…) ; panneau : niveau, relations, ouvrir, centrer, développer, tous les contacts.

const LARGEUR = { personne: 184, individu: 150, groupe: 120 };
const HAUTEUR = { personne: 46, individu: 30, groupe: 28 };
// Couleur de la relation principale : variable --annuaire-relation-<code> du thème (relations du référentiel livré).
const RELATIONS_COLOREES = ['CLIENT', 'PROSPECT', 'FOURNISSEUR', 'LOUEUR', 'SOUS_TRAITANT', 'COTRAITANT', 'INTERIM', 'ARCHITECTE', 'MOE', 'BE', 'BC', 'MOA', 'BANQUE', 'ASSURANCE'];
const couleurRelation = (code) => `var(--annuaire-relation-${code.toLowerCase().replaceAll('_', '-')})`;

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
      { code: 'contacts', libelle: texte('annuaire.graphe.reglages.contacts'), type: 'case' },
      { code: 'liens', libelle: texte('annuaire.graphe.reglages.liens'), type: 'case' },
      { code: 'max_contacts', libelle: texte('annuaire.graphe.reglages.max_contacts'), titre: texte('annuaire.graphe.reglages.max_contacts_aide'), type: 'liste', options: [4, 8, 15, 30, 100] },
    ];
  }

  enColonne(n) { return enColonneAnnuaire(n); }

  dimensions(n) { return { w: LARGEUR[n.type] ?? 150, h: HAUTEUR[n.type] ?? 30 }; }

  couleurNoeud(n) {
    if (n.type !== 'personne') return 'var(--discret)';
    const c = (n.casquettes ?? []).find((x) => RELATIONS_COLOREES.includes(x));
    return c ? couleurRelation(c) : 'var(--bord)';
  }

  #niveau(n) { return this.options.referentiels?.niveaux?.find((x) => x.code === n.niveau)?.libelle ?? n.niveau ?? ''; }

  titreNoeud(n) { return [n.libelle, this.#niveau(n), n.sous_titre].filter(Boolean).join(' – '); }

  corpsNoeud(n, { x, y, w, h, bord, cx }) {
    if (n.type === 'personne') {
      const relations = (n.casquettes ?? []).map((c) => this.options.referentiels?.casquettes?.find((x2) => x2.code === c)?.icone ?? '').join('');
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="var(--surface)" ${bord}/>
        <rect x="${x}" y="${y}" width="6" height="${h}" rx="3" fill="${this.couleurNoeud(n)}"/>
        <text x="${x + 14}" y="${y + 19}" font-size="13">${echapper(n.icone ?? icone('annuaire_personne'))}</text>
        <text x="${x + 34}" y="${y + 19}" font-size="12" font-weight="600" fill="var(--texte)">${echapper(tronquer(n.libelle, 22))}</text>
        <text x="${x + 34}" y="${y + 35}" font-size="10" fill="var(--discret)">${echapper(tronquer([this.#niveau(n), n.sous_titre].filter(Boolean).join(' · '), 22))}</text>
        ${relations ? `<text x="${x + w - 6}" y="${y + 35}" font-size="10" text-anchor="end">${echapper(relations)}</text>` : ''}`;
    }
    if (n.type === 'individu') {
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--fond)" ${bord}/>
        <text x="${x + 10}" y="${y + 20}" font-size="12">${iconeHtml('annuaire_individu')}</text>
        <text x="${x + 28}" y="${y + 19}" font-size="11" fill="var(--texte)">${echapper(tronquer(n.libelle, 19))}</text>`;
    }
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--fond)" stroke="var(--discret)" stroke-dasharray="3 3"/>
      <text x="${cx}" y="${y + 18}" font-size="11" text-anchor="middle" fill="var(--discret)">${iconeHtml('annuaire_groupe')} ${echapper(n.libelle)}</text>`;
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
    return [{ classe: 'l-hier', libelle: texte('annuaire.graphe.legende.hierarchie') }, { classe: 'l-lien', libelle: texte('annuaire.graphe.legende.lien') }, { classe: 'l-rat', libelle: texte('annuaire.graphe.legende.contact') }, { classe: 'l-inactif', libelle: texte('annuaire.graphe.legende.inactif') }];
  }

  compte(g) {
    return g.noeuds.length
      ? [
        pluriel('annuaire.graphe.compte.personnes', g.noeuds.filter((n) => n.type === 'personne').length),
        pluriel('annuaire.graphe.compte.contacts', g.noeuds.filter((n) => n.type === 'individu').length),
        pluriel('annuaire.graphe.compte.relations', g.aretes.length),
      ].join(', ') : texte('annuaire.graphe.introuvable');
  }

  infosNoeud(n) {
    const ref = this.options.referentiels ?? {};
    const relations = (n.casquettes ?? []).map((c) => ref.casquettes?.find((x) => x.code === c)).filter(Boolean);
    return `<p class="aide">${n.type === 'personne' ? echapper(this.#niveau(n)) : n.type === 'individu' ? texteHtml('annuaire.graphe.individu') : texteHtml('annuaire.graphe.contacts_masques')}${n.sous_titre ? ` · ${echapper(n.sous_titre)}` : ''}
        · ${n.distance === 0 ? texteHtml('annuaire.graphe.depart') : pluriel('annuaire.graphe.distance', n.distance)}${n.actif ? '' : ` · ${texteHtml('annuaire.graphe.inactif')}`}</p>
      ${relations.length ? `<p class="annuaire-pastilles">${relations.map((r) => `<span class="pastille cochee">${echapper(r.icone ?? '')} ${echapper(r.libelle)}</span>`).join('')}</p>` : ''}`;
  }

  peutOuvrir(n) { return n.type !== 'groupe' && super.peutOuvrir(n); }

  boutonsNoeud(n) {
    if (n.type === 'groupe') {
      return [{ code: 'tous', libelle: texte('annuaire.graphe.tous_contacts'), action: () => this.developper(n, { max_contacts: 200 }).catch((e) => this.erreur(e)) }];
    }
    return super.boutonsNoeud(n);
  }

  relationVoisin(a, n) {
    if (a.type === 'hierarchie') return a.de === n.cle ? texte('annuaire.graphe.voisin.inferieur') : texte('annuaire.graphe.voisin.superieur');
    if (a.type === 'lien') return a.vers === n.cle ? texte('annuaire.graphe.voisin.vers_fiche', { lien: a.libelle ?? texte('annuaire.graphe.voisin.lien') }) : a.libelle ?? texte('annuaire.graphe.voisin.lien');
    if (a.type === 'rattachement') return a.libelle ?? texte('annuaire.graphe.voisin.contact');
    return texte('annuaire.graphe.voisin.contacts');
  }
}
