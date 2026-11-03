# Multi-sociétés (API)

> **Principe :** Une base PostgreSQL par société, résolue via sous-domaine (Host header)
> **Scripts :** `db/193_modules_services.sql` (activation modules), `appsettings.json` (connexion)

---

## 🏢 Architecture multi-sociétés

### Résolution par sous-domaine

| Environnement | Société principale | Société démo |
|---------------|-------------------|--------------|
| **Dev** | `localhost:5173` → base `logibtp` | `demo.localhost:5173` → base `logibtp_demo` |
| **Prod** | `acme.logibtp.fr` → base `logibtp_acme` | `demo.logibtp.fr` → base `logibtp_demo` |

### Configuration (`appsettings.json`)

```json
{
  "Societes": {
    "BaseDomain": "logibtp.fr",
    "Default": {
      "Nom": "Principale",
      "ConnectionString": "Host=postgres;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp",
      "Schema": "public",
      "GedRepertoire": "stockage-ged/logibtp"
    },
    "Societes": {
      "demo": {
        "Nom": "Démo",
        "ConnectionString": "Host=postgres;Port=5433;Database=logibtp_demo;Username=logibtp;Password=logibtp",
        "Schema": "public",
        "GedRepertoire": "stockage-ged/logibtp_demo"
      }
    }
  }
}
```

### Résolution au runtime

```csharp
// LogiBTP.Socle.Web.AddSocietes()
public class SocieteResolver : ISocieteResolver
{
    private readonly SocietesOptions _options;
    
    public SocieteInfo ResoudreParHost(string host)
    {
        // 1. Extraire sous-domaine
        var sousDomaine = ExtraireSousDomaine(host, _options.BaseDomain);
        
        // 2. Chercher dans config
        if (!string.IsNullOrEmpty(sousDomaine) && 
            _options.Societes.TryGetValue(sousDomaine, out var config))
        {
            return new SocieteInfo
            {
                Code = sousDomaine,
                Nom = config.Nom,
                ConnectionString = config.ConnectionString,
                Schema = config.Schema,
                GedRepertoire = config.GedRepertoire
            };
        }
        
        // 3. Société par défaut
        return new SocieteInfo
        {
            Code = "default",
            Nom = _options.Default.Nom,
            ConnectionString = _options.Default.ConnectionString,
            Schema = _options.Default.Schema,
            GedRepertoire = _options.Default.GedRepertoire
        };
    }

    private string ExtraireSousDomaine(string host, string baseDomain)
    {
        if (host.EndsWith("." + baseDomain))
            return host[..^("." + baseDomain).Length];
        if (host == "localhost" || host.StartsWith("localhost:"))
            return null; // Société principale en dev
        if (host.StartsWith("demo."))
            return "demo"; // Cas spécial dev
        return null;
    }
}

// ITenantInfo injecté dans LogiBtpContext
public interface ITenantInfo
{
    string SocieteCode { get; }
    string ConnectionString { get; }
    string Schema { get; }
    string GedRepertoire { get; }
}
```

### Middleware pipeline (ordre critique)

```csharp
// Program.cs
app.UseSocietes();           // 1. Résout ITenantInfo depuis Host → HttpContext.Features
app.UseAuthentificationSession(); // 2. Pose Utilisateur (dépend de ITenantInfo pour base)
app.UseDroits();             // 3. Droits (dépend Utilisateur + ITenantInfo)
```

---

## 🗄️ Isolation des données

| Ressource | Isolation | Détail |
|-----------|-----------|--------|
| **Base PostgreSQL** | **Base séparée** | `logibtp`, `logibtp_demo`, `logibtp_acme`... |
| **Stockage GED** | **Répertoire séparé** | `stockage-ged/logibtp`, `stockage-ged/logibtp_demo` |
| **Migrations EF** | Par base | `__EFMigrationsHistory` dans chaque base |
| **Scripts SQL** | Appliqués sur chaque base | Via `installation/scripts.txt` sur chaques base |
| **Cache / Session** | Via `ITenantInfo` | `IDistributedCache` préfixé par société |

### DbContext par société

```csharp
// LogiBtpContext reçoit ITenantInfo scoped
public class LogiBtpContext : DbContext
{
    public LogiBtpContext(DbContextOptions<LogiBtpContext> options, ITenantInfo tenant)
        : base(options)
    {
        Tenant = tenant;
    }

    public ITenantInfo Tenant { get; }
    
    // Les requêtes EF filtrent automatiquement via la connexion
    // Pas de filtre global "SocieteId" nécessaire (bases séparées)
}

// Configuration DI
services.AddDbContext<LogiBtpContext>((sp, options) => {
    var tenant = sp.GetRequiredService<ITenantInfo>();
    options.UseNpgsql(tenant.ConnectionString, o => 
        o.MigrationsHistoryTable("__EFMigrationsHistory", tenant.Schema));
}, ServiceLifetime.Scoped);
```

---

## ⚙️ Activation modules par société (`module_societe`)

### Table `module_societe` (script `193_modules_services.sql`)

