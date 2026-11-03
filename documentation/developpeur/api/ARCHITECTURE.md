# Architecture API (Backend .NET)

> **Stack :** .NET 8, ASP.NET Core, EF Core 10, PostgreSQL 17 (Npgsql)
> **Pattern :** Classes mères (modules) → Spécialisation (cœur) via Template Method
> **Multi-sociétés :** Une base par sous-domaine, résolution via Host header

---

## 🏗️ Structure du projet `src/`

```
src/
├── LogiBTP.Api/                 # Point d'entrée API (Program.cs, Controllers, Middlewares)
│   ├── Program.cs               # Bootstrap, DI, Middleware pipeline, MapModule...
│   ├── appsettings.json         # Config : Societes, Connexion, Modules, Mail, OAuth...
│   ├── appsettings.Development.json
│   ├── Btp/                     # Spécialisations cœur (Btp/*)
│   │   ├── SpecialisationBtp.cs          # Cœur : métré, variables, écarts, documents
│   │   ├── SpecialisationFicheBtp.cs     # Fiches salarié/matériel/structure
│   │   ├── SpecialisationListeBtp.cs     # Listes, vues, saisie, filtres
│   │   ├── SpecialisationGedBtp.cs       # GED, catégories, versions, coffre
│   │   ├── SpecialisationBibliothequeBtp.cs # Bibliothèque, prix, unités, tarifs
│   │   ├── SpecialisationDocumentBtp.cs  # Document (héritage module Document)
│   │   ├── SpecialisationAuthentificationBtp.cs
│   │   ├── SpecialisationDroitsBtp.cs
│   │   ├── SpecialisationMailBtp.cs
│   │   ├── SpecialisationOAuthBtp.cs
│   │   ├── SpecialisationCrmBtp.cs
│   │   ├── SpecialisationExecutionBtp.cs
│   │   ├── SpecialisationPointageBtp.cs
│   │   ├── SpecialisationPlanningBtp.cs
│   │   ├── SpecialisationReglementBtp.cs
│   │   ├── SpecialisationEditionBtp.cs
│   │   ├── SpecialisationCalendrierBtp.cs
│   │   ├── SpecialisationStockBtp.cs
│   │   ├── SpecialisationComptabiliteBtp.cs
│   │   ├── SpecialisationSousTraitanceBtp.cs
│   │   ├── LogiBtpContext.cs             # DbContext principal (EF Core)
│   │   ├── DocumentBtp.cs                # Entité Document + colonnes BTP
│   │   ├── DocumentLigneBtp.cs           # Entité DocumentLigne + colonnes BTP
│   │   ├── DocumentCompletBtp.cs         # Document avec lignes + totaux + TVA
│   │   ├── MoteurDevisBtp.cs             # Moteur calcul (parité JS)
│   │   ├── ComparateurBtp.cs             # Comparaison client/serveur
│   │   └── [autres services Btp/*]
│   ├── Properties/
│   │   └── launchSettings.json
│   └── CleConstruction.targets
├── LogiBTP.Domaine/             # Entités cœur (DocumentBtp, DocumentLigneBtp, Codes, Geographie, VentilationFrais)
│   ├── Ressources/              # Règles ressources (habilitations, missions, équipes, affectations, compteurs, entretiens)
│   └── LogiBTP.Domaine.csproj
├── LogiBTP.Calcul/              # Moteur de calcul pur (MoteurDevisBtp, Modeles, FonctionsBtp)
│   └── LogiBTP.Calcul.csproj
└── LogiBTP.slnx                 # Solution file
```

---

## ⚙️ Bootstrap (`Program.cs`)

### Pipeline middleware (ordre critique)

```csharp
// src/LogiBTP.Api/Program.cs (simplifié)
var builder = WebApplication.CreateBuilder(args);

// 1. Configuration & Services de base
builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.PropertyNamingPolicy = null); // PascalCase

// 2. EF Core + PostgreSQL (une DbContext par société via AddSocietes)
builder.Services.AddSocietes(builder.Configuration); // Résolution sous-domaine → connection string

// 3. Modules : AddModule<Module>() + MapModule<Module>()
builder.Services.AddModuleDocument();
builder.Services.AddModuleMetre();
builder.Services.AddModuleListe();
builder.Services.AddModuleFiche();
builder.Services.AddModuleGed();
builder.Services.AddModuleBibliotheque();
builder.Services.AddModuleAnnuaire();
// ... modules facultatifs selon module_societe

// 4. Cœur : Spécialisations BTP
builder.Services.AddScoped<SpecialisationBtp>();
builder.Services.AddScoped<SpecialisationFicheBtp>();
builder.Services.AddScoped<SpecialisationListeBtp>();
// ...

// 5. Authentification / Session (en-têtes X-Utilisateur, X-Profil, X-Groupe)
builder.Services.AddAuthentificationSession(); // UseAuthentificationSession après UseSocietes

// 6. Droits (IDroits du socle)
builder.Services.AddDroits();

// 7. Notifications, Mail, OAuth, etc.
builder.Services.AddNotifications();
builder.Services.AddMail();
builder.Services.AddOAuth();

// 8. Swagger (dev)
if (builder.Environment.IsDevelopment()) {
    builder.Services.AddEndpointsApiExplorer();
    builder.Services.AddSwaggerGen();
}

var app = builder.Build();

// Pipeline HTTP
if (app.Environment.IsDevelopment()) {
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

// 9. Résolution société (sous-domaine) → DOIT être avant UseAuthentificationSession
app.UseSocietes(); // Ajoute ITenantInfo au HttpContext

// 10. Session utilisateur (pose Utilisateur.Poser → Utilisateur.Depuis du socle)
app.UseAuthentificationSession();

// 11. Droits (catalogue nœuds, table routes)
app.UseDroits();

// 12. Controllers / MapModule
app.MapControllers();
app.MapModuleDocument();     // /api/documents, /api/documents/{id}/lignes, etc.
app.MapModuleListe();        // /api/listes
app.MapModuleFiche();        // /api/fiches/{type}/{id}
app.MapModuleGed();          // /api/ged
app.MapModuleBibliotheque(); // /api/bibliotheque
// ...

app.Run();
```

