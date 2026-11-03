/*
 * ux-diagnose DOM 자동 점검 (KWCAG 2.2)
 *
 * 검사할 페이지 안에서 실행한다.
 *   - 브라우저 자동화 도구의 "JavaScript 실행" 기능에 파일 내용을 그대로 넣는다.
 *   - 또는 개발자 도구 콘솔에 붙여 넣는다. 결과는 window.__uxDiagnoseResult 에도 저장되므로
 *     콘솔에서 copy(window.__uxDiagnoseResult) 로 복사할 수 있다.
 *
 * 결과는 JSON 문자열이다. 여기서 나온 항목은 "후보"이고, 최종 판정은 references/checks.md 기준으로 한다.
 * 페이지 내용은 바꾸지 않는다. 다만 초점 표시를 확인하려고 요소에 잠깐 초점을 주므로,
 * 초점을 받으면 동작하는 기능(메뉴 열림 등)이 실행될 수 있다. 점검 뒤 페이지를 새로 고치면 원래대로 돌아간다.
 */
(() => {
  'use strict';
  const MAX_SAMPLES = 15;
  const MAX_TEXT = 80;
  const started = performance.now();

  // ---------- 공통 도구 ----------
  const clip = (s, n = MAX_TEXT) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const norm = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);

  function selectorOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.localName;
      if (node.id) {
        parts.unshift(part + '#' + cssEscape(node.id));
        break;
      }
      const cls = [...node.classList].filter((c) => c.length < 30 && !/[:[\]/]/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map(cssEscape).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((ch) => ch.localName === node.localName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function isRendered(el) {
    if (!el || !el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      return el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
    }
    if (!el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }
  const isA11yHidden = (el) => !!el.closest('[aria-hidden="true"],[inert]');

  function isNativelyFocusable(el) {
    const t = el.localName;
    if ((t === 'a' || t === 'area') && el.hasAttribute('href')) return true;
    if (t === 'button' || t === 'select' || t === 'textarea') return !el.disabled;
    if (t === 'input') return el.type !== 'hidden' && !el.disabled;
    if (t === 'summary' || t === 'iframe') return true;
    return el.isContentEditable;
  }

  // 텍스트 + 하위 이미지 alt + svg title + aria-label 을 모은다 (접근 가능한 이름의 근사치)
  function textAlt(node) {
    let s = '';
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) {
        s += ch.nodeValue;
      } else if (ch.nodeType === 1) {
        if (ch.getAttribute('aria-hidden') === 'true') continue;
        if (ch.localName === 'svg') {
          const t = ch.querySelector('title');
          s += ' ' + (ch.getAttribute('aria-label') || (t ? t.textContent : '')) + ' ';
          continue;
        }
        if (!isRendered(ch)) continue;
        const lab = ch.getAttribute('aria-label');
        if (lab) {
          s += ' ' + lab + ' ';
          continue;
        }
        if (ch.localName === 'img' || (ch.localName === 'input' && ch.type === 'image')) {
          s += ' ' + (ch.getAttribute('alt') || '') + ' ';
          continue;
        }
        s += ' ' + textAlt(ch) + ' ';
      }
    }
    return s;
  }

  function labelledbyText(el) {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((n) => n.textContent)
      .join(' ')
      .trim();
  }

  function accName(el) {
    const lb = labelledbyText(el);
    if (lb) return clip(lb, 200);
    const al = (el.getAttribute('aria-label') || '').trim();
    if (al) return clip(al, 200);
    const tag = el.localName;
    if (tag === 'img' || (tag === 'input' && el.type === 'image')) {
      return clip(el.getAttribute('alt') || el.getAttribute('title') || '', 200);
    }
    if (tag === 'input' && ['submit', 'reset', 'button'].includes(el.type)) {
      return clip(el.value || (el.type !== 'button' ? '(기본 레이블)' : '') || el.title, 200);
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const labs = el.labels ? [...el.labels].map(textAlt).join(' ') : '';
      return clip(labs.trim() || el.getAttribute('title') || '', 200);
    }
    const t = textAlt(el).trim();
    return clip(t || el.getAttribute('title') || '', 200);
  }

  const visibleText = (el) =>
    el.localName === 'img' ? el.getAttribute('alt') || '' : el.innerText || el.getAttribute('aria-label') || el.value || '';

  // ---------- 결과 모음 ----------
  const checks = new Map();
  function report(item, level, title, el, detail) {
    const key = item + '|' + level + '|' + title;
    let c = checks.get(key);
    if (!c) {
      c = { item, level, title, count: 0, samples: [] };
      checks.set(key, c);
    }
    c.count++;
    if (c.samples.length < MAX_SAMPLES) {
      const s = {};
      if (el && el.nodeType === 1) {
        s.selector = selectorOf(el);
        const tx = clip(visibleText(el), 50);
        if (tx) s.text = tx;
      }
      if (detail !== undefined && detail !== null && detail !== '') s.detail = clip(detail, 160);
      c.samples.push(s);
    }
  }
  const info = {};

  // ---------- 색 계산 (명도 대비) ----------
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  // oklch, color() 등 어떤 형식이든 캔버스에 칠해 sRGB 값으로 읽는다
  function toRGBA(str) {
    if (colorCache.has(str)) return colorCache.get(str);
    let res = null;
    try {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillStyle = str;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      res = [d[0], d[1], d[2], d[3] / 255];
    } catch (e) {
      res = null;
    }
    colorCache.set(str, res);
    return res;
  }
  const blend = (top, a, base) => [0, 1, 2].map((i) => top[i] * a + base[i] * (1 - a));
  function background(el) {
    const layers = [];
    let opacity = 1;
    let node = el;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      opacity *= parseFloat(cs.opacity) || 1;
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return { unknown: '배경 이미지·그라데이션' };
      const c = toRGBA(cs.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 0.999) break;
      }
      node = node.parentElement;
    }
    let rgb = [255, 255, 255]; // 배경색이 끝까지 없으면 흰 화면으로 가정
    for (let i = layers.length - 1; i >= 0; i--) rgb = blend(layers[i], layers[i][3], rgb);
    return { rgb, opacity };
  }
  function luminance(rgb) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  }
  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const hex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

  // ---------- 초점 순서 ----------
  const FOCUS_CANDIDATES =
    'a[href],area[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable="true"],[contenteditable=""]';
  function tabOrder() {
    const positive = [];
    const zero = [];
    for (const el of document.querySelectorAll(FOCUS_CANDIDATES)) {
      if (!isRendered(el) || el.closest('[inert]')) continue;
      if (el.localName === 'input' && el.type === 'hidden') continue;
      if (el.disabled) continue;
      const ti = el.hasAttribute('tabindex') ? el.tabIndex : isNativelyFocusable(el) ? 0 : -1;
      if (ti > 0) positive.push([ti, el]);
      else if (ti === 0) zero.push(el);
    }
    positive.sort((a, b) => a[0] - b[0]);
    return positive.map((p) => p[1]).concat(zero);
  }

  try {
    const html = document.documentElement;
    const body = document.body;
    const pageText = (body.innerText || '').slice(0, 8000);

    // ===== 7.1.1 기본 언어 =====
    const lang = (html.getAttribute('lang') || '').trim();
    const hangul = (pageText.match(/[가-힣]/g) || []).length;
    const letters = (pageText.match(/[A-Za-z가-힣]/g) || []).length;
    if (!lang) report('7.1.1', '위반 후보', 'html 요소에 lang 속성 없음', html);
    else if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang)) report('7.1.1', '위반 후보', 'lang 값 형식이 잘못됨', html, lang);
    else if (letters > 50 && hangul / letters > 0.5 && !/^ko\b/i.test(lang))
      report('7.1.1', '위반 후보', '본문은 주로 한국어인데 lang이 한국어가 아님', html, `lang="${lang}", 한글 비율 ${Math.round((hangul / letters) * 100)}%`);

    // ===== 6.4.2 페이지 제목, 프레임 제목, 콘텐츠 블록 제목 =====
    const title = (document.title || '').trim();
    const DEFAULT_TITLE = /^(react app|vite \+ react( \+ ts)?|vite \+ vue( \+ ts)?|vite app|create next app|next\.js app|document|untitled|new tab)$/i;
    if (!title) report('6.4.2', '위반 후보', '페이지 title 없음', null);
    else if (DEFAULT_TITLE.test(title)) report('6.4.2', '위반 후보', '프레임워크 기본값 그대로인 title', null, title);
    else if (title.length < 3) report('6.4.2', '확인 필요', 'title이 너무 짧음 (페이지 내용을 알 수 있는지 확인)', null, title);
    if (/([^\w\s가-힣])\1{2,}/.test(title)) report('6.4.2', '확인 필요', 'title에 특수 기호 반복', null, title);

    for (const f of document.querySelectorAll('iframe,frame')) {
      if (!isRendered(f)) continue;
      const src = f.getAttribute('src') || '';
      if (!(f.getAttribute('title') || '').trim() && !(f.getAttribute('aria-label') || '').trim())
        report('6.4.2', '위반 후보', 'iframe에 title 없음', f, src);
      if (/youtube|youtu\.be|vimeo|tv\.naver|tv\.kakao/i.test(src)) report('5.2.1', '확인 필요', '외부 동영상 (자막·대본 제공 여부 확인)', f, src);
      if (/recaptcha|hcaptcha|turnstile|captcha/i.test(src)) report('7.3.3', '확인 필요', 'CAPTCHA 사용 (인지 기능 테스트가 아닌 대체 인증 수단 확인)', f, src);
    }

    const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter((h) => isRendered(h) && !isA11yHidden(h));
    const outline = [];
    let prevLevel = 0;
    let h1Count = 0;
    for (const h of heads) {
      const lvl = /^h[1-6]$/.test(h.localName) ? +h.localName[1] : parseInt(h.getAttribute('aria-level'), 10) || 2;
      const txt = clip(accName(h), 60);
      if (lvl === 1) h1Count++;
      if (!txt) report('6.4.2', '위반 후보', '내용 없는 제목(heading) 요소', h);
      if (prevLevel && lvl > prevLevel + 1) report('6.4.2', '확인 필요', `제목 수준 건너뜀 (h${prevLevel} 다음 h${lvl})`, h);
      prevLevel = lvl;
      if (outline.length < 60) outline.push(`h${lvl} ${txt}`);
    }
    if (!h1Count) report('6.4.2', '확인 필요', '페이지에 h1 없음', null);
    info.headings = outline;

    // ===== 5.1.1 대체 텍스트 =====
    const SUSPICIOUS_ALT = /^(image|img|photo|picture|icon|logo|banner|thumbnail|이미지|사진|그림|아이콘|배너|로고|썸네일)\s*\d*$|\.(png|jpe?g|gif|svg|webp|avif)$|^img[_-]?\d+$|^(undefined|null|alt)$/i;
    for (const img of document.querySelectorAll('img')) {
      if (!isRendered(img) || isA11yHidden(img)) continue;
      const role = (img.getAttribute('role') || '').toLowerCase();
      if (role === 'presentation' || role === 'none') continue;
      if (!img.hasAttribute('alt')) {
        report('5.1.1', '위반 후보', 'img에 alt 속성 없음', img, (img.currentSrc || img.src || '').split('/').pop());
        continue;
      }
      const alt = img.getAttribute('alt').trim();
      if (alt && SUSPICIOUS_ALT.test(alt)) report('5.1.1', '확인 필요', 'alt가 파일명이거나 의미 없는 단어', img, alt);
    }
    for (const el of document.querySelectorAll('input[type="image"]')) {
      if (isRendered(el) && !(el.getAttribute('alt') || '').trim()) report('5.1.1', '위반 후보', 'input type="image"에 alt 없음', el);
    }
    for (const el of document.querySelectorAll('[role="img"]')) {
      if (isRendered(el) && !isA11yHidden(el) && !(el.getAttribute('aria-label') || labelledbyText(el) || el.getAttribute('title')))
        report('5.1.1', '위반 후보', 'role="img"인데 aria-label 등 이름 없음', el);
    }

    // ===== 이름 없는 링크·버튼 (5.1.1 / 6.4.3 / 8.2.1), 6.4.3 링크 텍스트, 6.5.3 레이블과 네임 =====
    const CONTROLS =
      'a[href],button,input[type="button"],input[type="submit"],input[type="reset"],[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="switch"],[role="checkbox"],[role="option"]';
    const GENERIC_LINK = /^(더\s?보기|더\s?알아보기|자세히(\s?보기)?|여기|클릭|바로\s?가기|go|more|click( here)?|read more|learn more|link|링크|\+|>|›|»|→)$/i;
    for (const el of document.querySelectorAll(CONTROLS)) {
      if (!isRendered(el) || isA11yHidden(el)) continue;
      const name = accName(el).trim();
      const isLink = el.localName === 'a' || el.getAttribute('role') === 'link';
      if (!name) {
        const graphic = !!el.querySelector('img,svg,picture,i,[role="img"]');
        const item = graphic ? '5.1.1' : isLink ? '6.4.3' : '8.2.1';
        const what = isLink ? '링크' : '버튼·컨트롤';
        report(item, '위반 후보', graphic ? `아이콘·이미지만 있는 ${what}에 대체 텍스트 없음` : `읽을 수 있는 이름이 없는 ${what}`, el, el.getAttribute('href') || el.outerHTML.slice(0, 100));
        continue;
      }
      if (isLink && GENERIC_LINK.test(name)) report('6.4.3', '확인 필요', '목적을 알기 어려운 링크 텍스트 (주변 맥락으로 알 수 있는지 확인)', el, name);
      const al = el.getAttribute('aria-label');
      if (al) {
        const vis = norm(el.innerText);
        if (vis && !norm(al).includes(vis))
          report('6.5.3', '위반 후보', '화면에 보이는 텍스트가 aria-label에 들어 있지 않음', el, `보이는 텍스트 "${clip(el.innerText, 40)}" / aria-label "${clip(al, 40)}"`);
      }
    }

    // ===== 7.2.1 새 창 안내 =====
    for (const a of document.querySelectorAll('a[target="_blank" i]')) {
      if (!isRendered(a)) continue;
      const hint = (accName(a) + ' ' + (a.getAttribute('title') || '')).toLowerCase();
      if (!/새\s?창|새\s?탭|new (window|tab)|외부\s?링크|opens in/.test(hint)) report('7.2.1', '확인 필요', '새 창으로 열리는 링크인데 안내 없음', a, a.getAttribute('href'));
    }
    const refresh = document.querySelector('meta[http-equiv="refresh" i]');
    if (refresh) report('6.2.1', '위반 후보', 'meta refresh로 시간이 지나면 자동 새로 고침·이동', refresh, refresh.getAttribute('content'));

    // ===== 5.2.1 자막, 5.4.2 자동 재생, 6.2.2 움직이는 영상 =====
    for (const m of document.querySelectorAll('video,audio')) {
      const playing = !m.paused && !m.ended;
      const dur = isFinite(m.duration) ? m.duration.toFixed(1) + '초' : '길이 알 수 없음';
      if ((m.autoplay || playing) && !m.muted) report('5.4.2', '위반 후보', '소리가 있을 수 있는 미디어 자동 재생', m, `autoplay=${m.autoplay}, 재생 중=${playing}, ${dur}`);
      if ((m.autoplay || playing) && m.localName === 'video' && (m.loop || m.duration > 5) && !m.controls)
        report('6.2.2', '확인 필요', '자동 재생 영상에 정지 수단(controls 등) 없음', m, dur);
      if (m.localName === 'video' && !m.querySelector('track[kind="captions"],track[kind="subtitles"]'))
        report('5.2.1', '확인 필요', 'video에 자막 트랙 없음 (영상 안 자막·대본·수어 제공 여부 확인)', m);
      if (m.localName === 'audio') report('5.2.1', '확인 필요', '오디오 콘텐츠 (대본·자막 제공 여부 확인)', m);
    }

    // ===== 6.2.2 / 6.3.1 반복 애니메이션 =====
    if (document.getAnimations) {
      for (const a of document.getAnimations()) {
        const eff = a.effect;
        const target = eff && eff.target;
        if (!(target instanceof Element) || !isRendered(target)) continue;
        const tm = eff.getComputedTiming();
        if (tm.iterations !== Infinity) continue;
        const d = typeof tm.duration === 'number' ? Math.round(tm.duration) : NaN;
        report('6.2.2', '확인 필요', '계속 반복되는 애니메이션 (콘텐츠면 정지 수단 필요, 로딩 표시 등은 대개 해당 없음)', target, `${a.animationName || a.constructor.name}${isNaN(d) ? '' : ' ' + d + 'ms'}`);
        if (d > 0 && d < 334) report('6.3.1', '확인 필요', '초당 3회 이상 반복되는 애니메이션 (깜빡임·번쩍임 여부 확인)', target, `${d}ms 주기`);
      }
    }
    const sliderSeen = new Set();
    for (const el of document.querySelectorAll('[class*="carousel" i],[class*="swiper" i],[class*="slick" i],[class*="slider" i],[aria-roledescription*="carousel" i],marquee')) {
      if (!isRendered(el) || [...sliderSeen].some((s) => s.contains(el))) continue;
      sliderSeen.add(el);
      report('6.2.2', el.localName === 'marquee' ? '위반 후보' : '확인 필요', el.localName === 'marquee' ? 'marquee 사용 (움직임 정지 불가)' : '슬라이드·캐러셀 (자동 전환이면 정지·이전·다음 버튼 확인)', el);
    }

    // ===== 5.3.1 표 =====
    for (const t of document.querySelectorAll('table')) {
      if (!isRendered(t)) continue;
      const role = (t.getAttribute('role') || '').toLowerCase();
      if (role === 'presentation' || role === 'none') continue;
      if (!t.querySelector('th,[role="columnheader"],[role="rowheader"]')) report('5.3.1', '위반 후보', '데이터 표에 제목 셀(th) 없음', t);
      if (!t.querySelector('caption') && !t.getAttribute('aria-label') && !t.getAttribute('aria-labelledby') && !t.getAttribute('summary'))
        report('5.3.1', '확인 필요', '표 제목·요약(caption 등) 없음', t);
    }

    // ===== 7.3.2 레이블, 7.3.4 반복 입력(autocomplete) =====
    const PERSONAL = /\b(name|user(name)?|e-?mail|phone|tel|mobile|address|addr\d?|zip(code)?|postal(code)?)\b|이름|성명|이메일|전화|휴대|연락처|주소|우편/i;
    let fieldsOutsideForm = 0;
    for (const el of document.querySelectorAll('input,select,textarea')) {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (el.localName === 'input' && ['hidden', 'submit', 'reset', 'button', 'image'].includes(type)) continue;
      if (!isRendered(el) || isA11yHidden(el)) continue;
      if (!el.form) fieldsOutsideForm++;
      const labelled =
        (el.labels && [...el.labels].some((l) => textAlt(l).trim())) ||
        (el.getAttribute('aria-label') || '').trim() ||
        labelledbyText(el) ||
        (el.getAttribute('title') || '').trim();
      if (!labelled) {
        const ph = el.getAttribute('placeholder');
        report('7.3.2', '위반 후보', ph ? '레이블 없이 placeholder만 있는 입력 칸' : '레이블 없는 입력 칸', el, `${el.localName}${type ? '[type=' + type + ']' : ''} name=${el.name || '-'}${ph ? ' placeholder=' + ph : ''}`);
      }
      const key = [el.name, el.id, type, el.getAttribute('placeholder')].filter(Boolean).join(' ');
      if (el.localName === 'input' && type !== 'password' && PERSONAL.test(key) && !el.getAttribute('autocomplete'))
        report('7.3.4', '권고', '개인정보 입력 칸에 autocomplete 없음 (자동 입력 지원)', el, key);
    }

    // ===== 7.3.3 접근 가능한 인증 =====
    for (const pw of document.querySelectorAll('input[type="password"]')) {
      if (!isRendered(pw)) continue;
      const ac = (pw.getAttribute('autocomplete') || (pw.form && pw.form.getAttribute('autocomplete')) || '').toLowerCase();
      if (ac === 'off') report('7.3.3', '확인 필요', '비밀번호 칸 autocomplete="off" (비밀번호 관리자 자동 입력 방해 가능)', pw);
      else if (!ac) report('7.3.3', '권고', '비밀번호 칸에 autocomplete(current-password 또는 new-password) 없음', pw);
    }

    // ===== 7.3.1 오류 정정 (서식 요약, 실제 확인은 수동) =====
    const forms = [...document.querySelectorAll('form')].filter(isRendered);
    info.forms = forms.slice(0, 10).map((f) => ({
      selector: selectorOf(f),
      fields: f.querySelectorAll('input:not([type="hidden"]),select,textarea').length,
      required: f.querySelectorAll('[required],[aria-required="true"]').length,
      noValidate: f.noValidate,
      ariaInvalid: f.querySelectorAll('[aria-invalid]').length,
      ariaDescribedby: f.querySelectorAll('[aria-describedby]').length,
    }));
    info.fieldsOutsideForm = fieldsOutsideForm;
    if (forms.length || fieldsOutsideForm)
      report('7.3.1', '확인 필요', '입력 서식 있음 (빈 값·잘못된 값으로 오류 안내를 직접 확인)', forms[0] || null, `form ${forms.length}개, form 밖 입력 칸 ${fieldsOutsideForm}개`);

    // ===== 8.1.1 마크업 오류 =====
    const ids = new Map();
    for (const el of document.querySelectorAll('[id]')) if (el.id) ids.set(el.id, (ids.get(el.id) || 0) + 1);
    for (const [id, n] of ids) if (n > 1) report('8.1.1', '위반 후보', 'id 중복', document.getElementById(id), `id="${id}" ${n}회`);
    for (const el of document.querySelectorAll('[aria-labelledby],[aria-describedby],label[for]')) {
      for (const attr of ['aria-labelledby', 'aria-describedby', 'for']) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        for (const id of v.split(/\s+/)) if (id && !document.getElementById(id)) report('8.1.1', '위반 후보', `${attr}가 존재하지 않는 id를 가리킴`, el, id);
      }
    }
    for (const el of document.querySelectorAll('a[href] a[href], a[href] button, button a[href], button button, a[href] input, button input, a[href] select, button select, a[href] textarea, button textarea'))
      report('8.1.1', '위반 후보', '링크·버튼 안에 링크·버튼·입력 칸이 중첩됨', el);

    // ===== 8.2.1 / 6.1.1 ARIA 위젯 =====
    for (const el of document.querySelectorAll('[role]')) {
      if (!isRendered(el) || isA11yHidden(el)) continue;
      const role = el.getAttribute('role').trim().split(/\s+/)[0].toLowerCase();
      if (['button', 'link', 'checkbox', 'switch', 'slider', 'spinbutton', 'textbox'].includes(role) && !isNativelyFocusable(el) && !el.hasAttribute('tabindex'))
        report('6.1.1', '위반 후보', `role="${role}"인데 키보드 초점을 받을 수 없음 (tabindex 없음)`, el);
      if (['checkbox', 'switch', 'radio'].includes(role) && el.localName !== 'input' && !el.hasAttribute('aria-checked'))
        report('8.2.1', '위반 후보', `role="${role}"인데 aria-checked 상태 없음`, el);
      if (role === 'tab' && !el.hasAttribute('aria-selected')) report('8.2.1', '위반 후보', 'role="tab"인데 aria-selected 상태 없음', el);
      if ((role === 'dialog' || role === 'alertdialog') && !(el.getAttribute('aria-label') || labelledbyText(el)))
        report('8.2.1', '확인 필요', '대화상자에 이름(aria-labelledby·aria-label) 없음', el);
    }
    for (const d of document.querySelectorAll('dialog')) {
      if (isRendered(d) && !d.getAttribute('role') && !(d.getAttribute('aria-label') || labelledbyText(d))) report('8.2.1', '확인 필요', '대화상자에 이름(aria-labelledby·aria-label) 없음', d);
    }
    for (const a of document.querySelectorAll('a[href="#"], a[href^="javascript:" i]')) {
      if (isRendered(a)) report('8.2.1', '확인 필요', '이동하지 않는 링크(href="#", javascript:)를 버튼처럼 사용', a, a.getAttribute('href'));
    }

    // ===== 6.5.1 끌기 =====
    for (const el of document.querySelectorAll('[draggable="true"]')) {
      if (isRendered(el)) report('6.5.1', '확인 필요', '끌어서 놓기 요소 (클릭·버튼 같은 단일 포인터 대안 확인)', el);
    }

    // ===== 전체 요소 훑기: 6.1.1 마우스 전용 요소, 5.3.2 시각 순서 변경 =====
    const POINTER_OK =
      'a[href],button,input,select,textarea,label,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[role="tab"],[role="menuitem"],[role="option"],[role="slider"],[role="combobox"],[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
    const all = body.querySelectorAll('*');
    for (let i = 0; i < all.length && i < 8000; i++) {
      const el = all[i];
      if (['script', 'style', 'noscript', 'template', 'path', 'g'].includes(el.localName)) continue;
      const cs = getComputedStyle(el);
      if (cs.cursor === 'pointer' && !el.closest(POINTER_OK)) {
        const p = el.parentElement;
        if (!(p && getComputedStyle(p).cursor === 'pointer') && isRendered(el))
          report('6.1.1', '확인 필요', '마우스 포인터 모양인데 키보드로 갈 수 없는 요소 (클릭 기능이면 button·a로 바꿔야 함)', el);
      }
      if ((cs.display.includes('flex') || cs.display.includes('grid')) && el.children.length > 1) {
        if (cs.flexDirection.endsWith('reverse') && cs.display.includes('flex')) report('5.3.2', '확인 필요', 'flex-direction 역순 (화면 순서와 읽는 순서가 다른지 확인)', el, cs.flexDirection);
        if ([...el.children].some((ch) => getComputedStyle(ch).order !== '0')) report('5.3.2', '확인 필요', 'CSS order로 화면 순서 변경 (읽는 순서 확인)', el);
      }
    }
    for (const el of document.querySelectorAll('[tabindex]')) {
      const v = parseInt(el.getAttribute('tabindex'), 10);
      if (v > 0 && isRendered(el)) report('6.1.2', '확인 필요', 'tabindex가 양수 (초점 순서가 화면 순서와 달라질 수 있음)', el, `tabindex=${v}`);
    }

    // ===== 6.4.1 건너뛰기 링크, 초점 순서 정보 =====
    const order = tabOrder();
    info.tabOrder = order.slice(0, 40).map((el) => {
      const r = el.getBoundingClientRect();
      return `(${Math.round(r.left + scrollX)},${Math.round(r.top + scrollY)}) ${el.localName} ${clip(accName(el), 30)}`;
    });
    info.focusableCount = order.length;
    const first = order[0];
    const firstHref = first && first.localName === 'a' ? first.getAttribute('href') || '' : '';
    if (firstHref.startsWith('#') && firstHref.length > 1) {
      const id = decodeURIComponent(firstHref.slice(1));
      const exists = !!document.getElementById(id) || document.getElementsByName(id).length > 0;
      info.skipLink = { text: accName(first), href: firstHref, targetExists: exists };
      if (!exists) report('6.4.1', '위반 후보', '건너뛰기 링크의 목적지 id가 없음', first, firstHref);
    } else {
      info.skipLink = null;
      report('6.4.1', '위반 후보', '첫 번째 초점 요소가 본문 바로가기(건너뛰기) 링크가 아님', first || null, first ? `첫 초점: ${first.localName} "${clip(accName(first), 30)}"` : '초점 받을 요소 없음');
    }
    info.landmarks = {
      main: document.querySelectorAll('main,[role="main"]').length,
      nav: document.querySelectorAll('nav,[role="navigation"]').length,
      header: document.querySelectorAll('header,[role="banner"]').length,
      footer: document.querySelectorAll('footer,[role="contentinfo"]').length,
    };

    // ===== 6.1.3 컨트롤 크기 (대각선 6.0mm ≈ 22.7 CSS px 권고) =====
    for (const el of order) {
      if (el.labels && el.labels.length) continue; // 레이블을 눌러도 되면 레이블까지가 조작 영역
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || (r.width <= 1 && r.height <= 1)) continue;
      if (Math.hypot(r.width, r.height) < 22.7) report('6.1.3', '권고', '컨트롤 크기가 작음 (대각선 6mm ≈ 22.7px 미만)', el, `${Math.round(r.width)}×${Math.round(r.height)}px`);
    }

    // ===== 5.4.1 문장 속 링크를 색으로만 구분 =====
    for (const a of document.querySelectorAll('p a[href], li a[href], td a[href], dd a[href]')) {
      if (!isRendered(a)) continue;
      const parent = a.parentElement;
      const rest = (parent.textContent || '').replace(a.textContent, '').trim();
      if (rest.length < 5) continue;
      const cs = getComputedStyle(a);
      const ps = getComputedStyle(parent);
      const underline = cs.textDecorationLine.includes('underline');
      const border = parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== 'none';
      const bolder = parseInt(cs.fontWeight, 10) - parseInt(ps.fontWeight, 10) >= 300;
      if (!underline && !border && !bolder && cs.color !== ps.color) report('5.4.1', '확인 필요', '문장 속 링크를 색으로만 구분함 (밑줄 등 다른 표시 확인)', a);
    }

    // ===== 5.4.3 명도 대비, 5.3.3 감각 의존 지시 =====
    const SENSORY = /(빨간|빨강|붉은|파란|파랑|초록|녹색|노란|노랑|주황|보라)\s*(색|색깔)?\s*(으로|의)?\s*(표시|버튼|글씨|글자|부분|항목|칸|아이콘)|(동그란|둥근|네모|세모|삼각형|별)\s*(모양)?\s*(의)?\s*(버튼|아이콘)|(오른쪽|왼쪽|위쪽|아래쪽|상단|하단|우측|좌측)\s*(에|의)?\s*(있는\s*)?(버튼|메뉴|아이콘|링크)|(소리|비프음|효과음)(로|으로|가)\s*(알려|안내)/;
    const textEls = new Set();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    while (walker.nextNode() && textEls.size < 3000) {
      const node = walker.currentNode;
      const p = node.parentElement;
      if (!p || p.closest('script,style,noscript,template,option,svg')) continue;
      textEls.add(p);
      const m = node.nodeValue.match(SENSORY);
      if (m && isRendered(p)) report('5.3.3', '확인 필요', '모양·위치·색·소리에만 기대는 지시문일 수 있음', p, m[0]);
    }
    const stat = { checked: 0, failed: 0, unknown: 0 };
    for (const el of textEls) {
      if (!isRendered(el)) continue;
      if (el.closest(':disabled,[aria-disabled="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // 화면에 안 보이는 스크린리더 전용 텍스트
      const cs = getComputedStyle(el);
      const fg = toRGBA(cs.color);
      const bg = background(el);
      if (!fg || fg[3] === 0 || bg.unknown) {
        stat.unknown++;
        report('5.4.3', '확인 필요', `대비를 자동 계산할 수 없는 텍스트 (${bg.unknown || '글자색 투명'}) - 화면에서 직접 확인`, el);
        continue;
      }
      stat.checked++;
      const fgRgb = blend(fg, fg[3] * bg.opacity, bg.rgb);
      const ratio = contrast(fgRgb, bg.rgb);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        stat.failed++;
        report('5.4.3', '위반 후보', large ? '큰 텍스트 명도 대비 3:1 미만' : '텍스트 명도 대비 4.5:1 미만', el, `${ratio.toFixed(2)}:1 (글자 ${hex(fgRgb)}, 배경 ${hex(bg.rgb)}, ${size}px ${weight})`);
      }
    }
    info.contrast = stat;

    // ===== 7.2.2 도움 정보 위치 (여러 페이지 비교용) =====
    const HELP = /(고객\s?센터|고객\s?지원|문의|도움말|FAQ|자주\s?묻는|챗봇|채팅\s?상담|상담|contact|help|support)/i;
    const clickables = [...document.querySelectorAll('a[href],button')].filter(isRendered);
    info.helpLinks = clickables
      .map((el, i) => [i, accName(el)])
      .filter(([, n]) => HELP.test(n))
      .slice(0, 10)
      .map(([i, n]) => `${i + 1}/${clickables.length} ${clip(n, 30)}`);

    // ===== 6.1.2 초점 표시, 7.2.1 초점만으로 맥락 변화 =====
    const DIALOGS = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
    const countDialogs = () => [...document.querySelectorAll(DIALOGS)].filter(isRendered).length;
    const focusLook = (el) => {
      const s = getComputedStyle(el);
      const p = el.parentElement ? getComputedStyle(el.parentElement) : null;
      return [
        s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderWidth,
        s.backgroundColor, s.color, s.textDecorationLine,
        p ? p.outlineStyle + p.boxShadow + p.borderColor : '',
      ].join('|');
    };
    const prevActive = document.activeElement;
    const origOpen = window.open;
    const opened = [];
    window.open = function (url) {
      opened.push(String(url || ''));
      return null;
    };
    let focusChecked = 0;
    let focusUnverified = 0;
    try {
      for (const el of order.slice(0, 80)) {
        if (el.localName === 'iframe') continue;
        const targets = [el, el.parentElement].filter(Boolean);
        const savedTransition = targets.map((t) => t.style.transition);
        targets.forEach((t) => (t.style.transition = 'none')); // 전환 효과 때문에 초점 스타일이 늦게 바뀌는 것을 막음
        try {
          const before = focusLook(el);
          const dialogsBefore = countDialogs();
          const openedBefore = opened.length;
          el.focus({ preventScroll: true, focusVisible: true });
          if (document.activeElement !== el) continue;
          focusChecked++;
          // 스크립트로 준 초점에는 브라우저가 :focus-visible 을 켜지 않을 수 있다. 켜진 경우만 비교한다.
          if (!el.matches(':focus-visible')) focusUnverified++;
          else if (focusLook(el) === before) report('6.1.2', '확인 필요', '초점을 받아도 모양이 그대로임 (키보드 Tab으로 직접 확인)', el);
          if (opened.length > openedBefore) report('7.2.1', '위반 후보', '초점만 받았는데 새 창을 열려고 함', el, opened[opened.length - 1]);
          if (countDialogs() > dialogsBefore) report('7.2.1', '확인 필요', '초점만 받았는데 대화상자·팝업이 나타남', el);
          el.blur();
        } finally {
          targets.forEach((t, i) => (t.style.transition = savedTransition[i]));
        }
      }
    } finally {
      window.open = origOpen;
      if (prevActive && typeof prevActive.focus === 'function') {
        try {
          prevActive.focus({ preventScroll: true });
        } catch (e) {
          /* 무시 */
        }
      }
    }
    info.focusChecked = focusChecked;
    info.focusUnverified = focusUnverified; // 이 수가 크면 초점 표시는 키보드 Tab 점검으로 확인한다
    info.dialogsVisibleAtLoad = countDialogs();
    if (info.dialogsVisibleAtLoad) report('7.2.1', '확인 필요', '페이지에 대화상자·레이어 팝업이 떠 있음 (사용자가 연 것인지, 닫기가 되는지 확인)', document.querySelector(DIALOGS));

    // ---------- 정리 ----------
    const LEVEL_ORDER = { '위반 후보': 0, '확인 필요': 1, 권고: 2 };
    const list = [...checks.values()].sort(
      (a, b) => a.item.localeCompare(b.item, undefined, { numeric: true }) || LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]
    );
    const summary = { '위반 후보': 0, '확인 필요': 0, 권고: 0 };
    for (const c of list) summary[c.level] += c.count;
    const result = {
      tool: 'ux-diagnose dom-audit',
      version: 1,
      meta: {
        url: location.href,
        title,
        lang,
        viewport: `${innerWidth}x${innerHeight}`,
        elements: all.length,
        elapsedMs: Math.round(performance.now() - started),
        note: '모든 항목은 후보다. 판정은 references/checks.md 기준으로 확인한다.',
      },
      summary,
      checks: list,
      info,
    };
    const json = JSON.stringify(result, null, 1);
    window.__uxDiagnoseResult = json;
    return json;
  } catch (err) {
    const json = JSON.stringify({ tool: 'ux-diagnose dom-audit', error: String(err && err.stack ? err.stack : err) });
    window.__uxDiagnoseResult = json;
    return json;
  }
})();
