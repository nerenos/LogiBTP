using System.Globalization;
using LogiBTP.Import;
using LogiBTP.Import.Reprise;

namespace LogiBTP.Api.Reprise;

/// <summary>Contact d'un tiers source : individu rattaché, fonction, coordonnées propres (usages du rattachement).</summary>
public sealed record ContactSource
{
    /// <summary>Clé du registre du contact (table source, clé primaire).</summary>
    public required (string Table, string Cle) Origine { get; init; }
    public string? Civilite { get; init; }
    public required string Nom { get; init; }
    public string? Prenom { get; init; }
    public string? Fonction { get; init; }
    public bool Principal { get; init; }
    public bool Actif { get; init; } = true;
    public List<CoordonneeReprise> Coordonnees { get; init; } = [];
}

/// <summary>
/// Tiers lu d'une source, forme commune MDE / OPTIM (plan reprise-mde-optim, lot 6). <see cref="CleFusion"/> est la clé
/// proposée et retenue pour la fusion des doublons (<c>import_fusion</c>, table <see cref="TableFusion"/>).
/// </summary>
public sealed class TiersSource
{
    public required string TableFusion { get; init; }
    public required string CleFusion { get; init; }
    /// <summary>Clés du registre de la fiche (table source, clé primaire) : toutes pointeront vers la personne écrite.</summary>
    public List<(string Table, string Cle)> Origines { get; init; } = [];
    public string? Code { get; init; }
    public required string RaisonSociale { get; set; }
    public bool Particulier { get; set; }
    public string? Siret { get; set; }
    public string? TvaIntra { get; set; }
    public string? FormeLibelle { get; set; }
    public string Pays { get; set; } = "FR";
    public HashSet<string> Casquettes { get; } = new(StringComparer.Ordinal);
    public string? CliCompte { get; set; }
    public string? FouCompte { get; set; }
    public string? StCompte { get; set; }
    public string? CliCollectif { get; set; }
    public string? FouCollectif { get; set; }
    public string? StCollectif { get; set; }
    public string? CliMode { get; set; }
    public string? CliDelai { get; set; }
    public string? FouMode { get; set; }
    public string? FouDelai { get; set; }
    public decimal? EncoursMax { get; set; }
    public string? CliCategorie { get; set; }
    public bool NePasRelancer { get; set; }
    /// <summary>Fiche en « Ne plus utiliser » (usage N) : compte bloqué de la source ; fusion : seulement si tous le sont.</summary>
    public bool NePlusUtiliser { get; set; }
    public string? Iban { get; set; }
    public string? Bic { get; set; }
    public bool Actif { get; set; } = true;
    public string? Commentaire { get; set; }
    public List<CoordonneeReprise> Coordonnees { get; } = [];
    public List<ContactSource> Contacts { get; } = [];
    /// <summary>Payeurs : clé de registre du tiers payeur et type de lien (FACTURER_A…), note éventuelle.</summary>
    public List<((string Table, string Cle) Payeur, string TypeLien, string? Note)> Payeurs { get; } = [];

    /// <summary>Libellé d'une fiche proposée à la fusion.</summary>
    public string Libelle => string.Join(" ", new[] { Code, RaisonSociale }.Where(x => !string.IsNullOrWhiteSpace(x)));
}

/// <summary>
/// Écriture des tiers repris (lot 6) : regroupement des fusions retenues (une personne, casquettes cumulées, coordonnées et
/// contacts de toutes les fiches), SIRET unique (doublon non fusionné : SIRET retiré et signalé), code gardé sinon
/// suffixé, doublons proposés (même SIRET, sinon même nom et même code postal), payeurs, registre.
/// </summary>
public static class TiersReprise
{
    public const string TypeLienFacturerA = "FACTURER_A";

