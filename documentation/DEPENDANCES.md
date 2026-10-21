# LogiBTP – dépendances par module

> Fichier généré par `npm run rapport-dependances` (`scripts/rapport-dependances.mjs`) : ne pas modifier à la main,
> relancer après tout ajout ou mise à jour d'une dépendance. Versions npm installées (`node_modules`), licences lues
> dans les paquets ; NuGet : licence du `.nuspec` du cache local (`?` si le paquet n'est pas restauré).

## socle

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | decimal.js | 10.6.0 | MIT | exécution (socle/js) |
| npm | immer | 10.2.0 | MIT | exécution (socle/js) |
| npm | vitest | 3.2.7 | MIT | développement (socle/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Socle.Tests |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Socle.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Socle.Tests |

## modules/annuaire

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/annuaire/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Annuaire.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Annuaire.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Annuaire.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Annuaire.Tests |

## modules/authentification

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/authentification/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Authentification.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Authentification.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Authentification.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Authentification.Tests |

## modules/bibliotheque

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/bibliotheque/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Bibliotheque.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Bibliotheque.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Bibliotheque.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Bibliotheque.Tests |

## modules/crm

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/crm/js) |
| NuGet | HtmlSanitizer | 9.2.1039 | MIT | LogiBTP.Crm.Web |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Crm.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Crm.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Crm.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Crm.Tests |

## modules/document

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/document/js) |
| NuGet | HtmlSanitizer | 9.2.1039 | MIT | LogiBTP.Documents.Web |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Documents.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Documents.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Documents.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Documents.Tests |

## modules/edition

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | @pdf-lib/fontkit | 1.1.1 | MIT | exécution (modules/edition/js) |
| npm | esbuild | 0.28.2 | MIT | développement (modules/edition/js) |
| npm | pdf-lib | 1.17.1 | MIT | exécution (modules/edition/js) |
| npm | qrcode-generator | 2.0.4 | MIT | exécution (modules/edition/js) |
| npm | vitest | 3.2.7 | MIT | développement (modules/edition/js) |
| NuGet | Jint | 4.17.0 | BSD-2-Clause | LogiBTP.Editions |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Editions.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Editions.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Editions.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Editions.Tests |
| police | modules/edition/js/polices/inter/Inter-Bold.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/inter/Inter-BoldItalic.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/inter/Inter-Italic.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/inter/Inter-Medium.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/inter/Inter-MediumItalic.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/inter/Inter-Regular.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/inter/Inter-SemiBold.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/inter/Inter-SemiBoldItalic.ttf | — | OFL-1.1 | OFL.txt |
| police | modules/edition/js/polices/libre-barcode-39/LibreBarcode39-Regular.ttf | — | OFL-1.1 | OFL.txt |

## modules/entreprises-fr

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/entreprises-fr/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.EntreprisesFr.Tests |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.EntreprisesFr.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.EntreprisesFr.Tests |

## modules/fiche

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/fiche/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Fiches.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Fiches.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Fiches.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Fiches.Tests |

## modules/ged

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | @kenjiuno/msgreader | 1.28.0 | Apache-2.0 | exécution (modules/ged/js) |
| npm | postal-mime | 2.7.6 | MIT-0 | exécution (modules/ged/js) |
| npm | vitest | 3.2.7 | MIT | développement (modules/ged/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Ged.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Ged.Web |
| NuGet | PdfPig | 0.1.16 | Apache-2.0 | LogiBTP.Ged.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Ged.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Ged.Tests |

## modules/graphe

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/graphe/js) |

## modules/import

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/import/js) |

## modules/liste

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/liste/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Listes.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Listes.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Listes.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Listes.Tests |

## modules/metre

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | @codemirror/autocomplete | 6.20.3 | MIT | exécution (modules/metre/js) |
| npm | @codemirror/commands | 6.11.1 | MIT | exécution (modules/metre/js) |
| npm | @codemirror/language | 6.13.1 | MIT | exécution (modules/metre/js) |
| npm | @codemirror/lint | 6.9.7 | MIT | exécution (modules/metre/js) |
| npm | @codemirror/state | 6.7.6 | MIT | exécution (modules/metre/js) |
| npm | @codemirror/view | 6.43.14 | MIT | exécution (modules/metre/js) |
| npm | @lezer/highlight | 1.2.5 | MIT | exécution (modules/metre/js) |
| npm | vitest | 3.2.7 | MIT | développement (modules/metre/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Metres.Tests |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Metres.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Metres.Tests |

## modules/navigation

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/navigation/js) |

## modules/reglement

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | vitest | 3.2.7 | MIT | développement (modules/reglement/js) |
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Reglements.Tests |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Reglements.Web |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Reglements.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Reglements.Tests |

## client

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| npm | @codemirror/commands | 6.11.1 | MIT | exécution (client) |
| npm | @codemirror/language | 6.13.1 | MIT | exécution (client) |
| npm | @codemirror/lint | 6.9.7 | MIT | exécution (client) |
| npm | @codemirror/state | 6.7.6 | MIT | exécution (client) |
| npm | @codemirror/view | 6.43.14 | MIT | exécution (client) |
| npm | @fontsource-variable/inter | 5.3.0 | OFL-1.1 | exécution (client) |
| npm | @lezer/highlight | 1.2.5 | MIT | exécution (client) |
| npm | vite | 7.3.7 | MIT | développement (client) |
| npm | vitest | 3.2.7 | MIT | développement (client) |

## cœur (src)

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| NuGet | EFCore.NamingConventions | 10.0.1 | Apache-2.0 | LogiBTP.Api |
| NuGet | Npgsql.EntityFrameworkCore.PostgreSQL | 10.0.3 | PostgreSQL | LogiBTP.Api |

## cœur (tests)

| Type | Dépendance | Version | Licence | Usage |
|---|---|---|---|---|
| NuGet | Microsoft.NET.Test.Sdk | 17.14.1 | MIT | LogiBTP.Calcul.Tests |
| NuGet | xunit | 2.9.3 | Apache-2.0 | LogiBTP.Calcul.Tests |
| NuGet | xunit.runner.visualstudio | 3.1.4 | Apache-2.0 | LogiBTP.Calcul.Tests |
