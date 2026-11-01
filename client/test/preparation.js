// Dictionnaire du programme (couches socle → modules → cœur, module Personnalisation) posé avant les tests.
import { composer } from '@logibtp/personnalisation';
import { initialiserDictionnaire } from '@logibtp/socle/dictionnaire';
import { COUCHES } from '../personnalisation/couches.js';

const { libelles, icones, emojis } = composer(COUCHES);
initialiserDictionnaire({ libelles, icones, emojis });
