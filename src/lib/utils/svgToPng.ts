/** SVG (texte) → PNG téléchargeable, via un canvas hors-écran (aucune dépendance). */
export async function downloadSvgAsPng(svgText: string, filename: string, scale = 2): Promise<void> {
	const objectUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('svg load failed'));
			img.src = objectUrl;
		});

		const canvas = document.createElement('canvas');
		canvas.width = img.naturalWidth * scale;
		canvas.height = img.naturalHeight * scale;
		const ctx = canvas.getContext('2d')!;
		ctx.scale(scale, scale);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);
		ctx.drawImage(img, 0, 0);

		const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!pngBlob) return;
		const a = document.createElement('a');
		a.href = URL.createObjectURL(pngBlob);
		a.download = filename;
		a.click();
		URL.revokeObjectURL(a.href);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}
