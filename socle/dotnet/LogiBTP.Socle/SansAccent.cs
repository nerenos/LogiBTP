using System.Text;

namespace LogiBTP.Socle;

/// <summary>
/// Lettres sans accents, par une table explicite répliquée dans accents.js (l'application tourne en globalisation
/// invariante, où string.Normalize ne décompose pas). Table = décomposition NFD des lettres latines précomposées
/// (U+00C0–U+024F, U+1E00–U+1EFF), ligatures et lettres barrées développées (œ → oe, æ → ae, ß → ss, ø → o, đ → d,
/// ł → l), marques combinantes retirées : même résultat que les fonctions SQL de recherche sur ces lettres.
/// Jeu partagé : socle/tests/sans_accent.json.
/// </summary>
public static class SansAccent
{
    public static readonly IReadOnlyDictionary<char, string> Speciaux = new Dictionary<char, string>
    {
        ['œ'] = "oe", ['Œ'] = "oe", ['æ'] = "ae", ['Æ'] = "ae", ['ß'] = "ss", ['ø'] = "o", ['Ø'] = "o", ['đ'] = "d", ['Đ'] = "d", ['ł'] = "l", ['Ł'] = "l",
    };

    /// <summary>Lettres latines précomposées et leur lettre de base (même rang).</summary>
    public const string Accentuees = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨ"
        + "ĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛ"
        + "ǜǞǟǠǡǢǣǦǧǨǩǪǫǬǭǮǯǰǴǵǸǹǺǻǼǽǾǿȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑ"
        + "ḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫ"
        + "ṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊ"
        + "ịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ";
    public const string Bases = "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhI"
        + "iIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaIiOoUuUuUuUuU"
        + "uAaAaÆæGgKkOoOoƷʒjGgNnAaÆæØøAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyAaBbBbBbCcDdDdDdDd"
        + "DdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTt"
        + "TtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwyſAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiI"
        + "iOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYy";

    private static readonly Dictionary<char, char> Decomposition = Accentuees.Zip(Bases).ToDictionary(x => x.First, x => x.Second);

    private static bool Marque(char c) => c is (>= '\u0300' and <= '\u036F') or (>= '\u1AB0' and <= '\u1AFF') or (>= '\u1DC0' and <= '\u1DFF')
        or (>= '\u20D0' and <= '\u20FF') or (>= '\uFE20' and <= '\uFE2F');

    /// <summary>Texte sans accents ni casse : ligatures développées, lettres ramenées à leur base, marques retirées, minuscules.</summary>
    public static string Retirer(string? texte)
    {
        if (string.IsNullOrEmpty(texte)) return "";
        var b = new StringBuilder(texte.Length);
        foreach (var c in texte)
        {
            if (c < '\u0080') b.Append(c);
            else if (Speciaux.TryGetValue(c, out var s)) b.Append(s);
            else if (Decomposition.TryGetValue(c, out var d)) b.Append(d);
            else if (!Marque(c)) b.Append(c);
        }
        return b.ToString().ToLowerInvariant();
    }
}
