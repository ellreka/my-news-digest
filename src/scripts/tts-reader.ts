const RATE_STORAGE_KEY = 'my-news-digest:ttsRate';
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
			// pre（コード）は読み上げ対象外
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

function pickJapaneseVoice(): SpeechSynthesisVoice | null {
	const voices = speechSynthesis.getVoices();
	const ja = voices.filter((v) => v.lang.toLowerCase().startsWith('ja'));
	return ja.find((v) => /google|premium|enhanced|neural/i.test(v.name)) ?? ja[0] ?? null;
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
	// View Transitions / astro:page-load の再入でリスナーが積み上がらないように掃除
	pageCleanup?.();
	pageCleanup = null;

	if (!isDigestPage()) return;

	const content = document.querySelector('.sl-markdown-content');
	const toolbar = document.querySelector<HTMLElement>('[data-tts-toolbar]');
	if (!content || !toolbar) return;

	const playBtn = toolbar.querySelector<HTMLButtonElement>('[data-tts-play]');
	const stopBtn = toolbar.querySelector<HTMLButtonElement>('[data-tts-stop]');
	const rateInput = toolbar.querySelector<HTMLInputElement>('[data-tts-rate]');
	const rateValue = toolbar.querySelector<HTMLElement>('[data-tts-rate-value]');
	const unsupported = document.querySelector<HTMLElement>('[data-tts-unsupported]');
	if (!playBtn || !stopBtn || !rateInput || !rateValue) return;

	toolbar.hidden = false;

	if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
		if (unsupported) unsupported.hidden = false;
		playBtn.disabled = true;
		stopBtn.disabled = true;
		rateInput.disabled = true;
		return;
	}

	const els: TtsElements = { toolbar, playBtn, stopBtn, rateInput, rateValue, unsupported };
	const blocks = collectBlocks(content);
	if (blocks.length === 0) {
		toolbar.hidden = true;
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
	/** 意図した cancel 中は onerror で UI を落とさない */
	let ignoringCancelErrors = false;
	/** speakFrom 世代。古い onend / 遅延開始を無効化 */
	let generation = 0;
	let resumeTimer: ReturnType<typeof setTimeout> | null = null;
	const ac = new AbortController();
	const { signal } = ac;

	const syncRateUi = () => {
		els.rateInput.value = String(rate);
		els.rateValue.textContent = `${rate.toFixed(2)}x`;
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
			utter.lang = 'ja-JP';
			if (voice) utter.voice = voice;
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

		// cancel 直後の speak 失敗を避ける
		resumeTimer = setTimeout(() => {
			resumeTimer = null;
			if (gen !== generation || !speaking) return;
			speakNext();
		}, AFTER_CANCEL_MS);
	};

	const refreshVoice = () => {
		voice = pickJapaneseVoice();
	};
	refreshVoice();
	speechSynthesis.addEventListener('voiceschanged', refreshVoice, { signal });

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
			if (speaking) {
				const resumeAt = index;
				speakFrom(resumeAt);
			}
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

	const onPageHide = () => stop();
	window.addEventListener('pagehide', onPageHide, { signal });

	pageCleanup = () => {
		clearResumeTimer();
		generation += 1;
		markIntentionalCancel();
		speechSynthesis.cancel();
		ac.abort();
		for (const block of blocks) {
			block.classList.remove('tts-speakable', 'tts-active');
			block.removeAttribute('role');
			block.removeAttribute('aria-label');
			block.removeAttribute('title');
			// tabindex は元からあった可能性があるので 0 を付けた分だけ外すのは難しい → 付けたものとして除去
			block.removeAttribute('tabindex');
		}
		setSpeakingUi(false);
	};
}

function bootTts() {
	initTts();
}

// 初回 + Astro View Transitions 後
document.addEventListener('astro:page-load', bootTts);
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', bootTts, { once: true });
} else if (!document.documentElement.hasAttribute('data-astro-transition')) {
	// astro:page-load がすぐ来る環境では二重起動するが、pageCleanup で抑止する
	bootTts();
}