    public static async Task EcrireAsync(ContexteReprise ctx, IReadOnlyList<TiersSource> tiers, CancellationToken ct)
    {
        Proposer(ctx, tiers);
        var sirets = (await SqlReprise.LireAsync(ctx.Unite, "SELECT per_siret FROM personne WHERE per_siret IS NOT NULL", r => r.GetString(0), ct))
            .ToHashSet(StringComparer.Ordinal);
        var codes = (await SqlReprise.LireAsync(ctx.Unite, "SELECT per_code FROM personne WHERE per_code IS NOT NULL", r => r.GetString(0), ct))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var comptes = await ReferentielsCible.LireAsync(ctx, ct);

        // Fusions : la fiche conservée en tête, puis les fusionnées dans l'ordre de lecture.
        var groupes = tiers.GroupBy(t => ctx.CleConservee(t.TableFusion, t.CleFusion))
            .Select(g => g.OrderBy(t => t.CleFusion == g.Key ? 0 : 1).ToList()).ToList();
        foreach (var g in groupes)
        {
            var t = Fusionner(g);
            var volume = ctx.Rapport.Volume(t.TableFusion);
            volume.Lues += g.Count;
            if (t.Siret is { } s && !sirets.Add(s))
            {
                ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.SiretPris, $"{t.TableFusion} {t.CleFusion}",
                    $"SIRET {s} déjà repris sur une autre fiche : retiré de « {t.Libelle} » (fusion possible)");
                t.Siret = null;
            }
            string? code = null;
            if (t.Code is { } c)
            {
                code = Associations.CodeLibre(c.Trim(), 20, codes.Contains);
                codes.Add(code);
                if (code != c.Trim())
                    ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.CodeRenomme, $"{t.TableFusion} {t.CleFusion}",
                        $"Code « {c} » déjà pris : repris sous « {code} »");
            }
            var perId = await AnnuaireReprise.InsererPersonneAsync(ctx.Unite, new PersonneReprise
            {
                Code = code, Niveau = t.Particulier ? AnnuaireReprise.Niveau.Particulier : AnnuaireReprise.Niveau.Societe,
                RaisonSociale = t.RaisonSociale, Siret = t.Siret, TvaIntra = t.TvaIntra, FormeLibelle = t.FormeLibelle,
                Pays = t.Pays, Actif = t.Actif, Commentaire = t.Commentaire,
            }, ct);
            if (t.NePlusUtiliser && t.Actif)
                await SqlReprise.ExecuterAsync(ctx.Unite, "UPDATE personne SET per_usage = 'N' WHERE per_id = $1", ct, perId);
            foreach (var col in new[] { t.CliCollectif, t.FouCollectif, t.StCollectif })
                await comptes.CompteAsync(col, col, ReferentielsCible.TypeCompte.Collectif, ReferentielsCible.SensCompte.Aucun, ct);
            await SqlReprise.ExecuterAsync(ctx.Unite, """
                UPDATE personne SET per_casquettes = $2, per_cli_compte = $3, per_fou_compte = $4, per_st_compte = $5,
                    per_cli_collectif = $6, per_fou_collectif = $7, per_st_collectif = $8,
                    per_cli_mode_reglement = $9::varchar, per_cli_delai_paiement = $10::varchar, per_fou_mode_reglement = $11::varchar,
                    per_fou_delai_paiement = $12::varchar, per_mode_reglement = COALESCE($9::varchar, $11::varchar),
                    per_delai_paiement = COALESCE($10::varchar, $12::varchar),
                    per_cli_encours_max = $13, per_cli_categorie = $14, per_rel_ne_pas_relancer = $15, per_iban = $16, per_bic = $17
                WHERE per_id = $1
                """, ct, perId, SqlReprise.Json.De(t.Casquettes.Order(StringComparer.Ordinal).ToList()),
                AnnuaireReprise.Couper(t.CliCompte, 20), AnnuaireReprise.Couper(t.FouCompte, 20), AnnuaireReprise.Couper(t.StCompte, 20),
                AnnuaireReprise.Couper(t.CliCollectif, 20), AnnuaireReprise.Couper(t.FouCollectif, 20), AnnuaireReprise.Couper(t.StCollectif, 20),
                t.CliMode, t.CliDelai, t.FouMode, t.FouDelai, t.EncoursMax, AnnuaireReprise.Couper(t.CliCategorie, 40), t.NePasRelancer,
                AnnuaireReprise.Couper(t.Iban?.Replace(" ", "", StringComparison.Ordinal), 34), AnnuaireReprise.Couper(t.Bic, 11));

