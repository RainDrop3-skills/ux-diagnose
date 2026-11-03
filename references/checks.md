# 항목별 검사 방법과 판정 기준

`references/kwcag22.md`의 33개 검사항목을 실제로 확인하는 방법이다. 항목마다 다음 순서로 적었다.

- **방식**: 자동(스크립트로 판정 가능) / 반자동(스크립트가 후보를 찾고 사람이 판단) / 수동(화면·동작을 직접 확인)
- **스크립트**: `dom-audit.js` 결과에서 이 항목을 보는 곳. `run-audit.mjs`를 쓰면 키보드 점검 결과도 같은 `checks`에 들어간다.
- **코드**: 소스에서 찾을 패턴. Grep(ripgrep) 정규식이며 앞뒤 탐색(lookaround)은 쓰지 않는다. 찾은 줄은 앞뒤 맥락을 읽고 판단한다. 기본 대상 확장자: `*.{html,jsx,tsx,js,ts,vue,svelte,css,scss}`
- **직접 확인**: 스크립트·코드로 판단할 수 없어 화면이나 동작으로 봐야 하는 것
- **판정**: 위반으로 볼 조건. 원문 예외에 해당하면 위반이 아니다.
- **수정 예시**

## 판정 단계와 심각도

| 판정 | 뜻 |
|---|---|
| 위반 | 근거(위치 + 코드 또는 측정값)가 있고 원문 예외에 해당하지 않는다 |
| 확인 필요 | 자동으로 판단할 수 없다. 무엇을 보면 되는지 함께 적는다 |
| 권고 | 원문이 "바람직하다"로 쓴 요구(6.1.3 크기 등)나 사용성 개선 |
| 준수 | 검사했고 문제를 찾지 못했다 |
| 해당 없음 | 그 콘텐츠가 없다(예: 동영상이 없으면 5.2.1) |

스크립트의 `위반 후보`는 그대로 위반이 아니다. 예외에 해당하는지, 실제 화면에서도 문제인지 보고 위반으로 확정한다.

위반의 심각도는 사용자가 겪는 결과로 정한다.
- **높음**: 기능을 아예 쓸 수 없다. 키보드 함정, 키보드로 못 쓰는 핵심 기능, 이름 없는 핵심 버튼·링크, 레이블 없는 필수 입력, 자동 재생 소리, 번쩍임.
- **중간**: 쓸 수는 있지만 이해하거나 찾기 어렵다. 명도 대비, 페이지 제목, 링크 텍스트, lang, 오류 안내, 초점 표시.
- **낮음**: 불편하거나 일부 사용자에게만 영향이 있다. 컨트롤 크기, 표 요약, autocomplete.

---

## 5.1.1 적절한 대체 텍스트 제공
- 방식: 반자동. 대체 텍스트가 **있는지**는 자동, **적절한지**는 사람이 판단한다.
- 스크립트: `img에 alt 속성 없음`, `아이콘·이미지만 있는 링크/버튼에 대체 텍스트 없음`, `alt가 파일명이거나 의미 없는 단어`, `role="img"인데 이름 없음`
- 코드
  - 이미지 태그: `<(img|Image)\b` 를 찾고 태그 안에 `alt`가 있는지 본다(여러 줄에 걸친 태그 주의).
  - 아이콘 버튼: `<(button|a)\b[^>]*>\s*<(svg|[A-Z]\w*Icon|Icon)\b` (multiline). `aria-label`이나 숨김 텍스트(`sr-only`)가 있는지 본다.
  - 배경 이미지: `background(-image)?:\s*url\(|bg-\[url` 로 찾고, 의미 있는 이미지인지 본다.
  - 차트: `recharts|chart\.js|react-chartjs|lightweight-charts|apexcharts|<canvas` 가 있으면 차트를 설명하는 텍스트가 있는지 본다.
- 직접 확인: 스크린샷과 대조해 alt가 이미지의 의미·용도를 전달하는지. 장식 이미지는 `alt=""`인지. 데이터 차트는 수치나 결론을 텍스트로도 주는지.
- 판정: 의미 있는 이미지·아이콘 버튼에 대체 텍스트가 없거나, 의미와 다른 대체 텍스트(파일명, "이미지")면 위반. 장식 이미지에 `alt=""`는 준수.
- 수정 예시
  ```jsx
  <img src="/logo.png" alt="봄동마켓" />
  <img src="/divider.png" alt="" />                {/* 장식 */}
  <button aria-label="장바구니에 담기"><CartIcon aria-hidden="true" /></button>
  ```

