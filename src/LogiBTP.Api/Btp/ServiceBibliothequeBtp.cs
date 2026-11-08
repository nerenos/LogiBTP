using LogiBTP.Bibliotheque.Web;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Bibliothèque du cœur : les éléments « à ne plus utiliser » (<c>ele_usage</c> = N, db/228) sont écartés des seules
/// recherches (composition, appel F3) ; la colonne appartient au cœur, elle est lue par sous-requête SQL.
/// Les éléments en sommeil (S) restent proposés ; la fiche et la lecture par identifiant ne sont pas touchées.
/// </summary>
public class ServiceBibliothequeBtp(BibliothequeDbContext db, SpecialisationBibliotheque specialisation)
    : ServiceBibliotheque(db, specialisation)
{
    protected override IQueryable<Element> FiltreChoix(IQueryable<Element> elements) =>
        elements.Where(e => !Db.Database.SqlQuery<long>($"SELECT ele_id AS \"Value\" FROM element WHERE ele_usage = 'N'").Contains(e.EleId));
}
