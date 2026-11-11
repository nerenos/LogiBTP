// Catalogue des contrôles FNFE (XSD et schematrons XSLT 2.0 du paquet 1.4.0.04, artefacts/) et compilation des
// schematrons en SEF pour SaxonJS (outil de développement et de test : pas de validation XSLT 2.0 dans le serveur, Q6).
//
// Les SEF (5 Mo environ chacun) ne sont pas versionnés : ils sont produits par `npm run compiler-schematrons` dans
// js/.sef/ (ignoré par git), et recompilés d'eux-mêmes quand le XSLT source change (empreinte SHA-256 + chemin).
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ICI = dirname(fileURLToPath(import.meta.url));
/** Racine du module (modules/facture-electronique). */
export const RACINE_MODULE = resolve(ICI, '..', '..');
export const DOSSIER_SCHEMATRONS = join(RACINE_MODULE, 'artefacts', 'schematrons');
export const DOSSIER_XSD = join(RACINE_MODULE, 'artefacts', 'xsd');
export const DOSSIER_SEF = join(RACINE_MODULE, 'js', '.sef');
const FICHIER_EMPREINTES = join(DOSSIER_SEF, 'empreintes.json');

/** Schematrons compilés (XSLT 2.0), chemins relatifs à artefacts/schematrons. */
export const SCHEMATRONS = Object.freeze({
  EN16931_CII: 'en16931/EN16931-CII-validation.xslt',
  EN16931_UBL: 'en16931/EN16931-UBL-validation.xslt',
  EXTENDED_CTC_FR_CII: 'extended-ctc-fr/EXTENDED-CTC-FR-CII.xslt',
  EXTENDED_CTC_FR_UBL: 'extended-ctc-fr/EXTENDED-CTC-FR-UBL.xslt',
  FACTUR_X_BASIC_WL: 'factur-x/basicwl/FACTUR-X_BASIC-WL.xslt',
  FACTUR_X_EN16931: 'factur-x/en16931/FACTUR-X_EN16931.xslt',
  FACTUR_X_EXTENDED: 'factur-x/extended/FACTUR-X_EXTENDED.xslt',
  BR_FR_CII: 'br-fr-flux2/BR-FR-Flux2-Schematron-CII.xslt',
  BR_FR_CII_WARNING: 'br-fr-flux2/BR-FR-Flux2-Schematron-CII_WARNING.xslt',
  BR_FR_UBL: 'br-fr-flux2/BR-FR-Flux2-Schematron-UBL.xslt',
  BR_FR_UBL_WARNING: 'br-fr-flux2/BR-FR-Flux2-Schematron-UBL_WARNING.xslt',
  BR_FR_CDV: 'cdar/BR-FR-CDV-Schematron-CDAR.xslt',
  BR_FR_CDV_WARNING: 'cdar/BR-FR-CDV-Schematron-CDAR_WARNING.xslt',
  FLUX10: 'flux10/Flux10.xslt', // e-reporting (annexe 7 v1.8)
});

/** Jeux XSD (mêmes que `JeuXsd` de ValidationXsd.cs) : dossier sous artefacts/xsd et schéma principal. */
export const JEUX_XSD = Object.freeze({
  CII_D22B: Object.freeze({ dossier: 'cii-d22b', principal: 'CrossIndustryInvoice_100pD22B.xsd' }),
  FACTUR_X_BASIC_WL: Object.freeze({ dossier: 'factur-x/basicwl', principal: 'Factur-X_BASICWL.xsd' }),
  FACTUR_X_EN16931: Object.freeze({ dossier: 'factur-x/en16931', principal: 'Factur-X_EN16931.xsd' }),
  FACTUR_X_EXTENDED: Object.freeze({ dossier: 'factur-x/extended', principal: 'Factur-X_EXTENDED.xsd' }),
  UBL_INVOICE: Object.freeze({ dossier: 'ubl-2.1', principal: 'maindoc/UBL-Invoice-2.1.xsd' }),
  UBL_CREDIT_NOTE: Object.freeze({ dossier: 'ubl-2.1', principal: 'maindoc/UBL-CreditNote-2.1.xsd' }),
  CDAR_D22B: Object.freeze({ dossier: 'cdar-d22b', principal: 'CrossDomainAcknowledgementAndResponse_100pD22B.xsd' }),
  FLUX10: Object.freeze({ dossier: 'flux10', principal: 'ereporting.xsd' }),
});