## 5.2.1 자막 제공
- 방식: 반자동
- 스크립트: `video에 자막 트랙 없음`, `외부 동영상`, `오디오 콘텐츠`
- 코드: `<video\b|<audio\b|youtube\.com/embed|player\.vimeo|<track\b`
- 직접 확인: 영상 안에 자막이 박혀 있는지, 페이지에 대본이 있는지, 소리 없는 배경 영상인지(대사가 없으면 화면해설 대상인지 판단).
- 판정: 말이나 소리 정보가 있는 영상·음성에 자막, 대본, 수어가 하나도 없으면 위반. 대사·소리 정보가 없는 장식 영상은 해당 없음으로 볼 수 있으나 근거를 적는다.
- 수정 예시: `<video controls><source src="intro.mp4"><track kind="captions" src="intro.ko.vtt" srclang="ko" label="한국어"></video>`

## 5.3.1 표의 구성
- 방식: 반자동
- 스크립트: `데이터 표에 제목 셀(th) 없음`, `표 제목·요약(caption 등) 없음`
- 코드: `<table\b`, `<th\b`, `<caption\b`. 표 라이브러리(`@tanstack/react-table|ag-grid|DataGrid`)는 렌더링 결과로 본다.
- 직접 확인: 레이아웃용 표인지 데이터 표인지. 레이아웃용이면 `role="presentation"`.
- 판정: 데이터 표에 제목 셀이 없으면 위반. caption 등 표 정보가 없으면 확인 필요(주변 제목으로 충분히 설명되는지 본다).
- 수정 예시
  ```html
  <table><caption>주문 목록: 상품, 수량, 금액</caption>
    <tr><th scope="col">상품</th><th scope="col">수량</th></tr>
    <tr><td>상추</td><td>2</td></tr></table>
  ```

## 5.3.2 콘텐츠의 선형구조
- 방식: 반자동
- 스크립트: `flex-direction 역순`, `CSS order로 화면 순서 변경`, 그리고 `info.tabOrder`(초점 순서와 좌표)
- 코드: `flex-(row|col)-reverse|flex-direction:\s*\w+-reverse|\border-\d|order:\s*-?\d|grid-area|position:\s*absolute`
- 직접 확인: CSS를 끈 상태(또는 DOM 순서)로 읽었을 때 내용이 말이 되는지. 화면에서 아래에 있는 요약이 DOM에서는 맨 앞에 있지 않은지.
- 판정: DOM 순서대로 읽으면 맥락이 깨지면 위반.
- 수정 예시: 시각 순서를 CSS로 뒤집지 말고 DOM 순서 자체를 바꾼다.

## 5.3.3 명확한 지시사항 제공
- 방식: 반자동
- 스크립트: `모양·위치·색·소리에만 기대는 지시문일 수 있음`
- 코드(한국어 문구): `(오른쪽|왼쪽|위쪽|아래쪽|상단|하단|우측|좌측)\s*(에|의)?\s*(있는\s*)?(버튼|메뉴|아이콘)|(빨간|파란|초록|노란)\s*(색)?\s*(버튼|표시|글씨)|(동그란|네모|세모)\s*(모양)?\s*(버튼|아이콘)`
- 직접 확인: 가리키는 대상의 실제 이름(버튼 텍스트, 대체 텍스트)이 지시문에 함께 있는지. 효과음으로만 알리는 것이 없는지.
- 판정: 위치·모양·색·소리만으로 대상을 가리키고 실제 이름이 없으면 위반.
- 수정 예시: "오른쪽 버튼을 누르세요" → "오른쪽의 [다음] 버튼을 누르세요"

## 5.4.1 색에 무관한 콘텐츠 인식
- 방식: 반자동
- 스크립트: `문장 속 링크를 색으로만 구분함`
- 코드
  - 오류 표시: `border-red|text-red|ring-red|error` 근처에 오류 문구가 있는지.
  - 차트 범례: 차트 라이브러리 사용 위치. 계열을 색으로만 구분하는지.
  - 상태 표시: `bg-(green|red|yellow)-\d+` 같은 배지에 글자가 있는지.
