export type ConfirmOptions = {
	title?: string;
	message: string;
	confirmLabel?: string;
	cancelLabel?: string;
};

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

export const confirmState = $state<{ pending: Pending | null }>({ pending: null });

/** Modale de confirmation façon site (remplace window.confirm). Résout true/false. */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
	const o = typeof opts === 'string' ? { message: opts } : opts;
	return new Promise((resolve) => {
		confirmState.pending = { ...o, resolve };
	});
}

export function answerConfirm(value: boolean) {
	confirmState.pending?.resolve(value);
	confirmState.pending = null;
}
