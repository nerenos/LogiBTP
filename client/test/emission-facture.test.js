import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { texte, texteHtml, existe } from '@logibtp/socle/dictionnaire';
import { REGLE_COMPLETUDE, NIVEAU_COMPLETUDE, NIVEAU_CONTROLE, SYNTAXE, STATUT_CDV } from '@logibtp/facture-electronique';
import { compilerSchematrons } from '../../modules/facture-electronique/js/outils/schematrons.js';
import { validerFacture } from '../../modules/facture-electronique/js/outils/valider.js';
import { ECART_EMISSION_FE, MOTIF_EMISSION_FE, PASTILLE_EMISSION_FE, PASTILLES_EMISSION_FE_LISTE, TRANSMISSION_AVOIR_INTERNE_FE, TYPE_DOCUMENT } from '../src/app/codes.js';
import { bandeauCompletudeFeHtml, libelleEcartFe, completudeFeVisible } from '../src/app/documents/completude-fe.js';
import { annulationFeHtml, demanderAnnulationFe, envoiFeHtml, envoiFeVisible, libellePastilleFe, teintePastilleFe } from '../src/app/documents/envoi-fe.js';
import { VUES_LISTE } from '../src/app/vues-liste.js';

// Facturation électronique, lot 22 : pièces de vente de démonstration écrites par EmissionFactureTests.cs
// (tests/emission-fe/ecrits/, jeu 02_pieces.json) contrôlées par l'outil du module : XSD, schematron du profil et BR-FR-Flux2,
// en CII seul, en UBL et en XML Factur-X (CII sur le XSD et le schematron Factur-X EN16931).
const DOSSIER = fileURLToPath(new URL('../../tests/emission-fe/ecrits/', import.meta.url));
const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.xml')).sort();
const jeu = JSON.parse(readFileSync(new URL('../../tests/emission-fe/02_pieces.json', import.meta.url), 'utf8'));
const LONG = 60_000;
const fatals = (r) => r.controles.filter((c) => c.niveau === NIVEAU_CONTROLE.FATAL);

beforeAll(async () => { await compilerSchematrons(); }, 600_000);

describe('pièces de démonstration émises : aucune erreur fatale', () => {
  it('chaque pièce écrite a son CII et son UBL', () => {
    const ecrites = jeu.pieces.filter((p) => !p.attendu_emission).map((p) => p.nom);
    expect(fichiers).toEqual(ecrites.flatMap((n) => [`${n}_CII.xml`, `${n}_UBL.xml`]).sort());
    expect(ecrites).toEqual(expect.arrayContaining(['FACTURE', 'AVOIR', 'ACOMPTE', 'DEFINITIVE', 'AVOIR_ACOMPTE']));
  });
  for (const f of fichiers) {
    it(f, async () => {
      const r = await validerFacture(`${DOSSIER}${f}`);
      expect(fatals(r)).toEqual([]);
      expect(r.valide).toBe(true);
      expect(r.syntaxe).toBe(f.endsWith('_UBL.xml') ? SYNTAXE.UBL : SYNTAXE.CII);
    }, LONG);
    if (f.endsWith('_CII.xml')) {
      it(`${f} en Factur-X`, async () => {
        const r = await validerFacture(`${DOSSIER}${f}`, { facturX: true });
        expect(fatals(r)).toEqual([]);
        expect(r.syntaxe).toBe(SYNTAXE.FACTUR_X);
      }, LONG);
    }
  }
});