- 직접 확인: 화면을 흑백으로 봐도(개발자 도구 Rendering > Emulate vision deficiencies > Achromatopsia) 정보가 구분되는지.
- 판정: 색이 유일한 구분 수단이면 위반(필수 입력을 빨간색으로만 표시, 차트 계열을 색으로만 구분, 오류를 빨간 테두리로만 표시 등).
- 수정 예시: 필수 항목에 `*` 와 "필수" 안내, 오류에 문구 추가, 차트에 무늬·직접 레이블, 문장 속 링크에 밑줄.

## 5.4.2 자동 재생 금지
- 방식: 자동 + 확인
- 스크립트: `소리가 있을 수 있는 미디어 자동 재생`
- 코드: `autoPlay|autoplay|new Audio\(|\.play\(\)` (페이지 진입 시 실행되는지 본다)
- 직접 확인: 실제로 소리가 나는지, 3초 이상인지, 멈춤·음량 조절 수단이 있는지.
- 판정: 3초 이상 소리가 자동 재생되고 3초 안에 멈추지 않으면 위반. `muted` 자동 재생은 이 항목 위반이 아니다(6.2.2는 따로 본다).
- 수정 예시: `<video autoPlay muted loop playsInline>` 또는 자동 재생을 끄고 `controls` 제공.

## 5.4.3 텍스트 콘텐츠의 명도 대비
- 방식: 자동(배경 이미지 위 글자는 수동)
- 스크립트: `텍스트 명도 대비 4.5:1 미만`, `큰 텍스트 명도 대비 3:1 미만`(측정값, 글자색, 배경색 포함), `대비를 자동 계산할 수 없는 텍스트`, `info.contrast`
- 코드(후보 찾기): `text-(gray|slate|zinc|neutral|stone)-(200|300|400)\b|placeholder:text-|color:\s*#(ccc|ddd|bbb|aaa|999)`
- 직접 확인
  - 배경 이미지·그라데이션 위의 글자: 스크린샷에서 가장 밝은(어두운) 부분을 기준으로 본다.
  - placeholder 글자색은 스크립트가 재지 않는다. placeholder에 중요한 안내가 있으면 직접 잰다.
  - 다른 요소 위에 겹쳐 놓은(absolute) 글자는 스크립트가 아래쪽 배경을 못 볼 수 있다.
- 판정: 일반 텍스트 4.5:1 미만, 큰 텍스트(24px 이상, 또는 약 18.66px 이상 굵게) 3:1 미만이면 위반. 로고, 장식, 비활성(disabled) 콘트롤은 제외.
  - 원문은 "화면 확대가 가능하도록 구현한 텍스트"도 3:1까지 허용한다. 적용 조건이 모호하므로 이 스킬은 4.5:1을 기준으로 위반을 표시하고, 3:1 이상 4.5:1 미만은 보고서에 이 예외를 함께 적는다.
