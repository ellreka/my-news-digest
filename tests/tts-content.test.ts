import { prepareReadingUnits } from '../src/scripts/tts-content';

/** Browser regression checks; run in the dev server with this module's export. */
export function runTtsContentTests(): string[] {
  const passed: string[] = [];
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };
  const fixture = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  };
  const textsEqual = (root: HTMLElement, expected: string[]) => {
    const actual = prepareReadingUnits(root).map((unit) => unit.text);
    assert(JSON.stringify(actual) === JSON.stringify(expected),
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  };

  {
    const root = fixture('<p>最初<strong>の文。次</strong><a href="/article">のリンクです。最後</a>。</p>');
    const strong = root.querySelector('strong');
    const link = root.querySelector('a');
    const originalText = root.textContent;
    textsEqual(root, ['最初の文。', '次のリンクです。', '最後。']);
    const units = prepareReadingUnits(root);
    assert(root.querySelector('strong') === strong, 'The emphasis element must be preserved.');
    assert(root.querySelector('a') === link && link?.getAttribute('href') === '/article',
      'The original link and its destination must be preserved.');
    assert(root.textContent === originalText, 'Wrapping must preserve the original visible text.');
    assert(strong?.querySelectorAll('[data-tts-unit]').length === 2,
      'A sentence boundary inside emphasis must produce separate markers.');
    assert(link?.querySelectorAll('[data-tts-unit]').length === 2,
      'A sentence boundary inside a link must preserve the link and split its markers.');
    units.forEach((unit, index) => {
      assert(unit.elements.map((element) => element.textContent).join('') === unit.text,
        'Markers across inline elements must cover the whole sentence.');
      assert(unit.elements.every((element) => element.dataset.ttsUnit === String(index)),
        'Every part of a sentence must share its unit index.');
    });
    assert(prepareReadingUnits(root) === units, 'Preparing twice must reuse the same units.');
    assert(!root.querySelector('[data-tts-unit] [data-tts-unit]'),
      'Preparing twice must not add nested wrappers.');
    passed.push('Inline formatting, links, sentence markers, and repeated preparation');
  }

  {
    const root = fixture('<ul><li>親の前。<p>親の段落。</p><ul><li>子。</li></ul>親の後。</li><li><p>次。</p></li></ul><blockquote><p>引用。</p></blockquote>');
    textsEqual(root, ['親の前。', '親の段落。', '子。', '親の後。', '次。', '引用。']);
    passed.push('Nested lists and quotes preserve document order without duplicate reading');
  }

  {
    const root = fixture('<h2>見出し<a class="sl-anchor-link">Section titled 見出し</a></h2><p>読む。<span aria-hidden="true">非表示。</span><span hidden>隠す。</span><span style="display:none">隠す。</span><button>操作。</button></p><pre><code>コード。</code></pre><div hidden><p>隠す。</p></div><p>https://example.com/path?a=1</p><p>www.example.com https://other.example</p><p>　</p><p>……</p>');
    textsEqual(root, ['見出し', '読む。']);
    assert(!root.querySelector('.sl-anchor-link [data-tts-unit], [hidden] [data-tts-unit], button [data-tts-unit], pre [data-tts-unit]'),
      'Excluded content must not receive markers.');
    passed.push('Heading anchors, hidden content, controls, code, and URL-only text are excluded');
  }

  {
    const root = fixture('<p>  最初の文。\n <em>次の</em>文。  </p><p>一行目<br>二行目</p>');
    const originalText = root.textContent;
    textsEqual(root, ['最初の文。', '次の文。', '一行目', '二行目']);
    assert(root.textContent === originalText, 'Source whitespace must remain unchanged.');
    passed.push('Whitespace is normalized only for speech and line breaks separate units');
  }

  {
    const root = fixture('<p>共通する。<a href="/testing">「テストを生成するな、信頼を生成しろ」</a>は実践だ。速度は1.5倍。</p><p>引用する。<strong>『「引用です。」』</strong>次です。</p><p>補足する。（補足だ。）次です。</p><p>前。「 後です。」次。</p>');
    const originalText = root.textContent;
    const link = root.querySelector('a');
    textsEqual(root, [
      '共通する。', '「テストを生成するな、信頼を生成しろ」は実践だ。', '速度は1.5倍。',
      '引用する。', '『「引用です。」』', '次です。',
      '補足する。', '（補足だ。）', '次です。',
      '前。', '「 後です。」', '次。',
    ]);
    assert(root.textContent === originalText, 'Boundary correction must preserve all source characters.');
    assert(root.querySelector('a') === link
      && link?.querySelector('[data-tts-unit]')?.getAttribute('data-tts-unit') === '1',
    'An opening quote inside a link must be marked as part of the following sentence.');
    for (const unit of prepareReadingUnits(root)) {
      assert(unit.elements.map((element) => element.textContent).join('') === unit.text,
        'Corrected sentence offsets must highlight the exact sentence, including its brackets.');
    }
    passed.push('Japanese opening brackets follow their sentence without moving closing brackets or decimals');
  }

  {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    try {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });
      const root = fixture('<p>速度は1.5倍。「最初です。」次です！English sentence. Another sentence.</p>');
      textsEqual(root, ['速度は1.5倍。', '「最初です。」', '次です！', 'English sentence.', 'Another sentence.']);
      passed.push('Sentence fallback handles Japanese quotes, English, and decimals');
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
      else Reflect.deleteProperty(Intl, 'Segmenter');
    }
  }

  return passed;
}
