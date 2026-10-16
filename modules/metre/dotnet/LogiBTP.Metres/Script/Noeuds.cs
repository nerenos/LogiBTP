namespace LogiBTP.Metres.Script;

// Arbre d'un script (réplique des nœuds de script/analyseur.js). Ligne et colonne : position signalée en cas d'erreur.

public abstract record Noeud(int Ligne, int Colonne);

public sealed record NoeudValeur(Valeur V, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record NoeudVariable(string Nom, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
/// <summary>Variable de portée de l'hôte ($$, $, @@, @), lue par le résolveur et écrite par les portées.</summary>
public sealed record NoeudPortee(string Ref, string Portee, string Nom, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
/// <summary>Donnée de l'hôte ({{lig_qte}}), lue par le résolveur et écrite par <see cref="ContexteScript.Ecrire"/>.</summary>
public sealed record NoeudDonnee(string Ref, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record NoeudUnaire(string Op, Noeud E, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record NoeudBinaire(string Op, Noeud G, Noeud D, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record NoeudAppel(string Nom, string Texte, IReadOnlyList<Noeud> Args, int Ligne, int Colonne) : Noeud(Ligne, Colonne);

public sealed record InstrDeclaration(string Nom, char Type, Noeud? Init, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
/// <summary>Affectation : =, +=, -=, *=, /=, ++, -- (E null pour ++ et --).</summary>
public sealed record InstrAffectation(Noeud Cible, string Op, Noeud? E, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record BrancheSi(Noeud Condition, IReadOnlyList<Noeud> Corps);
public sealed record InstrSi(IReadOnlyList<BrancheSi> Branches, IReadOnlyList<Noeud>? Sinon, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record InstrPour(string Nom, Noeud Debut, Noeud Fin, Noeud? Pas, IReadOnlyList<Noeud> Corps, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record InstrRenvoyer(Noeud E, int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record InstrSortir(int Ligne, int Colonne) : Noeud(Ligne, Colonne);
public sealed record InstrContinuer(int Ligne, int Colonne) : Noeud(Ligne, Colonne);

/// <summary>Plage du texte (positions de début et de fin).</summary>
public sealed record PlageTexte(int Debut, int Fin, string Texte);

/// <summary>
/// Déclaration d'une variable. Paramètre : non locale, déclarée dans l'en-tête et jamais réaffectée (modifiable
/// dans la grille). Implicite : variable de boucle non déclarée.
/// </summary>
public sealed class DeclarationScript
{
    public required string Nom { get; init; }
    public char Type { get; init; }
    public bool Local { get; init; }
    public bool Implicite { get; init; }
    public bool Parametre { get; set; }
    public PlageTexte? Defaut { get; init; }
    public PlageTexte? Declaration { get; init; }
    public int Ligne { get; init; }
    public int Colonne { get; init; }
}

public sealed record AnalyseScript(IReadOnlyList<Noeud> Programme, IReadOnlyList<DeclarationScript> Declarations, IReadOnlyList<ErreurScript> Erreurs);
