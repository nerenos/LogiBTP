using System.Globalization;
using System.Text;

namespace LogiBTP.Ged;

/// <summary>
/// Normalisation de la recherche : ligatures développées (œ → oe, æ → ae, ß → ss, ø → o, đ → d, ł → l), accents et
/// autres marques retirés, minuscules. Même règle que la fonction SQL f_ged_normaliser (colonne dge_recherche) et que
/// normaliserRecherche en JS (jeu tests/cas/03_normalisation.json). Les lettres latines accentuées sont ramenées à leur
/// lettre de base par une table (décomposition NFD d'Unicode, générée) : l'application tourne en mode de globalisation
/// invariant, où string.Normalize ne décompose pas.
/// </summary>
public static class NormalisationGed
{
    private static readonly Dictionary<char, string> Speciaux = new()
    {
        ['œ'] = "oe", ['Œ'] = "oe", ['æ'] = "ae", ['Æ'] = "ae", ['ß'] = "ss", ['ø'] = "o", ['Ø'] = "o", ['đ'] = "d", ['Đ'] = "d", ['ł'] = "l", ['Ł'] = "l",
    };

    // Lettres latines précomposées (U+00C0–U+024F, U+1E00–U+1EFF) et leur lettre de base.
    private const string Accentuees = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜ"
        + "ĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽ"
        + "žƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǢǣǦǧǨǩǪǫǬǭǮǯǰǴǵǸǹǺǻǼǽǾǿȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧ"
        + "ȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃ"
        + "ṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓ"
        + "ẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨ"
        + "ứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ";
    private const string Bases = "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeG"
        + "gGgGgGgHhIiIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZ"
        + "zOoUuAaIiOoUuUuUuUuUuAaAaÆæGgKkOoOoƷʒjGgNnAaÆæØøAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAa"
        + "EeOoOoOoOoYyAaBbBbBbCcDdDdDdDdDdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMm"
        + "NnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTtTtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZz"
        + "ZzhtwyſAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuU"
        + "uUuUuUuUuYyYyYyYy";

    private static readonly Dictionary<char, char> Decomposition = Accentuees.Zip(Bases).ToDictionary(x => x.First, x => x.Second);

    public static string Normaliser(string? texte)
    {
        if (string.IsNullOrEmpty(texte)) return "";
        var b = new StringBuilder(texte.Length);
        foreach (var c in texte)
        {
            if (Speciaux.TryGetValue(c, out var s)) { b.Append(s); continue; }
            if (Decomposition.TryGetValue(c, out var d)) { b.Append(d); continue; }
            var cat = CharUnicodeInfo.GetUnicodeCategory(c);
            if (cat is UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark) continue;
            b.Append(c);
        }
        return b.ToString().ToLowerInvariant();
    }
}
