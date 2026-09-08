/** Keep speech visible until the reader deliberately moves the page. */
export class ReadingFollower {
	private active = false;
	private following = true;
	private elements: HTMLElement[] = [];
	private expectedScrollY: number | undefined;
	private lastScrollY = window.scrollY;
	private frame = 0;
	private player: HTMLElement;
	private onChange: (detached: boolean) => void;

	constructor(player: HTMLElement, signal: AbortSignal, onChange: (detached: boolean) => void) {
		this.player = player;
		this.onChange = onChange;
		const inPlayer = (target: EventTarget | null) => target instanceof Node && player.contains(target);
		window.addEventListener('wheel', (event) => {
			if (!inPlayer(event.target) && (event.deltaY || event.deltaX)) this.detach();
		}, { passive: true, signal });
		let touch: { x: number; y: number } | undefined;
		window.addEventListener('touchstart', (event) => {
			const first = event.touches[0];
			touch = first && !inPlayer(event.target) ? { x: first.clientX, y: first.clientY } : undefined;
		}, { passive: true, signal });
		window.addEventListener('touchmove', (event) => {
			const first = event.touches[0];
			if (touch && first && Math.hypot(first.clientX - touch.x, first.clientY - touch.y) > 6) this.detach();
		}, { passive: true, signal });
		window.addEventListener('touchend', () => { touch = undefined; }, { passive: true, signal });
		window.addEventListener('touchcancel', () => { touch = undefined; }, { passive: true, signal });
		window.addEventListener('keydown', (event) => {
			if (event.defaultPrevented || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
			if (event.target instanceof Element && event.target.closest('input, textarea, select, button, summary, [role="button"], [contenteditable="true"]')) return;
			this.detach();
		}, { signal });
		// Also catch dragging the scrollbar, anchor navigation, and assistive scrolling.
		window.addEventListener('scroll', () => {
			const y = window.scrollY;
			if (Math.abs(y - this.lastScrollY) < 0.5) return;
			this.lastScrollY = y;
			if (this.expectedScrollY !== undefined && Math.abs(y - this.expectedScrollY) < 2) {
				this.expectedScrollY = undefined;
				return;
			}
			this.expectedScrollY = undefined;
			this.detach();
		}, { passive: true, signal });
		window.addEventListener('resize', () => this.refresh(), { passive: true, signal });
		window.visualViewport?.addEventListener('resize', () => this.refresh(), { passive: true, signal });
		signal.addEventListener('abort', () => cancelAnimationFrame(this.frame), { once: true });
	}

	begin(): void {
		this.active = true;
		this.following = true;
		this.lastScrollY = window.scrollY;
		this.onChange(false);
	}

	stop(): void {
		this.active = false;
		this.elements = [];
		cancelAnimationFrame(this.frame);
		this.onChange(false);
	}

	setCurrent(elements: HTMLElement[]): void {
		this.elements = elements;
		this.refresh();
	}

	resume(): void {
		if (!this.active) return;
		this.following = true;
		this.onChange(false);
		this.refresh();
	}

	refresh(): void {
		cancelAnimationFrame(this.frame);
		if (this.active && this.following) this.frame = requestAnimationFrame(() => this.keepVisible());
	}

	private detach(): void {
		if (!this.active || !this.following) return;
		this.following = false;
		cancelAnimationFrame(this.frame);
		this.onChange(true);
	}

	private keepVisible(): void {
		if (!this.active || !this.following) return;
		const rects = this.elements.flatMap((element) => Array.from(element.getClientRects()))
			.filter((rect) => rect.width > 0 && rect.height > 0);
		if (!rects.length) return;
		const top = Math.min(...rects.map((rect) => rect.top));
		const bottom = Math.max(...rects.map((rect) => rect.bottom));
		const viewport = window.visualViewport;
		const viewportTop = viewport?.offsetTop ?? 0;
		// Starlight's scroll padding includes its fixed header and mobile TOC.
		const headerSpace = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 16;
		const visibleTop = viewportTop + headerSpace;
		const visibleBottom = Math.min(viewportTop + (viewport?.height ?? window.innerHeight), this.player.getBoundingClientRect().top) - 12;
		const available = visibleBottom - visibleTop;
		if (available <= 0 || (top >= visibleTop && bottom <= visibleBottom)) return;
		// An unusually long sentence cannot fit: show its beginning instead of its end.
		const offset = Math.max(0, (available - (bottom - top)) / 2);
		const target = Math.min(
			Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
			Math.max(0, window.scrollY + top - visibleTop - offset),
		);
		if (Math.abs(target - window.scrollY) < 1) return;
		this.expectedScrollY = target;
		// Instant scrolling gives manual gestures immediate control and avoids an
		// animation's late scroll events being mistaken for further user scrolling.
		window.scrollTo({ top: target, behavior: 'instant' });
		this.expectedScrollY = window.scrollY;
	}
}
