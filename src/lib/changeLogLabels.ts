// Libellés lisibles pour l'historique des modifications (changeLog) — partagés entre la modal
// ticket (TicketHistory) et la page admin globale.
import { ABSENCE_TYPE_LABELS, ABSENCE_PERIOD_LABELS } from './absenceTypes';

const FIELD_LABELS: Record<string, Record<string, string>> = {
	TICKET: {
		estimationReal: 'Est. Réal',
		estimationTest: 'Est. Test',
		raeReal: 'RAE Réal',
		raeTest: 'RAE Test',
		estimationPrev: 'Estimation prévisionnel',
		enveloppeTotale: 'Enveloppe totale',
		// Par activité (ticket_activity_rae) — raeReal/raeTest y reprennent les libellés ci-dessus.
		estimation: 'Estimé',
		budget: 'Budget',
		stateId: 'État',
		sprintId: 'Sprint',
		versionId: 'Version',
		sspId: 'Code SSP',
		assigneeId: 'Assigné à',
		priority: 'Priorité',
		key: 'Clé'
	},
	ABSENCE: {
		startDate: 'Date de début',
		endDate: 'Date de fin',
		type: 'Type',
		period: 'Durée'
	},
	MEMBER: {
		role: 'Rôle',
		active: 'Statut',
		owner: "Propriétaire de l'espace",
		canViewImputations: "Accès : imputations de l'équipe",
		canViewMoodResults: 'Accès : résultats Team mood'
	},
	WORKSPACE: {
		jiraPat: 'Token Jira',
		jiraJql: 'Filtre JQL Jira',
		jiraConflictStrategy: 'Stratégie de sync Jira'
	}
};

const YES_NO = { true: 'Oui', false: 'Non' };

// Valeurs stockées brutes (enums, booléens) → libellé. Les références (état, sprint, assigné…) sont
// déjà écrites en libellé au moment du changement, cf. trackedValue (tickets.ts).
const VALUE_LABELS: Record<string, Record<string, string>> = {
	'ABSENCE.type': ABSENCE_TYPE_LABELS,
	'ABSENCE.period': ABSENCE_PERIOD_LABELS,
	'MEMBER.role': { USER: 'Membre', MANAGER: 'Manager', ADMIN: 'Admin' },
	'MEMBER.active': { true: 'Actif', false: 'Désactivé' },
	'MEMBER.owner': YES_NO,
	'MEMBER.canViewImputations': YES_NO,
	'MEMBER.canViewMoodResults': YES_NO,
	'WORKSPACE.jiraConflictStrategy': { KEEP_LOCAL: 'Garder les tickets existants', JIRA_WINS: 'Jira fait autorité' }
};

export function fieldLabel(entityType: string, field: string | null): string {
	if (!field) return '';
	return FIELD_LABELS[entityType]?.[field] ?? field;
}

export function formatChangeValue(entityType: string, field: string | null, value: string | null): string {
	if (value === null) return '—';
	if (entityType === 'TICKET' && field === 'priority') return `P${value}`;
	return VALUE_LABELS[`${entityType}.${field}`]?.[value] ?? value;
}
