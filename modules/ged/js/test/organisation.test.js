import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accesAutorise, classer, echeancesRetention, ajouterMois, extraireTexte, FournisseurGedMemoire } from '../src/index.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const lire = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));

/** PDF minimal d'une page (comme pdfSimple du client). */
function pdf(texte) {
  const flux = `BT /F1 18 Tf 60 780 Td (${texte}) Tj ET`;
  const objets = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>', `<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`];
  return `%PDF-1.4\n${objets.map((o, i) => `${i + 1} 0 obj\n${o}\nendobj\n`).join('')}%%EOF\n`;
}

describe('règles répliquées (jeux partagés avec le C#)', () => {
  it('rétention : règle applicable et échéances', () => {
    const jeu = lire('04_retention.json');
    for (const c of jeu.cas) {
      const regles = c.regles ? jeu.regles.filter((r) => c.regles.includes(r.id)) : jeu.regles;
      expect(echeancesRetention(c.document, regles, c.aujourdhui), c.nom).toEqual(c.attendu);
    }
    for (const c of jeu.ajouter_mois) expect(ajouterMois(c.date, c.mois)).toBe(c.attendu);
  });

  it('classification automatique', () => {
    const jeu = lire('05_classification.json');
    for (const c of jeu.cas) expect(classer(c.document, jeu.regles), c.nom).toEqual(c.attendu);
  });

  it('confidentialité et accès', () => {
    const jeu = lire('06_acces.json');
    for (const c of jeu.cas) {
      for (const [cle, attendu] of Object.entries(c.attendu)) expect(accesAutorise(c.document, jeu.utilisateurs[cle]), `${c.nom} / ${cle}`).toBe(attendu);
    }
  });
});

describe('extraction du texte', () => {
  it('PDF simple, texte, HTML, sans texte', async () => {
    expect(await extraireTexte(new Blob([pdf('Facture beton C25/30')]), 'scan.pdf')).toEqual({ texte: 'Facture beton C25/30', etat: 'FAIT' });
    expect(await extraireTexte(new Blob(['<p>Devis &amp; <b>plan</b></p>']), 'a.html')).toEqual({ texte: 'Devis & plan', etat: 'FAIT' });
    expect(await extraireTexte(new Blob(['Bonjour   Hélène']), 'a.txt')).toEqual({ texte: 'Bonjour Hélène', etat: 'FAIT' });
    expect((await extraireTexte(new Blob([new Uint8Array([0x89, 0x50])]), 'photo.png', 'image/png')).etat).toBe('SANS_TEXTE');
  });
});

