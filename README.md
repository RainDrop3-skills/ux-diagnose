# ux-diagnose

내가 만든 웹사이트의 UX를 **한국형 웹 콘텐츠 접근성 지침(KWCAG) 2.2**의 33개 검사항목 기준으로 진단하는 Claude Code 스킬입니다.

- 실행 중인 페이지를 헤드리스 Chrome으로 열어 자동 점검합니다. 대체 텍스트, 레이블, 명도 대비, 제목, lang, id 중복 등을 봅니다.
- 실제로 Tab 키를 눌러 초점 순서, 초점 표시, 키보드 함정을 확인합니다.
- 소스 코드(React, Next.js, Vue, HTML)에서 원인 위치를 찾습니다.
- 항목별 판정(위반 / 확인 필요 / 권고 / 준수 / 해당 없음)과 근거, 수정 예시를 담은 보고서를 냅니다.

기준 문서: https://a11ykr.github.io/kwcag22/

## 설치

Claude Code 개인 스킬 폴더에 넣습니다.

```bash
# macOS / Linux / Git Bash
git clone https://github.com/RainDrop3-skills/ux-diagnose.git ~/.claude/skills/ux-diagnose
```

```powershell
# Windows PowerShell
git clone https://github.com/RainDrop3-skills/ux-diagnose.git "$env:USERPROFILE\.claude\skills\ux-diagnose"
```

자동 점검 스크립트를 쓰려면 다음이 필요합니다.
- Node.js 22 이상 (외부 패키지 설치 없음)
- Chrome 또는 Edge

## 사용

Claude Code에서 이렇게 말하면 됩니다.

- "localhost:3000 UX 진단해줘"
- "이 프로젝트 접근성 검사해줘. 메인이랑 회원가입 페이지 봐줘"
- "키보드로만 쓸 수 있는지 확인해줘"
- "진단 결과에서 높음만 고쳐줘"

스크립트만 직접 실행할 수도 있습니다.

```bash
node scripts/run-audit.mjs http://localhost:3000 http://localhost:3000/signup --out audit.json --screenshot shots
```

로그인이 필요한 페이지는 브라우저 개발자 도구(F12) 콘솔에 `scripts/dom-audit.js` 내용을 붙여 넣어 실행합니다. 그다음 `copy(window.__uxDiagnoseResult)`로 결과를 복사합니다.

## 구조

| 경로 | 내용 |
|---|---|
| `SKILL.md` | 진단 절차 (Claude가 읽는 지침) |
| `references/kwcag22.md` | 33개 검사항목 원문 요약 |
| `references/checks.md` | 항목별 검사 방법, 판정 기준, 수정 예시 |
| `scripts/run-audit.mjs` | 헤드리스 Chrome 실행기 (자동 점검 + Tab 키 점검 + 스크린샷) |
| `scripts/dom-audit.js` | 페이지 안에서 실행하는 자동 점검 스크립트 |
| `templates/report.md` | 진단 보고서 양식 |

## 한계

- 개발자가 스스로 하는 진단입니다. 공식 웹 접근성 품질인증 심사를 대신하지 않습니다.
- 자동 점검 결과는 "후보"입니다. 대체 텍스트가 적절한지, 색에만 의존하는지 같은 항목은 화면과 동작을 보고 판단합니다.
- 화면낭독프로그램(NVDA, VoiceOver 등)으로 직접 들어 보는 확인은 사람이 해야 합니다.
