using LogiBTP.Socle;

namespace LogiBTP.Metres.Script;

/// <summary>
/// Analyseur du langage de script des métrés (réplique de script/analyseur.js). Produit l'arbre du programme et
/// toutes les erreurs détectables sans exécution : syntaxe (avec reprise à l'instruction suivante), variables
/// inconnues ou déclarées deux fois, fonctions inconnues, nombre d'arguments, Sortir / Continuer hors boucle,
/// références invalides.
/// </summary>
public sealed class Analyseur
{
    private static readonly Dictionary<string, char> Types = new() { ["chaine"] = 'C', ["numerique"] = 'N', ["booleen"] = 'B', ["bool"] = 'B' };
    private static readonly HashSet<string> Comparaisons = ["=", "<>", "<", "<=", ">", ">="];
    private static readonly HashSet<string> Affectations = ["=", "+=", "-=", "*=", "/="];

    private sealed class ErreurSyntaxe(string code, string message, Jeton jeton) : Exception(message)
    {
        public string Code { get; } = code;
        public Jeton Jeton { get; } = jeton;
    }

    private readonly string _source;
    private readonly List<Jeton> _jetons;
    private readonly List<ErreurScript> _erreurs = [];
    private readonly IReadOnlyDictionary<string, FonctionScript> _catalogue;
    private readonly List<DeclarationScript> _declarations = [];
    private readonly Dictionary<string, DeclarationScript> _parNom = new(StringComparer.Ordinal);
    private readonly HashSet<string> _cibles = new(StringComparer.Ordinal);
    private int _i;
    private bool _enTete = true;
    private int _boucles;
    private int _profondeurBloc;

    private Analyseur(string source, IReadOnlyDictionary<string, FonctionScript>? fonctions)
    {
        _source = source;
        _jetons = Lexeur.Decouper(source, _erreurs);
        var catalogue = new Dictionary<string, FonctionScript>(Fonctions.Catalogue);
        foreach (var (nom, f) in fonctions ?? new Dictionary<string, FonctionScript>()) catalogue[nom] = f;
        _catalogue = catalogue;
    }

    /// <summary>Catalogue des fonctions : celles du langage complétées par celles de l'hôte.</summary>
    internal IReadOnlyDictionary<string, FonctionScript> Catalogue => _catalogue;

    /// <summary>Analyse un script : programme, déclarations dans l'ordre du texte, erreurs triées par position.</summary>
    public static AnalyseScript Analyser(string? texte, IReadOnlyDictionary<string, FonctionScript>? fonctions = null) =>
        new Analyseur(texte ?? "", fonctions).Executer();

    private AnalyseScript Executer()
    {
        var programme = new List<Noeud>();
        while (Courant.Genre != "fin")
        {
            if (Courant.Genre == "mc" && Courant.Normalise is "fin" or "sinon" or "sinonsi")
            {
                Signaler("SYNTAXE", $"« {Courant.Texte} » sans « Si » ou « Pour » correspondant", Courant);
                _i++;
                if (Courant.Genre == "nl") _i++;
                continue;
            }
            if (InstructionAvecReprise() is { } n) programme.Add(n);
        }
        foreach (var d in _declarations) d.Parametre = !d.Local && !d.Implicite && !_cibles.Contains(d.Nom);
        var erreurs = _erreurs.OrderBy(e => e.Ligne).ThenBy(e => e.Colonne).ToList();
        return new AnalyseScript(programme, _declarations, erreurs);
    }

    // ------------------------------------------------------------------ jetons

    private Jeton Courant => _jetons[_i];
    private Jeton Suivant() => _jetons[_i++];
    private bool EstOp(string v, Jeton? j = null) { j ??= Courant; return j.Genre == "op" && j.Texte == v; }
    private bool EstMc(string n, Jeton? j = null) { j ??= Courant; return j.Genre == "mc" && j.Normalise == n; }
    private ErreurSyntaxe Faute(string message, Jeton? j = null, string code = "SYNTAXE") => new(code, message, j ?? Courant);
    private void Signaler(string code, string message, Jeton j) => _erreurs.Add(new ErreurScript(code, message, j.Ligne, j.Colonne));

    private string Decrire(Jeton j) =>
        j.Genre == "fin" ? "fin du script" : j.Genre == "nl" ? "fin de ligne" : $"« {_source[j.Debut..j.Fin]} »";

