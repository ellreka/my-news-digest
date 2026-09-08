export interface ReadingUnit {
  text: string;
  elements: HTMLElement[];
}

interface SentenceRange {
  start: number;
  end: number;
  unit: ReadingUnit;
  index: number;
}

const readableTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI']);
const boundaryTags = new Set([
  ...readableTags,
  'BLOCKQUOTE', 'DIV', 'UL', 'OL', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION',
  'SECTION', 'ARTICLE', 'TABLE', 'TR', 'TD', 'TH', 'HR', 'BR', 'PRE',
]);
const ignoredSelector = [
  '.sl-anchor-link', '[aria-hidden="true"]', '[hidden]', '[inert]', '[data-tts-ignore]',
  'button', 'input', 'select', 'textarea', 'script', 'style', 'noscript', 'template',
  'pre', 'svg', 'math', 'nav', 'audio', 'video', 'canvas', 'iframe',
].join(',');
const preparedRoots = new WeakMap<HTMLElement, ReadingUnit[]>();

/** Add sentence markers without moving links, emphasis, or other existing elements. */
export function prepareReadingUnits(root: HTMLElement): ReadingUnit[] {
  const prepared = preparedRoots.get(root);
  if (prepared) return prepared;

  const runs: Text[][] = [];
  let currentRun: Text[] = [];
  const finishRun = () => {
    if (currentRun.length) runs.push(currentRun);
    currentRun = [];
  };

  // Entering and leaving a block separates runs. In particular, an outer li never
  // collects the text from its nested p or li a second time.
  const visit = (node: Node, readable: boolean) => {
    if (node.nodeType === 3) {
      if (readable) currentRun.push(node as Text);
      return;
    }
    if (node.nodeType !== 1) return;

    const element = node as HTMLElement;
    const boundary = boundaryTags.has(element.tagName);
    if (boundary) finishRun();
    if (element.matches(ignoredSelector)
      || element.style.display === 'none'
      || element.style.visibility === 'hidden') return;

    const childReadable = readable || readableTags.has(element.tagName);
    for (const child of element.childNodes) visit(child, childReadable);
    if (boundary) finishRun();
  };

  visit(root, false);
  finishRun();

  const units: ReadingUnit[] = [];
  for (const run of runs) markSentences(run, units);
  preparedRoots.set(root, units);
  return units;
}

function sentenceSegments(text: string): { index: number; segment: string }[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'sentence' });
    const segments = Array.from(segmenter.segment(text), ({ index, segment }) => ({ index, segment }));
    for (let index = 0; index < segments.length - 1; index++) {
      const current = segments[index];
      const next = segments[index + 1];
      // Unicode sentence boundaries can attach the opening quote in `文。「次` to
      // the preceding sentence. Move only opening brackets and their whitespace,
      // keeping both segments' offsets aligned with the untouched source text.
      const opening = current.segment.match(/[「『（【〈《〔［｛〝][\s「『（【〈《〔［｛〝]*$/u)?.[0];
      if (!opening) continue;
      current.segment = current.segment.slice(0, -opening.length);
      next.segment = opening + next.segment;
      next.index -= opening.length;
    }
    return segments.filter(({ segment }) => segment.length > 0);
  }

  const segments: { index: number; segment: string }[] = [];
  // ASCII full stops split at a following space or end, preserving decimal
  // numbers and URL hostnames in browsers without Intl.Segmenter.
  const endings = /[。！？!?]+[」』）)\]】”’"']*|\.+[」』）)\]】”’"']*(?=\s|$)/gu;
  let start = 0;
  for (const match of text.matchAll(endings)) {
    const end = match.index + match[0].length;
    segments.push({ index: start, segment: text.slice(start, end) });
    start = end;
  }
  if (start < text.length) segments.push({ index: start, segment: text.slice(start) });
  return segments;
}

function isReadable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text)
    && !text.split(/\s+/u).every((token) => /^(?:https?:\/\/|www\.)\S+$/iu.test(token));
}

function markSentences(nodes: Text[], units: ReadingUnit[]): void {
  const source = nodes.map((node) => node.data).join('');
  if (!isReadable(source.trim())) return;

  const ranges: SentenceRange[] = [];
  for (const { index, segment } of sentenceSegments(source)) {
    const text = segment.replace(/\s+/gu, ' ').trim();
    if (!isReadable(text)) continue;

    const leadingSpace = segment.length - segment.trimStart().length;
    const unit: ReadingUnit = { text, elements: [] };
    ranges.push({
      start: index + leadingSpace,
      end: index + segment.trimEnd().length,
      unit,
      index: units.length,
    });
    units.push(unit);
  }

  let nodeStart = 0;
  for (const node of nodes) {
    const nodeEnd = nodeStart + node.data.length;
    const fragment = node.ownerDocument.createDocumentFragment();
    let offset = 0;

    for (const range of ranges) {
      const start = Math.max(range.start, nodeStart) - nodeStart;
      const end = Math.min(range.end, nodeEnd) - nodeStart;
      if (start >= end) continue;
      if (offset < start) fragment.append(node.data.slice(offset, start));

      const part = node.data.slice(start, end);
      if (part.trim()) {
        const span = node.ownerDocument.createElement('span');
        span.dataset.ttsUnit = String(range.index);
        span.textContent = part;
        fragment.append(span);
        range.unit.elements.push(span);
      } else {
        fragment.append(part);
      }
      offset = end;
    }

    if (offset > 0) {
      if (offset < node.data.length) fragment.append(node.data.slice(offset));
      node.replaceWith(fragment);
    }
    nodeStart = nodeEnd;
  }
}
