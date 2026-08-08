let ctx: AudioContext | null = null;

/** Joue un court bip synthétisé (pas de fichier audio à charger/héberger). */
export function beep(
	freq: number,
	{
		offset = 0,
		duration = 0.12,
		type = 'square',
		volume = 0.15
	}: { offset?: number; duration?: number; type?: OscillatorType; volume?: number } = {}
) {
	ctx ??= new AudioContext();
	const now = ctx.currentTime + offset;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = type;
	osc.frequency.value = freq;
	gain.gain.setValueAtTime(0, now);
	gain.gain.linearRampToValueAtTime(volume, now + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
	osc.connect(gain).connect(ctx.destination);
	osc.start(now);
	osc.stop(now + duration + 0.02);
}
