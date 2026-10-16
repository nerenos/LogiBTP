using LogiBTP.Socle;

namespace LogiBTP.Metres.Script;

/// <summary>
/// Contexte d'exécution d'un script fourni par l'hôte.
/// Resoudre : lecture d'une donnée ({{lig_qte}}) ou d'une variable de portée (@@Perte) → decimal, string ou bool ;
/// Portees et LigneId : écriture des variables de portée ; Ecrire : écriture d'une donnée de l'hôte
/// (absent : erreur ECRITURE_INTERDITE) ; Fonctions : fonctions supplémentaires (nom normalisé).
/// </summary>
public sealed class ContexteScript
{
    public required Func<string, object?> Resoudre { get; init; }
    public Portees? Portees { get; init; }
    public long? LigneId { get; init; }
    public Action<string, object>? Ecrire { get; init; }
    public IReadOnlyDictionary<string, FonctionScript>? Fonctions { get; init; }
}

/// <summary>Variable déclarée (hors variables de boucle implicites) et sa dernière valeur (decimal, string ou bool).</summary>
public sealed record VariableScript(string Nom, char Type, bool Local, bool Parametre, object? Valeur, string? Defaut);

public sealed record AvertissementScript(string Code, string Message);

/// <summary>
/// Résultat d'un script : quantité renvoyée (null sans Renvoyer ou en erreur), variables, erreurs (toutes celles de
/// l'analyse, ou la première erreur d'exécution), avertissements (METRE_SANS_RESULTAT).
/// </summary>
public sealed record ResultatScript(decimal? Resultat, IReadOnlyList<VariableScript> Variables, IReadOnlyList<ErreurScript> Erreurs,
    IReadOnlyList<AvertissementScript> Avertissements);

/// <summary>Interpréteur du langage de script des métrés (réplique de script/interpreteur.js).</summary>
public sealed class Interpreteur
{
    private const int MaxTours = 10000;
    private const int MaxInstructions = 100000;

    private sealed class Interruption(string code, string message, Noeud noeud) : Exception(message)
    {
        public string Code { get; } = code;
        public Noeud Noeud { get; } = noeud;
    }

    private enum Fin { Aucune, Sortir, Continuer, Renvoyer }

    private readonly ContexteScript _contexte;
    private readonly IReadOnlyDictionary<string, FonctionScript> _catalogue;
    private readonly Dictionary<string, Valeur> _memoire = new(StringComparer.Ordinal);
    private int _instructions;
    private decimal _renvoi;

    private Interpreteur(ContexteScript contexte, IReadOnlyDictionary<string, FonctionScript> catalogue)
    {
        _contexte = contexte;
        _catalogue = catalogue;
    }

    /// <summary>Exécute un script de métré. Ne lève pas d'erreur de calcul : elles sont renvoyées.</summary>
    public static ResultatScript Executer(string? texte, ContexteScript contexte)
    {
        var analyse = Analyseur.Analyser(texte, contexte.Fonctions);
        var catalogue = new Dictionary<string, FonctionScript>(Fonctions.Catalogue);
        foreach (var (nom, f) in contexte.Fonctions ?? new Dictionary<string, FonctionScript>()) catalogue[nom] = f;
        var it = new Interpreteur(contexte, catalogue);

        ResultatScript Sortie(decimal? resultat, IReadOnlyList<ErreurScript> erreurs, IReadOnlyList<AvertissementScript> avertissements) => new(
            resultat,
            analyse.Declarations.Where(d => !d.Implicite).Select(d => new VariableScript(d.Nom, d.Type, d.Local, d.Parametre,
                it._memoire.TryGetValue(d.Nom, out var v) ? v.Exposer() : null, d.Defaut?.Texte)).ToList(),
            erreurs,
            avertissements);

        if (analyse.Erreurs.Count > 0) return Sortie(null, analyse.Erreurs, []);
        try
        {
            foreach (var d in analyse.Declarations) if (d.Implicite) it._memoire[d.Nom] = Valeur.N(0);
            if (it.ExecuterBloc(analyse.Programme) == Fin.Renvoyer) return Sortie(ArrondiCalcul.Arr6(it._renvoi), [], []);
            return Sortie(null, [], [new AvertissementScript("METRE_SANS_RESULTAT", "Le script ne renvoie pas de quantité (« Renvoyer » absent)")]);
        }
        catch (Interruption e)
        {
            return Sortie(null, [new ErreurScript(e.Code, e.Message, e.Noeud.Ligne, e.Noeud.Colonne)], []);
        }
    }

    // ------------------------------------------------------------------ expressions

    private Valeur LireReference(string reference, Noeud n)
    {
        try
        {
            return Valeur.Typer(_contexte.Resoudre(reference));
        }
        catch (ErreurCalcul e)
        {
            throw new Interruption(e.Code, e.Message, n);
        }
    }

