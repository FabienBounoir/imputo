import type { Role } from '$lib/server/db';
import type { MembershipInfo } from '$lib/server/services/workspaces';

declare global {
	namespace App {
		interface Locals {
			user: {
				id: string;
				displayName: string;
				email: string;
				themePref: string;
				accentMode: string;
				accentColor: string | null;
			} | null;
			sessionToken: string | null;
			memberships: MembershipInfo[];
			workspace: MembershipInfo | null;
			role: Role | null;
			deactivatedWorkspace: { workspaceId: string; workspaceName: string; accentColor: string } | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
