// Lettres sans accents, par une table explicite répliquée dans SansAccent.cs (le C# tourne en globalisation
// invariante et le moteur d'édition dans Jint : pas de décomposition Unicode fiable). Table = décomposition NFD des
// lettres latines précomposées (U+00C0–U+024F, U+1E00–U+1EFF), ligatures et lettres barrées développées (œ → oe,
// æ → ae, ß → ss, ø → o, đ → d, ł → l), marques combinantes retirées : même résultat que les fonctions SQL
// f_sans_accent, f_annuaire_normaliser et f_ged_normaliser sur ces lettres. Jeu partagé : socle/tests/sans_accent.json.

export const SPECIAUX = Object.freeze({ 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae', 'ß': 'ss', 'ø': 'o', 'Ø': 'o', 'đ': 'd', 'Đ': 'd', 'ł': 'l', 'Ł': 'l' });

// Lettres latines précomposées et leur lettre de base (même rang).
export const ACCENTUEES = 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨ'
  + 'ĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛ'
  + 'ǜǞǟǠǡǢǣǦǧǨǩǪǫǬǭǮǯǰǴǵǸǹǺǻǼǽǾǿȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑ'
  + 'ḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫ'
  + 'ṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊ'
  + 'ịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ';
export const BASES = 'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyyAaAaAaCcCcCcCcDdEeEeEeEeEeGgGgGgGgHhI'
  + 'iIiIiIiIJjKkLlLlLlNnNnNnOoOoOoRrRrRrSsSsSsSsTtTtUuUuUuUuUuUuWwYyYZzZzZzOoUuAaIiOoUuUuUuUuU'
  + 'uAaAaÆæGgKkOoOoƷʒjGgNnAaÆæØøAaAaEeEeIiIiOoOoRrRrUuUuSsTtHhAaEeOoOoOoOoYyAaBbBbBbCcDdDdDdDd'
  + 'DdEeEeEeEeEeFfGgHhHhHhHhHhIiIiKkKkKkLlLlLlLlMmMmMmNnNnNnNnOoOoOoOoPpPpRrRrRrRrSsSsSsSsSsTt'
  + 'TtTtTtUuUuUuUuUuVvVvWwWwWwWwWwXxXxYyZzZzZzhtwyſAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiI'
  + 'iOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYy';

const DECOMPOSITION = new Map([...ACCENTUEES].map((c, i) => [c, [...BASES][i]]));
const MARQUE = /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/;

/** Texte sans accents ni casse : ligatures développées, lettres ramenées à leur base, marques retirées, minuscules. */
export function sansAccent(texte) {
  if (texte === null || texte === undefined) return '';
  let r = '';
  for (const c of String(texte)) {
    if (c < '\u0080') r += c;
    else if (SPECIAUX[c] !== undefined) r += SPECIAUX[c];
    else if (DECOMPOSITION.has(c)) r += DECOMPOSITION.get(c);
    else if (!MARQUE.test(c)) r += c;
  }
  return r.toLowerCase();
}

/**
 * Recherche « contient » sans casse ni accents (listes, annuaire, GED, listes de choix) : la table, puis la
 * décomposition Unicode pour les autres écritures ; même résultat que les fonctions SQL de recherche.
 */
export const normaliser = (texte) => sansAccent(texte).normalize('NFD').replace(/\p{M}/gu, '');