    private Valeur Evaluer(Noeud n)
    {
        switch (n)
        {
            case NoeudValeur v: return v.V;
            case NoeudVariable v: return _memoire[v.Nom];
            case NoeudPortee p: return LireReference(p.Ref, p);
            case NoeudDonnee d: return LireReference(d.Ref, d);
            case NoeudUnaire u:
            {
                var v = Evaluer(u.E);
                if (u.Op == "pas")
                {
                    if (v.Type != 'B') throw new Interruption("TYPE", "« pas » : booléen attendu", u);
                    return Valeur.B(!v.Booleen);
                }
                if (v.Type != 'N') throw new Interruption("TYPE", $"« {u.Op} » : numérique attendu", u);
                return u.Op == "-" ? Valeur.N(-v.Nombre) : v;
            }
            case NoeudBinaire b: return Binaire(b);
            case NoeudAppel a:
            {
                var args = a.Args.Select(Evaluer).ToList();
                var f = _catalogue[a.Nom];
                try
                {
                    return f.Appliquer(args);
                }
                catch (ErreurCalcul e)
                {
                    throw new Interruption(e.Code, $"{f.Signature} : {e.Message}", a);
                }
                catch (OverflowException)
                {
                    throw new Interruption("DEPASSEMENT", $"{f.Signature} : Valeur trop grande", a);
                }
            }
            default: throw new InvalidOperationException($"Nœud inconnu {n.GetType().Name}");
        }
    }

    private static bool Booleen(Valeur v, string quoi, Noeud n) =>
        v.Type == 'B' ? v.Booleen : throw new Interruption("TYPE", $"{quoi} : booléen attendu, {Valeur.NomType(v.Type)} trouvé", n);

    private static Valeur Arithmetique(string op, Valeur g, Valeur d, Noeud n)
    {
        if (op == "+" && (g.Type == 'C' || d.Type == 'C')) return Valeur.C(g.EnTexte() + d.EnTexte());
        if (g.Type != 'N' || d.Type != 'N')
        {
            throw new Interruption("TYPE", $"« {op} » : numériques attendus, {Valeur.NomType(g.Type)} et {Valeur.NomType(d.Type)} trouvés", n);
        }
        var a = g.Nombre;
        var b = d.Nombre;
        try
        {
            switch (op)
            {
                case "+": return Valeur.N(a + b);
                case "-": return Valeur.N(a - b);
                case "*": return Valeur.N(a * b);
                default:
                    if (b == 0) throw new Interruption("DIVISION_ZERO", "Division par zéro", n);
                    return Valeur.N(op == "/" ? a / b : a % b);
            }
        }
        catch (OverflowException)
        {
            throw new Interruption("DEPASSEMENT", "Valeur trop grande", n);
        }
    }

    private Valeur Binaire(NoeudBinaire n)
    {
        if (n.Op is "et" or "ou")
        {
            var gb = Booleen(Evaluer(n.G), $"« {n.Op} »", n);
            if (n.Op == "et" ? !gb : gb) return Valeur.B(gb);
            return Valeur.B(Booleen(Evaluer(n.D), $"« {n.Op} »", n));
        }
        var g = Evaluer(n.G);
        var d = Evaluer(n.D);
        if (n.Op is "+" or "-" or "*" or "/" or "modulo") return Arithmetique(n.Op, g, d, n);
        if (g.Type != d.Type) throw new Interruption("TYPE", $"Comparaison de types différents : {Valeur.NomType(g.Type)} et {Valeur.NomType(d.Type)}", n);
        if (g.Type == 'B' && n.Op is not ("=" or "<>")) throw new Interruption("TYPE", "Booléens : seuls « = » et « <> » sont permis", n);
        var c = g.Type switch
        {
            'N' => g.Nombre.CompareTo(d.Nombre),
            'C' => Math.Sign(string.CompareOrdinal(g.Texte, d.Texte)),
            _ => g.Booleen == d.Booleen ? 0 : 1,
        };
        return Valeur.B(n.Op switch
        {
            "=" => c == 0,
            "<>" => c != 0,
            "<" => c < 0,
            "<=" => c <= 0,
            ">" => c > 0,
            _ => c >= 0,
        });
    }

    // ------------------------------------------------------------------ instructions

    /// <summary>Valeur conforme au type déclaré (numérique arrondi à 6 décimales).</summary>
    private static Valeur Conforme(char type, Valeur v, string nom, Noeud n)
    {
        if (v.Type != type) throw new Interruption("TYPE", $"« {nom} » est {Valeur.NomType(type)} : {Valeur.NomType(v.Type)} affecté", n);
        return type == 'N' ? Valeur.N(ArrondiCalcul.Arr6(v.Nombre)) : v;
    }

    private static Valeur NouvelleValeur(string op, Valeur ancienne, Valeur? v, Noeud n)
    {
        if (op is "++" or "--" && ancienne.Type != 'N') throw new Interruption("TYPE", $"« {op} » : numérique attendu", n);
        return op switch
        {
            "=" => v!.Value,
            "++" => Arithmetique("+", ancienne, Valeur.N(1), n),
            "--" => Arithmetique("-", ancienne, Valeur.N(1), n),
            _ => Arithmetique(op[..1], ancienne, v!.Value, n),
        };
    }

