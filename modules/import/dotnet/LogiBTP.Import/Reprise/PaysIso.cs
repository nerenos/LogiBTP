namespace LogiBTP.Import.Reprise;

/// <summary>
/// Codes de pays ISO 3166-1 alpha-2 (liste de cibles « PAYS » des correspondances, colonnes <c>per_pays</c> et
/// <c>coo_pays</c>) : donnée de référence, pas un code de l'application.
/// </summary>
public static class PaysIso
{
    private const string Liste = """
        AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ
        BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR
        CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
        GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU
        ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ
        LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ
        MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF
        PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI
        SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR
        TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
        """;

    public static IReadOnlyCollection<string> Codes { get; } =
        Liste.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.Ordinal);

    /// <summary>Code ISO d'une valeur source déjà au format (deux lettres connues, casse ignorée), sinon null.</summary>
    public static string? Code(string? valeur) =>
        valeur?.Trim().ToUpperInvariant() is { Length: 2 } c && Codes.Contains(c) ? c : null;
}