- 수정 예시(Tailwind v3 색 기준): `text-gray-400`(#9ca3af, 흰 배경 2.5:1) → `text-gray-600`(#4b5563, 7.6:1). 브랜드 색을 바꾸는 일이므로 바꿀 색 값을 제안하고 사용자 확인을 받은 뒤 고친다.

## 5.4.4 콘텐츠 간의 구분
- 방식: 수동
- 직접 확인: 스크린샷에서 이웃한 카드·목록·버튼이 테두리, 구분선, 배경색, 여백으로 구분되는지. 특히 붙어 있는 버튼 묶음, 경계 없는 카드 목록.
- 판정: 이웃한 콘텐츠의 경계를 알아볼 수 없으면 위반.
- 수정 예시: 카드에 `border` 또는 배경색 차이, 버튼 사이 `gap`.

## 6.1.1 키보드 사용 보장
- 방식: 반자동 + 키보드 점검
- 스크립트: `마우스 포인터 모양인데 키보드로 갈 수 없는 요소`, `role="..."인데 키보드 초점을 받을 수 없음`, `info.keyboardOrder`(실제 Tab 순서)
- 코드
  - 클릭되는 일반 요소: `<(div|span|li|p|td|tr|img|section|article)\b[^>]*onClick` → `role`, `tabIndex`, `onKeyDown`이 함께 있는지.
  - 마우스 전용 이벤트: `onMouse(Enter|Over|Down)|onDoubleClick|onContextMenu|:hover` 로만 여는 메뉴·툴팁.
- 직접 확인: Tab, Shift+Tab, Enter, Space, 방향키, Esc로 메뉴·드롭다운·모달·탭·슬라이더·지도 밖 기능을 모두 쓸 수 있는지.
- 판정: 마우스로만 쓸 수 있는 기능이 있으면 위반(원문 예외: 붓질, 지도, 시뮬레이션 등 궤적이 중요한 기능. 그 밖의 UI는 키보드로 되어야 함).
- 수정 예시
  ```jsx
  <div onClick={open}>열기</div>            // 위반
  <button type="button" onClick={open}>열기</button>
  ```

## 6.1.2 초점 이동과 표시
- 방식: 키보드 점검(자동) + 확인
- 스크립트: `키보드 함정`, `Tab으로 초점을 받아도 모양이 바뀌지 않음`, `Tab으로 초점을 받았는데 화면 밖`, `초점이 화면 위쪽으로 크게 되돌아감`, `tabindex가 양수`. `run-audit.mjs` 없이 `dom-audit.js`만 쓰면 `초점을 받아도 모양이 그대로임 (키보드 Tab으로 직접 확인)`만 나온다. 이때 `info.focusUnverified`가 크면 초점 표시는 Tab으로 직접 확인해야 한다.
- 코드: `outline:\s*(none|0)|outline-none|focus:outline-none` → 같은 요소에 `focus-visible:ring|focus:ring|:focus-visible\s*\{` 같은 대체 표시가 있는지. `tabIndex=\{?["']?[1-9]|tabindex=["'][1-9]`. 모달: `role="dialog"|<dialog|Modal` 에서 초점 가두기·Esc 닫기·닫은 뒤 초점 복귀.
- 직접 확인: 모달을 열면 초점이 모달 안으로 가고, 닫으면 연 버튼으로 돌아오는지. 순서가 화면 읽는 순서와 맞는지.
- 판정: 함정, 초점 표시 없음, 화면 순서와 크게 어긋난 초점 순서는 위반. 열린 모달 안에서만 초점이 도는 것은 정상.
- 수정 예시
  ```css
  :focus-visible { outline: 3px solid #1a73e8; outline-offset: 2px; }
  ```

## 6.1.3 조작 가능
- 방식: 자동(권고)
- 스크립트: `컨트롤 크기가 작음 (대각선 6mm ≈ 22.7px 미만)` (CSS px 96dpi 환산 기준)
- 코드: `w-[34]\s+h-[34]\b|width:\s*1\dpx` 같은 작은 아이콘 버튼
- 직접 확인: 모바일 화면 폭에서 붙어 있는 작은 링크·아이콘을 손가락으로 따로 누를 수 있는지.
- 판정: 원문이 "바람직하다"로 쓴 요구이므로 **권고**로 보고한다. 이웃 콘트롤과 붙어 있어 잘못 누르기 쉬우면 높여서 적는다.
- 수정 예시: 아이콘은 16px로 두고 버튼에 `padding`을 줘 클릭 영역을 24px 이상으로.

## 6.1.4 문자 단축키 ★
- 방식: 코드 검사
- 코드: `addEventListener\(\s*["']key(down|press|up)|onKey(Down|Press|Up)|useHotkeys|hotkeys\(|mousetrap|tinykeys` → 키 비교가 `e.key === 'k'` 처럼 **글자 하나**이고 `ctrlKey|metaKey|altKey` 조건이 없는지, 입력 칸에 초점이 있을 때만 동작하는지.
- 판정: 수식키 없는 한 글자 단축키가 전역에서 동작하고, 끄기·재설정·초점 한정 중 아무것도 없으면 위반. 단축키가 없으면 해당 없음.
- 수정 예시: `if ((e.ctrlKey || e.metaKey) && e.key === 'k')`, 또는 설정에 "단축키 끄기".

## 6.2.1 응답시간 조절
- 방식: 코드 검사 + 확인
- 스크립트: `meta refresh로 시간이 지나면 자동 새로 고침·이동`
- 코드: `setTimeout|setInterval` 중 `logout|session|expire|만료|timer|countdown|남은 시간` 근처, `http-equiv=["']refresh`, 인증번호 유효시간 카운트다운
- 직접 확인: 시간이 끝나기 전에 미리(20초 이상 전) 알리고 연장·해제할 수 있는지. 인증번호 유효시간이면 재발송으로 다시 시도할 수 있는지.
- 판정: 시간제한이 있는데 미리 알림과 연장·해제 수단이 없으면 위반. 경매·실시간 게임, 20시간 이상 세션은 예외.
- 수정 예시: 자동 로그아웃 1분 전 "로그인 연장" 대화상자.

## 6.2.2 정지 기능 제공
- 방식: 반자동
- 스크립트: `슬라이드·캐러셀`, `계속 반복되는 애니메이션`, `자동 재생 영상에 정지 수단 없음`, `marquee 사용`
- 코드: `swiper|react-slick|slick-carousel|embla|keen-slider|autoplay|setInterval\(.*(slide|next|index)|<marquee|animate-(spin|ping|pulse|bounce)|animation:[^;]*infinite`
- 직접 확인: 자동으로 넘어가는 배너에 정지(일시정지)·이전·다음 버튼이 있는지. 로딩 스피너처럼 잠깐 보이는 표시는 콘텐츠가 아니므로 대개 해당 없음.
- 판정: 자동으로 바뀌거나 움직이는 콘텐츠에 정지 수단이 없으면 위반.
- 수정 예시: Swiper `autoplay` 사용 시 "일시정지" 버튼으로 `swiper.autoplay.stop()` 호출.

## 6.3.1 깜빡임과 번쩍임 사용 제한
- 방식: 반자동
- 스크립트: `초당 3회 이상 반복되는 애니메이션`
- 코드: `animation[^;]*\b(0?\.\d+s|[1-3]\d\dms)\b[^;]*infinite|animate-ping`
- 직접 확인: 실제로 밝기가 크게 바뀌며 깜빡이거나 번쩍이는지(회전 스피너는 해당 없음), 면적과 지속 시간.
- 판정: 초당 3~50회로 깜빡이거나 번쩍이는 콘텐츠가 있고 멈출 수 없으면 위반.

## 6.4.1 반복 영역 건너뛰기
- 방식: 자동 + 확인
- 스크립트: `첫 번째 초점 요소가 본문 바로가기 링크가 아님`, `건너뛰기 링크의 목적지 id가 없음`, `info.skipLink`, `info.landmarks`
- 코드: 레이아웃 파일(`app/layout.*`, `pages/_app.*`, `App.*`, `index.html`)에서 `href="#(main|content)"|본문\s?바로\s?가기|건너뛰기` 와 목적지 `id="main"`
- 직접 확인: Tab을 처음 눌렀을 때 건너뛰기 링크가 **화면에 보이는지**, 누르면 본문으로 초점이 가는지.
- 판정: 반복되는 메뉴가 있는데 건너뛰기 링크가 없거나, 맨 앞이 아니거나, 동작하지 않거나, 초점을 받아도 보이지 않으면 위반. 반복 영역이 없는 한 화면짜리 페이지는 해당 없음일 수 있다(근거를 적는다).
- 수정 예시
  ```jsx
  <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2">본문 바로가기</a>
  ...
  <main id="main" tabIndex={-1}>
  ```

## 6.4.2 제목 제공
- 방식: 자동 + 확인
- 스크립트: `페이지 title 없음`, `프레임워크 기본값 그대로인 title`, `iframe에 title 없음`, `내용 없는 제목(heading) 요소`, `제목 수준 건너뜀`, `페이지에 h1 없음`, `info.headings`
- 코드
  - Next.js App Router: `export const metadata|generateMetadata` (페이지마다 title이 다른지), `app/layout`의 기본 title
  - Next.js Pages Router·React: `<title>|<Head>|Helmet|document\.title`
  - Vite·CRA: `index.html`의 `<title>` 이 `Vite + React`, `React App` 그대로인지
  - SPA 라우팅: 경로가 바뀔 때 title도 바뀌는지
- 직접 확인: 여러 페이지를 열어 title이 서로 다르고 내용을 설명하는지(`run-audit.mjs`에 URL을 여러 개 넣으면 `meta.title`을 비교할 수 있다). 모달·팝업에 제목이 있는지.
- 판정: title이 없거나, 기본값이거나, 페이지마다 같거나, iframe 제목이 없으면 위반. 제목 수준 건너뜀은 확인 필요.
- 수정 예시: `export const metadata = { title: '주문 내역 | 봄동마켓' }`, `<iframe title="오시는 길 지도" ...>`

## 6.4.3 적절한 링크 텍스트
- 방식: 반자동
- 스크립트: `읽을 수 있는 이름이 없는 링크`, `목적을 알기 어려운 링크 텍스트`
- 코드: `>\s*(더\s?보기|자세히(\s?보기)?|여기|클릭|바로\s?가기|more|Read more|Learn more)\s*<`, 아이콘만 있는 `<a`·`<Link`
- 직접 확인: "더보기"가 바로 앞 제목과 묶여 있어 맥락으로 알 수 있는지. 같은 "더보기"가 여러 개면 각각 구분되는지.
- 판정: 링크 텍스트와 주변 맥락 어디에서도 목적지를 알 수 없으면 위반.
- 수정 예시: `<a href="/notice" aria-label="공지사항 더보기">더보기</a>` (보이는 텍스트 "더보기"가 이름 앞부분이 아니므로 6.5.3도 고려해 `공지사항 <span>더보기</span>`처럼 보이는 텍스트를 늘리는 쪽이 낫다)

## 6.4.4 고정된 참조 위치 정보 ★
- 방식: 수동
- 대상: 페이지 구분이 있는 전자출판문서(전자책, PDF·EPUB 뷰어 등)를 웹 페이지로 제공할 때만.
- 판정: 대부분의 웹사이트·웹앱은 **해당 없음**. 해당하면 페이지 번호 표시와 페이지 이동 기능, 확대해도 번호가 유지되는지 본다.

## 6.5.1 단일 포인터 입력 지원 ★
- 방식: 반자동
- 스크립트: `끌어서 놓기 요소`
- 코드: `draggable|onDrag|react-dnd|@dnd-kit|react-beautiful-dnd|sortablejs|onTouchMove|swipe|pinch|useGesture|hammerjs|wheel` (지도·슬라이더·정렬 목록·이미지 확대)
- 직접 확인: 끌기·스와이프·핀치로 하는 일을 버튼 클릭(이전/다음, 위로/아래로, +/-)으로도 할 수 있는지.
- 판정: 경로·다중 포인터 동작으로만 되는 기능이 있으면 위반. 서명처럼 동작 자체가 필수인 경우와 브라우저 기본 스크롤은 예외.
- 수정 예시: 정렬 목록에 "위로", "아래로" 버튼, 지도에 확대·축소 버튼.

## 6.5.2 포인터 입력 취소 ★
- 방식: 코드 검사
- 코드: `onMouseDown|onPointerDown|onTouchStart|mousedown|pointerdown|touchstart` 에서 바로 실행되는 동작(삭제, 제출, 이동, 결제)
- 판정: 누르는 순간(다운) 실행되고 취소·되돌리기가 없으면 위반. 끌기 시작, 화면 피아노처럼 다운이 필수인 경우는 예외.
- 수정 예시: `onMouseDown` → `onClick`(업 이벤트에 실행)

## 6.5.3 레이블과 네임 ★
- 방식: 자동 + 확인
- 스크립트: `화면에 보이는 텍스트가 aria-label에 들어 있지 않음`
- 코드: `aria-label=` 이 보이는 텍스트가 있는 버튼·링크에 붙은 곳
- 판정: 보이는 텍스트가 접근 가능한 이름에 들어 있지 않으면 위반. 보이는 텍스트를 이름 앞부분에 두는 것이 좋다.
- 수정 예시: `<button aria-label="Close dialog">닫기</button>` → `<button aria-label="닫기">닫기</button>` 또는 `aria-label` 제거

## 6.5.4 동작기반 작동 ★
- 방식: 코드 검사
- 코드: `devicemotion|deviceorientation|DeviceMotionEvent|DeviceOrientationEvent|Accelerometer|Gyroscope|shake`
- 판정: 기기를 흔들거나 기울여 실행하는 기능에 버튼 대안이나 끄기가 없으면 위반. 없으면 해당 없음.

## 7.1.1 기본 언어 표시
- 방식: 자동
- 스크립트: `html 요소에 lang 속성 없음`, `lang 값 형식이 잘못됨`, `본문은 주로 한국어인데 lang이 한국어가 아님`
- 코드: `<html\b` 를 `app/layout.*`, `pages/_document.*`, `index.html`, `public/index.html` 에서 찾는다. Next.js 템플릿 기본값 `lang="en"`이 흔하다.
- 판정: lang이 없거나 실제 주 언어와 다르면 위반.
- 수정 예시: `<html lang="ko">`

## 7.2.1 사용자 요구에 따른 실행
- 방식: 반자동
- 스크립트: `초점만 받았는데 새 창을 열려고 함`, `초점만 받았는데 대화상자·팝업이 나타남`, `새 창으로 열리는 링크인데 안내 없음`, `페이지에 대화상자·레이어 팝업이 떠 있음`
- 코드
  - 초점·선택만으로 실행: `onFocus=\{[^}]*(navigate|router\.push|submit|open|location)`, `<select[^>]*onChange=\{[^}]*(navigate|router\.push|submit|location)`
  - 진입하자마자 여는 팝업: `useEffect` 안의 `set\w*Open\(true\)|showModal\(\)|window\.open`
  - 새 창: `target=["']_blank|window\.open`
- 직접 확인: 셀렉트에서 방향키로 항목을 옮기기만 해도 페이지가 바뀌는지. 진입 시 레이어 팝업이 뜨는지, 닫기 버튼이 실제로 닫는지.
- 판정: 초점·선택만으로 페이지 이동, 제출, 새 창이 일어나면 위반. 안내 없는 새 창 링크는 확인 필요(사용자가 예측할 수 있는지 판단).
- 수정 예시: 셀렉트 옆에 "이동" 버튼, 새 창 링크에 `(새 창)` 표시나 `title="새 창 열림"`.

## 7.2.2 찾기 쉬운 도움 정보 ★
- 방식: 수동(여러 페이지 비교)
- 스크립트: `info.helpLinks` (도움 링크와 전체 링크·버튼 중 순번). 여러 페이지 결과를 나란히 비교한다.
- 코드: 공통 레이아웃(헤더·푸터)에 고객센터, 문의, FAQ, 챗봇 링크가 있는지.
- 판정: 도움 정보가 있는데 페이지마다 위치(상대적 순서)가 다르거나 일부 페이지에만 있으면 위반. 도움 정보가 없으면 해당 없음.

## 7.3.1 오류 정정
- 방식: 수동(직접 제출해 봄) + 코드
- 스크립트: `입력 서식 있음`, `info.forms`(필수 항목 수, aria-invalid, aria-describedby 사용 여부)
- 코드: `aria-invalid|aria-describedby|role=["']alert|aria-live|setError|errors\.|formState|helperText|invalid`
- 직접 확인(로컬·개발 서버에서만, 실제 데이터가 저장되는 운영 서버에서는 사용자 허락 없이 제출하지 않는다)
  - 필수 칸을 비우고 제출 → 어떤 칸이 왜 틀렸는지 텍스트로 나오는지
  - 형식이 틀린 값(이메일, 전화번호) → 고칠 방법이 나오는지
  - 오류가 나면 초점이 오류 칸이나 오류 요약으로 가는지, 입력한 값이 지워지지 않는지
- 판정: 오류 위치나 이유를 알려 주지 않으면 위반(빨간 테두리만, "입력 오류" 한 줄만, alert만 뜨고 어느 칸인지 모름 등). 시스템 오류는 적용하지 않는다.
- 수정 예시
  ```jsx
  <input id="email" aria-invalid={!!err} aria-describedby="email-err" />
  {err && <p id="email-err" role="alert">이메일 형식이 아닙니다. 예: name@example.com</p>}
  ```

## 7.3.2 레이블 제공
- 방식: 자동
- 스크립트: `레이블 없는 입력 칸`, `레이블 없이 placeholder만 있는 입력 칸`, `for가 존재하지 않는 id를 가리킴`(8.1.1)
- 코드: `<(input|select|textarea)\b` 주변에 `<label`·`htmlFor`·`aria-label`·`aria-labelledby`·`title` 이 있는지. UI 라이브러리는 `label` prop(예: MUI `TextField label=`)이 있는지.
- 판정: 보조기술이 인식할 수 있게 연결된 레이블이 없으면 위반. placeholder는 레이블로 인정하지 않는다.
- 수정 예시: `<label htmlFor="name">이름</label><input id="name" />`

## 7.3.3 접근 가능한 인증 ★
- 방식: 반자동
- 스크립트: `비밀번호 칸 autocomplete="off"`, `비밀번호 칸에 autocomplete 없음`, `CAPTCHA 사용`
- 코드: `type=["']password`, `autoComplete=["']off`, `onPaste=\{[^}]*preventDefault|onCopy|onPaste`, `recaptcha|hcaptcha|turnstile|captcha`, 소셜 로그인(`signIn\(|oauth|kakao|naver|google`)
- 직접 확인: 비밀번호 관리자 자동 입력과 붙여넣기가 되는지. 인지 테스트(CAPTCHA, 계산, 이미지 고르기)만 있는지, 대안(소셜 로그인, 이메일 링크, 휴대폰 인증 등)이 있는지.
- 판정: 인증이 비밀번호 기억·문자 옮겨 적기 같은 인지 테스트에만 의존하고, 자동 입력·붙여넣기도 막혀 있으며 대안도 없으면 위반.
- 수정 예시: `<input type="password" autoComplete="current-password">`, 붙여넣기 차단 제거.

## 7.3.4 반복 입력 정보 ★
- 방식: 반자동
- 스크립트: `개인정보 입력 칸에 autocomplete 없음`(권고)
- 코드: 여러 단계 서식(`step|Stepper|wizard`), 주문자·수령자처럼 같은 정보를 두 번 받는 칸(`receiver|recipient|shipping|billing|수령|배송`)
- 직접 확인: 이전 단계에서 입력한 정보를 다음 단계에서 다시 입력하게 하는지, "주문자 정보와 같음" 같은 선택이 있는지.
- 판정: 같은 과정에서 이미 입력한 정보를 다시 입력해야 하고 자동 입력·선택 수단이 없으면 위반. 비밀번호 확인 입력은 예외. autocomplete 누락은 권고.
- 수정 예시: `<label><input type="checkbox" onChange={copyOrderer} /> 주문자 정보와 같음</label>`, `autoComplete="name"`, `"email"`, `"tel"`, `"street-address"`, `"postal-code"`.

## 8.1.1 마크업 오류 방지
- 방식: 자동(렌더링 결과) + 코드
- 스크립트: `id 중복`, `aria-labelledby/aria-describedby/for가 존재하지 않는 id를 가리킴`, `링크·버튼 안에 링크·버튼·입력 칸이 중첩됨`
- 코드
  - 반복 렌더링되는 컴포넌트의 고정 id: 목록·카드 컴포넌트 안의 `id=["'][^"'{]+["']` (React는 `useId()` 사용)
  - 중첩: `<a` 나 `<Link` 안의 `<button`, `<button` 안의 `<a`
  - 정적 HTML이면 W3C 검사기(https://validator.w3.org/nu/)로 열고 닫음·속성 중복을 확인할 수 있다. 외부 서비스로 소스를 보내므로 사용자에게 먼저 묻는다.
- 판정: id 중복, 잘못된 중첩, 속성 중복 선언이 있으면 위반.

## 8.2.1 웹 애플리케이션 접근성 준수
- 방식: 반자동 + 키보드·보조기술 확인
- 스크립트: `읽을 수 있는 이름이 없는 버튼·컨트롤`, `role="checkbox|switch|radio"인데 aria-checked 없음`, `role="tab"인데 aria-selected 없음`, `대화상자에 이름 없음`, `이동하지 않는 링크를 버튼처럼 사용`
- 코드: 직접 만든 위젯(`role=["'](button|tab|tablist|dialog|menu|menuitem|listbox|option|combobox|switch|checkbox)`), `aria-expanded|aria-selected|aria-checked|aria-pressed|aria-controls`, div로 만든 셀렉트·토글·아코디언·드롭다운
- 직접 확인: 펼침·선택·체크 상태가 바뀔 때 aria 상태도 바뀌는지. 가능하면 화면낭독프로그램(Windows: NVDA·내레이터, macOS: VoiceOver)으로 이름·역할·상태를 들어 본다.
- 판정: 직접 만든 위젯의 이름, 역할, 상태, 값이 보조기술에 전달되지 않으면 위반. 가능하면 기본 HTML 요소(`button`, `select`, `details`, `dialog`, `input type="checkbox"`)나 검증된 라이브러리(Radix UI, Headless UI 등)로 바꾸는 것을 먼저 권한다.
- 수정 예시
  ```jsx
  <button aria-expanded={open} aria-controls="faq-1" onClick={toggle}>배송은 얼마나 걸리나요?</button>
  <div id="faq-1" hidden={!open}>...</div>
  ```
