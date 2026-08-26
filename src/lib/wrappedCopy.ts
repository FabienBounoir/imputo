/**
 * Textes des écrans du Wrapped, choisis par palier plutôt que par valeur brute.
 *
 * Jusqu'ici chaque écran avait UNE phrase, quelle que soit la donnée : « 2 jours d'affilée » et
 * « 200 jours d'affilée » recevaient la même vanne, et une année à 1,8/5 d'humeur était présentée
 * exactement comme une année à 4,7. Écrire une phrase par chiffre serait intenable, d'où les
 * paliers : quelques seuils par écran, la dernière entrée atteinte gagne.
 *
 * Le ton s'assagit quand les chiffres baissent. Féliciter une petite série avec la formule prévue
 * pour une grosse sonne creux ; sur l'humeur, ce serait carrément à côté de la plaque.
 *
 * Les phrases ici sont des compléments : la partie factuelle (avec le <mark>) reste dans le markup,
 * seul le commentaire varie. Ça évite d'avoir à réinjecter du HTML depuis une chaîne.
 */

/** Sous-ensemble de WrappedPayload réellement utilisé — évite d'importer un type de $lib/server. */
export type WrappedCopyInput = {
	totalHours: number;
	productivePct: number;
	topTicket: { hours: number } | null;
	streakDays: number;
	moodAvg: number | null;
	supportCount: number;
	duo: { ticketsInCommon: number } | null;
};

export type WrappedCopy = {
	ticket: string;
	streak: string;
	mood: string;
	support: string;
	volumeTitle: string;
	volumeSub: string;
	duo: string;
};

/**
 * Dernière entrée dont le seuil est atteint. `steps` doit être trié par seuil croissant, et sa
 * première entrée sert de plancher (elle couvre tout ce qui passe en dessous, valeurs négatives
 * comprises — un compteur ne devrait jamais l'être, mais un palier qui rend `undefined` casserait
 * la phrase à l'écran plutôt que de la rendre bancale).
 */
export function tier(value: number, steps: [number, string][]): string {
	let out = steps[0][1];
	for (const [min, text] of steps) if (value >= min) out = text;
	return out;
}

/**
 * Accord en nombre. En français le singulier couvre 0 ET 1 (« 0 jour », « 1 jour »), d'où le seuil
 * à 2 et non à 1. Les écrans affichent des compteurs qui peuvent légitimement valoir 1 — une série
 * d'un seul jour, un seul ticket en commun — et « 1 jours d'affilée » saute aux yeux.
 */
export function plural(n: number, one: string, many: string): string {
	return Math.abs(n) < 2 ? one : many;
}

export function wrappedCopy(w: WrappedCopyInput, year: number): WrappedCopy {
	return {
		ticket: tier(w.topTicket?.hours ?? 0, [
			[0, "Une paille — il ne t'a pas retenu bien longtemps."],
			[5, "Rien de dramatique, il t'a laissé respirer."],
			[15, 'De quoi le connaître par cœur.'],
			[40, 'Vous avez passé un cap ensemble.'],
			[100, 'Il te le doit bien.'],
			[250, 'À ce stade, tu devrais figurer dans ses contributeurs.']
		]),
		streak: tier(w.streakDays, [
			[0, 'Tout commence quelque part.'],
			[3, 'Le pli est presque pris.'],
			[5, 'Une vraie petite série.'],
			[10, 'Ça devient une habitude.'],
			[20, "Ton passé de retardataire commence à s'éloigner."],
			[50, 'Ton passé de retardataire ne te rattrapera plus.'],
			[100, "À ce niveau-là, ce n'est plus de la rigueur, c'est un réflexe."]
		]),
		// Le seul écran où la vanne est déplacée : une mauvaise année se constate, elle ne se
		// commente pas. Le ton ne redevient enjoué qu'en haut de barème.
		mood: tier(w.moodAvg ?? 0, [
			[0, 'Une année qui a pesé.'],
			[2.5, 'Une année en dents de scie.'],
			[3, 'Une année correcte, sans plus.'],
			[3.5, 'Plutôt une bonne année.'],
			[4, "Une année qui t'a réussi."],
			[4.5, "Une année comme on en souhaite à tout le monde."]
		]),
		support: tier(w.supportCount, [
			// « … pour l'équipe. » précède : on reprend par un pronom, sinon on la nomme deux fois de suite.
			[0, "Elle s'en souvient."],
			[3, 'Elle te doit bien un café.'],
			[6, 'Elle te doit bien plusieurs cafés.'],
			[12, "À ce rythme, la permanence, c'est toi."]
		]),
		volumeTitle: tier(w.totalHours, [
			[0, `${year}, à petites touches.`],
			[50, `${year}, sans forcer.`],
			[200, `On a tenu le rythme en ${year}.`],
			[600, `${year} n'a pas chômé.`],
			[1200, `${year}, à plein régime.`]
		]),
		volumeSub: tier(w.productivePct, [
			[0, 'Heures imputées, réunions, et tout le reste'],
			[40, 'Heures imputées, jours ouvrés, café bu'],
			[70, 'Heures imputées, et surtout du temps utile'],
			[85, 'Heures imputées, presque que du concret']
		]),
		duo: tier(w.duo?.ticketsInCommon ?? 0, [
			[0, 'Un début de duo.'],
			[3, 'Vous vous croisez souvent.'],
			[6, 'Ton duo le plus régulier.'],
			[15, 'Ton duo le plus productif.'],
			// La phrase du markup finit par « … cette année. » : éviter de reprendre « année » derrière.
			[30, 'Une bonne partie du boulot est passée par vous deux.']
		])
	};
}
