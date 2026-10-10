using LogiBTP.Domaine;

namespace LogiBTP.Calcul;

/// <summary>Identifiants fixes de la table type_ligne (données de référence).</summary>
public static class TL
{
    public const short Titre = 1;
    public const short Ouvrage = 2;
    public const short Element = 3;
    public const short Texte = 4;
    public const short SousTotal = 5;
    public const short Image = 6;
    public const short SautPage = 7;
    public const short PiedHt = 8;
    public const short PiedTtc = 9;
    public const short Tva = 10;

    public static bool EstChiffree(DocumentLigne l) => l.LigTylId is Ouvrage or Element;
    public static bool EstPied(DocumentLigne l) => l.LigTylId is PiedHt or PiedTtc or Tva;
    public static bool EstNumerotee(DocumentLigne l) => l.LigTylId is Titre or Ouvrage or Element && !l.LigIsEcartArrondi;
    public static bool AccepteEnfants(DocumentLigne l) => l.LigTylId is Titre or Ouvrage;
}
