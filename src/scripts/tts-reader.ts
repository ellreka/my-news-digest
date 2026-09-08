import { prepareReadingUnits, type ReadingUnit } from './tts-content';
import { parseRate, RATE_STORAGE_KEY, SpeechReader, type ReaderState } from './tts-controller';
import { ReadingFollower } from './tts-follow';

function errorMessage(error?: string): string {
	if (error === 'not-allowed' || error === 'start-timeout') {
		return '音声を開始できませんでした。再生ボタンでもう一度お試しください。';
	}
	if (error === 'language-unavailable' || error === 'voice-unavailable' || error === 'synthesis-unavailable') {
		return '日本語の音声を利用できません。端末の音声設定をご確認ください。';
	}
	return '読み上げが中断されました。再生ボタンでもう一度お試しください。';
}

function initReader(): (() => void) | undefined {
	const player = document.querySelector<HTMLElement>('[data-tts-player]');
	const content = document.querySelector<HTMLElement>('[data-tts-content]');
	const root = content?.querySelector<HTMLElement>('.sl-markdown-content');
	if (!player || !content || !root) return;

	const play = player.querySelector<HTMLButtonElement>('[data-tts-play]')!;
	const stop = player.querySelector<HTMLButtonElement>('[data-tts-stop]')!;
	const rateInput = player.querySelector<HTMLInputElement>('[data-tts-rate]')!;
	const volumeInput = player.querySelector<HTMLInputElement>('[data-tts-volume]')!;
	const volumePanel = player.querySelector<HTMLDetailsElement>('[data-tts-volume-panel]')!;
	const rateValue = player.querySelector<HTMLOutputElement>('[data-tts-rate-value]')!;
	const volumeValue = player.querySelector<HTMLOutputElement>('[data-tts-volume-value]')!;
	const status = player.querySelector<HTMLElement>('[data-tts-status]')!;
	const follow = player.querySelector<HTMLButtonElement>('[data-tts-follow]')!;
	const errorIndicator = player.querySelector<HTMLElement>('[data-tts-error]')!;
	const listeners = new AbortController();
	const { signal } = listeners;
	document.addEventListener('click', (event) => {
		if (event.target instanceof Node && !volumePanel.contains(event.target)) volumePanel.open = false;
	}, { signal });
	volumePanel.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape') return;
		volumePanel.open = false;
		volumePanel.querySelector('summary')?.focus({ preventScroll: true });
		event.stopPropagation();
	}, { signal });
	const html = document.documentElement;
	const follower = new ReadingFollower(player, signal, (detached) => {
		follow.hidden = !detached;
	});
	player.hidden = false;
	html.setAttribute('data-tts-enabled', '');
	const measurePlayer = () => {
		html.style.setProperty('--tts-player-height', `${player.getBoundingClientRect().height}px`);
		follower.refresh();
	};
	const resizeObserver = new ResizeObserver(measurePlayer);
	resizeObserver.observe(player);
	measurePlayer();

	let reader: SpeechReader | undefined;
	let highlighted: ReadingUnit | undefined;
	let keyboardTargets: HTMLElement[] = [];
	const clearHighlight = () => {
		highlighted?.elements.forEach((element) => element.classList.remove('tts-current'));
		highlighted = undefined;
	};
	const cleanup = () => {
		reader?.stop();
		follower.stop();
		listeners.abort();
		resizeObserver.disconnect();
		clearHighlight();
		content.removeAttribute('data-tts-reading');
		html.removeAttribute('data-tts-enabled');
		html.style.removeProperty('--tts-player-height');
	};

	if (typeof window.speechSynthesis?.speak !== 'function' || typeof window.SpeechSynthesisUtterance !== 'function') {
		status.textContent = 'このブラウザは読み上げに対応していません。';
		errorIndicator.hidden = false;
		player.setAttribute('data-tts-error', '');
		errorIndicator.setAttribute('aria-label', status.textContent);
		player.title = status.textContent;
		return cleanup;
	}

	// Mark only once, including when a page is restored from the back/forward cache.
	const units = prepareReadingUnits(root);
	if (units.length === 0) {
		status.textContent = '読み上げる本文がありません。';
		errorIndicator.hidden = false;
		player.setAttribute('data-tts-error', '');
		errorIndicator.setAttribute('aria-label', status.textContent);
		player.title = status.textContent;
		return cleanup;
	}

	keyboardTargets = units.flatMap((unit) => {
		const target = unit.elements.find((element) => !element.closest('a, button'));
		return target ? [target] : [];
	});
	let wasActive = false;
	const renderState = (state: ReaderState) => {
		const active = state.status === 'starting' || state.status === 'speaking';
		const focusedControl = document.activeElement;
		play.disabled = active;
		stop.disabled = !active;
		play.hidden = active;
		stop.hidden = !active;
		if (active && focusedControl === play) stop.focus({ preventScroll: true });
		if (!active && focusedControl === stop) play.focus({ preventScroll: true });
		content.toggleAttribute('data-tts-reading', active);
		if (active !== wasActive) {
			if (active) follower.begin();
			else follower.stop();
			for (const element of keyboardTargets) {
				if (active) {
					element.tabIndex = 0;
					element.setAttribute('role', 'button');
					element.setAttribute('aria-label', `この文から読み上げ: ${units[Number(element.dataset.ttsUnit)]!.text}`);
				} else {
					element.removeAttribute('tabindex');
					element.removeAttribute('role');
					element.removeAttribute('aria-label');
				}
			}
			wasActive = active;
		}
		clearHighlight();
		if (state.status === 'speaking') {
			highlighted = units[state.index];
			highlighted?.elements.forEach((element) => element.classList.add('tts-current'));
			follower.setCurrent(highlighted?.elements ?? []);
		}
		// Do not announce every sentence over the speech audio to screen readers.
		const message = state.status === 'speaking' ? '読み上げ中'
			: state.status === 'starting' ? '読み上げ中'
			: state.status === 'finished' ? '最後まで読み上げました。'
			: state.status === 'error' ? errorMessage(state.error)
			: '再生すると本文を読み上げます。';
		if (status.textContent !== message) status.textContent = message;
		errorIndicator.hidden = state.status !== 'error';
		player.toggleAttribute('data-tts-error', state.status === 'error');
		if (state.status === 'error') {
			player.title = message;
			errorIndicator.setAttribute('aria-label', message);
		} else {
			player.removeAttribute('title');
		}
	};

	const synth = window.speechSynthesis;
	let voices = synth.getVoices();
	synth.addEventListener('voiceschanged', () => { voices = synth.getVoices(); }, { signal });
	reader = new SpeechReader({
		texts: units.map((unit) => unit.text),
		synthesis: synth,
		createUtterance: (text) => new SpeechSynthesisUtterance(text),
		getVoice: () => {
			const japanese = voices.filter((voice) => /^ja(?:-|$)/i.test(voice.lang));
			return japanese.find((voice) => voice.localService) ?? japanese.find((voice) => voice.default) ?? japanese[0];
		},
		onState: renderState,
	});
	try {
		rateInput.value = String(parseRate(localStorage.getItem(RATE_STORAGE_KEY)));
	} catch {
		rateInput.value = '1';
	}
	const updateSettings = () => {
		const rate = parseRate(rateInput.value);
		const volume = Number(volumeInput.value);
		rateValue.value = `${rate.toFixed(1)}×`;
		volumeValue.value = `${volume}%`;
		rateInput.setAttribute('aria-valuetext', `${rate.toFixed(1)}倍`);
		volumeInput.setAttribute('aria-valuetext', `${volume}%`);
		reader!.setSettings(rate, volume / 100);
	};
	updateSettings();
	play.disabled = rateInput.disabled = volumeInput.disabled = false;
	renderState({ status: 'idle', index: -1 });
	play.addEventListener('click', () => reader!.start(), { signal });
	stop.addEventListener('click', () => reader!.stop(), { signal });
	follow.addEventListener('click', () => {
		follower.resume();
		stop.focus({ preventScroll: true });
	}, { signal });
	for (const input of [rateInput, volumeInput]) {
		input.addEventListener('input', () => updateSettings(), { signal });
		input.addEventListener('change', () => {
			updateSettings();
			if (input === rateInput) {
				try { localStorage.setItem(RATE_STORAGE_KEY, String(parseRate(rateInput.value))); } catch { /* Reading still works without storage. */ }
			}
		}, { signal });
	}

	const selectUnit = (target: EventTarget | null) => {
		if (!reader!.active || !(target instanceof Element) || target.closest('a, button, input, select, textarea')) return;
		const element = target.closest<HTMLElement>('[data-tts-unit]');
		if (!element || !content.contains(element)) return;
		reader!.start(Number(element.dataset.ttsUnit));
	};
	content.addEventListener('click', (event) => {
		// A drag to select/copy text must not unexpectedly change playback.
		if (window.getSelection()?.isCollapsed === false) return;
		selectUnit(event.target);
	}, { signal });
	content.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (!(event.target instanceof HTMLElement) || !event.target.matches('[data-tts-unit][role="button"]')) return;
		event.preventDefault();
		selectUnit(event.target);
	}, { signal });
	// Stop on navigation, including BFCache, without resuming audio automatically.
	window.addEventListener('pagehide', () => reader!.stop(), { signal });
	return cleanup;
}

let dispose: (() => void) | undefined;
function mount() {
	dispose?.();
	dispose = initReader();
}

mount();
const lifecycle = new AbortController();
document.addEventListener('astro:before-swap', () => { dispose?.(); dispose = undefined; }, { signal: lifecycle.signal });
document.addEventListener('astro:page-load', () => {
	if (!dispose) mount();
}, { signal: lifecycle.signal });
if (import.meta.hot) import.meta.hot.dispose(() => {
	dispose?.();
	lifecycle.abort();
});
