// 真实浏览器回归测试：用 headless Chrome 通过 CDP 加载 test-browser.html，
// 实例化真实 MarkdownEditor，渲染含代码块的 markdown，断言预览代码块
// 不被多余的 [ ] 包裹（复现/守住 3c2c62f 修复的 bug）。
//
// 依赖：Chrome 安装在 C:\Program Files\Google\Chrome\Application\chrome.exe
//       CDP ws 库：C:\Users\admin\.claude\skills\browser\browser\node_modules\ws
// 运行：node test/browser/code-block-brackets.test.cjs
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/admin/.claude/skills/browser/browser/node_modules/ws');
const http = require('http');
const path = require('path');
const assert = require('node:assert');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = 'file:///' + path.resolve(__dirname, '../../src/test-browser.html').replace(/\\/g, '/');

function getJSON(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => res(JSON.parse(d))); }).on('error', rej);
  });
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function runChromeAndTest() {
  const prof = path.join(require('os').tmpdir(), 'cdp-br-prof');
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--remote-debugging-port=9334', '--user-data-dir=' + prof], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill(); } catch (e) {} };
  try {
    await wait(1500);
    const list = await getJSON('http://127.0.0.1:9334/json/version');
    const ws = new WebSocket(list.webSocketDebuggerUrl);
    const pending = {}; let msgId = 0;
    const send = (method, params, sessionId) => new Promise((res) => {
      const id = ++msgId; pending[id] = res;
      ws.send(JSON.stringify({ id, method, params: params || {}, sessionId: sessionId || undefined }));
    });
    await new Promise((r) => ws.on('open', r));
    ws.on('message', (m) => { const o = JSON.parse(m); if (o.id && pending[o.id]) { pending[o.id](o); delete pending[o.id]; } });

    const targets = await send('Target.getTargets');
    const page = targets.result.targetInfos.find((t) => t.type === 'page');
    const attached = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const sid = attached.result.sessionId;
    await send('Runtime.enable', {}, sid);
    await send('Page.enable', {}, sid);

    await send('Page.navigate', { url: HTML }, sid);
    await wait(1500);
    // 跳过 EULA，否则 init 会卡在等待用户点击
    await send('Runtime.evaluate', { expression: "localStorage.setItem('tizumark-eula-accepted','true')", returnByValue: true }, sid);
    await send('Page.reload', {}, sid);
    await wait(7000);

    const r = await send('Runtime.evaluate', {
      expression: `(async function () {
        try {
          var ed = window.editor;
          if (!ed || !ed.cm) return JSON.stringify({ error: 'no editor' });
          var md = "# 标题\\n\\n\`\`\`js\\nconst a=[1,2];\\nconst b=JSON.parse(\\"{}\\");\\n\`\`\`\\n";
          ed.cm.setValue(md);
          await ed.updatePreview();
          await new Promise(r => setTimeout(r, 300));
          function blockText() {
            var c = document.querySelector('.preview-content pre code');
            if (!c) return null;
            var s = c.querySelector(':scope > .code-scroll');
            return s ? s.textContent : c.textContent;
          }
          var results = {};
          results.off = blockText();
          ed.preview.classList.add('code-line-numbers');
          await ed.updatePreview();
          await new Promise(r => setTimeout(r, 300));
          results.on = blockText();
          await ed.updatePreview();
          await new Promise(r => setTimeout(r, 300));
          results.onAgain = blockText();
          return JSON.stringify(results);
        } catch (e) { return JSON.stringify({ error: e.message }); }
      })()`,
      returnByValue: true,
      awaitPromise: true,
    }, sid);

    const out = r.result && r.result.result ? JSON.parse(r.result.result.value) : null;
    await send('Browser.close').catch(() => {});

    assert.ok(out && !out.error, 'browser test failed: ' + JSON.stringify(out));
    for (const k of Object.keys(out)) {
      const t = (out[k] || '').trim();
      assert.strictEqual(t.startsWith('['), false, k + ': 代码块开头出现多余 [ -> ' + t.slice(0, 20));
      assert.strictEqual(t.endsWith(']'), false, k + ': 代码块结尾出现多余 ] -> ' + t.slice(-20));
    }
    console.log('真实浏览器回归测试通过:', JSON.stringify(out));
    return true;
  } finally {
    cleanup();
  }
}

(async () => {
  try {
    await runChromeAndTest();
    console.log('✅ 预览代码块无多余 [ ] 包裹');
    process.exit(0);
  } catch (e) {
    console.error('❌ 测试失败:', e.message);
    process.exit(1);
  }
})();
