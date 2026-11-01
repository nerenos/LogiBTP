import { texte } from '@logibtp/socle/dictionnaire';
import { TYPE_DOCUMENT } from '../codes.js';
import { lireFichierOptim } from '@logibtp/import';

// Formats d'import connus : lecture du fichier (module Import) et type de document créé. Commun à toutes les méthodes
// d'import : le fichier source est conservé dans la GED du document créé et son origine enregistrée (traçabilité).
export const FORMATS_IMPORT = {
  OptimBTP: { libelle: 'OptimBTP', extensions: '.optim,.zip,.xml', type: TYPE_DOCUMENT.V_DEVIS, lire: (octets) => lireFichierOptim(octets), page: '/import/optimbtp' },
};

/** Format d'après son code ou son libellé (origine enregistrée : dor_format = libellé). */
export function formatImport(code) {
  const f = FORMATS_IMPORT[code] ?? Object.values(FORMATS_IMPORT).find((x) => x.libelle === code);
  if (!f) throw new Error(texte('import_btp.formats.inconnu', { code }));
  return f;
}
