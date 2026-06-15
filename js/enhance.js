/* ============================================================
   ENHANCE — Screen 3. Staged forge: 검 -> 방어구 -> 능력치.
   Each stage has its OWN pool of attempts (ATTEMPTS_PER_STAGE).
   A stage ends when its attempts run out OR the player presses
   "다음 강화단계로 넘어가기" (bottom-right). The last stage's
   button starts the battle.
   ============================================================ */
window.Enhance = (function () {
  const C = window.CONFIG;
  const { $, $$ } = UI;
  const st = State.state;

  let onDone = null;
  let built = false;
  let advancing = false;

  const order = C.CATEGORIES.map((c) => c.key); // ['sword','armor','stat']

  function pct(x) { return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%'; }
  function activeKey() { return order[st.stageIndex]; }

  /* ---------- markup ---------- */
  function panelHtml(cat, i) {
    const ms = C.MILESTONES.map(
      (m) => `<div class="milestone" data-ms="${m}">${cat.skillIcon}<span class="ms-label">${m}강</span></div>`
    ).join('');
    return `
      <div class="enhance-panel ${cat.cls}" data-cat="${cat.key}" data-idx="${i}">
        <div class="ep-stamp"></div>
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
      panel.querySelector('[data-try]').addEventListener('click', () => tryEnhance(cat.key));
    });
    built = true;
  }

  function buildStageIndicator() {
    $('#stage-indicator').innerHTML = C.CATEGORIES.map(
      (cat, i) => `<div class="stage-chip" data-stage="${i}">
          <span class="stage-num">${i + 1}</span>
          <span class="stage-ico">${cat.icon}</span>
          <span class="stage-text">${cat.name}</span>
        </div>${i < 2 ? '<span class="stage-arrow">›</span>' : ''}`
    ).join('');
  }

  /* ---------- odds ---------- */
  function oddsFor(level) {
    if (level >= C.MAX_LEVEL) return null;
    const row = C.ENHANCE_TABLE[level];
    return { success: row.success, down: row.down, fail: 1 - row.success - row.down };
  }

  /* ---------- per-panel refresh ---------- */
  function refreshPanel(catKey) {
    const lv = st.build[catKey];
    const panel = $(`.enhance-panel[data-cat="${catKey}"]`);
    const isActive = catKey === activeKey();

    const lvEl = panel.querySelector('[data-lv]');
    lvEl.textContent = lv;
    lvEl.classList.toggle('maxed', lv >= C.MAX_LEVEL);
    panel.querySelector('[data-bar]').style.width = (lv / C.MAX_LEVEL * 100) + '%';

    panel.querySelectorAll('.milestone').forEach((m) => {
      m.classList.toggle('lit', lv >= Number(m.dataset.ms));
    });

    const odds = oddsFor(lv);
    const sEl = panel.querySelector('[data-odd-success]');
    const fEl = panel.querySelector('[data-odd-fail]');
    const dEl = panel.querySelector('[data-odd-down]');
    const tryBtn = panel.querySelector('[data-try]');

    if (!odds) {
      sEl.textContent = '—'; fEl.textContent = '—'; dEl.textContent = '—';
      tryBtn.textContent = '최대 강화'; tryBtn.disabled = true;
    } else {
      sEl.textContent = pct(odds.success);
      fEl.textContent = pct(odds.fail);
      dEl.textContent = lv >= 5 ? pct(odds.down) : '0% (5강~)';
      tryBtn.textContent = '강화 시도';
      tryBtn.disabled = !isActive || st.stageAttempts <= 0;
    }
  }

  /* ---------- stage visuals ---------- */
  function refreshStage() {
    const idx = st.stageIndex;
    // panel states
    C.CATEGORIES.forEach((cat, i) => {
      const panel = $(`.enhance-panel[data-cat="${cat.key}"]`);
      panel.classList.toggle('is-active', i === idx);
      panel.classList.toggle('is-done', i < idx);
      panel.classList.toggle('is-locked', i > idx);
      const stamp = panel.querySelector('.ep-stamp');
      stamp.textContent = i < idx ? '완료' : (i > idx ? '대기' : '');
    });
    // stage chips
    $$('#stage-indicator .stage-chip').forEach((chip, i) => {
      chip.classList.toggle('done', i < idx);
      chip.classList.toggle('active', i === idx);
    });
    // counter label
    const cat = C.CATEGORIES[idx];
    $('#attempts-label').textContent = `${cat.name} 강화 · 남은 횟수`;
    refreshAttempts();
    // next button label
    const btn = $('#btn-stage-next');
    if (idx < 2) { btn.textContent = '다음 강화단계로 →'; }
    else { btn.textContent = st.mode === 'practice' ? '전투 시작' : '전투 준비 완료'; }
    btn.disabled = false;

    C.CATEGORIES.forEach((c) => refreshPanel(c.key));
    refreshReadyHint();
  }

  function refreshAttempts() {
    const el = $('#attempts-left');
    el.textContent = st.stageAttempts;
    el.classList.toggle('low', st.stageAttempts <= 5);
  }

  /* ---------- enhancing ---------- */
  function tryEnhance(catKey) {
    if (advancing) return;
    if (catKey !== activeKey()) return;            // only the active stage is forgeable
    if (st.stageAttempts <= 0) { UI.toast('이 단계의 강화 횟수를 모두 사용했습니다.'); return; }
    const lv = st.build[catKey];
    if (lv >= C.MAX_LEVEL) { UI.toast('이미 최대 강화입니다.'); return; }

    st.stageAttempts--;
    refreshAttempts();

    const odds = oddsFor(lv);
    const roll = Math.random();
    let outcome;
    if (roll < odds.success) outcome = 'success';
    else if (roll < odds.success + odds.down) outcome = 'down';
    else outcome = 'fail';

    const panel = $(`.enhance-panel[data-cat="${catKey}"]`);
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

    if (st.stageAttempts <= 0) {
      // stage exhausted -> auto-advance after a short beat
      panel.querySelector('[data-try]').disabled = true;
      const cat = C.CATEGORIES[st.stageIndex];
      UI.toast(`${cat.name} 강화 완료! 다음 단계로 이동합니다.`);
      advancing = true;
      setTimeout(() => { advancing = false; nextStage(); }, 1100);
    }
  }

  function flash(panel, cls) {
    panel.classList.remove('flash-success', 'flash-fail', 'flash-down');
    void panel.offsetWidth;
    panel.classList.add(cls);
  }

  /* ---------- stage advancing / done ---------- */
  function nextStage() {
    if (st.stageIndex < order.length - 1) {
      st.stageIndex++;
      st.stageAttempts = C.ATTEMPTS_PER_STAGE;
      refreshStage();
      const cat = C.CATEGORIES[st.stageIndex];
      UI.toast(`▶ ${cat.name} 강화 단계 시작`);
    } else {
      finishAll();
    }
  }

  function finishAll() {
    $('#btn-stage-next').disabled = true;
    onDone && onDone();
  }

  /* ---------- readiness (P2P) ---------- */
  function refreshReadyHint() {
    const status = $('#enhance-ready-status');
    if (st.mode === 'practice') {
      status.textContent = '각 부위를 30회씩 강화한 뒤 전투를 시작하세요.';
    } else if (st.iAmReady && !st.opponentReady) {
      status.textContent = '상대의 강화 완료를 기다리는 중...';
    } else if (st.iAmReady && st.opponentReady) {
      status.textContent = '양측 준비 완료! 전투를 시작합니다.';
    } else {
      status.textContent = `상대(${st.opponentName})와 동시에 강화 중입니다.`;
    }
  }

  /* ---------- entry ---------- */
  function enter() {
    if (!built) { buildGrid(); buildStageIndicator(); }
    st.stageIndex = 0;
    st.stageAttempts = C.ATTEMPTS_PER_STAGE;
    advancing = false;
    refreshStage();
  }

  function setOpponentReady(ready) {
    st.opponentReady = ready;
    refreshReadyHint();
  }

  function init(opts) {
    onDone = opts.onDone;
    $('#btn-stage-next').addEventListener('click', () => { if (!advancing) nextStage(); });
  }

  return { init, enter, refreshReadyHint, setOpponentReady };
})();