describe('bandeau de complétude de la pièce', () => {
  it('libellé de chaque règle de complétude et de chaque écart de l\'émission', () => {
    for (const r of Object.values(REGLE_COMPLETUDE)) expect(existe(`facture_electronique.completude.regles.${r}`), r).toBe(true);
    for (const n of Object.values(NIVEAU_COMPLETUDE)) expect(existe(`facture_electronique.completude.niveaux.${n}`), n).toBe(true);
    for (const c of Object.values(ECART_EMISSION_FE)) expect(existe(`document_btp.page.completude_fe.ecarts.${c}`), c).toBe(true);
    expect(libelleEcartFe({ regle: REGLE_COMPLETUDE.BR_FR_12 })).toBe(texte(`facture_electronique.completude.regles.${REGLE_COMPLETUDE.BR_FR_12}`));
    expect(libelleEcartFe({ regle: ECART_EMISSION_FE.IBAN_ABSENT }, true)).toBe(texte(`document_btp.page.completude_fe.ecarts.${ECART_EMISSION_FE.IBAN_ABSENT}`));
  });

  it('écarts bloquants, avertissements, pièce complète, type non émis', () => {
    const controle = {
      applicable: true, type_facture: '380', cadre: 'S1', bloquant: true,
      completude: [{ regle: REGLE_COMPLETUDE.BR_FR_12, niveau: NIVEAU_COMPLETUDE.BLOQUANT, donnee: 'BT-49', ligne: null },
        { regle: REGLE_COMPLETUDE.BR_FR_15, niveau: NIVEAU_COMPLETUDE.BLOQUANT, donnee: 'BT-151', ligne: '2' }],
      emission: [{ regle: ECART_EMISSION_FE.NUMERO_PROVISOIRE, niveau: NIVEAU_COMPLETUDE.AVERTISSEMENT, donnee: 'BT-1', ligne: null }],
    };
    const html = bandeauCompletudeFeHtml(controle);
    expect(html).toContain('probleme');
    expect((html.match(/data-ecart-fe=/g) ?? []).length).toBe(3);
    expect(html).toContain('BT-151');
    expect(html).toContain(texte('document_btp.page.completude_fe.bloquants', { nombre: 2 }));
    const complet = bandeauCompletudeFeHtml({ ...controle, completude: [], emission: [] });
    expect(complet).not.toContain('probleme');
    expect(complet).toContain(texteHtml('document_btp.page.completude_fe.complete'));
    expect(bandeauCompletudeFeHtml({ applicable: false })).toBe('');
    expect(bandeauCompletudeFeHtml(null)).toBe('');
  });

  it('visible : module actif, droit, pièce enregistrée d\'un type émis', () => {
    const types = { V_FACTURE: '380' };
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: true, entId: 4, code: 'V_FACTURE', types })).toBe(true);
    expect(completudeFeVisible({ moduleActif: false, peutConsulter: true, entId: 4, code: 'V_FACTURE', types })).toBe(false);
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: false, entId: 4, code: 'V_FACTURE', types })).toBe(false);
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: true, entId: -4, code: 'V_FACTURE', types })).toBe(false);
    expect(completudeFeVisible({ moduleActif: true, peutConsulter: true, entId: 4, code: 'V_DEVIS', types })).toBe(false);
  });
});

// Lot 24 : Factur-X (PDF/A-3 du moteur d'édition + CII associé) écrits par EnvoiFactureBtpTests.cs : facture de démonstration
// (FACTURE_FX.pdf, sans base) et facture validée sur la base jetable puis émise (VALIDEE_FX.pdf), contrôlés par l'outil du lot 4.
describe('Factur-X émis : aucune erreur fatale', () => {
  const pdfs = readdirSync(DOSSIER).filter((f) => f.endsWith('_FX.pdf')).sort();
  it('Factur-X de la facture de démonstration présent', () => expect(pdfs).toContain('FACTURE_FX.pdf'));
  for (const f of pdfs) {
    it(f, async () => {
      const r = await validerFacture(`${DOSSIER}${f}`);
      expect(fatals(r)).toEqual([]);
      expect(r.valide).toBe(true);
      expect(r.syntaxe).toBe(SYNTAXE.FACTUR_X);
    }, LONG);
  }
});

