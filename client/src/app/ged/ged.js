import { FournisseurGedApi } from '@logibtp/ged';
import { ENTETES } from '../api.js';

// GED du cœur : fournisseur (API).

export const creerFournisseurGed = () => new FournisseurGedApi({ base: '/api/ged', entetes: ENTETES });