    private Jeton AttendreOp(string v, string quoi)
    {
        if (!EstOp(v)) throw Faute($"{quoi} attendu, {Decrire(Courant)} trouvé");
        return Suivant();
    }

    private void FinInstruction()
    {
        var j = Courant;
        if (j.Genre == "nl") { _i++; return; }
        if (j.Genre == "fin") return;
        throw Faute($"Fin d'instruction attendue, {Decrire(j)} trouvé");
    }

    // ------------------------------------------------------------------ expressions

    private Noeud Expression() => Ou();

    private Noeud Ou()
    {
        var g = Et();
        while (EstMc("ou"))
        {
            var j = Suivant();
            g = new NoeudBinaire("ou", g, Et(), j.Ligne, j.Colonne);
        }
        return g;
    }

    private Noeud Et()
    {
        var g = Non();
        while (EstMc("et"))
        {
            var j = Suivant();
            g = new NoeudBinaire("et", g, Non(), j.Ligne, j.Colonne);
        }
        return g;
    }

    private Noeud Non()
    {
        if (EstMc("pas"))
        {
            var j = Suivant();
            return new NoeudUnaire("pas", Non(), j.Ligne, j.Colonne);
        }
        return Comparaison();
    }

    private Noeud Comparaison()
    {
        var g = Somme();
        var j = Courant;
        if (j.Genre == "op" && Comparaisons.Contains(j.Texte!))
        {
            _i++;
            var n = new NoeudBinaire(j.Texte!, g, Somme(), j.Ligne, j.Colonne);
            var k = Courant;
            if (k.Genre == "op" && Comparaisons.Contains(k.Texte!)) throw Faute("Comparaisons enchaînées : utiliser « et » / « ou »", k);
            return n;
        }
        return g;
    }

    private Noeud Somme()
    {
        var g = Produit();
        while (EstOp("+") || EstOp("-"))
        {
            var j = Suivant();
            g = new NoeudBinaire(j.Texte!, g, Produit(), j.Ligne, j.Colonne);
        }
        return g;
    }

    private Noeud Produit()
    {
        var g = Unaire();
        while (EstOp("*") || EstOp("/") || EstMc("modulo"))
        {
            var j = Suivant();
            g = new NoeudBinaire(j.Genre == "mc" ? "modulo" : j.Texte!, g, Unaire(), j.Ligne, j.Colonne);
        }
        return g;
    }

    private Noeud Unaire()
    {
        if (EstOp("+") || EstOp("-"))
        {
            var j = Suivant();
            return new NoeudUnaire(j.Texte!, Unaire(), j.Ligne, j.Colonne);
        }
        return Primaire();
    }

    private Noeud Reference(Jeton j)
    {
        Reference r;
        try
        {
            r = References.Analyser(j.Texte!);
        }
        catch (ErreurCalcul e)
        {
            throw Faute(e.Message, j, e.Code);
        }
        return r is ReferenceVariable v
            ? new NoeudPortee($"{v.Portee}{v.Nom}", v.Portee, v.Nom, j.Ligne, j.Colonne)
            : new NoeudDonnee(j.Texte!, j.Ligne, j.Colonne);
    }

    private NoeudVariable Variable(Jeton j)
    {
        if (!_parNom.ContainsKey(j.Texte!)) Signaler("VARIABLE_INCONNUE", $"Variable « {j.Texte} » non déclarée", j);
        return new NoeudVariable(j.Texte!, j.Ligne, j.Colonne);
    }

