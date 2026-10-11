import { describe, it, expect } from 'vitest';
import { sousDomaine } from '../src/app/societe.js';

describe('société (hors ligne : déduite de l\'adresse)', () => {
  it('sous-domaine ou base principale', () => {
    expect(sousDomaine('localhost')).toBeNull();
    expect(sousDomaine('demo.localhost')).toBe('demo');
    expect(sousDomaine('acme.logibtp.fr')).toBe('acme');
    expect(sousDomaine('logibtp.fr')).toBeNull();
    expect(sousDomaine('www.logibtp.fr')).toBeNull();
    expect(sousDomaine('192.168.1.10')).toBeNull();
  });
});