/** Chemin du SEF d'un schematron (chemin relatif du catalogue). */
export const cheminSef = (schematron) => join(DOSSIER_SEF, schematron.replace(/\.xslt$/, '.sef.json'));

const empreinte = (fichier) => createHash('sha256').update(fichier).update(readFileSync(fichier)).digest('hex');

function lireEmpreintes() {
  try { return JSON.parse(readFileSync(FICHIER_EMPREINTES, 'utf8')); } catch { return {}; }
}

/** Vrai si le SEF existe et a été compilé depuis le XSLT actuel (même contenu, même emplacement). */
export function sefAJour(schematron, empreintes = lireEmpreintes()) {
  const source = join(DOSSIER_SCHEMATRONS, schematron);
  return existsSync(cheminSef(schematron)) && empreintes[schematron] === empreinte(source);
}

const executer = promisify(execFile);
const XSLT3 = createRequire(import.meta.url).resolve('xslt3/xslt3.js');

/**
 * Compile en SEF les schematrons demandés (tous par défaut) qui ne sont pas à jour, en parallèle.
 * Pas de `-relocate` : le SEF garde l'URI du XSLT source, d'où sont résolus les `document('…_codedb.xml')` de Factur-X.
 * @returns {Promise<string[]>} schematrons compilés
 */
export async function compilerSchematrons({ schematrons = Object.values(SCHEMATRONS), forcer = false, journal } = {}) {
  const empreintes = lireEmpreintes();
  const aFaire = schematrons.filter((s) => forcer || !sefAJour(s, empreintes));
  const file = [...aFaire];
  const ouvrier = async () => {
    for (let s = file.shift(); s; s = file.shift()) {
      const source = join(DOSSIER_SCHEMATRONS, s);
      const sef = cheminSef(s);
      mkdirSync(dirname(sef), { recursive: true });
      const debut = Date.now();
      await executer(process.execPath, [XSLT3, `-xsl:${source}`, `-export:${sef}`, '-nogo'], { maxBuffer: 1 << 24 });
      empreintes[s] = empreinte(source);
      journal?.(`${s} → ${relative(RACINE_MODULE, sef)} (${Date.now() - debut} ms)`);
    }
  };
  const ouvriers = Math.max(1, Math.min(availableParallelism(), 4, aFaire.length));
  await Promise.all(Array.from({ length: ouvriers }, ouvrier));
  if (aFaire.length) {
    mkdirSync(DOSSIER_SEF, { recursive: true });
    writeFileSync(FICHIER_EMPREINTES, JSON.stringify(lireEmpreintesFusion(empreintes), null, 2));
  }
  return aFaire;
}

// Relit le fichier avant d'écrire (deux compilations concurrentes, par exemple deux fichiers de test).
function lireEmpreintesFusion(empreintes) {
  return { ...lireEmpreintes(), ...empreintes };
}

// Ligne de commande : npm run compiler-schematrons [-- --forcer]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const forcer = process.argv.includes('--forcer');
  const debut = Date.now();
  const faits = await compilerSchematrons({ forcer, journal: (l) => console.log(l) });
  console.log(faits.length
    ? `${faits.length} schematron(s) compilé(s) en ${Math.round((Date.now() - debut) / 1000)} s dans ${relative(process.cwd(), DOSSIER_SEF)}`
    : 'Schematrons déjà compilés et à jour.');
}