    private Noeud Primaire()
    {
        var j = Courant;
        if (j.Genre == "nb") { _i++; return new NoeudValeur(Valeur.N(j.Nombre), j.Ligne, j.Colonne); }
        if (j.Genre == "ch") { _i++; return new NoeudValeur(Valeur.C(j.Texte!), j.Ligne, j.Colonne); }
        if (EstMc("vrai") || EstMc("faux")) { _i++; return new NoeudValeur(Valeur.B(j.Normalise == "vrai"), j.Ligne, j.Colonne); }
        if (j.Genre == "ref") { _i++; return Reference(j); }
        if (EstOp("("))
        {
            _i++;
            var e = Expression();
            AttendreOp(")", "Parenthèse fermante « ) »");
            return e;
        }
        if (j.Genre == "id")
        {
            _i++;
            if (!EstOp("(")) return Variable(j);
            _i++;
            var args = new List<Noeud>();
            if (!EstOp(")"))
            {
                args.Add(Expression());
                while (EstOp(";")) { _i++; args.Add(Expression()); }
            }
            AttendreOp(")", "Parenthèse fermante « ) »");
            if (!_catalogue.TryGetValue(j.Normalise!, out var def)) Signaler("FONCTION_INCONNUE", $"Fonction « {j.Texte} » inconnue", j);
            else if (args.Count < def.Min || (def.Max is { } max && args.Count > max))
            {
                Signaler("ARGUMENTS", $"{def.Signature} : {args.Count} argument(s) fourni(s)", j);
            }
            return new NoeudAppel(j.Normalise!, j.Texte!, args, j.Ligne, j.Colonne);
        }
        throw Faute($"Expression attendue, {Decrire(j)} trouvé", j);
    }

    // ------------------------------------------------------------------ instructions

    private void Declarer(string nom, char type, bool local, bool implicite, Jeton j, PlageTexte? defaut = null, PlageTexte? declaration = null)
    {
        if (_parNom.ContainsKey(nom))
        {
            Signaler("DECLARATION_DOUBLE", $"Variable « {nom} » déjà déclarée", j);
            return;
        }
        var d = new DeclarationScript
        {
            Nom = nom, Type = type, Local = local, Implicite = implicite, Defaut = defaut, Declaration = declaration,
            Ligne = j.Ligne, Colonne = j.Colonne,
        };
        _declarations.Add(d);
        _parNom[nom] = d;
    }

    private Noeud Declaration()
    {
        var debut = Courant;
        var local = EstMc("local");
        if (local) _i++;
        var jn = Courant;
        if (jn.Genre != "id") throw Faute($"Nom de variable attendu, {Decrire(jn)} trouvé");
        _i++;
        if (!(Courant.Genre == "id" && Courant.Normalise == "est")) throw Faute($"« est » attendu, {Decrire(Courant)} trouvé");
        _i++;
        if (Courant.Genre == "id" && Courant.Normalise is "un" or "une") _i++;
        var jt = Courant;
        if (jt.Genre != "id" || !Types.TryGetValue(jt.Normalise!, out var type))
        {
            throw Faute($"Type attendu (chaîne, numérique ou booléen), {Decrire(jt)} trouvé", jt);
        }
        _i++;
        Noeud? init = null;
        PlageTexte? defaut = null;
        if (EstOp("="))
        {
            _i++;
            var premier = Courant;
            init = Expression();
            var dernier = _jetons[_i - 1];
            defaut = new PlageTexte(premier.Debut, dernier.Fin, _source[premier.Debut..dernier.Fin]);
        }
        if (!_enTete || _boucles > 0 || _profondeurBloc > 0) Signaler("SYNTAXE", "Les variables se déclarent en tête du script", debut);
        var fin = _jetons[_i - 1].Fin;
        Declarer(jn.Texte!, type, local, false, jn, defaut, new PlageTexte(debut.Debut, fin, _source[debut.Debut..fin]));
        return new InstrDeclaration(jn.Texte!, type, init, jn.Ligne, jn.Colonne);
    }

    private bool EstDeclaration()
    {
        if (EstMc("local")) return true;
        var j = _i + 1 < _jetons.Count ? _jetons[_i + 1] : null;
        return Courant.Genre == "id" && j is { Genre: "id", Normalise: "est" };
    }

    private Noeud Cible(Jeton j)
    {
        if (j.Genre == "ref") return Reference(j);
        if (j.Genre == "id")
        {
            _cibles.Add(j.Texte!);
            return Variable(j);
        }
        throw Faute($"Instruction attendue, {Decrire(j)} trouvé", j);
    }

    private List<Noeud> Bloc(params string[] fins)
    {
        var corps = new List<Noeud>();
        _profondeurBloc++;
        try
        {
            for (;;)
            {
                var j = Courant;
                if (j.Genre == "fin") return corps;
                if (j.Genre == "mc" && fins.Contains(j.Normalise)) return corps;
                if (InstructionAvecReprise() is { } n) corps.Add(n);
            }
        }
        finally
        {
            _profondeurBloc--;
        }
    }

