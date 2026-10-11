import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, texteEntree, empreinteEntree, verifierChaine, editionsAPurger, FournisseurGedMemoire, lireMail, genreApercu } from '../src/index.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tests/cas');
const lire = (f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'));

describe('coffre-fort chaîné (jeu partagé avec le C#)', () => {
  const { entrees } = lire('01_coffre.json');
  it('empreintes de contenu, textes et empreintes des entrées', async () => {
    for (const e of entrees) {
      expect(await sha256(e.contenu)).toBe(e.empreinte_document);
      expect(texteEntree(e)).toBe(e.texte);
      expect(await empreinteEntree(e)).toBe(e.empreinte_entree);
    }
    expect((await verifierChaine(entrees)).ok).toBe(true);
  });
  it('altération détectée', async () => {
    const modifiees = structuredClone(entrees);
    modifiees[1].utilisateur = 'pirate';
    expect((await verifierChaine(modifiees)).rupture).toEqual({ index: 1, raison: 'Entrée modifiée' });
    const retiree = structuredClone(entrees).filter((_, i) => i !== 1);
    expect((await verifierChaine(retiree)).rupture).toEqual({ index: 1, raison: 'Chaînage rompu' });
  });
});

describe('conservation des versions (jeu partagé avec le C#)', () => {
  for (const c of lire('02_versions.json').cas) {
    it(c.nom, () => expect(editionsAPurger(c.versions, c.conservees, { coffre: !!c.coffre })).toEqual(c.attendu));
  }
});

describe('fournisseur mémoire', () => {
  const fichier = (contenu, nom, type = 'text/plain') => new File([contenu], nom, { type });
  const creer = (profil = 'ADMIN') => new FournisseurGedMemoire({ profil, parametres: { editions_conservees: 2 }, horloge: () => Date.UTC(2026, 9, 11, 10) });

  it('dépôt, éditions limitées, étapes conservées, contenus partagés par empreinte', async () => {
    const g = creer();
    const d = await g.deposer({ fichier: fichier('v1', 'plan.txt'), meta: { titre: 'Plan', type_element: 'materiel', id_element: 3 } });
    await g.nouvelleVersion(d.id, { fichier: fichier('v2', 'plan.txt') });
    await g.etape(d.id, { etape: 'VALIDATION' });
    await g.nouvelleVersion(d.id, { fichier: fichier('v3', 'plan.txt') });
    const r = await g.document(d.id);
    expect(r.versions.map((v) => `${v.numero}:${v.genre}`)).toEqual(['2:edition', '3:etape', '4:edition']);
    expect(r.etat).toBe('VALIDATION');
    expect(g.contenus.size).toBe(2); // v1 purgée (contenu orphelin retiré) ; l'étape partage le contenu de v2
    expect(await (await g.contenu(r.versions.at(-1).id)).text()).toBe('v3');
    expect((await g.lister({ type_element: 'materiel', id_element: '3' })).length).toBe(1);
    expect((await g.lister({ recherche: 'PLAN' })).length).toBe(1);
  });

  it('coffre-fort : verrouillé, chaîné, vérifiable, ni modification ni purge', async () => {
    const g = creer();
    const a = await g.deposer({ fichier: fichier('%PDF devis', 'devis.pdf', 'application/pdf'), meta: { titre: 'Devis signé', categorie: 'devis_signe', coffre: true } });
    const b = await g.deposer({ fichier: fichier('%PDF facture', 'facture.pdf', 'application/pdf'), meta: { titre: 'Facture', coffre: true } });
    expect([a.coffre, b.journal_coffre[0].empreinte_precedente]).toEqual([true, a.journal_coffre[0].empreinte_entree]);
    expect((await g.verifier(a.id)).integre).toBe(true);
    expect((await g.verifierCoffre()).ok).toBe(true);
    expect((await g.nouvelleVersion(a.id, { fichier: fichier('x', 'x.pdf') }).catch((e) => e)).code).toBe('COFFRE');
    expect((await g.modifier(a.id, { titre: 'Autre' }).catch((e) => e)).code).toBe('COFFRE');
    expect((await g.modifier(a.id, { notes: 'Reçu par courrier' })).notes).toBe('Reçu par courrier');
    // Suppression : masquage réservé à l'administrateur, purge définitive impossible.
    expect((await creer('SAISIE').supprimer(a.id).catch((e) => e)).code).toBe('INTROUVABLE');
    const saisie = creer('SAISIE');
    Object.assign(saisie, { documents: g.documents, versions: g.versions, contenus: g.contenus, journal: g.journal });
    expect((await saisie.supprimer(a.id).catch((e) => e)).code).toBe('ACCES_REFUSE');
    await g.supprimer(a.id);
    expect((await g.purger(a.id).catch((e) => e)).code).toBe('COFFRE');
    // Altération du contenu stocké : détectée.
    g.contenus.set(a.version.id && g.versions.find((v) => v.document === a.id).empreinte, new Blob(['falsifié']));
    expect((await g.verifier(a.id)).integre).toBe(false);
  });

  it('suppression par masquage, restauration, purge par un administrateur', async () => {
    const g = creer();
    const d = await g.deposer({ fichier: fichier('x', 'note.txt'), meta: { titre: 'Note' } });
    expect((await g.purger(d.id).catch((e) => e)).code).toBe('NON_SUPPRIME');
    await g.supprimer(d.id);
    expect((await g.lister()).length).toBe(0);
    expect((await g.lister({ supprimes: true })).length).toBe(1);
    await g.restaurer(d.id);
    await g.supprimer(d.id);
    await g.purger(d.id);
    expect([g.documents.length, g.contenus.size]).toEqual([0, 0]);
  });
});

describe('mails et aperçus', () => {
  it('lecture d\'un .eml avec pièce jointe', async () => {
    const eml = [
      'From: =?UTF-8?Q?H=C3=A9l=C3=A8ne_Martin?= <h.martin@exemple.fr>', 'To: Bureau <bureau@logibtp.fr>', 'Cc: compta@logibtp.fr',
      'Subject: =?UTF-8?Q?Devis_sign=C3=A9?=', 'Date: Sun, 11 Oct 2026 09:30:00 +0200', 'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"', '', '--b1', 'Content-Type: text/plain; charset=utf-8', '',
      'Bonjour, voici le devis signé.', '--b1', 'Content-Type: application/pdf; name="devis.pdf"',
      'Content-Disposition: attachment; filename="devis.pdf"', 'Content-Transfer-Encoding: base64', '', btoa('%PDF-1.4 signe'), '--b1--', '',
    ].join('\r\n');
    const m = await lireMail(new File([eml], 'devis.eml'));
    expect([m.objet, m.de, m.a, m.cc, m.message, m.date]).toEqual(['Devis signé', 'Hélène Martin <h.martin@exemple.fr>', 'Bureau <bureau@logibtp.fr>',
      'compta@logibtp.fr', 'Bonjour, voici le devis signé.', '2026-10-11T07:30:00.000Z']);
    expect(m.pieces.map((p) => [p.nom, p.type, new TextDecoder().decode(p.contenu)])).toEqual([['devis.pdf', 'application/pdf', '%PDF-1.4 signe']]);
  });

  it('genres d\'aperçu', () => {
    expect(['photo.JPG', 'plan.pdf', 'note.txt', 'mail.msg', 'devis.docx', 'tableau.xlsx'].map((n) => genreApercu(n))).toEqual(['image', 'pdf', 'texte', 'mail', null, null]);
  });
});
