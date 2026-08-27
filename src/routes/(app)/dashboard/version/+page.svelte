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
	title="Dashboard par version"
	baseHref="/dashboard/version"
	options={data.options}
	selectedId={data.selectedId}
	dashboard={data.dashboard}
	emptyLabel="Aucune version dans cet espace."
	{jiraCfg}
/>
