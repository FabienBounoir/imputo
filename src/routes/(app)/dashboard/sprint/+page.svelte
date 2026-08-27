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
/>
