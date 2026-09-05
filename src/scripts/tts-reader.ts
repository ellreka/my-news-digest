const RATE_STORAGE_KEY = 'my-news-digest:ttsRate';
const VOICE_STORAGE_KEY = 'my-news-digest:ttsVoiceURI';
const DEFAULT_RATE = 1;
const MIN_RATE = 0.5;
const MAX_RATE = 2;
/** cancel() 直後に speak すると失敗する環境向けの待ち */
const AFTER_CANCEL_MS = 40;

type TtsElements = {
	toolbar: HTMLElement;
	playBtn: HTMLButtonElement;
	stopBtn: HTMLButtonElement;
	rateInput: HTMLInputElement;
	rateValue: HTMLElement;
	voiceSelect: HTMLSelectElement;
	unsupported: HTMLElement | null;
};

let pageCleanup: (() => void) | null = null;

function isDigestPage(): boolean {
	return /\/digests\//.test(location.pathname);
}

function collectBlocks(root: Element): HTMLElement[] {
	const blocks: HTMLElement[] = [];
	const pushIfText = (el: HTMLElement) => {
		const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text.length > 0) blocks.push(el);
	};

	const walk = (el: Element) => {
		for (const child of Array.from(el.children)) {
			const tag = child.tagName.toLowerCase();
			if (tag === 'pre') continue;
			if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'].includes(tag)) {
				pushIfText(child as HTMLElement);
			} else if (['ul', 'ol', 'div', 'section', 'article'].includes(tag)) {
				walk(child);
			}
		}
	};

	walk(root);
	return blocks;
}

function clampRate(rate: number): number {
	if (!Number.isFinite(rate)) return DEFAULT_RATE;
	return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
}

function readStoredRate(): number {
	try {
		const raw = localStorage.getItem(RATE_STORAGE_KEY);
		return clampRate(raw === null ? DEFAULT_RATE : Number(raw));
	} catch {
		return DEFAULT_RATE;
	}
}

function readStoredVoiceURI(): string | null {
	try {
		return localStorage.getItem(VOICE_STORAGE_KEY);
	} catch {
		return null;
	}
}

function voiceLabel(v: SpeechSynthesisVoice): string {
	const local = v.localService ? '端末' : 'オンライン';
	return `${v.name} (${v.lang}, ${local})`;
}

function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
	return [...voices].sort((a, b) => {
		const aJa = a.lang.toLowerCase().startsWith('ja') ? 0 : 1;
		const bJa = b.lang.toLowerCase().startsWith('ja') ? 0 : 1;
		if (aJa !== bJa) return aJa - bJa;
		return a.name.localeCompare(b.name, 'ja');
	});
}

function defaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
	const ja = voices.filter((v) => v.lang.toLowerCase().startsWith('ja'));
	return ja.find((v) => /google|premium|enhanced|neural/i.test(v.name)) ?? ja[0] ?? voices[0] ?? null;
}

function isCancelLikeError(error: string | undefined): boolean {
	if (!error) return false;
	const normalized = error.toLowerCase();
	return (
		normalized === 'interrupted' ||
		normalized === 'canceled' ||
		normalized === 'cancelled' ||
		normalized === 'abort' ||
		normalized === 'aborted'
	);
}

