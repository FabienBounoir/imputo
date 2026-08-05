<script lang="ts">
	import SprintDashboardPanel from '$lib/components/SprintDashboardPanel.svelte';
	let { data } = $props();
</script>

<SprintDashboardPanel
	title="Dashboard par sprint"
	baseHref="/dashboard/sprint"
	options={data.options}
	selectedId={data.selectedId}
	dashboard={data.dashboard}
	emptyLabel="Aucun sprint dans cet espace."
/>
