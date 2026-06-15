# CLAUDE.md

이 저장소에서 작업할 때 따르는 메모입니다.

## 프로젝트
**FORGE & FIGHT** — 순수 HTML/CSS/JS 웹 게임(빌드 도구 없음).
실행: 저장소 폴더에서 `python3 -m http.server 8000` → `http://localhost:8000`.

## 개발 워크플로우 (사용자 지정 · 항상 적용)
1. **버전 갱신**: 코드/콘텐츠를 변경할 때마다 `README.md` 맨 아래 `## 📌 버전`의
   버전을 **SemVer**로 올리고(필요 시 이전 버전 목록에 한 줄 추가), 날짜를 갱신한다.
2. **자동 PR + 자동 머지**: 작업을 푸시한 뒤 **PR을 자동 생성하고 자동으로 머지**한다.
   (사용자가 명시적으로 승인함 — 매번 묻지 않는다.)
3. **브랜치**: 기능 작업은 지정된 작업 브랜치에서 진행 → `main`으로 PR/머지.

## 코드 구조
- `index.html` — 5개 화면 + 오버레이
- `css/styles.css` — 다크 판타지(금속/양피지) 테마, 1920×1080 스테이지 스케일
- `js/config.js` 밸런스 · `state.js` 상태 · `ui.js` 라우팅 · `net.js` P2P(PeerJS)
  · `enhance.js` 단계 강화 · `battle.js` 2D 전투(캔버스) · `main.js` 흐름 조율
- `vendor/` PeerJS·Orbitron(로컬 vendoring, 런타임 CDN 의존성 없음)

## 검증
헤드리스 브라우저(Playwright, `/opt/pw-browsers`의 chromium 사용)로
로비→강화→전투→결과 플로우와 콘솔 무에러를 확인한다.
