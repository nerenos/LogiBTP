// Résultats JS des jeux de cas (arbre de pages et empreinte du PDF), comparés par les tests C# (moteur dans Jint) :
// modules/edition/tests/resultats-js/<nom>.json. Aperçus HTML et PDF des essais dans modules/edition/js/.essais/.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { editer, produirePdf } from '../src/index.js';
import { polices } from '../test/aide.js';
import { lireCasEdition, DOSSIER_TESTS } from './cas.mjs';
import { ecrireApercu } from '../test/apercu.mjs';

const sortie = DOSSIER_TESTS + 'resultats-js/';
const essais = fileURLToPath(new URL('../.essais/', import.meta.url));
mkdirSync(sortie, { recursive: true });
mkdirSync(essais, { recursive: true });
const p = await polices();
for (const cas of lireCasEdition()) {
  const t0 = Date.now();
  const r = editer(cas.modele, cas.donnees, { ...cas.env, polices: p });
  const t1 = Date.now();
  const pdf = await produirePdf(r, p, cas.env.pdf ?? {});
  const t2 = Date.now();
  const sha = createHash('sha256').update(pdf).digest('hex');
  const brut = await produirePdf(r, p, { ...(cas.env.pdf ?? {}), compresser: false });
  const shaBrut = createHash('sha256').update(brut).digest('hex');
  writeFileSync(sortie + `${cas.nom}.json`, JSON.stringify({ nom: cas.nom, donnees: cas.generer ? cas.donnees : undefined, resultat: r, pdf_sha256: sha, pdf_brut_sha256: shaBrut, pdf_octets: pdf.length }));
  writeFileSync(essais + `${cas.nom}.pdf`, pdf);
  ecrireApercu(r, essais + `${cas.nom}.html`);
  for (const pg of r.pages.slice(0, 3).concat(r.pages.slice(-1))) ecrireApercu(r, essais + `${cas.nom}-p${pg.numero}.html`, {}, pg.numero);
  console.log(`${cas.nom} : ${r.pages.length} pages, ${r.alertes.length} alertes, mise en page ${t1 - t0} ms, PDF ${t2 - t1} ms (${pdf.length} octets)`);
  for (const a of r.alertes) console.log('  ', a.code, a.message);
}