    private void ExigerFin(Jeton ouverture, string quoi)
    {
        if (!EstMc("fin")) throw Faute($"« Fin » attendu pour fermer {quoi} ouvert ligne {ouverture.Ligne}", Courant);
        _i++;
    }

    private InstrSi Si()
    {
        var ouverture = Suivant();
        var branches = new List<BrancheSi>();
        List<Noeud>? sinon = null;
        var cond = Expression();
        if (EstMc("alors")) _i++;
        FinInstruction();
        for (;;)
        {
            branches.Add(new BrancheSi(cond, Bloc("sinon", "sinonsi", "fin")));
            if (EstMc("sinonsi") || (EstMc("sinon") && EstMc("si", _jetons[_i + 1])))
            {
                _i += EstMc("sinonsi") ? 1 : 2;
                cond = Expression();
                if (EstMc("alors")) _i++;
                FinInstruction();
                continue;
            }
            if (EstMc("sinon"))
            {
                _i++;
                FinInstruction();
                sinon = Bloc("fin");
            }
            break;
        }
        ExigerFin(ouverture, "le « Si »");
        return new InstrSi(branches, sinon, ouverture.Ligne, ouverture.Colonne);
    }

    private InstrPour Pour()
    {
        var ouverture = Suivant();
        var jv = Courant;
        if (jv.Genre != "id") throw Faute($"Variable de boucle attendue, {Decrire(jv)} trouvé", jv);
        _i++;
        if (!_parNom.ContainsKey(jv.Texte!)) Declarer(jv.Texte!, 'N', true, true, jv);
        _cibles.Add(jv.Texte!);
        AttendreOp("=", "« = »");
        var debut = Expression();
        if (!(Courant.Genre == "id" && Courant.Normalise == "a")) throw Faute($"« à » attendu, {Decrire(Courant)} trouvé");
        _i++;
        var fin = Expression();
        Noeud? pas = null;
        if (EstMc("pas")) { _i++; pas = Expression(); }
        FinInstruction();
        _boucles++;
        List<Noeud> corps;
        try
        {
            corps = Bloc("fin");
        }
        finally
        {
            _boucles--;
        }
        ExigerFin(ouverture, "le « Pour »");
        return new InstrPour(jv.Texte!, debut, fin, pas, corps, ouverture.Ligne, ouverture.Colonne);
    }

    private Noeud Instruction()
    {
        var j = Courant;
        if (EstDeclaration()) return Declaration();
        _enTete = false;
        if (EstMc("si")) return Si();
        if (EstMc("pour")) return Pour();
        if (EstMc("renvoyer"))
        {
            _i++;
            return new InstrRenvoyer(Expression(), j.Ligne, j.Colonne);
        }
        if (EstMc("sortir") || EstMc("continuer"))
        {
            _i++;
            if (_boucles == 0) Signaler("SYNTAXE", $"« {j.Texte} » hors d'une boucle « Pour »", j);
            return j.Normalise == "sortir" ? new InstrSortir(j.Ligne, j.Colonne) : new InstrContinuer(j.Ligne, j.Colonne);
        }
        _i++;
        var c = Cible(j);
        var op = Courant;
        if (op.Genre == "op" && op.Texte is "++" or "--")
        {
            _i++;
            return new InstrAffectation(c, op.Texte, null, op.Ligne, op.Colonne);
        }
        if (op.Genre == "op" && Affectations.Contains(op.Texte!))
        {
            _i++;
            return new InstrAffectation(c, op.Texte!, Expression(), op.Ligne, op.Colonne);
        }
        throw Faute($"Affectation attendue (=, +=, -=, *=, /=, ++, --), {Decrire(op)} trouvé", op);
    }

    private Noeud? InstructionAvecReprise()
    {
        try
        {
            var n = Instruction();
            FinInstruction();
            return n;
        }
        catch (ErreurSyntaxe e)
        {
            _erreurs.Add(new ErreurScript(e.Code, e.Message, e.Jeton.Ligne, e.Jeton.Colonne));
            while (Courant.Genre != "nl" && Courant.Genre != "fin") _i++;
            if (Courant.Genre == "nl") _i++;
            return null;
        }
    }
}
