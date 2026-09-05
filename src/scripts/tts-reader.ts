const RATE_STORAGE_KEY = 'my-news-digest:ttsRate';
const DEFAULT_RATE = 1;
const MIN_RATE = 0.5;
const MAX_RATE = 2;

type TtsElements = {
	toolbar: HTMLElement;
	playBtn: HTMLButtonElement;
	stopBtn: HTMLButtonElement;
	rateInput: HTMLInputElement;
	rateValue: HTMLElement;
	unsupported: HTMLElement | null;
};

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
			if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre'].includes(tag)) {
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

function initTts() {
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
	}

	let rate = readStoredRate();
	let index = 0;
	let speaking = false;
	let voice: SpeechSynthesisVoice | null = null;

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

	const stop = () => {
		speechSynthesis.cancel();
		setSpeakingUi(false);
		setActive(null);
	};

	const speakFrom = (start: number) => {
		speechSynthesis.cancel();
		index = Math.max(0, Math.min(start, blocks.length - 1));
		setSpeakingUi(true);

		const speakNext = () => {
			if (!speaking) return;
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
				if (!speaking) return;
				index += 1;
				speakNext();
			};
			utter.onerror = () => {
				setSpeakingUi(false);
				setActive(null);
			};
			speechSynthesis.speak(utter);
		};

		speakNext();
	};

	const refreshVoice = () => {
		voice = pickJapaneseVoice();
	};
	refreshVoice();
	speechSynthesis.addEventListener('voiceschanged', refreshVoice);

	syncRateUi();
	els.stopBtn.disabled = true;

	els.playBtn.addEventListener('click', () => {
		if (speaking) return;
		speakFrom(0);
	});

	els.stopBtn.addEventListener('click', () => stop());

	els.rateInput.addEventListener('input', () => {
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
	});

	for (let i = 0; i < blocks.length; i += 1) {
		blocks[i].addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			// リンククリックは遷移を優先
			if (target?.closest('a')) return;
			event.preventDefault();
			speakFrom(i);
		});
	}

	window.addEventListener('pagehide', () => stop());
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initTts, { once: true });
} else {
	initTts();
}
