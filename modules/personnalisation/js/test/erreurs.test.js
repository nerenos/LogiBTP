import { describe, it, expect } from 'vitest';
import { catalogueErreurs, sitesCs, sitesJs } from '../src/index.js';

const cs = (chemin, source) => ({ chemin, source });

describe('catalogue des erreurs par code (lot P2)', () => {
  it('lieux C# : code littéral ou constante, message littéral ou composé', () => {
    const s = sitesCs(`
      throw ExceptionMetier.Invalide("A_UN", "Message un");
      throw ExceptionMetier.Conflit(Codes.Pris, $"Code {x} pris", new { x });
      throw new ExceptionMetier(StatusCodes.Status403Forbidden, "COMPTE_INACTIF",
          "Compte désactivé");
      throw new ErreurListe("REQUETE", "Requête " + n);
      throw ExceptionMetier.Invalide(codes[0], string.Join(" · ", codes));`);
    expect(s.map((x) => [x.code, x.constante, x.message])).toEqual([
      ['A_UN', null, 'Message un'],
      [null, 'Pris', null],
      ['COMPTE_INACTIF', null, 'Compte désactivé'],
      ['REQUETE', null, null],
      [null, null, null],
    ]);
  });

  it('lieux JS des moteurs : erreur, avertir, ErreurCalcul', () => {
    const s = sitesJs(`
      this.erreur(l.lig_id, 'ARBRE', 'Ligne hors arborescence');
      this.avertir(null, 'VARIABLE_TEXTE', \`Texte : \${i.message}\`);
      this.erreur(ligId, e.code, e.message);
      throw new ErreurCalcul('VIDE', "Formule l\\'vide");`);
    expect(s.map((x) => [x.code, x.message])).toEqual([
      ['ARBRE', 'Ligne hors arborescence'], ['VARIABLE_TEXTE', null], [null, null], ['VIDE', "Formule l'vide"],
    ]);
  });

  it('retient un code au même message littéral partout, écarte les autres', () => {
    const { retenus, ecartes } = catalogueErreurs({
      cs: [
        cs('modules/a/A.cs', `
          public static class Codes { public const string Pris = "CODE_PRIS"; }
          throw ExceptionMetier.Invalide("SUR", "Message sûr");
          throw ExceptionMetier.Conflit(Codes.Pris, "Code déjà pris");
          throw ExceptionMetier.Invalide("DEUX", "Premier");
          throw ExceptionMetier.Invalide("COMPOSE", "Fixe");
          throw ExceptionMetier.Invalide(ok ? "TERNAIRE" : "AUTRE", "Choix");
          throw ExceptionMetier.Invalide("TERNAIRE", "Seul");
          throw ExceptionMetier.Invalide("REGLE", "Règle");`),
        cs('src/B.cs', `
          throw ExceptionMetier.Invalide("SUR", "Message sûr");
          throw ExceptionMetier.Invalide("DEUX", "Second");
          throw ExceptionMetier.Invalide("COMPOSE", $"Variable {x}");
          var messages = new Dictionary<string, string> { ["REGLE"] = "Règle du module" };
          Erreur(l.Id, "MOTEUR", "Ligne du moteur C#");`),
      ],
      js: [cs('modules/d/js/src/moteur.js', "this.erreur(l.lig_id, 'MOTEUR', 'Ligne du moteur');")],
    });
    expect(Object.fromEntries([...retenus].map(([c, r]) => [c, [r.message, r.chemins]]))).toEqual({
      CODE_PRIS: ['Code déjà pris', ['modules/a/A.cs']],
      MOTEUR: ['Ligne du moteur', ['modules/d/js/src/moteur.js']],
      SUR: ['Message sûr', ['modules/a/A.cs', 'src/B.cs']],
    });
    expect(Object.fromEntries(ecartes)).toEqual({
      AUTRE: undefined, // jamais levé seul : ni retenu ni écarté
      COMPOSE: 'message composé',
      DEUX: 'plusieurs messages',
      REGLE: 'code employé ailleurs',
      TERNAIRE: 'code employé ailleurs',
    });
  });
});
