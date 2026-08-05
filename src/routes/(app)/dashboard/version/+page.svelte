<script lang="ts">
	import SprintDashboardPanel from '$lib/components/SprintDashboardPanel.svelte';
	let { data } = $props();
</script>

<SprintDashboardPanel
	title="Dashboard par version"
	baseHref="/dashboard/version"
	options={data.options}
	selectedId={data.selectedId}
	dashboard={data.dashboard}
	emptyLabel="Aucune version dans cet espace."
/>
