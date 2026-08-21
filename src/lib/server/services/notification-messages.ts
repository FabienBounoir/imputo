import { formatDay, formatDayList } from '$lib/utils/date';

export type NotifKind =
	| 'EVENING_MISSING'
	| 'MORNING_YESTERDAY'
	| 'RAE_STALE'
	| 'WEEKLY_RECAP'
	| 'MOOD_DEADLINE'
	| 'MOOD_RECAP'
	| 'ABSENCE_PENDING'
	| 'ABSENCE_VALIDATED'
	| 'SUPPORT_DUTY';

/** Contexte attendu par les variantes de chaque type de notif. */
export type NotifCtx = {
	EVENING_MISSING: { missing: number; nothing: boolean };
	MORNING_YESTERDAY: { day: string; missing: number; nothing: boolean };
	RAE_STALE: { count: number; staleDays: number };
	WEEKLY_RECAP: { days: string[] };
	MOOD_DEADLINE: Record<string, never>;
	MOOD_RECAP: { avg: number; prevAvg: number; votes: number };
	ABSENCE_PENDING: { name: string; range: string };
	ABSENCE_VALIDATED: { range: string };
	SUPPORT_DUTY: { single: boolean; until: string };
};

/** « 0,5 j » — les capacités sont en décimales de journée, jamais en heures. */
const jours = (n: number) => `${String(Math.round(n * 100) / 100).replace('.', ',')} j`;
const plural = (n: number, s = 's') => (n > 1 ? s : '');
/** Élision devant un prénom : « d'Alice », « de Bob ». */
const de = (name: string) => (/^[aeiouyàâäéèêëîïôöûüh]/i.test(name) ? `d'${name}` : `de ${name}`);
const note = (n: number) => `${n.toFixed(1).replace('.', ',')}/5`;
const duree = (c: NotifCtx['SUPPORT_DUTY']) => (c.single ? "aujourd'hui" : `jusqu'au ${c.until}`);

type Variant<K extends NotifKind> = (c: NotifCtx[K]) => { title: string; body: string };

/**
 * Plusieurs formulations par type, pour que les rappels ne deviennent pas un bruit de fond
 * qu'on ne lit plus. Le tirage est déterministe (cf. `notifMessage`), pas aléatoire.
 */