describe('émission de la pièce validée (pastille, bouton Émettre, colonne des listes)', () => {
  it('libellé et teinte de chaque pastille, libellé de chaque motif', () => {
    for (const p of Object.values(PASTILLE_EMISSION_FE)) {
      expect(existe(`document_btp.page.envoi_fe.pastilles.${p}`), p).toBe(true);
      expect(PASTILLES_EMISSION_FE_LISTE.some((o) => o.valeur === p), p).toBe(true);
    }
    for (const m of Object.values(MOTIF_EMISSION_FE)) expect(existe(`document_btp.page.envoi_fe.motifs.${m}`), m).toBe(true);
    for (const o of PASTILLES_EMISSION_FE_LISTE.filter((x) => !Object.values(PASTILLE_EMISSION_FE).includes(x.valeur))) {
      expect(Object.values(STATUT_CDV)).toContain(o.valeur);
      expect(existe(`facture_electronique.statuts.${o.valeur}`), o.valeur).toBe(true);
    }
    expect(libellePastilleFe(STATUT_CDV.MISE_A_DISPOSITION)).toBe(texte(`facture_electronique.statuts.${STATUT_CDV.MISE_A_DISPOSITION}`));
    expect(libellePastilleFe(PASTILLE_EMISSION_FE.EN_FILE)).toBe(texte(`document_btp.page.envoi_fe.pastilles.${PASTILLE_EMISSION_FE.EN_FILE}`));
    expect(teintePastilleFe(STATUT_CDV.REJETEE)).toBe('erreur');
    expect(teintePastilleFe('INCONNU')).toBe('neutre');
  });

  it('zone : pastille, motif, erreur, bouton selon le droit', () => {
    const etat = { applicable: true, etat: 'EMISE', pastille: STATUT_CDV.DEPOSEE, syntaxe: SYNTAXE.FACTUR_X, emettable: false };
    const html = envoiFeHtml(etat, { peutModifier: true });
    expect(html).toContain(`data-pastille-fe="${STATUT_CDV.DEPOSEE}"`);
    expect(html).not.toContain('data-action-fe');
    const echec = envoiFeHtml({ applicable: true, etat: 'ECHEC', pastille: PASTILLE_EMISSION_FE.ERREUR, motif: MOTIF_EMISSION_FE.INCOMPLETE, erreur: 'BR-FR-12 (BT-49)', emettable: true }, { peutModifier: true });
    expect(echec).toContain('data-action-fe="emettre"');
    expect(echec).toContain('BR-FR-12');
    expect(echec).toContain(texteHtml(`document_btp.page.envoi_fe.motifs.${MOTIF_EMISSION_FE.INCOMPLETE}`));
    expect(envoiFeHtml({ applicable: true, emettable: true }, { peutModifier: false })).not.toContain('data-action-fe');
    expect(envoiFeHtml({ applicable: true, emettable: true }, { peutModifier: true })).toContain(texteHtml('document_btp.page.envoi_fe.non_emise'));
    expect(envoiFeHtml({ applicable: false })).toBe('');
  });

  it('visible : module actif, droit, pièce validée d\'un type émis', () => {
    const types = { [TYPE_DOCUMENT.V_FACTURE]: '380' };
    const document = { ent_id: 4, ent_verrouille: true };
    expect(envoiFeVisible({ moduleActif: true, peutConsulter: true, document, code: TYPE_DOCUMENT.V_FACTURE, types })).toBe(true);
    expect(envoiFeVisible({ moduleActif: true, peutConsulter: true, document: { ...document, ent_verrouille: false }, code: TYPE_DOCUMENT.V_FACTURE, types })).toBe(false);
    expect(envoiFeVisible({ moduleActif: false, peutConsulter: true, document, code: TYPE_DOCUMENT.V_FACTURE, types })).toBe(false);
  });

  it('colonne « Facture électronique » des listes de factures seulement', () => {
    const factures = VUES_LISTE.find((v) => v.definition.theme === 'factures');
    expect(factures.definition.colonnes.map((c) => c.code)).toContain('statut_fe');
    const devis = VUES_LISTE.find((v) => v.definition.theme === 'devis');
    expect(devis.definition.colonnes.map((c) => c.code)).not.toContain('statut_fe');
  });
});