    private void Affecter(InstrAffectation n)
    {
        Valeur? v = n.E is null ? null : Evaluer(n.E);
        try
        {
            switch (n.Cible)
            {
                case NoeudVariable c:
                {
                    var ancienne = _memoire[c.Nom];
                    _memoire[c.Nom] = Conforme(ancienne.Type, NouvelleValeur(n.Op, ancienne, v, n), c.Nom, n);
                    return;
                }
                case NoeudPortee c:
                {
                    // Écriture au contexte le plus proche (=) ou là où la variable existe (opérations composées).
                    var portees = _contexte.Portees ?? throw new ErreurCalcul("PORTEE", $"{c.Ref} : aucune portée disponible");
                    if (n.Op == "=")
                    {
                        if (v!.Value.Type != 'N') throw new Interruption("TYPE", $"{c.Ref} : numérique attendu", n);
                        portees.Affecter(c.Portee, c.Nom, "=", v.Value.Nombre, _contexte.LigneId);
                        return;
                    }
                    var ancienne = Valeur.N(portees.Lire(c.Portee, c.Nom, _contexte.LigneId));
                    var r = NouvelleValeur(n.Op, ancienne, v, n);
                    if (r.Type != 'N') throw new Interruption("TYPE", $"{c.Ref} : numérique attendu", n);
                    portees.Affecter(c.Portee, c.Nom, "+=", r.Nombre - ancienne.Nombre, _contexte.LigneId);
                    return;
                }
                case NoeudDonnee c:
                {
                    var ecrire = _contexte.Ecrire ?? throw new ErreurCalcul("ECRITURE_INTERDITE", $"{{{{{c.Ref}}}}} ne peut pas être modifié");
                    var r = n.Op == "=" ? v!.Value : NouvelleValeur(n.Op, LireReference(c.Ref, n), v, n);
                    ecrire(c.Ref, r.Exposer());
                    return;
                }
            }
        }
        catch (ErreurCalcul e)
        {
            throw new Interruption(e.Code, e.Message, n);
        }
    }

    private Fin ExecuterBloc(IReadOnlyList<Noeud> corps)
    {
        foreach (var n in corps)
        {
            if (++_instructions > MaxInstructions) throw new Interruption("BOUCLE_INFINIE", "Trop d'instructions exécutées", n);
            switch (n)
            {
                case InstrDeclaration d:
                    _memoire[d.Nom] = d.Init is null
                        ? d.Type switch { 'N' => Valeur.N(0), 'C' => Valeur.C(""), _ => Valeur.B(false) }
                        : Conforme(d.Type, Evaluer(d.Init), d.Nom, d);
                    break;
                case InstrAffectation a:
                    Affecter(a);
                    break;
                case InstrSi s:
                {
                    var branche = s.Branches.FirstOrDefault(b => Booleen(Evaluer(b.Condition), "Condition du « Si »", b.Condition));
                    var r = ExecuterBloc(branche is not null ? branche.Corps : s.Sinon ?? []);
                    if (r != Fin.Aucune) return r;
                    break;
                }
                case InstrPour p:
                {
                    var r = Boucle(p);
                    if (r != Fin.Aucune) return r;
                    break;
                }
                case InstrRenvoyer r:
                {
                    var v = Evaluer(r.E);
                    if (v.Type != 'N') throw new Interruption("RESULTAT_TYPE", $"« Renvoyer » : numérique attendu, {Valeur.NomType(v.Type)} trouvé", r);
                    _renvoi = v.Nombre;
                    return Fin.Renvoyer;
                }
                case InstrSortir:
                    return Fin.Sortir;
                case InstrContinuer:
                    return Fin.Continuer;
            }
        }
        return Fin.Aucune;
    }

    private Fin Boucle(InstrPour n)
    {
        decimal Borne(Noeud e, string quoi)
        {
            var v = Evaluer(e);
            return v.Type == 'N' ? v.Nombre : throw new Interruption("TYPE", $"« Pour », {quoi} : numérique attendu", e);
        }
        if (_memoire[n.Nom].Type != 'N') throw new Interruption("TYPE", $"« Pour » : « {n.Nom} » doit être numérique", n);
        var fin = Borne(n.Fin, "fin");
        var pas = n.Pas is null ? 1m : Borne(n.Pas, "pas");
        if (pas == 0) throw new Interruption("BOUCLE_INFINIE", "« Pour » : pas nul", n);
        _memoire[n.Nom] = Valeur.N(ArrondiCalcul.Arr6(Borne(n.Debut, "début")));
        for (var tours = 0; ; tours++)
        {
            var i = _memoire[n.Nom].Nombre;
            if (pas > 0 ? i > fin : i < fin) return Fin.Aucune;
            if (tours >= MaxTours) throw new Interruption("BOUCLE_INFINIE", $"« Pour » : plus de {MaxTours} tours", n);
            var r = ExecuterBloc(n.Corps);
            if (r == Fin.Sortir) return Fin.Aucune;
            if (r == Fin.Renvoyer) return r;
            _memoire[n.Nom] = Valeur.N(ArrondiCalcul.Arr6(_memoire[n.Nom].Nombre + pas));
        }
    }
}