const VARIANTS: { [K in NotifKind]: Variant<K>[] } = {
	EVENING_MISSING: [
		(c) => ({
			title: '⏰ Imputation du jour',
			body: c.nothing ? "Rien de saisi aujourd'hui." : `Il te manque ${jours(c.missing)} sur aujourd'hui.`
		}),
		(c) => ({
			title: '🌙 Avant de fermer',
			body: c.nothing
				? "Ta journée est encore vide, deux minutes suffisent."
				: `Ta journée n'est pas complète : ${jours(c.missing)} à imputer.`
		}),
		(c) => ({
			title: '📝 Journée pas bouclée',
			body: c.nothing ? "Aucune imputation aujourd'hui." : `Encore ${jours(c.missing)} à poser sur aujourd'hui.`
		}),
		(c) => ({
			title: '⌛ Pense à ton imputation',
			body: c.nothing
				? "Aujourd'hui n'a pas encore été renseigné."
				: `Aujourd'hui n'est pas complet (${jours(c.missing)}).`
		})
	],
	MORNING_YESTERDAY: [
		(c) => ({
			title: "☕ Imputation d'hier",
			body: c.nothing
				? `Le ${formatDay(c.day)} est resté vide.`
				: `Le ${formatDay(c.day)} est resté incomplet (${jours(c.missing)}).`
		}),
		(c) => ({
			title: '🔁 Un oubli hier ?',
			body: c.nothing
				? `Rien n'a été saisi le ${formatDay(c.day)}.`
				: `Il manque ${jours(c.missing)} sur le ${formatDay(c.day)}.`
		}),
		(c) => ({
			title: "⏪ Hier n'est pas bouclé",
			body: `Le ${formatDay(c.day)} attend encore ${c.nothing ? 'ton imputation' : jours(c.missing)}.`
		}),
		(c) => ({
			title: '📅 Rattrapage',
			body: `Deux minutes pour compléter le ${formatDay(c.day)}.`
		})
	],
	RAE_STALE: [
		(c) => ({
			title: '🎯 RAE à mettre à jour',
			body: `${c.count} ticket${plural(c.count)} n'${c.count > 1 ? 'ont' : 'a'} plus bougé depuis ${c.staleDays} jours.`
		}),
		(c) => ({
			title: '⏳ Tes RAE datent',
			body: `${c.count} ticket${plural(c.count)} attend${plural(c.count, 'ent')} une réestimation.`
		}),
		(c) => ({
			title: "🔄 Encore d'actualité ?",
			body: `${c.count} ticket${plural(c.count)} garde${plural(c.count, 'nt')} un RAE inchangé depuis ${c.staleDays} jours.`
		}),
		(c) => ({
			title: '📊 Point RAE',
			body: `${c.count} ticket${plural(c.count)} à réestimer avant la fin de semaine.`
		})
	],
	WEEKLY_RECAP: [
		(c) => ({
			title: '📅 Semaine à boucler',
			body: `${c.days.length} jour${plural(c.days.length)} incomplet${plural(c.days.length)} : ${formatDayList(c.days)}.`
		}),
		(c) => ({
			title: '🗓️ Avant le week-end',
			body: `Il reste ${c.days.length} jour${plural(c.days.length)} à compléter (${formatDayList(c.days)}).`
		}),
		(c) => ({
			title: "✅ Ta semaine n'est pas complète",
			body: `${formatDayList(c.days)} attend${plural(c.days.length, 'ent')} ton imputation.`
		}),
		(c) => ({
			title: '📋 Récap de la semaine',
			body: `${c.days.length} jour${plural(c.days.length)} encore ouvert${plural(c.days.length)} : ${formatDayList(c.days)}.`
		})
	],
	// Envoyées le dernier jour ouvré de la plage, qui n'est pas forcément son dernier jour
	// calendaire (lundi→dimanche relance le vendredi) : pas de « ferme ce soir » ici.
	MOOD_DEADLINE: [
		() => ({ title: '🗳️ Team mood : dernier rappel', body: 'Dernier jour ouvré pour donner ton humeur.' }),
		() => ({ title: '⏳ Dernier appel', body: "La plage se termine et tu n'as pas encore voté." }),
		() => ({ title: '😀 Ton humeur compte', body: "Il te reste aujourd'hui pour voter tranquillement." }),
		() => ({ title: '💬 Team mood', body: 'Dernière occasion de voter avant la clôture.' })
	],
	MOOD_RECAP: [
		(c) => ({
			title: '📉 Team mood en baisse',
			body: `${note(c.avg)} sur ${c.votes} vote${plural(c.votes)}, ${note(c.prevAvg)} sur la plage précédente.`
		}),
		(c) => ({
			title: "🌧️ L'humeur a baissé",
			body: `${note(c.avg)} cette plage (${note(c.prevAvg)} avant), sur ${c.votes} vote${plural(c.votes)}.`
		}),
		(c) => ({
			title: '👀 Signal Team mood',
			body: `-${(c.prevAvg - c.avg).toFixed(1).replace('.', ',')} point sur la dernière plage (${note(c.avg)}).`
		}),
		(c) => ({
			title: '⚠️ À regarder',
			body: `L'équipe est à ${note(c.avg)}, en recul de ${(c.prevAvg - c.avg).toFixed(1).replace('.', ',')}.`
		})
	],
	ABSENCE_PENDING: [
		(c) => ({ title: '🌴 Congé à valider', body: `${c.name} a posé un congé du ${c.range}.` }),
		(c) => ({ title: '📥 Demande de congé', body: `${c.name} attend ta validation pour le ${c.range}.` }),
		(c) => ({ title: '✋ Validation en attente', body: `Congé ${de(c.name)} : ${c.range}.` }),
		(c) => ({ title: '🏖️ Nouvelle demande', body: `${c.name} demande un congé du ${c.range}.` })
	],
	// Cadence DAY : la période tient sur la journée, « jusqu'au … » n'aurait pas de sens.
	SUPPORT_DUTY: [
		(c) => ({ title: '🎧 Support : c’est toi', body: `Tu prends le support ${duree(c)}.` }),
		(c) => ({ title: '📞 Ton tour de support', body: `Le support est sur toi ${duree(c)}.` }),
		(c) => ({ title: '🛎️ Tour de support', body: `Tu es la personne de support ${duree(c)}.` }),
		(c) => ({ title: '📣 Support', body: `C’est ton tour ${duree(c)}.` })
	],
	ABSENCE_VALIDATED: [
		(c) => ({ title: '✅ Congé validé', body: `Ton congé du ${c.range} est validé.` }),
		(c) => ({ title: '👍 C\'est validé', body: `Ton congé du ${c.range} a été accepté.` }),
		(c) => ({ title: '🎉 Bonne nouvelle', body: `Ton congé du ${c.range} est confirmé.` }),
		(c) => ({ title: '🌴 Congé accepté', body: `${c.range} : c'est bon, tu peux poser.` })
	]
};

/** Page ouverte au clic sur la notif. */
export const NOTIF_URL: Record<NotifKind, string> = {
	EVENING_MISSING: '/imputation',
	MORNING_YESTERDAY: '/imputation',
	RAE_STALE: '/tickets',
	WEEKLY_RECAP: '/imputation',
	MOOD_DEADLINE: '/mood',
	MOOD_RECAP: '/admin/mood',
	ABSENCE_PENDING: '/absences',
	ABSENCE_VALIDATED: '/absences',
	SUPPORT_DUTY: '/support'
};

// ponytail: hash FNV-ish sur la graine plutôt qu'un Math.random() — deux membres (ou deux jours)
// tombent sur des formulations différentes, mais les relances d'un même rappel (même graine, slot
// exclu) gardent leur texte au lieu d'en changer à chaque passage du cron.
const pick = <T>(arr: T[], seed: string): T =>
	arr[([...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0) % arr.length];

/**
 * Titre + corps de la notif. Le nom de l'espace passe en suffixe de titre : le corps reste entier
 * pour l'information utile, et un membre multi-espaces sait quand même d'où vient le rappel.
 */
export function notifMessage<K extends NotifKind>(
	kind: K,
	ctx: NotifCtx[K],
	seed: string,
	workspaceName: string
): { title: string; body: string } {
	const { title, body } = pick(VARIANTS[kind], seed)(ctx);
	return { title: `${title} · ${workspaceName}`, body };
}