// Lot 25 : avoir interne d'une facture rejetée (213) ou refusée (210), proposé par le serveur (annulation de l'état),
// confirmé par la fenêtre du socle (dépôt pour archivage seul ou non).
describe('avoir interne d\'une facture rejetée ou refusée', () => {
  it('libellés des transmissions et des statuts de rejet ou de refus', () => {
    for (const t of Object.values(TRANSMISSION_AVOIR_INTERNE_FE)) expect(existe(`document_btp.page.envoi_fe.annulation.transmissions.${t}`), t).toBe(true);
    for (const s of [STATUT_CDV.REJETEE, STATUT_CDV.REFUSEE]) expect(existe(`document_btp.page.envoi_fe.annulation.statuts.${s}`), s).toBe(true);
  });

  it('proposition : bouton selon le droit, rien sans proposition', () => {
    const a = { proposee: true, statut: STATUT_CDV.REJETEE };
    const html = annulationFeHtml(a, { peutModifier: true });
    expect(html).toContain('data-action-fe="annuler"');
    expect(html).toContain(texteHtml('document_btp.page.envoi_fe.annulation.statuts.213'));
    expect(annulationFeHtml(a, { peutModifier: false })).not.toContain('data-action-fe');
    expect(annulationFeHtml(null)).toBe('');
    expect(annulationFeHtml({ proposee: false, statut: STATUT_CDV.DEPOSEE })).toBe('');
    const zone = envoiFeHtml({ applicable: true, etat: 'EMISE', pastille: STATUT_CDV.REFUSEE, statut: STATUT_CDV.REFUSEE, emettable: false, annulation: { proposee: true, statut: STATUT_CDV.REFUSEE } }, { peutModifier: true });
    expect(zone).toContain('data-annulation-fe="proposee"');
  });

  it('facture annulée : avoir et nouvelle facture ; avoir : facture annulée', () => {
    const faite = annulationFeHtml({ proposee: false, statut: STATUT_CDV.REFUSEE, transmission: TRANSMISSION_AVOIR_INTERNE_FE.ARCHIVAGE_SEUL, avoir_id: 8, avoir_numero: 'AV-1', copie_id: 9 });
    expect(faite).toContain('data-ouvrir-fe="8"');
    expect(faite).toContain('data-ouvrir-fe="9"');
    expect(faite).toContain('AV-1');
    expect(faite).toContain(texteHtml('document_btp.page.envoi_fe.annulation.transmissions.ARCHIVAGE_SEUL'));
    const avoir = annulationFeHtml({ est_avoir: true, statut: STATUT_CDV.REJETEE, transmission: TRANSMISSION_AVOIR_INTERNE_FE.AUCUNE, facture_id: 7, avoir_id: 8 });
    expect(avoir).toContain('data-annulation-fe="avoir"');
    expect(avoir).toContain('data-ouvrir-fe="7"');
  });

  it('fenêtre de confirmation : case cochée → archivage seul, décochée → non déposé, renoncement → null', async () => {
    let options;
    const dialogue = (o) => { options = o; return Promise.resolve(null); };
    expect(await demanderAnnulationFe(dialogue, STATUT_CDV.REJETEE)).toBeNull();
    expect(options.html).toContain('data-archivage-fe checked');
    const ok = options.boutons.find((b) => b.principal);
    const fenetre = (coche) => ({ querySelector: () => ({ checked: coche }) });
    expect(ok.valeur(fenetre(true))).toBe(TRANSMISSION_AVOIR_INTERNE_FE.ARCHIVAGE_SEUL);
    expect(ok.valeur(fenetre(false))).toBe(TRANSMISSION_AVOIR_INTERNE_FE.AUCUNE);
    expect(options.boutons.find((b) => !b.principal).valeur).toBeNull();
  });
});
