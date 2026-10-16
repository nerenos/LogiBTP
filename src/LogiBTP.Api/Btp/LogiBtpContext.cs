using LogiBTP.Documents.Web;
using LogiBTP.Domaine;
using LogiBTP.Metres;
using Microsoft.EntityFrameworkCore;

namespace LogiBTP.Api.Btp;

/// <summary>
/// Contexte EF Core du cœur : tables du module Document typées BTP (DocumentBtp, DocumentLigneBtp) et
/// tables du module Métré. Le schéma est géré par les scripts SQL (modules/*/db puis db/).
/// </summary>
public sealed class LogiBtpContext(DbContextOptions<LogiBtpContext> options) : DocumentDbContext<DocumentBtp, DocumentLigneBtp>(options)
{
    public DbSet<Metre> Metres => Set<Metre>();
    public DbSet<VariableDefinition> Variables => Set<VariableDefinition>();
    public DbSet<VentilationFrais> VentilationsFrais => Set<VentilationFrais>();
    public DbSet<VentilationFraisLigne> VentilationsFraisLignes => Set<VentilationFraisLigne>();

    protected override void ConfigurerComplements(ModelBuilder b)
    {
        b.Entity<Metre>().ToTable("metre").HasKey(x => x.MtrId);
        b.Entity<VariableDefinition>().ToTable("variable_definition").HasKey(x => x.VarId);
        b.Entity<VentilationFrais>().ToTable("ventilation_frais").HasKey(x => x.VfrId);
        b.Entity<VentilationFraisLigne>().ToTable("ventilation_frais_ligne").HasKey(x => x.VflId);
    }
}