---

## 🗄️ Entity Framework Core (`LogiBtpContext`)

### Configuration

```csharp
// Btp/LogiBtpContext.cs
public class LogiBtpContext : DbContext
{
    public LogiBtpContext(DbContextOptions<LogiBtpContext> options, ITenantInfo tenant)
        : base(options)
    {
        Tenant = tenant; // Société courante (schéma = public, base = logibtp ou logibtp_demo)
    }

    public ITenantInfo Tenant { get; }

    // Tables modules (Document, Métré, Liste, Fiche, GED, Bibliothèque, Annuaire...)
    public DbSet<Document> Documents { get; set; }
    public DbSet<DocumentLigne> DocumentLignes { get; set; }
    public DbSet<Metre> Metres { get; set; }
    public DbSet<Variable> Variables { get; set; }
    public DbSet<SourceListe> SourcesListe { get; set; }
    public DbSet<VueListe> VuesListe { get; set; }
    public DbSet<TypeFiche> TypesFiche { get; set; }
    public DbSet<GedElement> GedElements { get; set; }
    public DbSet<Element> Elements { get; set; }
    public DbSet<Personne> Personnes { get; set; }
    // ... tables cœur BTP
    public DbSet<DocumentBtp> DocumentsBtp { get; set; } // Vue ou table étendue
    public DbSet<DocumentLigneBtp> DocumentLignesBtp { get; set; }
    public DbSet<Projet> Projets { get; set; }
    public DbSet<Chantier> Chantiers { get; set; }
    public DbSet<Marche> Marches { get; set; }
    // ...

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Configuration entités modules (via IEntityTypeConfiguration)
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LogiBtpContext).Assembly);
        
        // Colonnes BTP : ALTER TABLE sur tables modules (pas de migration EF pour le cœur)
        // Voir db/100_btp.sql, 110_reference.sql, etc.
        
        // Filtres globaux (ex: usage = 'A' pour fiches actives)
        modelBuilder.Entity<Salarie>().HasQueryFilter(s => s.Usage == "A");
        modelBuilder.Entity<Materiel>().HasQueryFilter(m => m.Usage == "A");
    }
}
```

### Pas de migrations EF pour le cœur BTP

> **Important :** Le cœur ajoute ses colonnes via scripts SQL `ALTER TABLE` (`db/100_btp.sql`, `110_reference.sql`...), **pas** via migrations EF. Les migrations EF ne gèrent que les tables des modules.

```bash
# Créer une migration pour un module (ex: nouveau module)
dotnet ef migrations add NomMigration --project src/LogiBTP.Api --context LogiBtpContext --output-dir Migrations/ModuleNom

# Appliquer migrations (dev)
dotnet ef database update --project src/LogiBTP.Api --context LogiBtpContext
```

---

## 🔐 Multi-sociétés (Sous-domaines)

### Configuration (`appsettings.json`)

```json
{
  "Societes": {
    "BaseDomain": "logibtp.fr",
    "Default": {
      "Nom": "Principale",
      "ConnectionString": "Host=postgres;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp"
    },
    "Societes": {
      "demo": {
        "Nom": "Démo",
        "ConnectionString": "Host=postgres;Port=5433;Database=logibtp_demo;Username=logibtp;Password=logibtp"
      }
    }
  }
}
```

### Résolution au runtime

