import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rtfEnHtml } from '../src/index.js';

// Jeu partagé avec Rtf.cs (RtfTests) : libellés RTF des bases MDE (plan reprise-mde-optim, lot 8).
const jeu = JSON.parse(readFileSync(new URL('./rtf-cas.json', import.meta.url), 'utf8'));

describe('reprise : RTF en HTML (jeu partagé)', () => {
  for (const c of jeu.cas) it(c.nom, () => expect(rtfEnHtml(c.brut ? c.rtf : jeu.entete + c.rtf)).toBe(c.html));
});
