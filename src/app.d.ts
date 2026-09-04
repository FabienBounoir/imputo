import type { Role } from '$lib/server/db';
import type { MembershipInfo } from '$lib/server/services/workspaces';
import type { PerimeterCtx } from '$lib/server/services/perimeters';

declare global {
	// Injectée par vite.config.ts (define) depuis ARG APP_VERSION du Dockerfile.
	const __APP_VERSION__: string;

	namespace App {
		interface Locals {
			user: {
				id: string;
				displayName: string;
				email: string;
				themePref: string;
				accentMode: string;
				accentColor: string | null;
				sortActivitiesAlpha: boolean;
				motivationBanner: boolean;
				tutorialSeenAt: Date | null;
			} | null;
			sessionToken: string | null;
			memberships: MembershipInfo[];
			workspace: MembershipInfo | null;
			role: Role | null;
			canViewImputations: boolean;
			canViewMoodResults: boolean;
			deactivatedWorkspace: { workspaceId: string; workspaceName: string; accentColor: string } | null;
			/** Périmètres de l'espace courant + capacité à y agir comme CP (cf. services/perimeters.ts). */
			perimeterCtx: PerimeterCtx;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