function initTts() {
	pageCleanup?.();
	pageCleanup = null;
	document.body.classList.remove('tts-bar-visible');

	if (!isDigestPage()) return;

	const content = document.querySelector('.sl-markdown-content');
	const toolbar = document.querySelector<HTMLElement>('[data-tts-toolbar]');
	if (!content || !toolbar) return;

	const playBtn = toolbar.querySelector<HTMLButtonElement>('[data-tts-play]');
	const stopBtn = toolbar.querySelector<HTMLButtonElement>('[data-tts-stop]');
	const rateInput = toolbar.querySelector<HTMLInputElement>('[data-tts-rate]');
	const rateValue = toolbar.querySelector<HTMLElement>('[data-tts-rate-value]');
	const voiceSelect = toolbar.querySelector<HTMLSelectElement>('[data-tts-voice]');
	const unsupported = document.querySelector<HTMLElement>('[data-tts-unsupported]');
	if (!playBtn || !stopBtn || !rateInput || !rateValue || !voiceSelect) return;

	toolbar.hidden = false;
	document.body.classList.add('tts-bar-visible');

	if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
		if (unsupported) unsupported.hidden = false;
		playBtn.disabled = true;
		stopBtn.disabled = true;
		rateInput.disabled = true;
		voiceSelect.disabled = true;
		return;
	}

	const els: TtsElements = {
		toolbar,
		playBtn,
		stopBtn,
		rateInput,
		rateValue,
		voiceSelect,
		unsupported,
	};
	const blocks = collectBlocks(content);
	if (blocks.length === 0) {
		toolbar.hidden = true;
		document.body.classList.remove('tts-bar-visible');
		return;
	}

	for (const block of blocks) {
		block.classList.add('tts-speakable');
		block.title = 'ここから読み上げ';
		if (!block.hasAttribute('tabindex')) block.tabIndex = 0;
		block.setAttribute('role', 'button');
		block.setAttribute('aria-label', 'ここから読み上げ');
	}

	let rate = readStoredRate();
	let index = 0;
	let speaking = false;
	let voice: SpeechSynthesisVoice | null = null;
	let ignoringCancelErrors = false;
	let generation = 0;
	let resumeTimer: ReturnType<typeof setTimeout> | null = null;
	const ac = new AbortController();
	const { signal } = ac;

	const syncRateUi = () => {
		els.rateInput.value = String(rate);
		els.rateValue.textContent = `${rate.toFixed(2)}x`;
	};

	const populateVoices = () => {
		const voices = sortVoices(speechSynthesis.getVoices());
		const previous = els.voiceSelect.value || readStoredVoiceURI() || '';
		els.voiceSelect.replaceChildren();

		const placeholder = document.createElement('option');
		placeholder.value = '';
		placeholder.textContent = voices.length ? '自動（おすすめ）' : '音声を読み込み中…';
		els.voiceSelect.append(placeholder);

		for (const v of voices) {
			const opt = document.createElement('option');
			opt.value = v.voiceURI;
			opt.textContent = voiceLabel(v);
			els.voiceSelect.append(opt);
		}

		if (previous && voices.some((v) => v.voiceURI === previous)) {
			els.voiceSelect.value = previous;
			voice = voices.find((v) => v.voiceURI === previous) ?? null;
		} else {
			els.voiceSelect.value = '';
			voice = defaultVoice(voices);
		}
		els.voiceSelect.disabled = voices.length === 0;
	};

	const resolveVoice = (): SpeechSynthesisVoice | null => {
		const voices = speechSynthesis.getVoices();
		const selected = els.voiceSelect.value;
		if (selected) {
			return voices.find((v) => v.voiceURI === selected) ?? null;
		}
		return defaultVoice(voices);
	};

	const setActive = (i: number | null) => {
		for (const block of blocks) block.classList.remove('tts-active');
		if (i === null || i < 0 || i >= blocks.length) return;
		const el = blocks[i];
		el.classList.add('tts-active');
		el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	};

	const setSpeakingUi = (on: boolean) => {
		speaking = on;
		els.playBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
		els.playBtn.textContent = on ? '再生中' : '再生';
		els.stopBtn.disabled = !on;
	};

	const clearResumeTimer = () => {
		if (resumeTimer !== null) {
			clearTimeout(resumeTimer);
			resumeTimer = null;
		}
	};

	const markIntentionalCancel = () => {
		ignoringCancelErrors = true;
		window.setTimeout(() => {
			ignoringCancelErrors = false;
		}, AFTER_CANCEL_MS + 30);
	};

	const stop = () => {
		clearResumeTimer();
		generation += 1;
		markIntentionalCancel();
		speechSynthesis.cancel();
		setSpeakingUi(false);
		setActive(null);
	};

	const speakFrom = (start: number) => {
		clearResumeTimer();
		const gen = ++generation;
		markIntentionalCancel();
		speechSynthesis.cancel();

		index = Math.max(0, Math.min(start, blocks.length - 1));
		setSpeakingUi(true);
		voice = resolveVoice();

		const speakNext = () => {
			if (gen !== generation || !speaking) return;
			if (index >= blocks.length) {
				setSpeakingUi(false);
				setActive(null);
				return;
			}
			const block = blocks[index];
			const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim();
			setActive(index);
			if (!text) {
				index += 1;
				speakNext();
				return;
			}
			const utter = new SpeechSynthesisUtterance(text);
			utter.rate = rate;
			const currentVoice = voice ?? resolveVoice();
			if (currentVoice) {
				utter.voice = currentVoice;
				utter.lang = currentVoice.lang;
			} else {
				utter.lang = 'ja-JP';
			}
			utter.onend = () => {
				if (gen !== generation || !speaking) return;
				index += 1;
				speakNext();
			};
			utter.onerror = (event) => {
				if (gen !== generation) return;
				if (ignoringCancelErrors || isCancelLikeError(event.error)) return;
				setSpeakingUi(false);
				setActive(null);
			};
			speechSynthesis.speak(utter);
		};

		resumeTimer = setTimeout(() => {
			resumeTimer = null;
			if (gen !== generation || !speaking) return;
			speakNext();
		}, AFTER_CANCEL_MS);
	};

	populateVoices();
	speechSynthesis.addEventListener(
		'voiceschanged',
		() => {
			populateVoices();
		},
		{ signal },
	);

	syncRateUi();
	els.stopBtn.disabled = true;

	els.playBtn.addEventListener(
		'click',
		() => {
			if (speaking) return;
			speakFrom(0);
		},
		{ signal },
	);

	els.stopBtn.addEventListener('click', () => stop(), { signal });

	els.rateInput.addEventListener(
		'input',
		() => {
			rate = clampRate(Number(els.rateInput.value));
			syncRateUi();
			try {
				localStorage.setItem(RATE_STORAGE_KEY, String(rate));
			} catch {
				/* ignore */
			}
			if (speaking) speakFrom(index);
		},
		{ signal },
	);

	els.voiceSelect.addEventListener(
		'change',
		() => {
			const uri = els.voiceSelect.value;
			try {
				if (uri) localStorage.setItem(VOICE_STORAGE_KEY, uri);
				else localStorage.removeItem(VOICE_STORAGE_KEY);
			} catch {
				/* ignore */
			}
			voice = resolveVoice();
			if (speaking) speakFrom(index);
		},
		{ signal },
	);

	const startFromBlock = (i: number, event: Event) => {
		const target = event.target as HTMLElement | null;
		if (target?.closest('a')) return;
		event.preventDefault();
		speakFrom(i);
	};

	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		block.addEventListener('click', (event) => startFromBlock(i, event), { signal });
		block.addEventListener(
			'keydown',
			(event) => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				startFromBlock(i, event);
			},
			{ signal },
		);
	}

	window.addEventListener('pagehide', () => stop(), { signal });

	pageCleanup = () => {
		clearResumeTimer();
		generation += 1;
		markIntentionalCancel();
		speechSynthesis.cancel();
		ac.abort();
		document.body.classList.remove('tts-bar-visible');
		for (const block of blocks) {
			block.classList.remove('tts-speakable', 'tts-active');
			block.removeAttribute('role');
			block.removeAttribute('aria-label');
			block.removeAttribute('title');
			block.removeAttribute('tabindex');
		}
		setSpeakingUi(false);
	};
}

function bootTts() {
	initTts();
}

document.addEventListener('astro:page-load', bootTts);
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', bootTts, { once: true });
} else if (!document.documentElement.hasAttribute('data-astro-transition')) {
	bootTts();
}
