#!/usr/bin/env node
/*
 * ux-diagnose 실행기: 로컬 Chrome(또는 Edge)을 헤드리스로 띄워 페이지를 열고
 *   1) dom-audit.js 자동 점검
 *   2) 실제 Tab 키로 초점 이동 점검(초점 순서, 초점 표시, 키보드 함정)
 * 을 한 뒤 JSON으로 출력한다. 외부 패키지 없이 Node 22 이상에서 동작한다.
 *
 * 사용법:
 *   node scripts/run-audit.mjs <URL> [URL ...] [--out 결과.json] [--screenshot 폴더] [--wait 1500]
 *        [--width 1280] [--height 900] [--max-tabs 80] [--no-keyboard] [--chrome 실행파일경로]
 *
 *   --screenshot 폴더: 페이지마다 전체 화면(NN-이름.png)과 흑백 화면(NN-이름-gray.png)을 저장한다.
 *                      콘텐츠 구분(5.4.4), 색에만 의존(5.4.1), 배경 이미지 위 글자 대비를 눈으로 확인할 때 쓴다.
 *
 * 로그인이 필요한 페이지는 이 실행기로 열 수 없다(새 브라우저 프로필이라 로그인 상태가 없음).
 * 그런 페이지는 사용자의 브라우저에서 dom-audit.js를 직접 실행한다.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT_JS = readFileSync(join(HERE, 'dom-audit.js'), 'utf8');

// ---------- 인자 ----------
const opts = { urls: [], out: null, screenshot: null, wait: 1500, width: 1280, height: 900, maxTabs: 80, keyboard: true, chrome: null };
{
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--out') opts.out = a[++i];
    else if (k === '--screenshot') opts.screenshot = a[++i];
    else if (k === '--wait') opts.wait = Number(a[++i]);
    else if (k === '--width') opts.width = Number(a[++i]);
    else if (k === '--height') opts.height = Number(a[++i]);
    else if (k === '--max-tabs') opts.maxTabs = Number(a[++i]);
    else if (k === '--no-keyboard') opts.keyboard = false;
    else if (k === '--chrome') opts.chrome = a[++i];
    else if (k === '-h' || k === '--help') {
      console.log('사용법: node scripts/run-audit.mjs <URL> [URL ...] [--out 결과.json] [--screenshot 폴더] [--wait ms] [--width px] [--height px] [--max-tabs n] [--no-keyboard] [--chrome 경로]');
      process.exit(0);
    } else opts.urls.push(k);
  }
  if (!opts.urls.length) {
    console.error('검사할 URL을 하나 이상 넣어 주세요. 예: node scripts/run-audit.mjs http://localhost:3000');
    process.exit(1);
  }
  if (typeof WebSocket === 'undefined') {
    console.error('Node 22 이상이 필요합니다 (내장 WebSocket 사용). 현재: ' + process.version);
    process.exit(1);
  }
}

function findChrome() {
  const env = opts.chrome || process.env.CHROME_PATH;
  if (env) return env;
  const c = {
    win32: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      (process.env.LOCALAPPDATA || '') + '/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
  }[process.platform] || [];
  const found = c.find((p) => p && existsSync(p));
  if (!found) throw new Error('Chrome 또는 Edge를 찾지 못했습니다. --chrome 경로 또는 CHROME_PATH 환경 변수로 지정해 주세요.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Chrome 실행과 DevTools 연결 ----------
async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'ux-diagnose-'));
  const proc = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      `--window-size=${opts.width},${opts.height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome DevTools 포트를 얻지 못했습니다.')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('Chrome이 종료되었습니다 (code ' + code + ')'));
    });
  });
  return { proc, port, profile };
}

async function connectPage(port) {
  let targets = [];
  for (let i = 0; i < 20 && !targets.length; i++) {
    targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page');
    if (!targets.length) await sleep(250);
  }
  if (!targets.length) throw new Error('열린 탭을 찾지 못했습니다.');
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('DevTools 연결 실패'));
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const once = (method, timeout) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeout);
      const fn = (p) => {
        clearTimeout(timer);
        listeners.get(method).delete(fn);
        resolve(p);
      };
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { ws, send, once, evaluate };
}

// ---------- 키보드 점검 (페이지 안에서 쓰는 도우미) ----------
const KB_SETUP = `(() => {
  const st = document.createElement('style');
  st.id = '__ux_kb_style';
  st.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(st);
  const look = (el) => {
    const s = getComputedStyle(el);
    const p = el.parentElement ? getComputedStyle(el.parentElement) : null;
    return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderWidth,
      s.backgroundColor, s.color, s.textDecorationLine, p ? p.outlineStyle + p.boxShadow + p.borderColor : ''].join('|');
  };
  const sel = (el) => {
    const parts = []; let n = el;
    while (n && n.nodeType === 1 && parts.length < 4) {
      let part = n.localName;
      if (n.id) { parts.unshift(part + '#' + CSS.escape(n.id)); break; }
      const cls = [...n.classList].filter(c => c.length < 30 && !/[:[\\]/]/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
      const p = n.parentElement;
      if (p) { const same = [...p.children].filter(c => c.localName === n.localName); if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')'; }
      parts.unshift(part); n = p;
    }
    return parts.join(' > ');
  };
  const base = new Map();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  for (const el of document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]')) base.set(el, look(el));
  window.__uxKb = { look, sel, base };
  // 같은 이름의 라디오 그룹은 Tab으로 한 번만 들르므로, 나머지 개수를 알려 준다
  const groups = new Map();
  for (const r of document.querySelectorAll('input[type="radio"][name]')) groups.set(r.name, (groups.get(r.name) || 0) + 1);
  let radioExtra = 0;
  for (const n of groups.values()) radioExtra += n - 1;
  let focusable = 0;
  for (const el of base.keys()) {
    const shown = el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }) : el.getClientRects().length > 0;
    if (shown && !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && !(el.localName === 'input' && el.type === 'hidden')) focusable++;
  }
  return JSON.stringify({ radioExtra, focusable });
})()`;

const KB_STEP = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return JSON.stringify({ body: true });
  const kb = window.__uxKb;
  const r = el.getBoundingClientRect();
  const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('title') || el.getAttribute('alt') || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const before = kb.base.get(el);
  const inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && r.width > 0 && r.height > 0;
  return JSON.stringify({
    sel: kb.sel(el), tag: el.localName, name,
    x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height),
    inView, changed: before === undefined ? null : before !== kb.look(el),
    inDialog: !!el.closest('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]'),
    frame: el.localName === 'iframe'
  });
})()`;

async function pressTab(send) {
  const base = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function keyboardCheck(page) {
  const issues = [];
  const add = (item, level, title, step, detail) => issues.push({ item, level, title, sample: { selector: step?.sel, text: step?.name, detail } });
  const { radioExtra, focusable } = JSON.parse(await page.evaluate(KB_SETUP));
  const expected = focusable - radioExtra;
  const steps = [];
  const seen = new Map();
  let stuck = 0;
  let frameSteps = 0;
  const limit = Math.min(opts.maxTabs, Math.max(focusable + 3, 5));
  let presses = 0;
  while (steps.length < limit && presses < limit + 40) {
    presses++;
    await pressTab(page.send);
    await sleep(30);
    const s = JSON.parse(await page.evaluate(KB_STEP));
    if (s.body) {
      if (steps.length) break; // 마지막 요소 다음으로 빠져나감: 정상 종료
      continue;
    }
    const prev = steps[steps.length - 1];
    if (prev && prev.sel === s.sel) {
      // iframe 안에서 초점이 움직이는 동안에는 바깥 문서에서 같은 요소로 보인다
      if (s.frame) {
        if (++frameSteps >= 30) {
          add('6.1.2', '확인 필요', 'iframe 안에서 Tab을 30번 눌러도 빠져나오지 않음 (키보드 함정 여부 확인)', s);
          break;
        }
        continue;
      }
      stuck++;
      if (stuck >= 2) {
        add('6.1.2', '위반 후보', '키보드 함정: Tab을 눌러도 초점이 이 요소에서 움직이지 않음', s);
        break;
      }
      continue;
    }
    stuck = 0;
    frameSteps = 0;
    if (seen.has(s.sel)) {
      if (!s.inDialog && steps.length < expected - 1)
        add('6.1.2', '확인 필요', '모든 요소를 지나기 전에 초점이 앞쪽 요소로 되돌아감 (키보드 함정 여부 확인)', s, `${steps.length}번째 이동 뒤 ${seen.get(s.sel) + 1}번째 요소로 돌아감`);
      break;
    }
    seen.set(s.sel, steps.length);
    steps.push(s);
    if (!s.frame && s.changed === false) add('6.1.2', '위반 후보', 'Tab으로 초점을 받아도 모양이 바뀌지 않음 (초점 표시 없음)', s);
    if (!s.inView) add('6.1.2', '위반 후보', 'Tab으로 초점을 받았는데 화면 밖에 있어 보이지 않음', s, `(${s.x},${s.y}) ${s.w}×${s.h}`);
  }
  // 위로 크게 되돌아가는 이동은 순서가 어색할 수 있음 (고정 헤더 등은 예외)
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    if (b.y < a.y - 400) add('6.1.2', '확인 필요', '초점이 화면 위쪽으로 크게 되돌아감 (논리적 순서인지 확인)', b, `(${a.x},${a.y}) → (${b.x},${b.y})`);
  }
  await page.evaluate(`document.getElementById('__ux_kb_style')?.remove(); document.activeElement?.blur(); true`);
  return {
    issues,
    order: steps.slice(0, 60).map((s) => `(${s.x},${s.y}) ${s.tag} ${s.name}${s.changed === false ? '  [초점 표시 없음]' : ''}${s.inView ? '' : '  [화면 밖]'}`),
    visited: steps.length,
  };
}

function mergeKeyboard(result, kb) {
  // 실제 Tab 점검을 했으면 스크립트 초점으로 추정한 초점 표시 결과는 뺀다
  result.checks = result.checks.filter((c) => !(c.item === '6.1.2' && c.title.startsWith('초점을 받아도 모양이 그대로임')));
  const map = new Map(result.checks.map((c) => [c.item + '|' + c.level + '|' + c.title, c]));
  for (const is of kb.issues) {
    const key = is.item + '|' + is.level + '|' + is.title;
    let c = map.get(key);
    if (!c) {
      c = { item: is.item, level: is.level, title: is.title, count: 0, samples: [], source: 'keyboard' };
      map.set(key, c);
      result.checks.push(c);
    }
    c.count++;
    if (c.samples.length < 15) c.samples.push(is.sample);
  }
  const order = { '위반 후보': 0, '확인 필요': 1, 권고: 2 };
  result.checks.sort((a, b) => a.item.localeCompare(b.item, undefined, { numeric: true }) || order[a.level] - order[b.level]);
  result.summary = { '위반 후보': 0, '확인 필요': 0, 권고: 0 };
  for (const c of result.checks) result.summary[c.level] += c.count;
  result.info.keyboardOrder = kb.order;
  result.info.keyboardVisited = kb.visited;
}

// ---------- 화면 저장 ----------
async function captureScreens(page, index, url) {
  mkdirSync(opts.screenshot, { recursive: true });
  const m = await page.send('Page.getLayoutMetrics');
  const size = m.cssContentSize || m.contentSize;
  const clip = { x: 0, y: 0, width: opts.width, height: Math.min(Math.ceil(size.height), 6000), scale: 1 };
  const slug = url.replace(/^\w+:\/+/, '').replace(/[^\w가-힣.-]+/g, '_').slice(-60) || 'page';
  const files = [];
  for (const [suffix, vision] of [['', 'none'], ['-gray', 'achromatopsia']]) {
    await page.send('Emulation.setEmulatedVisionDeficiency', { type: vision });
    const shot = await page.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    const file = join(opts.screenshot, `${String(index + 1).padStart(2, '0')}-${slug}${suffix}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    files.push(file);
  }
  await page.send('Emulation.setEmulatedVisionDeficiency', { type: 'none' });
  return files;
}

// ---------- 실행 ----------
async function auditUrl(page, url, index) {
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false });
  const loaded = page.once('Page.loadEventFired', 30000);
  const nav = await page.send('Page.navigate', { url });
  if (nav.errorText) throw new Error(`페이지를 열지 못했습니다: ${nav.errorText}`);
  if (!(await loaded)) console.error(`[경고] ${url} load 이벤트가 30초 안에 오지 않았습니다. 현재 상태로 점검합니다.`);
  await sleep(opts.wait); // SPA 렌더링 대기
  // 화면은 점검 전에 저장한다(초점 때문에 열린 메뉴 등이 찍히지 않게).
  const screenshots = opts.screenshot ? await captureScreens(page, index, url) : null;
  // 키보드 점검을 먼저 한다. dom-audit가 요소에 초점을 줬다 빼면 Tab 시작 위치가 바뀌기 때문이다.
  const kb = opts.keyboard ? await keyboardCheck(page) : null;
  const result = JSON.parse(await page.evaluate(AUDIT_JS));
  if (result.error) throw new Error('dom-audit 실행 오류: ' + result.error);
  if (kb) mergeKeyboard(result, kb);
  if (screenshots) result.info.screenshots = screenshots;
  return result;
}

const { proc, port, profile } = await launch();
let exitCode = 0;
try {
  const page = await connectPage(port);
  const results = [];
  for (const [i, url] of opts.urls.entries()) {
    try {
      results.push(await auditUrl(page, url, i));
      console.error(`[완료] ${url}`);
    } catch (e) {
      results.push({ tool: 'ux-diagnose dom-audit', meta: { url }, error: String(e.message || e) });
      console.error(`[실패] ${url}: ${e.message || e}`);
      exitCode = 1;
    }
  }
  const json = JSON.stringify(results.length === 1 ? results[0] : results, null, 1);
  if (opts.out) {
    writeFileSync(opts.out, json, 'utf8');
    console.error(`[저장] ${opts.out}`);
  } else {
    process.stdout.write(json + '\n');
  }
  page.ws.close();
} catch (e) {
  console.error('[오류] ' + (e.message || e));
  exitCode = 1;
} finally {
  proc.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 임시 프로필 삭제 실패는 무시 */
  }
}
process.exit(exitCode);
