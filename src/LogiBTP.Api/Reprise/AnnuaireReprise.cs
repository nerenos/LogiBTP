using LogiBTP.Socle.Donnees;

namespace LogiBTP.Api.Reprise;

/// <summary>Personne (tiers, société de la base, établissement) écrite par la reprise.</summary>
public sealed record PersonneReprise
{
    public string? Code { get; init; }
    public required string Niveau { get; init; }
    public required string RaisonSociale { get; init; }
    public string? NomCommercial { get; init; }
    public string? Sigle { get; init; }
    public long? ParentId { get; init; }
    public bool SocieteBase { get; init; }
    public string Pays { get; init; } = "FR";
    public string? Siret { get; init; }
    public string? TvaIntra { get; init; }
    public string? Naf { get; init; }
    public string? FormeLibelle { get; init; }
    public decimal? Capital { get; init; }
    public string? Rcs { get; init; }
    public bool Actif { get; init; } = true;
    public string? Commentaire { get; init; }

    /// <summary>SIREN : les 9 premiers chiffres du SIRET.</summary>
    public string? Siren => Siret is { Length: >= 9 } s && s[..9].All(char.IsAsciiDigit) ? s[..9] : null;
}

/// <summary>Coordonnée d'une fiche : nature (ADRESSE, TELEPHONE, EMAIL, WEB), usage, valeur ou lignes d'adresse.</summary>
public sealed record CoordonneeReprise(string Nature, string? Usage, bool Principal)
{
    public string? Valeur { get; init; }
    public string? Ligne1 { get; init; }
    public string? Ligne2 { get; init; }
    public string? Ligne3 { get; init; }
    public string? CodePostal { get; init; }
    public string? Ville { get; init; }
    public string? Pays { get; init; }
    public string? Libelle { get; init; }

    public bool Vide => Nature == AnnuaireReprise.Nature.Adresse
        ? new[] { Ligne1, Ligne2, Ligne3, CodePostal, Ville }.All(string.IsNullOrWhiteSpace)
        : string.IsNullOrWhiteSpace(Valeur);
}

/// <summary>
/// Écritures de l'annuaire pendant une reprise (société de la base au lot 4, tiers au lot 6) : SQL constant sur les
/// tables du module Annuaire. Les natures et usages sont ceux de <c>modules/annuaire/js/src/coordonnees.js</c>.
/// </summary>
public static class AnnuaireReprise
{
    public static class Nature
    {
        public const string Adresse = "ADRESSE";
        public const string Telephone = "TELEPHONE";
        public const string Email = "EMAIL";
        public const string Web = "WEB";
    }

    public static class Usage
    {
        public const string Principale = "PRINCIPALE";
        public const string Siege = "SIEGE";
        public const string Facturation = "FACTURATION";
        public const string Livraison = "LIVRAISON";
        public const string Fixe = "FIXE";
        public const string Portable = "PORTABLE";
        public const string Standard = "STANDARD";
        public const string Fax = "FAX";
        public const string Pro = "PRO";
        public const string Site = "SITE";
        public const string Autre = "AUTRE";
    }

    public static class Niveau
    {
        public const string Societe = "SOCIETE";
        public const string Etablissement = "ETABLISSEMENT";
    }

    /// <summary>Texte coupé à une longueur de colonne (null si vide).</summary>
    public static string? Couper(string? texte, int longueur)
    {
        if (string.IsNullOrWhiteSpace(texte)) return null;
        var t = texte.Trim();
        return t.Length > longueur ? t[..longueur] : t;
    }

    /// <summary>Lignes d'une adresse saisie sur plusieurs lignes (CR LF) : trois au plus, la dernière cumule le reste.</summary>
    public static (string? L1, string? L2, string? L3) Lignes(string? adresse)
    {
        var l = (adresse ?? "").Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return (l.ElementAtOrDefault(0), l.ElementAtOrDefault(1), l.Length > 2 ? string.Join(" ", l[2..]) : null);
    }

    public static async Task<long> InsererPersonneAsync(UniteEcriture u, PersonneReprise p, CancellationToken ct) =>
        (long)(await SqlReprise.ScalaireAsync(u, """
            INSERT INTO personne (per_code, per_niv_code, per_raison_sociale, per_nom_commercial, per_sigle, per_parent_id,
                per_societe_base, per_pays, per_siren, per_siret, per_tva_intra, per_naf, per_forme_libelle, per_capital, per_rcs,
                per_actif, per_commentaire)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING per_id
            """, ct, Couper(p.Code, 20), p.Niveau, Couper(p.RaisonSociale, 150) ?? "?", Couper(p.NomCommercial, 150), Couper(p.Sigle, 30),
            p.ParentId, p.SocieteBase, p.Pays, p.Siren, Couper(p.Siret, 14), Couper(p.TvaIntra, 20), Couper(p.Naf, 6),
            Couper(p.FormeLibelle, 100), p.Capital, Couper(p.Rcs, 60), p.Actif, p.Commentaire))!;

    /// <summary>Coordonnée et son usage par une personne (vide : rien n'est écrit).</summary>
    public static async Task AjouterCoordonneeAsync(UniteEcriture u, long perId, CoordonneeReprise c, int ordre, string? auteur, CancellationToken ct)
    {
        if (c.Vide) return;
        var cooId = (long)(await SqlReprise.ScalaireAsync(u, """
            INSERT INTO coordonnee (coo_nature, coo_valeur, coo_ligne1, coo_ligne2, coo_ligne3, coo_code_postal, coo_ville, coo_pays,
                coo_modifie_par)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING coo_id
            """, ct, c.Nature, Couper(c.Valeur, 300), Couper(c.Ligne1, 150), Couper(c.Ligne2, 150), Couper(c.Ligne3, 150),
            Couper(c.CodePostal, 20), Couper(c.Ville, 100), c.Pays, Couper(auteur, 50)))!;
        await SqlReprise.ExecuterAsync(u, """
            INSERT INTO usage_coordonnee (uco_coo_id, uco_per_id, uco_usage, uco_libelle, uco_principal, uco_ordre)
            VALUES ($1, $2, $3, $4, $5, $6)
            """, ct, cooId, perId, c.Usage, Couper(c.Libelle, 100), c.Principal, ordre);
    }
}