```csharp
// Socle : LogiBTP.Socle.Web.AddSocietes
public static IServiceCollection AddSocietes(this IServiceCollection services, IConfiguration config)
{
    return services
        .AddSingleton<ISocieteResolver, SocieteResolver>()
        .AddScoped<ITenantInfo>(sp => sp.GetRequiredService<ISocieteResolver>().Resoudre())
        .AddDbContext<LogiBtpContext>((sp, options) => {
            var tenant = sp.GetRequiredService<ITenantInfo>();
            options.UseNpgsql(tenant.ConnectionString, o => o.MigrationsHistoryTable("__EFMigrationsHistory", tenant.Schema));
        });
}

// Middleware UseSocietes : résout depuis Host header
public class SocieteMiddleware
{
    public async Task InvokeAsync(HttpContext context, ISocieteResolver resolver)
    {
        var host = context.Request.Host.Host;
        var societe = resolver.ResoudreParHost(host); // ex: "demo" depuis "demo.localhost:5173"
        context.Features.Set(societe);
        await _next(context);
    }
}
```

### Isolation des données

| Ressource | Isolation |
|-----------|-----------|
| **Base de données** | Base PostgreSQL séparée par société (`logibtp`, `logibtp_demo`) |
| **Stockage GED** | Répertoire par société : `stockage-ged/logibtp`, `stockage-ged/logibtp_demo` |
| **Cache / Session** | Via `ITenantInfo` dans `HttpContext` |

---

## 🔐 Authentification & Session

### En-têtes d'authentification (développement)

```http
X-Utilisateur: 123          # Individu ID (ind_id)
X-Profil: SAISIE            # Profil : ADMIN, SAISIE, MOBILE, SUPERVISEUR_CRM, etc.
X-Groupe: 1                 # Groupe (optionnel)
```

### Middleware session (`UseAuthentificationSession`)

```csharp
// Pose l'utilisateur courant dans le socle (Utilisateur.Poser)
app.Use(async (context, next) => {
    var utilisateurId = context.Request.Headers["X-Utilisateur"].FirstOrDefault();
    var profil = context.Request.Headers["X-Profil"].FirstOrDefault();
    
    if (int.TryParse(utilisateurId, out var id)) {
        Utilisateur.Poser(new UtilisateurContext {
            IndividuId = id,
            Profil = Enum.Parse<Profil>(profil ?? "MOBILE"),
            SocieteId = context.GetTenantInfo()?.SocieteId
        });
    }
    await next();
});
```

### Routes publiques (sans session)

- `/api/sante` — Health check
- `/api/societe` — Infos société courante
- `/api/auth/*` — Connexion, inscription, mot de passe oublié

---

## 🛡️ Droits (`IDroits`, `SpecialisationDroitsBtp`)

### Catalogue des nœuds de droits

| Nœud | Description |
|------|-------------|
| `documents/{famille}/{code}` | Consultation type document (ex: `documents/V/DEVIS`) |
| `documents/{famille}/*` | Consultation tous types d'une famille |
| `fiches/{type}` | Fiche : VOIR, MODIFIER, DEBLOQUER, CONFIDENTIEL |
| `crm` | SUPERVISER, RGPD |
| `administration/*` | Paramètres, utilisateurs, modules |

### Vérification côté serveur

```csharp
// Dans un controller ou service
if (!Droits.Peut(utilisateur, "MODIFIER", "document", "V_DEVIS")) {
    throw new AccesRefuseException("Droit MODIFIER requis sur V_DEVIS");
}

// Ou via spécialisation
if (!specialisationDroits.PeutModifierDocument(document)) {
    return Forbid();
}
```

### Côté client

```javascript
// Dans Application (app.acces / app.peut)
app.peut('MODIFIER', 'document', 'V_DEVIS')  // true/false
app.acces('documents/V/DEVIS')                // 'VOIR' | 'MODIFIER' | 'APPROUVER' | null
```

---

## 📦 Injection de dépendances (Scopes)

| Scope | Services typiques |
|-------|-------------------|
| **Singleton** | Configuration, `ISocieteResolver`, `IDroitsCatalogue`, `IModulesActifs` |
| **Scoped** (par requête) | `LogiBtpContext`, `SpecialisationBtp`, `SpecialisationFicheBtp`, `UtilisateurContext`, `ITenantInfo` |
| **Transient** | Controllers, Validateurs, Helpers calcul |

---

## 🔗 Liens vers autres docs

| Concept | Documentation |
|---------|---------------|
| Spécialisations modules | [SPECIALISATIONS.md](SPECIALISATIONS.md) |
| Domaine & Calcul | [DOMAINE_CALCUL.md](DOMAINE_CALCUL.md) |
| Auth & Droits détaillés | [AUTH_DROITS.md](AUTH_DROITS.md) |
| Multi-sociétés | [MULTI_SOCIETES.md](MULTI_SOCIETES.md) |
| Routes API | [ROUTES_API.md](ROUTES_API.md) |
| Modules transverses | [MODULES_TRANSVERS.md](MODULES_TRANSVERS.md) |
| Tests API | [TESTS.md](TESTS.md) |
| Guide développement API | [GUIDE_DEVELOPPEMENT.md](GUIDE_DEVELOPPEMENT.md) |
| Client Architecture | [client/ARCHITECTURE.md](../client/ARCHITECTURE.md) |
| BDD Scripts | [bdd/SCRIPTS_ORDRE.md](../bdd/SCRIPTS_ORDRE.md) |