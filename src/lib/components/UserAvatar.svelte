<script lang="ts">
	// Avatar Dicebear (jeu "critters") avec repli sur les initiales en dégradé si l'image ne charge
	// pas (offline, API bloquée...). Le seed est l'id du user (uuid aléatoire déjà en base), jamais
	// son e-mail : contrairement à un hash d'e-mail, un uuid aléatoire n'est pas reconstituable par
	// rainbow table, donc l'API Dicebear n'apprend rien sur l'identité du user.
	let { userId, name, size = 32 }: { userId: string | undefined | null; name: string; size?: number } =
		$props();

	const initials = (n: string) =>
		n
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase();

	let failed = $state(false);
	$effect(() => {
		userId;
		failed = false;
	});
</script>

{#if userId && !failed}
	<img
		class="avatar avatar-img"
		style:width="{size}px"
		style:height="{size}px"
		src="https://api.dicebear.com/10.x/critters/svg?seed={encodeURIComponent(userId)}"
		alt={name}
		onerror={() => (failed = true)}
	/>
{:else}
	<div class="avatar" style:width="{size}px" style:height="{size}px">{initials(name || '?')}</div>
{/if}

<style>
	.avatar-img {
		background: none;
		object-fit: cover;
	}
</style>
