interface SpeechProbe {
	spoken: SpeechSynthesisUtterance[];
	cancellations: number;
}

type TestWindow = Window & typeof globalThis & { __ttsProbe: SpeechProbe };

/** Run against the Astro dev server; the real player runs inside an isolated viewport. */
export async function runTtsPlayerTests(): Promise<string[]> {
	const passed: string[] = [];
	const assert = (condition: unknown, message: string) => {
		if (!condition) throw new Error(message);
	};
	const near = (actual: number, expected: number) => Math.abs(actual - expected) < 0.00001;
	const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
	const timeout = async <T>(promise: Promise<T>, label: string, milliseconds = 8_000): Promise<T> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};
	const until = async (ready: () => boolean, label: string) => {
		const deadline = performance.now() + 8_000;
		while (!ready()) {
			if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`);
			await delay(25);
		}
	};

	const path = '/digests/2026/09/08/';
	const key = 'news-digest:tts-rate';
	const savedRate = localStorage.getItem(key);
	const frame = document.createElement('iframe');
	frame.title = 'TTS player browser regression tests';
	frame.style.cssText = 'position:fixed;top:0;left:0;width:390px;height:740px;border:0;z-index:2147483647;background:white';
	let win: TestWindow | undefined;
	try {
		localStorage.setItem(key, '1');
		const response = await fetch(path, { signal: AbortSignal.timeout(8_000) });
		assert(response.ok, `Cannot load the digest fixture: HTTP ${response.status}`);
		const markup = await timeout(response.text(), 'reading the digest HTML');
		assert(/<head\b[^>]*>/i.test(markup), 'The digest fixture must contain a head element.');
		const mock = `(() => {
			const probe = window.__ttsProbe = { spoken: [], cancellations: 0 };
			const synthesis = new EventTarget();
			synthesis.speak = utterance => probe.spoken.push(utterance);
			synthesis.cancel = () => { probe.cancellations++; };
			synthesis.getVoices = () => [];
			Object.defineProperty(window, 'speechSynthesis', { value: synthesis, configurable: true });
		})();`;
		await timeout(new Promise<void>((resolve) => {
			frame.addEventListener('load', () => resolve(), { once: true });
			frame.srcdoc = markup.replace(/<head\b[^>]*>/i, (head) =>
				`${head}<base href="${new URL(path, location.origin).href}"><script>${mock}</script>`);
			document.body.append(frame);
		}), 'loading the player iframe');
		win = frame.contentWindow as TestWindow;
		const testWindow = win;
		const doc = frame.contentDocument!;
		await until(() => Boolean(testWindow.__ttsProbe)
			&& doc.querySelector<HTMLButtonElement>('[data-tts-play]')?.disabled === false
			&& Boolean(doc.querySelector('[data-tts-unit="65"]')), 'initializing the real player');
		await timeout(doc.fonts.ready, 'loading the digest fonts');
		const query = <T extends HTMLElement>(selector: string): T => {
			const element = doc.querySelector<T>(selector);
			assert(element, `Missing player element: ${selector}`);
			return element!;
		};
		const player = query<HTMLElement>('[data-tts-player]');
		const content = query<HTMLElement>('[data-tts-content]');
		const play = query<HTMLButtonElement>('[data-tts-play]');
		const stop = query<HTMLButtonElement>('[data-tts-stop]');
		const follow = query<HTMLButtonElement>('[data-tts-follow]');
		const rate = query<HTMLInputElement>('[data-tts-rate]');
		const volume = query<HTMLInputElement>('[data-tts-volume]');
		const volumeToggle = query<HTMLElement>('[data-tts-volume-panel] summary');
		const probe = testWindow.__ttsProbe;
		const latest = () => {
			const utterance = probe.spoken.at(-1);
			assert(utterance, 'Expected a queued utterance.');
			return utterance!;
		};
		const frames = async (count: number) => {
			for (let index = 0; index < count; ++index) {
				await timeout(new Promise<void>((resolve) => testWindow.requestAnimationFrame(() => resolve())),
					'waiting for the player animation frame', 2_000);
			}
		};
		const settle = async () => {
			await frames(3);
			await delay(75);
			await frames(2);
		};
		const startAudio = async () => {
			latest().dispatchEvent(new testWindow.Event('start'));
			await settle();
		};
		const advance = async () => {
			const count = probe.spoken.length;
			latest().dispatchEvent(new testWindow.Event('end'));
			assert(probe.spoken.length === count + 1, 'Ending a sentence must queue exactly one next sentence.');
			await startAudio();
		};
		const assertButtons = (active: boolean) => {
			assert(play.hidden === active && stop.hidden === !active, 'Play and stop must exchange their hidden state.');
			assert(play.disabled === active && stop.disabled === !active, 'Only the active playback action must be enabled.');
			assert(testWindow.getComputedStyle(active ? play : stop).display === 'none',
				'The inactive playback action must be visually hidden.');
			assert(testWindow.getComputedStyle(active ? stop : play).display !== 'none',
				'The active playback action must be visible.');
		};
		const assertCurrentVisible = () => {
			const rects = Array.from(doc.querySelectorAll<HTMLElement>('.tts-current'))
				.flatMap((element) => Array.from(element.getClientRects()))
				.filter((rect) => rect.width > 0 && rect.height > 0);
			assert(rects.length > 0, 'The current sentence must be highlighted.');
			const top = Math.min(...rects.map((rect) => rect.top));
			const bottom = Math.max(...rects.map((rect) => rect.bottom));
			const viewport = testWindow.visualViewport;
			const viewportTop = viewport?.offsetTop ?? 0;
			const visibleTop = viewportTop
				+ (parseFloat(testWindow.getComputedStyle(doc.documentElement).scrollPaddingTop) || 16);
			const visibleBottom = Math.min(viewportTop + (viewport?.height ?? testWindow.innerHeight),
				player.getBoundingClientRect().top) - 12;
			assert(top >= visibleTop - 2 && top < visibleBottom,
				`The speaking sentence must start in the usable viewport (${top}, ${visibleTop}–${visibleBottom}).`);
			if (bottom - top <= visibleBottom - visibleTop) {
				assert(bottom <= visibleBottom + 2, 'The current sentence must not be covered by the floating player.');
			}
		};
		const selectSentence = async (index: number) => {
			const target = Array.from(doc.querySelectorAll<HTMLElement>(`[data-tts-unit="${index}"]`))
				.find((element) => !element.closest('a, button'));
			assert(target, `Sentence ${index} needs a selectable non-link fragment.`);
			const count = probe.spoken.length;
			target!.click();
			assert(probe.spoken.length === count + 1, `Selecting sentence ${index} must queue its speech.`);
			await startAudio();
			assert(query<HTMLElement>('.tts-current').dataset.ttsUnit === String(index),
				`Sentence ${index} must receive the highlight.`);
		};

		await settle();
		assertButtons(false);
		play.click();
		assertButtons(true);
		assert(probe.spoken.length === 1 && !doc.querySelector('.tts-current'),
			'Play must queue speech before highlighting starts.');
		await startAudio();
		assertButtons(true);
		const first = latest();
		const cancellationCount = probe.cancellations;
		const status = query<HTMLElement>('[data-tts-status]').textContent;
		volumeToggle.click();
		rate.value = '2.2';
		volume.value = '35';
		for (const input of [rate, volume]) {
			input.dispatchEvent(new testWindow.Event('input', { bubbles: true }));
			input.dispatchEvent(new testWindow.Event('change', { bubbles: true }));
		}
		await settle();
		assert(probe.spoken.length === 1 && probe.cancellations === cancellationCount,
			'Changing settings must neither queue speech nor cancel the current sentence.');
		assert(near(first.rate, 1) && near(first.volume, 1), 'The current native utterance must retain its original settings.');
		assert(query<HTMLElement>('[data-tts-status]').textContent === status
			&& query<HTMLElement>('.tts-current').dataset.ttsUnit === '0', 'Changing settings must preserve the playing state.');
		assert(localStorage.getItem(key) === '2.2', 'The selected rate must be persisted.');
		await advance();
		assert(near(latest().rate, 2.2) && near(latest().volume, 0.35), 'The next native utterance must use the new rate and volume.');
		passed.push('Rate and volume changes preserve current speech and apply from the next sentence');

		const initialY = testWindow.scrollY;
		await selectSentence(35);
		assert(Math.abs(testWindow.scrollY - initialY) > 100, 'Selecting a distant sentence must follow its playback position.');
		assertCurrentVisible();
		assert(follow.hidden, 'Automatic scrolling must not detach reading follow.');
		passed.push('A distant selected sentence scrolls into view when its audio starts');

		const touch = (type: string, x: number, y: number) => {
			const event = new testWindow.Event(type, { bubbles: true });
			Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
			content.dispatchEvent(event);
		};
		const gestures: { name: string; dispatch: () => void }[] = [
			{ name: 'wheel', dispatch: () => content.dispatchEvent(new testWindow.WheelEvent('wheel', { deltaY: 120, bubbles: true })) },
			{ name: 'touchmove', dispatch: () => {
				touch('touchstart', 100, 240);
				touch('touchmove', 100, 160);
				content.dispatchEvent(new testWindow.Event('touchend', { bubbles: true }));
			} },
			{ name: 'scroll key', dispatch: () => content.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })) },
			{ name: 'direct scrollbar-style scroll', dispatch: () => {} },
		];
		for (const gesture of gestures) {
			gesture.dispatch();
			if (gesture.name !== 'direct scrollbar-style scroll') {
				assert(!follow.hidden, `${gesture.name} must immediately expose the follow button.`);
			}
			testWindow.scrollBy({ top: testWindow.innerHeight * 2, behavior: 'instant' });
			await settle();
			assert(!follow.hidden, `${gesture.name} must suspend automatic following.`);
			const detachedY = testWindow.scrollY;
			await advance();
			assert(Math.abs(testWindow.scrollY - detachedY) < 2, `${gesture.name}: the next sentence must not move the reader's scroll position.`);
			assert(!follow.hidden, `${gesture.name}: advancing speech must keep following suspended.`);
			follow.click();
			await settle();
			assert(follow.hidden, `${gesture.name}: the follow button must hide after resuming.`);
			assertCurrentVisible();
			passed.push(`${gesture.name} suspends following across sentences; the follow button restores the reading position`);
		}

		for (const input of [rate, volume]) {
			if (input === volume) volumeToggle.click();
			input.focus({ preventScroll: true });
			input.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
		}
		await settle();
		assert(follow.hidden, 'Range control keyboard input must not suspend following.');
		await selectSentence(65);
		assertCurrentVisible();
		assert(follow.hidden, 'Following must remain active after range keyboard input.');
		passed.push('Range keyboard input preserves automatic following');

		content.dispatchEvent(new testWindow.WheelEvent('wheel', { deltaY: 120, bubbles: true }));
		assert(!follow.hidden, 'The final stop check must start with following suspended.');
		stop.click();
		await settle();
		assertButtons(false);
		assert(follow.hidden && !doc.querySelector('.tts-current'), 'Stop must hide the follow action and clear the highlight.');
		passed.push('Play and stop exchange visibility, and stopping clears the detached follow action');
		return passed;
	} finally {
		try {
			if (win) win.dispatchEvent(new win.Event('pagehide'));
		} finally {
			frame.remove();
			if (savedRate === null) localStorage.removeItem(key);
			else localStorage.setItem(key, savedRate);
		}
	}
}
