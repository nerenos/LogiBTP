using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Documents.Web;

/// <summary>
/// Périmètre unique des pièces valables (analyse du module Rentabilité, A5), jumeau de la vue <c>v_document_valable</c>
/// et de la fonction <c>f_document_valable</c> (module Document, script 019p) : pièce verrouillée, indice de référence,
/// pas remplacée (REMPLACE : version d'origine d'une pièce dévalidée, restée verrouillée). Une pièce annulée reste dans
/// le périmètre (compensée par son avoir d'annulation) sauf pour lire un état (commande en cours, précédents d'un
/// avancement, montant d'un marché) : <c>annulees = false</c>. Toute somme de pièces passe par ce périmètre, jamais par
/// <c>ent_verrouille</c> seul.
/// </summary>
public static class PerimetreDocuments
{
    /// <summary>Condition SQL sur une pièce d'alias <paramref name="alias"/> (pièces annulées écartées par défaut).</summary>
    public static string Sql(string alias = "d", bool annulees = false) =>
        $"f_document_valable({alias}.ent_id, {(annulees ? "TRUE" : "FALSE")})";

    /// <summary>Pièces valables d'une requête EF (pièces annulées écartées par défaut).</summary>
    public static IQueryable<TDoc> Valables<TDoc, TLigne>(this IQueryable<TDoc> documents, DocumentDbContext<TDoc, TLigne> db, bool annulees = false)
        where TDoc : Document, new()
        where TLigne : DocumentLigne, new() =>
        documents.Where(d => d.EntVerrouille && d.EntIsReference
            && db.StatutsDocument.Any(s => s.StdId == d.EntStdId && s.StdCode != StatutsDocument.Remplace
                && (annulees || s.StdCode != StatutsDocument.Annule)));

    /// <summary>Même règle sur des valeurs déjà lues.</summary>
    public static bool EstValable(bool verrouille, bool reference, string statut, bool annulees = false) =>
        verrouille && reference && statut != StatutsDocument.Remplace && (annulees || statut != StatutsDocument.Annule);
}
