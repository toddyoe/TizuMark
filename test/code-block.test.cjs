// 回归测试：代码块高亮 + 行号包裹。
// 锁定此前修复的 bug——切换代码行号开关后预览代码块出现多余 []（结构破损 / previously highlighted 警告）。
const test = require('node:test');
const assert = require('node:assert');
const { createPreviewDom, loadHljs, B } = require('./helpers/dom.js');
const { renderMarkdown } = require('../src/unified-renderer.js');
const { processCodeBlocks } = require('../src/modules/code-block.js');

function renderInto(preview, md) {
  preview.innerHTML = renderMarkdown(md, { softBreaks: false });
}

function structureOf(preview) {
  const code = preview.querySelector('pre code');
  const scroll = code && code.querySelector(':scope > .code-scroll');
  if (!scroll) return { ok: false, reason: 'no .code-scroll' };
  // 单行块：直接 <div class="code-scroll">内容</div>（无 .code-line 包裹，符合原实现）
  if (scroll.children.length === 0) return { ok: true };
  if (scroll.children.length === 1 && !scroll.children[0].classList.contains('code-line')) return { ok: true };
  // 多行块：每行应为 .code-line > (.code-line-num + .code-line-text)
  for (const ln of scroll.children) {
    if (!ln.classList.contains('code-line')) return { ok: false, reason: 'child not .code-line: ' + ln.className };
    if (!ln.querySelector(':scope > .code-line-num')) return { ok: false, reason: 'missing .code-line-num' };
    if (!ln.querySelector(':scope > .code-line-text')) return { ok: false, reason: 'missing .code-line-text' };
  }
  return { ok: true };
}

const SAMPLE = 'function binarySearch(arr, target) {\n  let left = 0;\n  console.log(binarySearch([1, 3, 5], 7));\n}\n';
const MD = B + B + B + 'javascript\n' + SAMPLE + B + B + B;

test('代码块基础结构合法（行号关闭）', () => {
  const { preview } = createPreviewDom();
  const hljs = loadHljs(preview.ownerDocument.defaultView);
  renderInto(preview, MD);
  const cache = new Map();
  processCodeBlocks(preview, { hljs, cache, lineNumbers: false });
  assert.deepStrictEqual(structureOf(preview), { ok: true });
});

test('行号开关来回切换不出现结构破损 / 无 previously highlighted 警告', () => {
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));

  const { preview } = createPreviewDom();
  const win = preview.ownerDocument.defaultView;
  const hljs = loadHljs(win);
  const cache = new Map();

  const states = [false, true, false, true, false];
  for (const on of states) {
    preview.classList.toggle('code-line-numbers', on);
    renderInto(preview, MD);
    processCodeBlocks(preview, { hljs, cache, lineNumbers: on });
    const s = structureOf(preview);
    assert.deepStrictEqual(s, { ok: true }, 'state=' + on + ' -> ' + (s.reason || 'ok'));
  }

  console.warn = origWarn;
  const prevHigh = warns.filter((w) => /previously highlighted/i.test(w));
  assert.strictEqual(prevHigh.length, 0, '存在 previously highlighted 警告: ' + prevHigh.join(' | '));
});

test('缓存键区分行号状态：开/关命中的是不同缓存', () => {
  const { preview } = createPreviewDom();
  const win = preview.ownerDocument.defaultView;
  const hljs = loadHljs(win);
  const cache = new Map();

  preview.classList.toggle('code-line-numbers', false);
  renderInto(preview, MD);
  processCodeBlocks(preview, { hljs, cache, lineNumbers: false });
  const offKey = [...cache.keys()].find((k) => k.includes('function'));
  assert.ok(offKey && offKey.endsWith('|0'), '关行号缓存键应以 |0 结尾: ' + offKey);

  preview.classList.toggle('code-line-numbers', true);
  renderInto(preview, MD);
  processCodeBlocks(preview, { hljs, cache, lineNumbers: true });
  const onKey = [...cache.keys()].find((k) => k.includes('function') && k.endsWith('|1'));
  assert.ok(onKey, '开行号应生成独立缓存键 |1');
});

test('math/mermaid/katex 代码块被跳过，不被行号包裹', () => {
  const { preview } = createPreviewDom();
  const win = preview.ownerDocument.defaultView;
  const hljs = loadHljs(win);
  const cache = new Map();
  const mdMath = B + B + B + 'mermaid\n' + 'graph TD; A-->B;\n' + B + B + B;
  renderInto(preview, mdMath);
  processCodeBlocks(preview, { hljs, cache, lineNumbers: true });
  const code = preview.querySelector('pre code');
  assert.strictEqual(code.querySelector('.code-scroll'), null, 'mermaid 块不应被包裹');
});

test('无 hljs 时仍能按行包裹（纯转义）', () => {
  const { preview } = createPreviewDom();
  const cache = new Map();
  renderInto(preview, MD);
  processCodeBlocks(preview, { hljs: undefined, cache, lineNumbers: false });
  const s = structureOf(preview);
  assert.deepStrictEqual(s, { ok: true });
  // 转义校验：含 < 的内容不应产生裸标签（用多行块验证 .code-line-text 转义）
  const mdHtml = B + B + B + 'html\n' + '<div>x</div>\n' + '<span>y</span>\n' + B + B + B;
  renderInto(preview, mdHtml);
  const cache2 = new Map();
  processCodeBlocks(preview, { hljs: undefined, cache: cache2, lineNumbers: false });
  const txt = preview.querySelector('pre code .code-line-text');
  assert.ok(txt, '多行块应存在 .code-line-text');
  assert.ok(txt.innerHTML.includes('&lt;'), '应包含转义后的 &lt;，实际: ' + txt.innerHTML);
});