            var ordre = 0;
            foreach (var coo in Distinctes(t.Coordonnees))
                await AnnuaireReprise.AjouterCoordonneeAsync(ctx.Unite, perId, coo, ordre++, ctx.Options.Auteur, ct);
            foreach (var contact in t.Contacts)
                await ContactAsync(ctx, perId, contact, ct);
            foreach (var o in g.SelectMany(x => x.Origines).Distinct())
                if (ctx.Registre.Trouver(o.Table, o.Cle) is null) ctx.Registre.Inscrire(o.Table, o.Cle, "personne", perId);
            volume.Ecrites += g.Count;
        }

        // Payeurs, une fois toutes les personnes écrites.
        foreach (var t in tiers)
        {
            var de = t.Origines.Select(o => ctx.Registre.Trouver(o.Table, o.Cle)).FirstOrDefault(x => x is not null);
            foreach (var (payeur, lien, note) in t.Payeurs)
            {
                var vers = ctx.Registre.Trouver(payeur.Table, payeur.Cle);
                if (de is null || vers is null || de == vers)
                {
                    if (vers is null)
                        ctx.Rapport.Signaler(NiveauAnomalie.Avertissement, CodeAnomalie.PayeurInconnu, $"{t.TableFusion} {t.CleFusion}",
                            $"Tiers payeur {payeur.Table} {payeur.Cle} non repris");
                    continue;
                }
                await SqlReprise.ExecuterAsync(ctx.Unite, """
                    INSERT INTO lien_personne (lpe_per_id, lpe_cible_id, lpe_tli_code, lpe_commentaire) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (lpe_per_id, lpe_cible_id, lpe_tli_code) DO NOTHING
                    """, ct, de.Value, vers.Value, lien, AnnuaireReprise.Couper(note, 500));
            }
        }
    }

    /// <summary>Individu, rattachement à la personne et coordonnées du rattachement.</summary>
    public static async Task<long> ContactAsync(ContexteReprise ctx, long perId, ContactSource c, CancellationToken ct)
    {
        var indId = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO individu (ind_civilite, ind_nom, ind_prenom, ind_actif) VALUES ($1, $2, $3, $4) RETURNING ind_id
            """, ct, AnnuaireReprise.Couper(c.Civilite, 10), AnnuaireReprise.Couper(c.Nom, 80) ?? "?", AnnuaireReprise.Couper(c.Prenom, 80), c.Actif),
            CultureInfo.InvariantCulture);
        var ratId = Convert.ToInt64(await SqlReprise.ScalaireAsync(ctx.Unite, """
            INSERT INTO rattachement (rat_ind_id, rat_per_id, rat_fonction, rat_principal, rat_actif) VALUES ($1, $2, $3, $4, $5) RETURNING rat_id
            """, ct, indId, perId, AnnuaireReprise.Couper(c.Fonction, 100), c.Principal, c.Actif), CultureInfo.InvariantCulture);
        var ordre = 0;
        foreach (var coo in Distinctes(c.Coordonnees))
            await AnnuaireReprise.AjouterCoordonneeAsync(ctx.Unite, null, ratId, coo, ordre++, ctx.Options.Auteur, ct);
        if (ctx.Registre.Trouver(c.Origine.Table, c.Origine.Cle) is null) ctx.Registre.Inscrire(c.Origine.Table, c.Origine.Cle, "individu", indId);
        var vc = ctx.Rapport.Volume(c.Origine.Table); vc.Lues++; vc.Ecrites++;
        return indId;
    }

    /// <summary>Fiches d'un groupe de fusion cumulées dans la première (conservée).</summary>
    private static TiersSource Fusionner(List<TiersSource> g)
    {
        var t = g[0];
        foreach (var x in g.Skip(1))
        {
            t.Casquettes.UnionWith(x.Casquettes);
            t.Siret ??= x.Siret; t.TvaIntra ??= x.TvaIntra; t.FormeLibelle ??= x.FormeLibelle;
            t.CliCompte ??= x.CliCompte; t.FouCompte ??= x.FouCompte; t.StCompte ??= x.StCompte;
            t.CliCollectif ??= x.CliCollectif; t.FouCollectif ??= x.FouCollectif; t.StCollectif ??= x.StCollectif;
            t.CliMode ??= x.CliMode; t.CliDelai ??= x.CliDelai; t.FouMode ??= x.FouMode; t.FouDelai ??= x.FouDelai;
            t.EncoursMax ??= x.EncoursMax; t.CliCategorie ??= x.CliCategorie; t.Iban ??= x.Iban; t.Bic ??= x.Bic;
            t.NePasRelancer |= x.NePasRelancer; t.Actif |= x.Actif; t.NePlusUtiliser &= x.NePlusUtiliser;
            t.Commentaire = string.Join("\n", new[] { t.Commentaire, x.Commentaire }.Where(s => !string.IsNullOrWhiteSpace(s))) is { Length: > 0 } n ? n : null;
            t.Coordonnees.AddRange(x.Coordonnees.Select(c => c with { Principal = false }));
            t.Contacts.AddRange(x.Contacts.Select(c => c with { Principal = false }));
            t.Payeurs.AddRange(x.Payeurs);
        }
        return t;
    }

    /// <summary>Coordonnées sans doublon (même nature, même valeur ou mêmes lignes), la première gardée.</summary>
    private static IEnumerable<CoordonneeReprise> Distinctes(IEnumerable<CoordonneeReprise> coordonnees)
    {
        var vues = new HashSet<string>(StringComparer.Ordinal);
        foreach (var c in coordonnees.Where(c => !c.Vide))
            if (vues.Add(string.Join("|", c.Nature, Associations.Normaliser(c.Valeur), Associations.Normaliser(c.Ligne1),
                    Associations.Normaliser(c.Ligne2), Associations.Normaliser(c.CodePostal), Associations.Normaliser(c.Ville))))
                yield return c;
    }

    /// <summary>Doublons proposés à la fusion : même SIRET, sinon même nom normalisé et même code postal (Q4).</summary>
    private static void Proposer(ContexteReprise ctx, IReadOnlyList<TiersSource> tiers)
    {
        var deja = new HashSet<string>(StringComparer.Ordinal);
        void Groupe(string critere, IEnumerable<IGrouping<string, TiersSource>> groupes)
        {
            foreach (var g in groupes)
            {
                var fiches = g.Where(t => !deja.Contains(t.CleFusion)).ToList();
                if (fiches.Select(t => ctx.CleConservee(t.TableFusion, t.CleFusion)).Distinct().Count() < 2) continue;
                ctx.Rapport.Proposer(fiches[0].TableFusion, critere, g.Key, fiches.Select(t => new FicheDoublon(t.CleFusion, t.Libelle)).ToList());
                deja.UnionWith(fiches.Select(t => t.CleFusion));
            }
        }
        Groupe("SIRET", tiers.Where(t => t.Siret is not null).GroupBy(t => t.Siret!));
        Groupe("NOM_CODE_POSTAL", tiers.Where(t => !deja.Contains(t.CleFusion))
            .Select(t => (t, cp: t.Coordonnees.FirstOrDefault(c => c.Nature == AnnuaireReprise.Nature.Adresse)?.CodePostal))
            .Where(x => x.cp is not null)
            .GroupBy(x => $"{Associations.Normaliser(x.t.RaisonSociale)} {x.cp}", x => x.t));
    }
}
