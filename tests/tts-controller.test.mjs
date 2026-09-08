import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRate, SpeechReader } from '../src/scripts/tts-controller.ts';

function setup(t, overrides = {}) {
	const spoken = [];
	const states = [];
	let cancellations = 0;
	const reader = new SpeechReader({
		texts: ['最初の文。', '次の文。', '最後の文。'],
		synthesis: {
			speak: (utterance) => spoken.push(utterance),
			cancel: () => { ++cancellations; },
		},
		createUtterance: (text) => ({ text }),
		onState: (state) => states.push(state),
		...overrides,
	});
	t.after(() => reader.stop());
	return { reader, spoken, states, cancellations: () => cancellations };
}

test('speaks in order, highlights only after start, and finishes cleanly', (t) => {
	const { reader, spoken, states } = setup(t);
	reader.start();
	assert.deepEqual(states.at(-1), { status: 'starting', index: 0 });
	for (let index = 0; index < 3; ++index) {
		assert.equal(spoken.length, index + 1);
		spoken[index].onstart();
		assert.deepEqual(states.at(-1), { status: 'speaking', index });
		spoken[index].onend();
	}
	assert.equal(reader.active, false);
	assert.deepEqual(states.at(-1), { status: 'finished', index: -1 });
	// A duplicate browser event cannot restart the completed article.
	spoken[2].onend();
	assert.equal(spoken.length, 3);
});

test('stop invalidates delayed start, end, and error events; replay begins at the top', (t) => {
	const { reader, spoken, states } = setup(t);
	reader.start(1);
	const canceled = spoken[0];
	reader.stop();
	canceled.onstart();
	canceled.onend();
	canceled.onerror({ error: 'interrupted' });
	assert.equal(spoken.length, 1);
	assert.deepEqual(states.at(-1), { status: 'idle', index: -1 });
	reader.start();
	assert.equal(spoken[1].text, '最初の文。');
});

test('rapid sentence selections keep only the newest run and continue from there', (t) => {
	const { reader, spoken, states } = setup(t);
	reader.start();
	reader.start(2);
	reader.start(1);
	for (const old of spoken.slice(0, 2)) {
		old.onend();
		old.onerror({ error: 'canceled' });
		old.onstart();
	}
	assert.equal(spoken.length, 3);
	assert.deepEqual(states.at(-1), { status: 'starting', index: 1 });
	spoken[2].onstart();
	spoken[2].onend();
	assert.equal(spoken[3].text, '最後の文。');
});

test('synchronous cancellation events cannot cancel a replacement utterance', (t) => {
	let current;
	const { reader, states } = setup(t, {
		synthesis: {
			speak: (utterance) => { current = utterance; },
			cancel: () => current?.onerror({ error: 'interrupted' }),
		},
	});
	reader.start();
	reader.start(1);
	current.onstart();
	assert.deepEqual(states.at(-1), { status: 'speaking', index: 1 });
});

test('changing settings leaves current speech untouched and applies them to the next sentence', (t) => {
	const { reader, spoken, states, cancellations } = setup(t);
	reader.start(1);
	spoken[0].onstart();
	const previousStates = [...states];
	const previousCancellations = cancellations();
	reader.setSettings(1.7, 0.35);
	assert.equal(spoken.length, 1);
	assert.equal(spoken[0].text, '次の文。');
	assert.equal(spoken[0].rate, 1);
	assert.equal(spoken[0].volume, 1);
	assert.equal(cancellations(), previousCancellations);
	assert.deepEqual(states, previousStates);
	spoken[0].onend();
	assert.equal(spoken.length, 2);
	assert.equal(spoken[1].text, '最後の文。');
	assert.equal(spoken[1].rate, 1.7);
	assert.equal(spoken[1].volume, 0.35);
});

test('consecutive changes while speech is starting are deferred and sentence selection uses the latest settings', (t) => {
	const { reader, spoken, states, cancellations } = setup(t);
	reader.start();
	const previousStates = [...states];
	const previousCancellations = cancellations();
	reader.setSettings(1.4, 0.7);
	reader.setSettings(2.2, 0.2);
	assert.equal(spoken.length, 1);
	assert.equal(spoken[0].rate, 1);
	assert.equal(spoken[0].volume, 1);
	assert.equal(cancellations(), previousCancellations);
	assert.deepEqual(states, previousStates);
	reader.start(2);
	assert.equal(spoken.length, 2);
	assert.equal(spoken[1].text, '最後の文。');
	assert.equal(spoken[1].rate, 2.2);
	assert.equal(spoken[1].volume, 0.2);
});

test('genuine synthesis failures stop the queue and allow another play attempt', (t) => {
	const { reader, spoken, states } = setup(t);
	reader.start();
	spoken[0].onerror({ error: 'language-unavailable' });
	assert.deepEqual(states.at(-1), { status: 'error', index: -1, error: 'language-unavailable' });
	assert.equal(reader.active, false);
	spoken[0].onend();
	assert.equal(spoken.length, 1);
	reader.start();
	assert.equal(spoken.length, 2);
});

test('reports speak() exceptions and browsers that never dispatch start', async (t) => {
	const failed = setup(t, { synthesis: { speak: () => { throw new Error('unavailable'); }, cancel() {} } });
	failed.reader.start();
	assert.equal(failed.states.at(-1).error, 'synthesis-failed');
	const silent = setup(t, { startTimeoutMs: 10 });
	silent.reader.start();
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(silent.states.at(-1).error, 'start-timeout');
	silent.spoken[0].onstart();
	assert.equal(silent.reader.active, false);
});

test('invalid sentence selections do not interrupt active playback', (t) => {
	const { reader, spoken, cancellations } = setup(t);
	reader.start();
	for (const index of [-1, 3, NaN, 1.5]) reader.start(index);
	assert.equal(spoken.length, 1);
	assert.equal(cancellations(), 1);
});

test('restores valid rates and falls back safely for corrupt or unavailable storage values', () => {
	assert.equal(parseRate('1.7'), 1.7);
	assert.equal(parseRate('0.5'), 0.5);
	assert.equal(parseRate('3'), 3);
	for (const value of [null, undefined, '', 'bad', 'NaN', 'Infinity', '-1', '0', '3.1', true, {}]) {
		assert.equal(parseRate(value), 1);
	}
});
