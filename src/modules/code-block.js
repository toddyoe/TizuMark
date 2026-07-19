// 代码块后处理：语法高亮（highlight.js）+ 行号包裹 + 缓存。
// 从 app.js 的 renderPreview 中抽取，独立后可单独测试、降低改动爆炸半径。
//
// 设计：纯函数式，依赖通过参数注入，不隐式读取全局 this。
//   - preview: 预览容器元素（含 <pre><code> 结构）
//   - opts.hljs: highlight.js 实例（浏览器传 window.hljs，测试传加载的实例）
//   - opts.cache: 缓存 Map（对应原 app.js 的 this._hljsCache）
//   - opts.lineNumbers: 是否开启行号（对应原 preview.classList.contains('code-line-numbers')）
//
// 关键修复（避免预览代码块出现多余 []）：
//   1. 已包裹 .code-scroll 的块直接跳过，避免对已包装内容重复切分/高亮；
//   2. 高亮前清除 hljs 的 dataset.highlighted，消除 "previously highlighted" 警告与错误处理；
//   3. 缓存键纳入行号状态，开/关行号不共用不匹配 display 规则的缓存。

function processCodeBlocks(preview, opts) {
  const { hljs, cache, lineNumbers } = opts;
  const lineNumOn = !!lineNumbers;

  if (typeof hljs !== 'undefined' && hljs) {
    try {
      preview.querySelectorAll('pre code').forEach((block) => {
        const cls = block.className || '';
        if (/language-(math|mermaid|katex)/.test(cls)) return;
        // 已包裹过（上一次渲染的结果）直接跳过，避免对已包 code-line 的内容重复切分/高亮
        if (block.querySelector('.code-scroll')) return;
        // 缓存键纳入行号状态：开/关行号不共用可能不匹配 display 规则的缓存
        const key = block.textContent + '|' + (lineNumOn ? 1 : 0);
        const cached = cache.get(key);
        if (cached !== undefined) {
          block.innerHTML = cached;
          return;
        }
        // 清除 hljs 上次高亮标记，避免 "previously highlighted" 警告与错误处理（行号数字被错误叠入文本）
        if (block.dataset.highlighted) {
          delete block.dataset.highlighted;
          block.className = (block.className || '').replace(/\bhljs\b/g, '').trim();
        }
        hljs.highlightElement(block);
        const lines = block.innerHTML.split('\n');
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
        let finalHtml;
        if (lines.length <= 1) {
          finalHtml = `<div class="code-scroll">${lines[0] || ''}</div>`;
        } else {
          finalHtml = `<div class="code-scroll">${
            lines.map((line, i) =>
              `<span class="code-line"><span class="code-line-num">${i + 1}</span><span class="code-line-text">${line || '&nbsp;'}</span></span>`
            ).join('')
          }</div>`;
        }
        block.innerHTML = finalHtml;
        cache.set(key, finalHtml);
      });
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[preview] HLJS error:', e);
    }
  } else {
    // 代码块行号（拆分代码行，CSS 控制行号显隐和换行）
    try {
      preview.querySelectorAll('pre code').forEach((block) => {
        if (block.querySelector('.code-scroll')) return;
        const lines = block.textContent.split('\n');
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (lines.length <= 1) {
          block.innerHTML = `<div class="code-scroll">${esc(lines[0] || '')}</div>`;
          return;
        }
        block.innerHTML = `<div class="code-scroll">${
          lines.map((line, i) =>
            `<span class="code-line"><span class="code-line-num">${i + 1}</span><span class="code-line-text">${esc(line) || '&nbsp;'}</span></span>`
          ).join('')
        }</div>`;
      });
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[preview] Code line error:', e);
    }
  }
}

// 浏览器：作为独立 <script> 加载，挂到全局 CodeBlock（与 unified-renderer.js 的 UnifiedRenderer 一致）
if (typeof window !== 'undefined' && typeof module === 'undefined') {
  window.CodeBlock = { processCodeBlocks };
}
// Node（测试 / 构建）：CommonJS 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { processCodeBlocks };
}