describe('fournisseur mémoire : organisation et cycle de vie', () => {
  const fichier = (contenu, nom, type = 'text/plain') => new File([contenu], nom, { type });
  const creer = (o = {}) => new FournisseurGedMemoire({ horloge: () => Date.UTC(2026, 9, 15, 10), ...o });

  it('dépôt : texte extrait, catégorie et confidentialité proposées, saisie prioritaire', async () => {
    const g = creer();
    const a = await g.deposer({ fichier: fichier(pdf('FACTURE 2026-118 beton'), 'scan_0042.pdf', 'application/pdf'), meta: { titre: 'scan 0042' } });
    expect([a.categorie, a.index_etat, a.mots_cles, a.classification.regles]).toEqual(['facture_recue', 'FAIT', ['facture'], [2]]);
    expect(a.extrait_texte).toBe('FACTURE 2026-118 beton');
    const b = await g.deposer({ fichier: fichier('x', 'Contrat.txt'), meta: { titre: 'Contrat', categorie: 'autre', confidentialite: 'INTERNE' } });
    expect([b.categorie, b.confidentialite]).toEqual(['autre', 'INTERNE']);
    expect((await g.deposer({ fichier: fichier('x', 'c.txt'), meta: { titre: 'Contrat cadre' } })).confidentialite).toBe('CONFIDENTIEL');
    expect((await g.lister({ recherche: 'beton' })).map((d) => d.titre)).toEqual(['scan 0042']);
  });

  it('répertoires : élément du parent, noms uniques, dépôt lié à l\'élément du répertoire, suppression si vide', async () => {
    const g = creer();
    const factures = await g.creerRepertoire({ nom: 'Factures', type_element: 'chantier', id_element: '4' });
    const annee = await g.creerRepertoire({ nom: '2026', parent_id: factures.id });
    expect([annee.type_element, annee.id_element]).toEqual(['chantier', '4']);
    expect((await g.creerRepertoire({ nom: 'factures', type_element: 'chantier', id_element: '4' }).catch((e) => e)).code).toBe('DOUBLON');
    expect((await g.creerRepertoire({ nom: 'a/b' }).catch((e) => e)).code).toBe('NOM');
    expect((await g.modifierRepertoire(factures.id, { parent_id: annee.id }).catch((e) => e)).code).toBe('REPERTOIRE_BOUCLE');
    // Dépôt depuis l'explorateur d'un autre élément : le document va à l'élément du répertoire.
    const d = await g.deposer({ fichier: fichier('x', 'f.txt'), meta: { titre: 'Facture', type_element: 'projet', id_element: '1', repertoire_id: annee.id } });
    expect([d.type_element, d.id_element, d.repertoire_id]).toEqual(['chantier', '4', annee.id]);
    expect((await g.repertoires({ type_element: 'chantier', id_element: '4' })).map((r) => [r.nom, r.nb_documents])).toEqual([['2026', 1], ['Factures', 0]]);
    expect((await g.supprimerRepertoire(annee.id).catch((e) => e)).code).toBe('REPERTOIRE_NON_VIDE');
    // Classé dans un répertoire d'un autre élément : lié à cet élément ; changer d'élément le sort du répertoire.
    const autre = await g.creerRepertoire({ nom: 'Plans', type_element: 'marche', id_element: '7' });
    expect((await g.modifier(d.id, { repertoire_id: autre.id })).type_element).toBe('marche');
    expect((await g.modifier(d.id, { type_element: 'projet', id_element: '1' })).repertoire_id).toBe(null);
    await g.supprimerRepertoire(annee.id);
  });

  it('accès : confidentiel invisible des autres, changement réservé à l\'auteur ou à l\'administrateur', async () => {
    const marie = creer({ utilisateur: 'marie', profil: 'CONDUCTEUR' });
    const d = await marie.deposer({ fichier: fichier('x', 'a.txt'), meta: { titre: 'Note', confidentialite: 'CONFIDENTIEL' } });
    const paul = creer({ utilisateur: 'paul', profil: 'CONDUCTEUR' });
    Object.assign(paul, { documents: marie.documents, versions: marie.versions, contenus: marie.contenus });
    expect(await paul.lister()).toEqual([]);
    expect((await paul.document(d.id).catch((e) => e)).code).toBe('INTROUVABLE');
    await marie.modifier(d.id, { acces_utilisateurs: ['paul'] });
    expect((await paul.lister()).length).toBe(1);
    expect((await paul.modifier(d.id, { confidentialite: 'PUBLIC' }).catch((e) => e)).code).toBe('ACCES_REFUSE');
    expect(marie.lignesListe()).toEqual([]);
  });

  it('dérivations sans boucle', async () => {
    const g = creer();
    const fr = await g.deposer({ fichier: fichier('fr', 'notice.txt'), meta: { titre: 'Notice' } });
    const en = await g.deposer({ fichier: fichier('en', 'notice-en.txt'), meta: { titre: 'Notice EN' } });
    const d = await g.ajouterDerivation(fr.id, { cible_id: en.id, type: 'traduction', langue: 'en' });
    expect(d.derivations.map((x) => [x.type, x.sens, x.document.id, x.langue])).toEqual([['TRADUCTION', 'cible', en.id, 'en']]);
    expect((await g.document(en.id)).derivations[0].sens).toBe('source');
    expect((await g.ajouterDerivation(en.id, { cible_id: fr.id, type: 'VERSION' }).catch((e) => e)).code).toBe('DERIVATION_BOUCLE');
    expect((await g.ajouterDerivation(fr.id, { cible_id: en.id, type: 'COPIE' }).catch((e) => e)).code).toBe('TYPE');
    await g.supprimerDerivation(d.derivations[0].id);
    expect((await g.document(fr.id)).derivations).toEqual([]);
  });

  it('rétention : échéances, archivage (hors coffre déplacé, coffre sur place) et restauration', async () => {
    const g = creer();
    const mail = await g.deposer({ fichier: fichier('m', 'relance.eml'), meta: { titre: 'Relance', date_document: '2024-01-10' } });
    const piece = await g.deposer({ fichier: fichier('p', 'p.txt'), meta: { titre: 'Pièce', parent_id: mail.id, date_document: '2024-01-10' } });
    const contrat = await g.deposer({ fichier: fichier('c', 'contrat.txt'), meta: { titre: 'Contrat', categorie: 'contrat', date_document: '2020-01-01', coffre: true } });
    const recent = await g.deposer({ fichier: fichier('r', 'r.txt'), meta: { titre: 'Récent', categorie: 'courrier', date_document: '2026-10-01' } });
    expect((await g.document(recent.id)).retention).toMatchObject({ regle: 5, archiver_le: '2028-10-01', statut: 'ACTIF' });
    expect((await g.echeances()).map((e) => [e.document.id, e.echeances.statut])).toEqual([[mail.id, 'A_ARCHIVER'], [contrat.id, 'A_ARCHIVER']]);
    expect(await g.appliquerRetention()).toEqual({ documents: 2, archives: 3, ids: [mail.id, contrat.id] });
    expect((await g.lister()).map((d) => d.id)).toEqual([recent.id]);
    expect((await g.lister({ archives: true })).map((d) => d.id).sort()).toEqual([mail.id, piece.id, contrat.id].sort());
    const archive = await g.document(mail.id);
    expect([archive.archive, archive.pieces.map((p) => p.id)]).toEqual([true, [piece.id]]);
    expect(await (await g.contenu(archive.versions[0].id)).text()).toBe('m');
    expect(g.contenus.size).toBe(4);
    await g.desarchiver(mail.id);
    await g.desarchiver(contrat.id);
    expect((await g.lister()).length).toBe(4);
    expect((await g.archiver(piece.id).catch((e) => e)).code).toBe('ARCHIVE_PIECE');
  });
});
