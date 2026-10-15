import { lireFichierOptim } from '@logibtp/import';

// Formats d'import connus : lecture du fichier (module Import) et type de document créé. Commun à toutes les méthodes
// d'import : le fichier source est conservé dans la GED du document créé et son origine enregistrée (traçabilité).
export const FORMATS_IMPORT = {
  OptimBTP: { libelle: 'OptimBTP', extensions: '.optim,.zip,.xml', type: 'V_DEVIS', lire: (octets) => lireFichierOptim(octets), page: '/import/optimbtp' },
};

export function formatImport(code) {
  const f = FORMATS_IMPORT[code];
  if (!f) throw new Error(`Format d'import inconnu : ${code}`);
  return f;
}
