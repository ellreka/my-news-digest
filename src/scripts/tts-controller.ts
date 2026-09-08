export const RATE_STORAGE_KEY = 'news-digest:tts-rate';
export const DEFAULT_RATE = 1;

export function parseRate(value: unknown): number {
	if (typeof value !== 'string' && typeof value !== 'number') return DEFAULT_RATE;
	const rate = Number(value);
	return Number.isFinite(rate) && rate >= 0.5 && rate <= 3
		? Math.round(rate * 10) / 10
		: DEFAULT_RATE;
}

export interface ReaderState {
	status: 'idle' | 'starting' | 'speaking' | 'finished' | 'error';
	index: number;
	error?: string;
}

interface ReaderOptions {
	texts: string[];
	synthesis: Pick<SpeechSynthesis, 'speak' | 'cancel'>;
	createUtterance: (text: string) => SpeechSynthesisUtterance;
	onState: (state: ReaderState) => void;
	getVoice?: () => SpeechSynthesisVoice | undefined;
	/** Fail visibly if a browser accepts speak() but never starts audio. */
	startTimeoutMs?: number;
}

/** Own one utterance at a time; canceled runs can never advance a newer run. */
export class SpeechReader {
	private options: ReaderOptions;
	private generation = 0;
	private utterance: SpeechSynthesisUtterance | undefined;
	private startTimer: ReturnType<typeof setTimeout> | undefined;
	private state: ReaderState = { status: 'idle', index: -1 };
	private rate = DEFAULT_RATE;
	private volume = 1;

	constructor(options: ReaderOptions) {
		this.options = options;
	}

	get active(): boolean {
		return this.state.status === 'starting' || this.state.status === 'speaking';
	}

	/** Keep current audio uninterrupted; new utterances use the latest settings. */
	setSettings(rate: number, volume: number): void {
		this.rate = parseRate(rate);
		this.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
	}

	start(index = 0): void {
		if (!Number.isInteger(index) || index < 0 || index >= this.options.texts.length) return;
		this.cancelCurrent();
		this.speak(index, this.generation);
	}

	stop(): void {
		this.cancelCurrent();
		this.publish({ status: 'idle', index: -1 });
	}

	private publish(state: ReaderState): void {
		this.state = state;
		this.options.onState(state);
	}

	private clearStartTimer(): void {
		if (this.startTimer !== undefined) clearTimeout(this.startTimer);
		this.startTimer = undefined;
	}

	private cancelCurrent(): void {
		++this.generation;
		this.clearStartTimer();
		// Invalidate before cancel(): some engines dispatch error synchronously.
		this.utterance = undefined;
		this.options.synthesis.cancel();
	}

	private speak(index: number, generation: number): void {
		if (generation !== this.generation) return;
		if (index >= this.options.texts.length) {
			this.publish({ status: 'finished', index: -1 });
			return;
		}

		try {
			const utterance = this.options.createUtterance(this.options.texts[index]!);
			this.utterance = utterance;
			utterance.lang = 'ja-JP';
			utterance.rate = this.rate;
			utterance.volume = this.volume;
			const voice = this.options.getVoice?.();
			if (voice) utterance.voice = voice;

			const isCurrent = () => generation === this.generation && this.utterance === utterance;
			utterance.onstart = () => {
				if (!isCurrent()) return;
				this.clearStartTimer();
				this.publish({ status: 'speaking', index });
			};
			utterance.onend = () => {
				if (!isCurrent()) return;
				this.clearStartTimer();
				this.utterance = undefined;
				this.speak(index + 1, generation);
			};
			utterance.onerror = (event) => {
				if (isCurrent()) this.fail(event.error);
			};

			this.publish({ status: 'starting', index });
			this.startTimer = setTimeout(() => {
				if (isCurrent()) this.fail('start-timeout');
			}, this.options.startTimeoutMs ?? 15_000);
			this.options.synthesis.speak(utterance);
		} catch {
			this.fail('synthesis-failed');
		}
	}

	private fail(error: string): void {
		this.cancelCurrent();
		this.publish({ status: 'error', index: -1, error });
	}
}
