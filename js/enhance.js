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

  /* per-level concrete stats shown on each panel (so every 강 is visibly meaningful) */
  const STAT_DEFS = {
    sword: [
      { label: '기본 공격력', get: (s) => s.basic,  fmt: (v) => v.toFixed(1) },
      { label: '강공격력',    get: (s) => s.strong, fmt: (v) => v.toFixed(1) },
    ],
    armor: [
      { label: '최대 체력',   get: (s) => s.maxHp,   fmt: (v) => Math.round(v) + ' HP' },
      { label: '피해 감소',   get: (s) => s.defense, fmt: (v) => (v * 100).toFixed(1) + '%' },
    ],
    stat: [
      { label: '이동 속도',   get: (s) => s.speed, fmt: (v) => v.toFixed(2) },
      { label: '체력 재생',   get: (s) => s.regen, fmt: (v) => v.toFixed(2) + '/s' },
    ],
  };

  function pct(x) { return (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%'; }
  function activeKey() { return order[st.stageIndex]; }
  function soloBuild(catKey, lv) { const b = State.freshBuild(); b[catKey] = lv; return b; }

  /* ---------- markup ---------- */
  function panelHtml(cat, i) {
    const ms = C.MILESTONES.map(
      (m) => `<div class="milestone" data-ms="${m}" tabindex="0" role="button" aria-label="${m}강 ${cat.skillName} 스킬 정보">${cat.skillIcon}<span class="ms-label">${m}강</span></div>`
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
        <div class="ep-stats" data-stats></div>
        <div class="ep-milestones">
          ${ms}
          <div class="ms-tip" data-mstip></div>
        </div>
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
      // milestone (5·7·9·10강) hover/focus/tap -> skill tooltip
      const tip = panel.querySelector('[data-mstip]');
      panel.querySelectorAll('.milestone').forEach((mEl) => {
        const showTip = () => { tip.innerHTML = msTipHtml(cat.key, Number(mEl.dataset.ms)); tip.classList.add('show'); };
        const hideTip = () => tip.classList.remove('show');
        mEl.addEventListener('mouseenter', showTip);
        mEl.addEventListener('mouseleave', hideTip);
        mEl.addEventListener('focus', showTip);
        mEl.addEventListener('blur', hideTip);
        mEl.addEventListener('click', (e) => { e.stopPropagation(); showTip(); }); // touch
      });
    });
    // tap anywhere else closes any open milestone tooltip (mobile)
    document.addEventListener('click', () => $$('.ms-tip.show').forEach((t) => t.classList.remove('show')));
    built = true;
  }

  /* tooltip describing what a milestone (5/7/9/10강) grants for this skill */
  function msTipHtml(catKey, m) {
    const idx = order.indexOf(catKey);
    const cat = C.CATEGORIES[idx];
    const tier = C.SKILL_MILESTONES.find((t) => t.lv === m) || { power: 1, cdMult: 1, title: '' };
    const got = st.build[catKey] >= m;
    const powerPct = Math.round((tier.power - 1) * 100);
    const cdSec = (C.SKILL_COOLDOWNS[idx] * tier.cdMult / 1000).toFixed(1);
    const bonus = [];
    if (powerPct > 0) bonus.push(`${cat.powerLabel} +${powerPct}%`);
    bonus.push(`쿨타임 ${cdSec}s`);
    return `
      <div class="mst-head">
        <span class="mst-lv">${m}강</span>
        <span class="mst-title">${tier.title}</span>
        <span class="mst-state ${got ? 'on' : ''}">${got ? '달성' : '미달성'}</span>
      </div>
      <div class="mst-skill">${cat.skillIcon} ${cat.skillName} <span class="mst-key">${cat.skillKey}</span></div>
      <div class="mst-desc">${cat.skillDesc}</div>
      <div class="mst-bonus">${bonus.join(' · ')}</div>`;
  }

  /* concrete per-level stats (current -> next) shown on each panel */
  function renderStats(panel, catKey, lv) {
    const defs = STAT_DEFS[catKey];
    const cur = State.statsFromBuild(soloBuild(catKey, lv));
    const nxt = lv < C.MAX_LEVEL ? State.statsFromBuild(soloBuild(catKey, lv + 1)) : null;
    panel.querySelector('[data-stats]').innerHTML = defs.map((d) => {
      const cv = d.fmt(d.get(cur));
      const nv = nxt ? d.fmt(d.get(nxt)) : null;
      const up = nv && nv !== cv;
      return `<div class="stat-line">
          <span class="stat-name">${d.label}</span>
          <span class="stat-vals">
            <span class="stat-cur">${cv}</span>
            ${up ? `<span class="stat-arrow">▲</span><span class="stat-next">${nv}</span>` : ''}
          </span>
        </div>`;
    }).join('');
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

    renderStats(panel, catKey, lv);

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
    st.attemptsByStage[st.stageIndex] = st.stageAttempts;
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
      if (window.SFX) SFX.play(lv + 1 >= C.MAX_LEVEL ? 'enhanceMax' : 'enhanceSuccess');
      if (C.MILESTONES.includes(lv + 1)) {
        const cat = C.CATEGORIES.find((c) => c.key === catKey);
        UI.toast(`✨ ${cat.name} ${lv + 1}강 달성! 특수 능력 점등`);
      }
    } else if (outcome === 'down') {
      st.build[catKey] = Math.max(0, lv - 1);
      flash(panel, 'flash-down');
      if (window.SFX) SFX.play('enhanceDown');
      UI.toast('💥 강화 실패 — 단계 하락!');
    } else {
      flash(panel, 'flash-fail');
      if (window.SFX) SFX.play('enhanceFail');
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
      st.attemptsByStage[st.stageIndex] = st.stageAttempts;   // keep this stage's leftovers
      st.stageIndex++;
      st.stageAttempts = st.attemptsByStage[st.stageIndex];   // resume (full for an unvisited stage)
      refreshStage();
      const cat = C.CATEGORIES[st.stageIndex];
      UI.toast(`▶ ${cat.name} 강화 단계 시작`);
    } else {
      finishAll();
    }
  }

  /* go back to the previous stage — only allowed while it still has attempts left */
  function prevStage() {
    if (advancing || st.iAmReady) return;
    if (st.stageIndex <= 0) return;
    const prevIdx = st.stageIndex - 1;
    if (st.attemptsByStage[prevIdx] <= 0) { UI.toast('이전 단계는 남은 강화 횟수가 없습니다.'); return; }
    st.attemptsByStage[st.stageIndex] = st.stageAttempts;   // keep current stage's leftovers
    st.stageIndex = prevIdx;
    st.stageAttempts = st.attemptsByStage[prevIdx];
    refreshStage();
    const cat = C.CATEGORIES[st.stageIndex];
    UI.toast(`◀ ${cat.name} 강화 단계로 돌아왔습니다`);
  }

  function finishAll() {
    $('#btn-stage-next').disabled = true;
    onDone && onDone();
  }

  /* show the "previous stage" button only when the earlier stage still has
     attempts left (and we haven't already locked in our build over P2P) */
  function refreshNavButtons() {
    const prevBtn = $('#btn-stage-prev');
    if (!prevBtn) return;
    const idx = st.stageIndex;
    const list = st.attemptsByStage || [];
    const canBack = idx > 0 && (list[idx - 1] || 0) > 0 && !st.iAmReady;
    prevBtn.classList.toggle('invisible', !canBack);
    prevBtn.disabled = !canBack;
  }

  /* ---------- readiness (P2P) ---------- */
  function refreshReadyHint() {
    refreshNavButtons();
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
    st.attemptsByStage = order.map(() => C.ATTEMPTS_PER_STAGE);
    st.stageAttempts = st.attemptsByStage[0];
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
    $('#btn-stage-prev').addEventListener('click', () => { if (!advancing) prevStage(); });
  }

  return { init, enter, refreshReadyHint, setOpponentReady };
})();
