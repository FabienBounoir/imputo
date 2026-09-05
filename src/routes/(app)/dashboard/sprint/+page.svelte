<script lang="ts">
	import SprintDashboardPanel from '$lib/components/SprintDashboardPanel.svelte';
	let { data } = $props();

	const jiraCfg = $derived({
		jiraBaseUrl: data.jiraBaseUrl,
		jiraLinkEnabled: data.workspace!.jiraLinkEnabled,
		jiraLinkKeyRegexPattern: data.workspace!.jiraLinkKeyRegexPattern,
		jiraLinkKeyRegexReplacement: data.workspace!.jiraLinkKeyRegexReplacement
	});
</script>

<SprintDashboardPanel
	title="Dashboard par sprint"
	baseHref="/dashboard/sprint"
	options={data.options}
	selectedId={data.selectedId}
	dashboard={data.dashboard}
	emptyLabel="Aucun sprint dans cet espace."
	{jiraCfg}
	states={data.states}
	projects={data.projects}
	sprints={data.sprints}
	versions={data.versions}
	ssps={data.ssps}
	ticketGroups={data.ticketGroups}
	members={data.assignableMembers}
	testPhase={data.testPhase}
	isAdmin={data.isAdmin}
	isOwner={data.isOwner}
/>