```sql
-- Colonnes
CREATE TABLE module_societe (
    mso_module_code VARCHAR(50) PRIMARY KEY, -- 'reglement', 'crm', 'execution', etc.
    mso_actif BOOLEAN NOT NULL DEFAULT FALSE,
    mso_configuration JSONB -- config spécifique au module pour cette société
);

-- Modules facultatifs
INSERT INTO module_societe (mso_module_code, mso_actif) VALUES
('reglement', false),
('crm', false),
('execution', false),
('pointage', false),
('planning', false),
('stock', false),
('comptabilite', false),
('sous_traitance', false);
```

### Vérification côté serveur

```csharp
// IModulesActifs du socle
public interface IModulesActifs
{
    bool EstActif(string moduleCode);
    void ExigerModule(string moduleCode); // Throw si inactif
}

// Implémentation BTP
public class ModulesSociete : IModulesActifs
{
    private readonly HashSet<string> _actifs;
    
    public ModulesSociete(LogiBtpContext context)
    {
        _actifs = context.ModuleSocietes
            .Where(m => m.MsoActif)
            .Select(m => m.MsoModuleCode)
            .ToHashSet();
    }
    
    public bool EstActif(string moduleCode) => _actifs.Contains(moduleCode);
    
    public void ExigerModule(string moduleCode)
    {
        if (!_actifs.Contains(moduleCode))
            throw new ModuleInactifException(moduleCode);
    }
}

// Utilisation dans controllers
[HttpGet("planning")]
public IActionResult GetPlanning()
{
    _modulesActifs.ExigerModule("planning"); // 404 si inactif
    // ...
}
```

### Vérification côté client

```javascript
// client/src/app/application.js
this.moduleActif = (code) => this.modulesActifs?.[code] === true;

// Dans une page
if (!app.moduleActif('planning')) {
  return app.naviguer('/introuvable'); // ou afficher message
}

// Chargement conditionnel module JS
if (app.moduleActif('planning')) {
  const { VuePlanningBtp } = await import('@logibtp/planning');
}
```

---

## 🔧 Développement & Tests multi-sociétés

### Lancer les deux bases en dev

```bash
# docker-compose.yml monte le volume et applique scripts.txt sur les DEUX bases
docker compose up -d

# Vérifier
docker compose exec postgres psql -U logibtp -d logibtp -c "SELECT current_database();"
docker compose exec postgres psql -U logibtp -d logibtp_demo -c "SELECT current_database();"
```

### Appliquer un script sur les deux bases

```bash
# Depuis la racine du repo
for db in logibtp logibtp_demo; do
  docker compose exec -T postgres psql -U logibtp -d $db -v ON_ERROR_STOP=1 < db/160_structure.sql
done
```

### Tests d'intégration (xUnit)

```csharp
// Tests utilisent LOGIBTP_TEST_PG pour la connexion
// Variable d'env : Host=localhost;Port=5433;Database=logibtp;Username=logibtp;Password=logibtp

// Pour tester société démo : changer Database=logibtp_demo
[Fact]
public async Task TestSocieteDemo()
{
    var connectionString = "Host=localhost;Port=5433;Database=logibtp_demo;Username=logibtp;Password=logibtp";
    using var context = CreateContext(connectionString);
    // ...
}
```

---

## 📦 Installation production

### Nouvel client (nouvelle société)

```bash
# 1. Créer base PostgreSQL
createdb -h serveur-pg -U postgres logibtp_client1

# 2. Appliquer TOUS les scripts (manifeste installation/scripts.txt)
for f in modules/*/db/*.sql db/*.sql; do
  psql -h serveur-pg -U logibtp -d logibtp_client1 -v ON_ERROR_STOP=1 < $f
done

# 3. Ajouter dans appsettings.json (section Societes.Societes)
# 4. Redémarrer API
# 5. Configurer DNS : client1.logibtp.fr → IP serveur
```

### Rôles PostgreSQL (script `installation/roles.sql`)

```sql
-- Exécuté par l'installeur avec superutilisateur
CREATE ROLE logibtp_schema NOINHERIT;  -- Propriétaire schéma (migrations, scripts)
CREATE ROLE logibtp_app NOINHERIT;     -- API : données seulement, PAS de DDL
CREATE ROLE logibtp_lecture NOINHERIT; -- Lecture seule

-- Restriction coffre GED : logibtp_app sans UPDATE/DELETE/TRUNCATE sur ged_*
-- pg_hba.conf : restriction par IP
```

---

## 🔗 Liens vers autres docs

| Concept | Documentation |
|---------|---------------|
| Architecture API | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Auth & Droits | [AUTH_DROITS.md](AUTH_DROITS.md) |
| Routes API | [ROUTES_API.md](ROUTES_API.md) |
| Client Navigation | [client/NAVIGATION.md](../client/NAVIGATION.md#multi-sociétés--navigation) |
| BDD Scripts | [bdd/SCRIPTS_ORDRE.md](../bdd/SCRIPTS_ORDRE.md) |
| Installation | [bdd/INSTALLATION_MAJ.md](../bdd/INSTALLATION_MAJ.md) |
| Guide dev API | [GUIDE_DEVELOPPEMENT.md](GUIDE_DEVELOPPEMENT.md) |