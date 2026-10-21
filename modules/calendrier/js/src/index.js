// Module Calendrier LogiBTP : calendriers de travail (plages, cycles de semaines, périodes) et jours fermés (fériés par
// règles, fermetures), règles partagées avec le serveur (ReglesCalendrier.cs).
export {
  REGLES_FERME, JOURS_SEMAINE, CYCLE_MAX, HORIZON_JOURS, MESSAGES_CALENDRIER,
  numeroJour, depuisNumero, ajouterJours, jourSemaine, paques, datesRegle, joursFermes,
  semaineDuCycle, plagesDuJour, journee, journees, instant, ajouterMinutesTravail, minutesTravail, prochainTravail,
  controlerCalendrier, controlerRegle, lirePlages, ecrirePlages, duree,
} from './calendrier.js';
