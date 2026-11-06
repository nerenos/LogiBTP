# Module Calendrier – contexte

## Rôle
- Calendriers de travail et jours fermés, communs au Planning et au Pointage ([Planning](../../documentation/conception/ANALYSE-MODULE-PLANNING.md) P12, P13, P22 ; [transverse](../../documentation/conception/ANALYSE-MODULES-TRANSVERSE.md) § 4.3) : plages horaires par jour, cycle de N semaines depuis une date de référence, plages datées (horaires d'été), jours fériés par règles (catalogue français à cocher), périodes de fermeture, temps de travail (fin d'un travail de N minutes, minutes travaillées entre deux instants, prochain instant travaillé).
- Ne connaît pas l'application : une fermeture propre à un élément (service…) a une portée (`jfe_type_element`, `jfe_id_element`) ; le cœur dit quel calendrier et quelles portées valent pour une ressource (`CalendriersBtp`).

## Dépendances
- JS `@logibtp/calendrier` : aucune. .NET : `LogiBTP.Calendrier` (règles), `LogiBTP.Calendrier.Web` → `LogiBTP.Socle.Web`, EF Core Npgsql. Jamais du cœur ni d'un autre module.
- Utilisé par : cœur (`SpecialisationCalendrierBtp` : utilisations ; `CalendriersBtp` : calendrier effectif d'un salarié ou d'un matériel ; `db/196` : calendrier des services, salariés, matériels ; page `/parametres/calendriers`). Les modules Planning et Pointage reçoivent les journées par leurs spécialisations.

## Structure
- `js/src/calendrier.js` ↔ `dotnet/LogiBTP.Calendrier/ReglesCalendrier.cs` : `paques` (Meeus / Jones / Butcher), `datesRegle` (DATE, ANNUEL — 29 février seulement les années bissextiles —, NIEME — rien si le 5e n'existe pas —, DERNIER, PAQUES + décalage, PERIODE limitée à l'année), `joursFermes` (règles actives, dates triées, libellés dans l'ordre des règles sans doublon), `semaineDuCycle` (semaines comptées depuis le lundi de la semaine de référence, modulo positif), `plagesDuJour` (plages datées couvrant la date prioritaires sur les permanentes du même jour), `journee` / `journees` (jour fermé : aucune plage), `ajouterMinutesTravail` (début hors plage : attend la suivante ; fin exacte de plage conservée ; 0 minute : le début ; `CALENDRIER_VIDE` au-delà de 3 660 jours), `minutesTravail`, `prochainTravail`, `controlerCalendrier` (CAL_CYCLE 1 à 8, CAL_REFERENCE, PLG_JOUR, PLG_SEMAINE, PLG_HEURES, PLG_PERIODE, PLG_CHEVAUCHEMENT — même semaine, jour et période), `controlerRegle` (FER_*), messages ; JS seul : `lirePlages` (« 8:00-12:00 13h30-17h », « 8-12 »), `ecrirePlages`, `duree` ; jeux `tests/cas/01_feries.json`, `02_travail.json`.
- Unités : dates « AAAA-MM-JJ », instants locaux « AAAA-MM-JJTHH:MM » (1440 = 24:00), durées en minutes entières ; jour ISO 1 lundi … 7 dimanche.
- `dotnet/LogiBTP.Calendrier.Web/ServiceCalendrier.cs` : entités (`CalendrierEntite`, `PlageEntite`, `JourFermeEntite`, `CalendrierDbContext`), `ServiceCalendrier` (`ListeAsync`, `ChargerAsync` — défaut sans identifiant —, `FermesAsync(calendrier, portées, du, au)`, `JourneesAsync` — 400 jours au plus —, `EnregistrerAsync` — un seul défaut, plages remplacées —, `SupprimerAsync` — ni défaut ni utilisé —, `JoursFermesAsync(portée)`, `EnregistrerJoursFermesAsync` — catalogue retiré = désactivé), `Portee` (« service:7 »), `SpecialisationCalendrier.UtilisationsAsync` ; `Extensions.cs` (`AddModuleCalendrier<T>`, `MapModuleCalendrier`).
- `db/006_calendrier.sql` (rejouable) : `calendrier` (un seul défaut), `calendrier_plage`, `jour_ferme` (catalogue : nationaux actifs, Alsace-Moselle et outre-mer inactifs ; portée nulle = société) ; calendriers STANDARD (39 h, défaut), BUREAU (35 h), ALTERNE_4X10 (cycle de 2 semaines).

## Routes HTTP (préfixe `/api/calendriers`)
- `GET /`, `POST /`, `PUT /{id}`, `DELETE /{id}` (écritures : administrateur) ; `GET /{id}/journees?du=&au=&portee=service:7,…` (0 = calendrier par défaut) ; `GET /jours-fermes?portee=` (sans : société), `PUT /jours-fermes` { type, id, regles }.

## Textes et icônes (module Personnalisation, lot P3p)
- Textes `calendrier.*` du `fr.json` du module (`regles` : `REGLES_FERME` par `textesParCode`, `jours` : `JOURS_SEMAINE`, `erreurs_regles` : `MESSAGES_CALENDRIER`, `{{max}}` du cycle) ; tests avec le dictionnaire (`test/preparation.js`). Page du cœur : `calendrier_btp.*`, icônes `calendrier_btp_*`.

## Tests
- `npm test --workspace modules/calendrier/js` ; `dotnet test modules/calendrier/dotnet/LogiBTP.Calendrier.Tests` (mêmes jeux).

## Repris du CLAUDE.md racine (à fusionner avec les sections ci-dessus)
- Module Calendrier (`modules/calendrier/CLAUDE.md`) : calendriers de travail (plages en minutes, cycle de N semaines depuis une référence, plages datées), jours fériés par règles (DATE, ANNUEL, NIEME, DERNIER, PAQUES, PERIODE ; catalogue français à cocher) et fermetures par portée (société, calendrier, `service:<id>`), temps de travail (`ajouterMinutesTravail`, `minutesTravail`, `prochainTravail`) répliqués entre `calendrier.js` et `ReglesCalendrier.cs` ; calendrier effectif d'une ressource par le cœur (salarié ou matériel, sinon service, sinon défaut : `CalendriersBtp`, `db/196`) ; page `/parametres/calendriers`.
