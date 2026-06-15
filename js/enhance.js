/* ============================================================
   ENHANCE — Screen 3. The 30-attempt forge: 검 / 방어구 / 능력치.
   ============================================================ */
window.Enhance = (function () {
  const C = window.CONFIG;
  const { $, $$ } = UI;
  const st = State.state;

  let onDone = null;
  let built = false;

  function pct(x) { return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%'; }

  function panelHtml(cat, i) {
    const ms = C.MILESTONES.map(
      (m) => `<div class="milestone" data-ms="${m}">${cat.skillIcon}<span class="ms-label">${m}강</span></div>`
    ).join('');
    return `
      <div class="enhance-panel ${cat.cls}" data-cat="${cat.key}" data-idx="${i}">
        <div class="ep-head">
          <div class="ep-icon">${cat.icon}</div>
          <div class="ep-name">${cat.name}</div>
          <div class="ep-desc">${cat.desc}</div>
        </div>
        <div class="ep-level-row">
          <span class="ep-level" data-lv>0</span><span class="ep-level-suffix">강</span>
        </div>
        <div class="ep-bar"><div class="ep-bar-fill" data-bar></div></div>
        <div class="ep-milestones">${ms}</div>
        <div class="ep-odds">
          <div class="odd-row odd-success"><span>성공 확률</span><span class="odd-val" data-odd-success>-</span></div>
          <div class="odd-row odd-fail"><span>실패 확률</span><span class="odd-val" data-odd-fail>-</span></div>
          <div class="odd-row odd-down"><span>하락 확률</span><span class="odd-val" data-odd-down>-</span></div>
        </div>
        <button class="btn ep-try" data-try>강화 시도</button>
      </div>`;
  }

  function buildGrid() {
    $('#enhance-grid').innerHTML = C.CATEGORIES.map(panelHtml).join('');
    C.CATEGORIES.forEach((cat) => {
      const panel = $(`.enhance-panel[data-cat="${cat.key}"]`);
      panel.querySelector('[data-try]').addEventListener('click', () => tryEnhance(cat.key, panel));
    });
    built = true;
  }

  function oddsFor(level) {
    if (level >= C.MAX_LEVEL) return null;
    const row = C.ENHANCE_TABLE[level];
    const fail = 1 - row.success - row.down;
    return { success: row.success, down: row.down, fail };
  }

  function refreshPanel(catKey) {
    const cat = C.CATEGORIES.find((c) => c.key === catKey);
    const lv = st.build[catKey];
    const panel = $(`.enhance-panel[data-cat="${catKey}"]`);
    const lvEl = panel.querySelector('[data-lv]');
    lvEl.textContent = lv;
    lvEl.classList.toggle('maxed', lv >= C.MAX_LEVEL);
    panel.querySelector('[data-bar]').style.width = (lv / C.MAX_LEVEL * 100) + '%';

    // milestones
    panel.querySelectorAll('.milestone').forEach((m) => {
      m.classList.toggle('lit', lv >= Number(m.dataset.ms));
    });

    // odds
    const odds = oddsFor(lv);
    const sEl = panel.querySelector('[data-odd-success]');
    const fEl = panel.querySelector('[data-odd-fail]');
    const dEl = panel.querySelector('[data-odd-down]');
    const tryBtn = panel.querySelector('[data-try]');
    if (!odds) {
      sEl.textContent = '—'; fEl.textContent = '—'; dEl.textContent = '—';
      tryBtn.textContent = '최대 강화';
      tryBtn.disabled = true;
    } else {
      sEl.textContent = pct(odds.success);
      fEl.textContent = pct(odds.fail);
      dEl.textContent = lv >= 5 ? pct(odds.down) : '0% (5강부터)';
      tryBtn.textContent = '강화 시도';
      tryBtn.disabled = st.attemptsLeft <= 0;
    }
  }

  function refreshAttempts() {
    const el = $('#attempts-left');
    el.textContent = st.attemptsLeft;
    el.classList.toggle('low', st.attemptsLeft <= 5);
  }

  function tryEnhance(catKey, panel) {
    if (st.attemptsLeft <= 0) { UI.toast('남은 강화 횟수가 없습니다.'); return; }
    const lv = st.build[catKey];
    if (lv >= C.MAX_LEVEL) return;

    st.attemptsLeft--;
    refreshAttempts();

    const odds = oddsFor(lv);
    const roll = Math.random();
    let outcome;
    if (roll < odds.success) outcome = 'success';
    else if (roll < odds.success + odds.down) outcome = 'down';
    else outcome = 'fail';

    if (outcome === 'success') {
      st.build[catKey] = lv + 1;
      flash(panel, 'flash-success');
      if (C.MILESTONES.includes(lv + 1)) {
        const cat = C.CATEGORIES.find((c) => c.key === catKey);
        UI.toast(`✨ ${cat.name} ${lv + 1}강 달성! 특수 능력 점등`);
      }
    } else if (outcome === 'down') {
      st.build[catKey] = Math.max(0, lv - 1);
      flash(panel, 'flash-down');
      UI.toast('💥 강화 실패 — 단계 하락!');
    } else {
      flash(panel, 'flash-fail');
    }

    refreshPanel(catKey);
    refreshReadyHint();

    if (st.attemptsLeft <= 0) {
      C.CATEGORIES.forEach((c) => refreshPanel(c.key));
      UI.toast('강화 횟수를 모두 사용했습니다. 전투 준비!');
    }
  }

  function flash(panel, cls) {
    panel.classList.remove('flash-success', 'flash-fail', 'flash-down');
    void panel.offsetWidth;
    panel.classList.add(cls);
  }

  function refreshReadyHint() {
    const status = $('#enhance-ready-status');
    if (st.mode === 'practice') {
      status.textContent = '준비가 되면 전투를 시작하세요.';
    } else if (st.iAmReady && !st.opponentReady) {
      status.textContent = '상대의 강화 완료를 기다리는 중...';
    } else if (st.iAmReady && st.opponentReady) {
      status.textContent = '양측 준비 완료! 전투를 시작합니다.';
    } else {
      status.textContent = `상대(${st.opponentName})와 동시에 강화 중입니다.`;
    }
  }

  /* called when entering the screen */
  function enter() {
    if (!built) buildGrid();
    refreshAttempts();
    C.CATEGORIES.forEach((c) => refreshPanel(c.key));
    refreshReadyHint();
    const doneBtn = $('#btn-enhance-done');
    doneBtn.disabled = false;
    doneBtn.textContent = st.mode === 'practice' ? '전투 시작' : '전투 준비 완료';
  }

  /* opponent readiness update from network */
  function setOpponentReady(ready) {
    st.opponentReady = ready;
    refreshReadyHint();
  }

  function init(opts) {
    onDone = opts.onDone;
    $('#btn-enhance-done').addEventListener('click', () => { onDone && onDone(); });
  }

  return { init, enter, refreshReadyHint, setOpponentReady };
})();
