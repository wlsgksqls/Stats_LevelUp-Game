/* ============================================================
   UI — screen routing, overlays, toast, and 16:9 scaling.
   ============================================================ */
window.UI = (function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---- 16:9 stage scaling ---- */
  function fitStage() {
    const stage = $('#stage');
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    stage.style.transform = `scale(${scale})`;
  }

  /* ---- screen routing ---- */
  let current = 'lobby';
  function show(name) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    current = name;
    document.body.setAttribute('data-screen', name);
    document.dispatchEvent(new CustomEvent('ff:screen', { detail: name }));
  }
  function currentScreen() { return current; }

  /* ---- loading transition; resolves after the animation ---- */
  const TIPS = [
    '5강부터 강화에 실패하면 단계가 하락할 수 있습니다.',
    '강화는 운과 전략, 전투는 피지컬!',
    '검은 공격력, 방어구는 체력/방어, 능력치는 기동성을 올립니다.',
    '5강 달성 시 해당 특수 스킬(1·2·3)의 자물쇠가 풀립니다.',
    '연장전에 돌입하면 초당 3씩 체력이 깎입니다.',
    '강공격은 느리지만 기본 공격의 2배 이상 데미지를 줍니다.',
  ];
  function loading(text, ms) {
    return new Promise((resolve) => {
      const ov = $('#loading-overlay');
      $('.loading-text').textContent = text || '접속 중...';
      $('#loading-tip').textContent = 'TIP · ' + TIPS[(Math.random() * TIPS.length) | 0];
      // restart bar animation
      const bar = $('.loading-bar-fill');
      bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
      ov.classList.remove('hidden');
      setTimeout(() => { ov.classList.add('hidden'); resolve(); }, ms || 1700);
    });
  }

  /* ---- generic popup ----
     opts = { title, body, warn, actions:[{label, primary, danger, disabled, onClick}], dismissable } */
  function popup(opts) {
    const ov = $('#popup-overlay');
    const card = $('#popup-card');
    $('#popup-title').textContent = opts.title || '';
    $('#popup-body').innerHTML = opts.body || '';
    card.classList.toggle('warn', !!opts.warn);

    const actions = $('#popup-actions');
    actions.innerHTML = '';
    (opts.actions || [{ label: '확인', primary: true }]).forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-secondary' : 'btn-ghost');
      btn.textContent = a.label;
      btn.disabled = !!a.disabled;
      btn.dataset.role = a.role || '';
      btn.onclick = () => {
        if (!a.keepOpen) closePopup();
        if (a.onClick) a.onClick();
      };
      actions.appendChild(btn);
    });
    ov.classList.remove('hidden');
    return card;
  }
  function closePopup() { $('#popup-overlay').classList.add('hidden'); }
  function popupIsOpen() { return !$('#popup-overlay').classList.contains('hidden'); }

  /* ---- toast ---- */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2200);
  }

  function init() {
    fitStage();
    window.addEventListener('resize', fitStage);
    window.addEventListener('orientationchange', () => setTimeout(fitStage, 120));
    window.addEventListener('load', fitStage);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitStage);
    // re-fit after the mobile browser settles its viewport (URL bar, etc.)
    setTimeout(fitStage, 200);
    setTimeout(fitStage, 600);
  }

  return { $, $$, init, show, currentScreen, loading, popup, closePopup, popupIsOpen, toast, fitStage };
})();
