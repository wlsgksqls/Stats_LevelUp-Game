/* ============================================================
   BATTLE — Screen 4. 2D side-view fighter on a canvas.
   World coords are shared by both peers: p1 (host) on the left,
   p2 (guest) on the right. Each peer drives only its own
   fighter and announces hits / death to the other.

   Art style: illustrated dark-fantasy arena + armored knights
   (shaded, outlined) rather than neon shapes. A 3s countdown
   plays before the fight begins.
   ============================================================ */
window.Battle = (function () {
  const C = window.CONFIG;
  const { $ } = UI;
  const st = State.state;

  /* world constants */
  const W = 1920, H = 1080, GROUND_Y = 880;
  const GRAVITY = 0.92, JUMP_V = -21, FRICTION = 0.80, MAXFALL = 26;
  const COYOTE = 8;          // frames of post-edge jump grace (lenient edge jumps)
  const PLAT_EDGE = 24;      // extra px of platform landing margin at each edge

  /* one-way floating platforms (x = left edge, y = top surface, w = width).
     Side ledges are reachable from the ground; the high center is reachable
     only by hopping off a side ledge. */
  const PLATFORMS = [
    { x: 215,         y: GROUND_Y - 200, w: 300 }, // left ledge
    { x: W - 515,     y: GROUND_Y - 200, w: 300 }, // right ledge
    { x: W / 2 - 175, y: GROUND_Y - 380, w: 350 }, // high center
  ];

  /* muted, painted palettes (no neon) */
  const PAL_P1 = { armor: '#54688f', armorL: '#90a9d2', armorD: '#313c57', cape: '#2c4a7a', capeD: '#1c3052', plume: '#7c9fd0', accent: '#7c9fd0' };
  const PAL_P2 = { armor: '#8f5a54', armorL: '#d29790', armorD: '#573332', cape: '#7a3030', capeD: '#521d1d', plume: '#cf7a72', accent: '#cf7a72' };
  const METAL = '#cdd4dd', METAL_D = '#828c9b', GOLD = '#c9a227', OUT = '#0d0b12';

  let canvas, ctx;
  let me = null, opp = null;
  let p1 = null, p2 = null;
  let netMode = false;
  let onEnd = null, onQuit = null;
  let running = false, ended = false, paused = false;
  let rafId = 0, lastTs = 0, acc = 0;
  const STEP = 1000 / 60;

  let timeLeft = C.TIMER_SECONDS;
  let overtime = false, otAcc = 0;
  let particles = [];
  let netAcc = 0;

  let phase = 'fighting';     // 'countdown' | 'fighting'
  let countdownT = 0, lastCount = null;
  let animClock = 0;
  let stars = null;

  const keys = Object.create(null);
  let inputBound = false;

  /* ---------- math helpers ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rad = (d) => d * Math.PI / 180;

  /* ---------- fighter factory ---------- */
  function makeFighter(id, x, build, name) {
    const s = State.statsFromBuild(build);
    const pal = id === 'p1' ? PAL_P1 : PAL_P2;
    return {
      id, name, pal, color: pal.accent, build, stats: s,
      x, y: GROUND_Y, vx: 0, vy: 0,
      w: 64, h: 150, facing: id === 'p1' ? 1 : -1,
      onGround: true,
      hp: s.maxHp, maxHp: s.maxHp,
      cd: { basic: 0, strong: 0 },
      skillCd: [0, 0, 0],
      atk: null,
      shieldT: 0, hasteT: 0, regenAcc: 0,
      hurt: 0, dead: false,
      onPlatform: false, dropTimer: 0, coyote: 0,
      tx: null, ty: null,   // remote interpolation targets (P2P)
      step: 0, bobPhase: Math.random() * Math.PI * 2,
      ai: null,
    };
  }

  /* ---------- public start ---------- */
  function start(cfg) {
    netMode = cfg.mode !== 'practice';
    onEnd = cfg.onEnd;
    onQuit = cfg.onQuit;
    paused = false;

    const hostBuild = st.isHost ? st.build : st.opponentBuild;
    const guestBuild = st.isHost ? st.opponentBuild : st.build;
    const hostName = st.isHost ? st.nickname : st.opponentName;
    const guestName = st.isHost ? st.opponentName : st.nickname;

    p1 = makeFighter('p1', 520, hostBuild || State.freshBuild(), hostName || 'P1');
    p2 = makeFighter('p2', W - 520, guestBuild || State.freshBuild(), guestName || 'P2');

    if (st.mode === 'practice') {
      me = p1; opp = p2; opp.ai = { t: 0, decide: 0, intent: 'approach' };
    } else if (st.isHost) {
      me = p1; opp = p2;
    } else {
      me = p2; opp = p1;
    }

    canvas = $('#battle-canvas');
    ctx = canvas.getContext('2d');
    bindInput();

    $('#hud-name-p1').textContent = p1.name;
    $('#hud-name-p2').textContent = p2.name;
    setupSkillHud();

    timeLeft = C.TIMER_SECONDS; overtime = false; otAcc = 0;
    particles = []; ended = false; running = true;
    $('#overtime-badge').classList.add('hidden');

    phase = 'countdown'; countdownT = 3.0; lastCount = null; animClock = 0;
    keys['a'] = keys['d'] = keys['s'] = false;   // clear any held input
    if (!stars) stars = makeStars();
    showCountdown();
    if (document.body.classList.contains('touch')) {
      UI.toast('좌측 조이스틱: 이동·위로 점프 · 화면 탭: 기본공격 · 우측: 강공/스킬', 4000);
    }

    updateHud();
    lastTs = performance.now(); acc = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() { running = false; paused = false; cancelAnimationFrame(rafId); hideCountdown(); }

  /* ---------- pause menu (ESC) ---------- */
  function togglePause() {
    if (!running || ended) return;
    if (paused) resumeGame();
    else openPauseMenu();
  }
  function openPauseMenu() {
    paused = true;
    keys['a'] = keys['d'] = keys['s'] = false;   // drop held movement so we don't slide on resume
    UI.popup({
      title: '⏸ 일시정지',
      body: '전투가 멈췄습니다. 계속할까요?',
      actions: [
        { label: '계속하기', primary: true, onClick: resumeGame },
        { label: '나가기', danger: true, onClick: quitBattle },
      ],
    });
  }
  function resumeGame() {
    if (!paused) return;
    paused = false;
    UI.closePopup();
    lastTs = performance.now();   // avoid a dt spike on the first resumed frame
  }
  function quitBattle() {
    paused = false;
    UI.closePopup();
    stop();
    ended = true;                 // block any pending finish()
    onQuit && onQuit();
  }

  /* ---------- input ---------- */
  function bindInput() {
    if (inputBound) return;
    inputBound = true;
    window.addEventListener('keydown', (e) => {
      if (UI.currentScreen() !== 'battle') return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { e.preventDefault(); togglePause(); return; }
      if (paused) return;                         // pause menu open: ignore gameplay keys
      keys[k] = true;
      if (k === ' ') { e.preventDefault(); jump(me); }   // jump = Spacebar only
      if (k === '1') useSkill(me, 0);
      if (k === '2') useSkill(me, 1);
      if (k === '3') useSkill(me, 2);
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    const cv = document.getElementById('battle-canvas');
    cv.addEventListener('mousedown', (e) => {
      if (UI.currentScreen() !== 'battle' || !running) return;
      e.preventDefault();
      if (e.button === 0) attack(me, 'basic');
      else if (e.button === 2) attack(me, 'strong');
    });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // touch: tapping the play area = basic attack (preventDefault blocks synthetic mouse)
    cv.addEventListener('touchstart', (e) => {
      if (UI.currentScreen() !== 'battle' || !running) return;
      e.preventDefault();
      attack(me, 'basic');
    }, { passive: false });
  }

  /* ---------- actions (blocked during countdown) ---------- */
  function jump(f) {
    if (!f || f.dead || !running || paused || phase !== 'fighting') return;
    if (f.onGround || f.coyote > 0) { f.vy = JUMP_V; f.onGround = false; f.onPlatform = false; f.coyote = 0; }
  }

  function attack(f, kind) {
    if (!f || f.dead || !running || paused || f.atk || phase !== 'fighting') return;
    if (kind === 'basic' && f.cd.basic > 0) return;
    if (kind === 'strong' && f.cd.strong > 0) return;

    const base = f.stats.basic;
    let a;
    if (kind === 'basic') {
      a = { kind, t: 0, dur: 18, as: 7, ae: 13, reach: 96, hh: 96, dmg: base, kb: 9 };
      f.cd.basic = 26;
    } else {
      a = { kind, t: 0, dur: 34, as: 16, ae: 24, reach: 128, hh: 120, dmg: f.stats.strong, kb: 18 };
      f.cd.strong = 64;
    }
    a.hit = false;
    f.atk = a;
    if (netMode && f === me) Net.send({ t: 'a', kind, dmg: a.dmg, reach: a.reach, hh: a.hh, kb: a.kb });
  }

  function useSkill(f, idx) {
    if (!f || f.dead || !running || paused || phase !== 'fighting') return;
    if (!f.stats.skills[idx]) { if (f === me) UI.toast('🔒 ' + C.CATEGORIES[idx].skillName + ' — 5강 필요'); return; }
    if (f.skillCd[idx] > 0) return;
    const pw = f.stats.skillPower[idx] || 1;                 // 7·9·10강 위력 강화
    f.skillCd[idx] = C.SKILL_COOLDOWNS[idx] * (f.stats.skillCdMult[idx] || 1); // 9·10강 쿨타임 단축
    if (idx === 0) {
      const a = { kind: 'skill', t: 0, dur: 40, as: 14, ae: 30, reach: 175, hh: 150, dmg: f.stats.strong * 1.5 * pw, kb: 24, hit: false };
      f.atk = a; f.vx += f.facing * 16;
      if (netMode && f === me) Net.send({ t: 'a', kind: 'skill', dmg: a.dmg, reach: a.reach, hh: a.hh, kb: a.kb });
    } else if (idx === 1) {
      const dur = Math.round(2200 * pw);
      f.shieldT = dur; spawnRing(f, '#9fc0ef');
      if (netMode && f === me) Net.send({ t: 'sk', idx, dur });
    } else if (idx === 2) {
      const dur = Math.round(3500 * pw);
      f.hasteT = dur; f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.12 * pw); spawnRing(f, '#b9a8ff');
      if (netMode && f === me) Net.send({ t: 'sk', idx, dur });
    }
    if (f === me) UI.toast('✨ ' + C.CATEGORIES[idx].skillName + ' 발동!');
  }

  /* ---------- network inbound ---------- */
  function handleNetData(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 's') {
      // authoritative target for smooth predicted interpolation (see physics)
      opp.tx = msg.x; opp.ty = msg.y; opp.vx = msg.vx; opp.facing = msg.facing;
      opp.hp = msg.hp; opp.shieldT = msg.shield ? 1 : 0; opp.hasteT = msg.haste ? 1 : 0;
      opp.onGround = msg.g;
    } else if (msg.t === 'a') {
      opp.atk = { kind: msg.kind, t: 0, dur: msg.kind === 'strong' ? 34 : msg.kind === 'skill' ? 40 : 18,
                  as: 99, ae: 99, reach: msg.reach, hh: msg.hh, dmg: 0, kb: 0, hit: true };
    } else if (msg.t === 'h') {
      applyDamage(me, msg.dmg, msg.kx, msg.kind);
    } else if (msg.t === 'sk') {
      if (msg.idx === 1) { opp.shieldT = msg.dur || 2200; spawnRing(opp, '#9fc0ef'); }
      if (msg.idx === 2) { opp.hasteT = msg.dur || 3500; spawnRing(opp, '#b9a8ff'); }
    } else if (msg.t === 'dead') {
      if (!ended) finish(me.dead ? 'draw' : 'win');
    }
  }

  /* ---------- damage ---------- */
  function applyDamage(f, raw, kx, kind) {
    if (!f || f.dead) return;
    if (f.shieldT > 0) { spawnBlock(f); return; }
    const dmg = raw * (1 - f.stats.defense);
    f.hp = Math.max(0, f.hp - dmg);
    f.vx += (kx || f.facing * -1) * (kind === 'strong' || kind === 'skill' ? 1 : 0.6) * 9;
    f.vy = Math.min(f.vy, -6);
    f.onGround = false;
    f.hurt = 12;
    spawnHit(f.x, f.y - f.h * 0.55, kind);
  }

  /* ---------- simulation ---------- */
  function physics(f) {
    // remote fighter (P2P): smooth velocity-predicted interpolation, no local sim
    if (netMode && f === opp) {
      if (f.tx == null) { f.tx = f.x; f.ty = f.y; }
      f.tx += f.vx;                       // predict forward with last known velocity
      f.x += (f.tx - f.x) * 0.5;          // ease render toward predicted target
      f.y += (f.ty - f.y) * 0.5;
      f.x = Math.max(70, Math.min(W - 70, f.x));
      if (f.atk) { f.atk.t++; if (f.atk.t > f.atk.dur) f.atk = null; }
      if (f.hurt > 0) f.hurt--;
      return;
    }

    const other = (f === p1) ? p2 : p1;
    if (other) f.facing = other.x >= f.x ? 1 : -1;

    const speed = f.stats.speed * (f.hasteT > 0 ? 1.7 : 1);
    let dir = 0;
    if (f === me && !f.dead) {
      if (keys['a']) dir -= 1;
      if (keys['d']) dir += 1;
      if (keys['s'] && !f.onGround) f.vy += 2.2;
    } else if (f.ai && !f.dead) {
      dir = aiThink(f, speed);
    }

    // snappy horizontal: ease quickly toward target speed; friction only when idle
    if (dir !== 0 && !f.dead) {
      const target = dir * speed * 1.6;
      f.vx += (target - f.vx) * (f.onGround ? 0.6 : 0.22);
    } else {
      f.vx *= f.onGround ? FRICTION : 0.92;
    }
    f.x += f.vx;
    f.x = Math.max(70, Math.min(W - 70, f.x));

    // step down through a platform with S (player only)
    if (f === me && f.onGround && f.onPlatform && keys['s']) {
      f.onGround = false; f.onPlatform = false; f.dropTimer = 12; f.y += 2;
    }
    if (f.dropTimer > 0) f.dropTimer--;

    // gravity + collision (always integrate; support is re-evaluated each step)
    const prevFeet = f.y;
    f.vy = Math.min(MAXFALL, f.vy + GRAVITY);
    f.y += f.vy;
    f.onGround = false; f.onPlatform = false;

    // one-way platforms with forgiving edges (wider x margin + softer top tolerance)
    if (f.vy >= 0 && f.dropTimer <= 0) {
      for (const p of PLATFORMS) {
        if (f.x > p.x - PLAT_EDGE && f.x < p.x + p.w + PLAT_EDGE && prevFeet <= p.y + 10 && f.y >= p.y) {
          f.y = p.y; f.vy = 0; f.onGround = true; f.onPlatform = true; break;
        }
      }
    }
    // solid ground
    if (f.y >= GROUND_Y) { f.y = GROUND_Y; f.vy = 0; f.onGround = true; f.onPlatform = false; }

    // coyote time — still allow a jump shortly after leaving an edge
    if (f.onGround) f.coyote = COYOTE; else if (f.coyote > 0) f.coyote--;

    if (f.cd.basic > 0) f.cd.basic--;
    if (f.cd.strong > 0) f.cd.strong--;
    for (let i = 0; i < 3; i++) if (f.skillCd[i] > 0) f.skillCd[i] = Math.max(0, f.skillCd[i] - STEP);
    if (f.shieldT > 0) f.shieldT = Math.max(0, f.shieldT - STEP);
    if (f.hasteT > 0) f.hasteT = Math.max(0, f.hasteT - STEP);
    if (f.hurt > 0) f.hurt--;

    if (f.stats.regen > 0 && !f.dead && f.hp > 0) {
      f.regenAcc += f.stats.regen * (STEP / 1000);
      if (f.regenAcc >= 1) { f.hp = Math.min(f.maxHp, f.hp + Math.floor(f.regenAcc)); f.regenAcc -= Math.floor(f.regenAcc); }
    }

    if (f.atk) { f.atk.t++; if (f.atk.t > f.atk.dur) f.atk = null; }
  }

  function hitboxOf(f) {
    if (!f.atk) return null;
    if (f.atk.t < f.atk.as || f.atk.t > f.atk.ae) return null;
    const reach = f.atk.reach;
    const x = f.facing === 1 ? f.x + 20 : f.x - 20 - reach;
    const y = f.y - f.h * 0.5 - f.atk.hh / 2;
    return { x, y, w: reach, h: f.atk.hh };
  }
  function bodyOf(f) { return { x: f.x - f.w / 2, y: f.y - f.h, w: f.w, h: f.h }; }
  function overlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  function resolveHits(attacker, defender) {
    if (!attacker.atk || attacker.atk.hit) return;
    const hb = hitboxOf(attacker);
    if (!hb) return;
    if (overlap(hb, bodyOf(defender))) {
      attacker.atk.hit = true;
      if (netMode) {
        Net.send({ t: 'h', dmg: attacker.atk.dmg, kx: attacker.facing, kind: attacker.atk.kind });
        spawnHit(defender.x, defender.y - defender.h * 0.55, attacker.atk.kind);
      } else {
        applyDamage(defender, attacker.atk.dmg, attacker.facing, attacker.atk.kind);
      }
    }
  }

  /* ---------- AI ---------- */
  function aiThink(f, speed) {
    const target = me;
    const dx = target.x - f.x;
    const dist = Math.abs(dx);
    const dir0 = Math.sign(dx) || 1;
    f.ai.t += STEP;

    // hop toward an elevated opponent (use the platforms to give chase)
    if (target.y < f.y - 50 && dist < 360 && f.onGround && Math.random() < 0.06) jump(f);

    if (f.hp < f.maxHp * 0.35) {
      if (f.stats.skills[1] && f.skillCd[1] <= 0 && Math.random() < 0.02) useSkill(f, 1);
      if (f.stats.skills[2] && f.skillCd[2] <= 0 && Math.random() < 0.02) useSkill(f, 2);
    }

    let dir = 0;
    if (dist > 150) {
      dir = dir0;
      if (target.y < GROUND_Y - 40 && f.onGround && Math.random() < 0.03) jump(f);
      if (Math.random() < 0.01 && f.onGround) jump(f);
    } else {
      if (f.ai.t > 650 + Math.random() * 650) {
        f.ai.t = 0;
        const r = Math.random();
        if (f.stats.skills[0] && f.skillCd[0] <= 0 && r < 0.15) useSkill(f, 0);
        else if (r < 0.38) attack(f, 'strong');
        else attack(f, 'basic');
      }
      if (Math.random() < 0.05) dir = (Math.random() < 0.5 ? dir0 : -dir0); // spacing dance
      if (Math.random() < 0.012 && f.onGround) jump(f);
    }
    return dir;
  }

  /* ---------- particles ---------- */
  const SPARKS = ['#ffe6a8', '#ffb867', '#ff7a47', '#ffffff'];
  function spawnHit(x, y, kind) {
    const n = kind === 'strong' || kind === 'skill' ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * (kind === 'basic' ? 7 : 12);
      particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, life: 1, decay: 0.04 + Math.random() * 0.04, color: SPARKS[(Math.random() * SPARKS.length) | 0], size: 2 + Math.random() * 4 });
    }
  }
  function spawnRing(f, color) {
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2;
      particles.push({ x: f.x, y: f.y - f.h * 0.5, vx: Math.cos(ang) * 6, vy: Math.sin(ang) * 6, life: 1, decay: 0.03, color, size: 4, grav: 0.05 });
    }
  }
  function spawnBlock(f) {
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      particles.push({ x: f.x, y: f.y - f.h * 0.5, vx: Math.cos(ang) * 4, vy: Math.sin(ang) * 4, life: 1, decay: 0.05, color: '#cfe2ff', size: 3 });
    }
  }
  function stepParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += (p.grav == null ? 0.3 : p.grav); p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  /* ---------- loop ---------- */
  function loop(ts) {
    if (!running) return;
    if (paused) { lastTs = ts; rafId = requestAnimationFrame(loop); return; } // freeze sim, keep frame
    let dt = ts - lastTs; lastTs = ts;
    if (dt > 100) dt = 100;
    animClock += dt;
    acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render();
    rafId = requestAnimationFrame(loop);
  }

  function update(ms) {
    if (ended) return;

    if (phase === 'countdown') {
      countdownT -= ms / 1000;
      updateCountdown();
      if (countdownT <= -0.55) { phase = 'fighting'; hideCountdown(); }
      // still age torch embers so the arena looks alive
      stepParticles();
      return;
    }

    physics(p1); physics(p2);

    if (netMode) { resolveHits(me, opp); }
    else { resolveHits(p1, p2); resolveHits(p2, p1); }

    stepParticles();

    if (!overtime) {
      timeLeft -= ms / 1000;
      if (timeLeft <= 0) { timeLeft = 0; overtime = true; $('#overtime-badge').classList.remove('hidden'); }
    } else {
      otAcc += ms;
      if (otAcc >= C.OVERTIME_TICK_INTERVAL) {
        otAcc -= C.OVERTIME_TICK_INTERVAL;
        const tickTargets = netMode ? [me] : [p1, p2];
        tickTargets.forEach((f) => {
          if (!f.dead) { f.hp = Math.max(0, f.hp - C.OVERTIME_TICK); spawnHit(f.x, f.y - f.h * 0.55, 'basic'); }
        });
      }
    }

    if (netMode) {
      netAcc += ms;
      if (netAcc >= 22) {   // ~45Hz state sync for snappier remote motion
        netAcc = 0;
        Net.send({ t: 's', x: me.x, y: me.y, vx: me.vx, facing: me.facing, hp: me.hp, g: me.onGround, shield: me.shieldT > 0, haste: me.hasteT > 0 });
      }
    }

    if (netMode) {
      if (me.hp <= 0 && !me.dead) { me.dead = true; Net.send({ t: 'dead' }); Net.send({ t: 'dead' }); finish('lose'); }
      else if (opp.hp <= 0 && !ended) finish('win');  // backup if a 'dead' packet is lost
    } else {
      if (p1.hp <= 0 || p2.hp <= 0) {
        const meDead = me.hp <= 0, oppDead = opp.hp <= 0;
        if (meDead && oppDead) finish('draw');
        else if (oppDead) finish('win');
        else finish('lose');
      }
    }

    updateHud();
  }

  function finish(result) {
    if (ended) return;
    ended = true; running = false;
    cancelAnimationFrame(rafId);
    st.lastResult = result;
    setTimeout(() => onEnd && onEnd(result), 700);
  }

  /* ---------- countdown DOM ---------- */
  function showCountdown() { const el = $('#battle-countdown'); el.classList.remove('hidden'); lastCount = null; updateCountdown(); }
  function updateCountdown() {
    const el = $('#battle-countdown'), num = $('#countdown-num');
    const label = countdownT > 0 ? String(Math.ceil(countdownT)) : '시작!';
    if (label !== lastCount) {
      lastCount = label;
      num.textContent = label;
      el.classList.toggle('cd-go', countdownT <= 0);
      num.classList.remove('cd-pop'); void num.offsetWidth; num.classList.add('cd-pop');
    }
  }
  function hideCountdown() { $('#battle-countdown').classList.add('hidden'); }

  /* ---------- HUD ---------- */
  function eachSkill(i, fn) {
    document.querySelectorAll('.skill-slot[data-skill="' + i + '"]').forEach(fn);
  }
  function setupSkillHud() {
    const myStats = me.stats;
    for (let i = 0; i < 3; i++) eachSkill(i, (el) => {
      el.classList.toggle('unlocked', myStats.skills[i]);
      const ov = el.querySelector('.skill-cd-overlay'); if (ov) ov.style.height = '0%';
    });
  }
  function updateHud() {
    const setHp = (fill, num, f) => {
      const ratio = Math.max(0, f.hp / f.maxHp);
      fill.style.width = (ratio * 100) + '%';
      fill.classList.toggle('low', ratio <= 0.3);
      num.textContent = Math.ceil(f.hp);
    };
    setHp($('#hp-fill-p1'), $('#hp-num-p1'), p1);
    setHp($('#hp-fill-p2'), $('#hp-num-p2'), p2);

    const mm = Math.floor(timeLeft / 60), ssn = Math.floor(timeLeft % 60);
    const t = $('#battle-timer');
    t.textContent = mm + ':' + String(ssn).padStart(2, '0');
    t.classList.toggle('urgent', timeLeft <= 10 && !overtime);

    for (let i = 0; i < 3; i++) {
      const ready = me.stats.skills[i] && me.skillCd[i] <= 0;
      const cdMax = C.SKILL_COOLDOWNS[i] * (me.stats.skillCdMult[i] || 1);
      const h = me.stats.skills[i] ? (me.skillCd[i] / cdMax * 100) + '%' : '0%';
      eachSkill(i, (el) => {
        el.classList.toggle('ready', ready);
        const ov = el.querySelector('.skill-cd-overlay'); if (ov) ov.style.height = h;
      });
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawStage();
    drawPlatforms();
    drawFighter(p1); drawFighter(p2);
    drawParticles();
  }

  /* ---------- stage (dark-fantasy arena) ---------- */
  function makeStars() {
    const arr = [];
    for (let i = 0; i < 90; i++) arr.push({ x: Math.random() * W, y: Math.random() * (GROUND_Y - 380), s: Math.random() < 0.85 ? 2 : 3, p: Math.random() * 6.28 });
    return arr;
  }

  function drawStage() {
    const t = animClock;
    // dusk sky
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, '#15131f'); sky.addColorStop(0.55, '#231a2b'); sky.addColorStop(1, '#3a2731');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, GROUND_Y);

    // stars
    for (const s of stars) { ctx.globalAlpha = (0.35 + 0.55 * Math.abs(Math.sin(t / 600 + s.p))) * 0.7; ctx.fillStyle = '#dfe3ff'; ctx.fillRect(s.x, s.y, s.s, s.s); }
    ctx.globalAlpha = 1;

    // moon with halo + craters
    const mx = 1480, my = 215;
    const halo = ctx.createRadialGradient(mx, my, 12, mx, my, 200);
    halo.addColorStop(0, 'rgba(238,231,205,0.5)'); halo.addColorStop(0.35, 'rgba(220,210,180,0.16)'); halo.addColorStop(1, 'rgba(220,210,180,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, 200, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#e8e2c8'; ctx.beginPath(); ctx.arc(mx, my, 72, 0, 6.3); ctx.fill();
    ctx.fillStyle = 'rgba(150,144,118,0.45)';
    ctx.beginPath(); ctx.arc(mx - 22, my - 16, 13, 0, 6.3); ctx.arc(mx + 26, my + 12, 10, 0, 6.3); ctx.arc(mx + 4, my + 32, 8, 0, 6.3); ctx.fill();

    // drifting cloud bands
    drawClouds(t);

    // far mountains (parallax layers)
    drawMountains('#1a1525', 0, 150);
    drawMountains('#231a2c', 46, 100);

    // castle wall + arches + banners
    drawWall();

    // torches
    drawTorch(250, GROUND_Y - 250, t);
    drawTorch(W - 250, GROUND_Y - 250, t);

    // stone floor
    drawGround();

    // foreground vignette for depth
    const vg = ctx.createRadialGradient(W / 2, GROUND_Y - 120, 320, W / 2, GROUND_Y - 120, 1150);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  function drawClouds(t) {
    ctx.save();
    ctx.fillStyle = 'rgba(20,16,28,0.55)';
    const off = (t / 90) % (W + 400);
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 560 + off) % (W + 500)) - 250;
      const cy = 120 + (i % 2) * 70;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 170, 34, 0, 0, 6.3);
      ctx.ellipse(cx + 120, cy + 10, 120, 26, 0, 0, 6.3);
      ctx.ellipse(cx - 110, cy + 14, 100, 22, 0, 0, 6.3);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMountains(color, yOff, amp) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= W; x += 36) {
      const y = GROUND_Y - 150 - yOff - amp * (0.5 + 0.5 * Math.sin(x * 0.0032 + yOff) + 0.32 * Math.sin(x * 0.011 + 2));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, GROUND_Y); ctx.closePath(); ctx.fill();
  }

  function drawWall() {
    const top = GROUND_Y - 330, h = 330;
    // wall face
    const wg = ctx.createLinearGradient(0, top, 0, GROUND_Y);
    wg.addColorStop(0, '#241f2c'); wg.addColorStop(1, '#191521');
    ctx.fillStyle = wg; ctx.fillRect(0, top, W, h);
    // arched openings (dark)
    ctx.fillStyle = '#100d16';
    for (let i = 0; i < 6; i++) {
      const ax = 90 + i * 320;
      ctx.beginPath();
      ctx.moveTo(ax, GROUND_Y);
      ctx.lineTo(ax, top + 130);
      ctx.arc(ax + 95, top + 130, 95, Math.PI, 0);
      ctx.lineTo(ax + 190, GROUND_Y);
      ctx.closePath(); ctx.fill();
    }
    // stone block seams
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 2;
    for (let y = top; y < GROUND_Y; y += 46) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (let x = 0; x < W; x += 92) { ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, GROUND_Y); ctx.stroke(); }
    // hanging banners
    for (let i = 0; i < 3; i++) {
      const bx = 250 + i * 640;
      ctx.fillStyle = '#6e2230'; ctx.fillRect(bx, top + 26, 44, 190);
      ctx.beginPath(); ctx.moveTo(bx, top + 216); ctx.lineTo(bx + 22, top + 246); ctx.lineTo(bx + 44, top + 216); ctx.closePath(); ctx.fill();
      ctx.fillStyle = GOLD; ctx.fillRect(bx + 16, top + 70, 12, 12);
      ctx.beginPath(); ctx.arc(bx + 22, top + 110, 12, 0, 6.3); ctx.stroke();
    }
  }

  function flameShape(x, y, w, hgt) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - w, y - hgt * 0.45, x, y - hgt);
    ctx.quadraticCurveTo(x + w, y - hgt * 0.45, x, y);
    ctx.closePath(); ctx.fill();
  }

  function drawTorch(x, y, t) {
    // glow
    const fl = 0.78 + 0.22 * Math.sin(t / 90) + 0.08 * Math.sin(t / 33);
    const g = ctx.createRadialGradient(x, y - 26, 6, x, y - 26, 170 * fl);
    g.addColorStop(0, 'rgba(255,168,80,0.42)'); g.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 26, 170 * fl, 0, 6.3); ctx.fill();
    // bracket
    ctx.fillStyle = '#241f29'; ctx.fillRect(x - 7, y, 14, 96);
    ctx.fillStyle = '#39323f'; ctx.fillRect(x - 18, y - 12, 36, 18);
    // flame
    ctx.fillStyle = '#ff7a2f'; flameShape(x, y - 6, 26, 70 * fl);
    ctx.fillStyle = '#ffb04a'; flameShape(x, y - 6, 17, 52 * fl);
    ctx.fillStyle = '#ffe39a'; flameShape(x, y - 6, 8, 30 * fl);
    // embers
    if (Math.random() < 0.35) particles.push({ x: x + (Math.random() * 18 - 9), y: y - 36, vx: (Math.random() - 0.5) * 1.1, vy: -1 - Math.random() * 1.2, life: 1, decay: 0.012 + Math.random() * 0.01, color: '#ffae5c', size: 2, grav: -0.03 });
  }

  function drawGround() {
    const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    g.addColorStop(0, '#3c3641'); g.addColorStop(1, '#1c1822');
    ctx.fillStyle = g; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = '#4a4350'; ctx.fillRect(0, GROUND_Y, W, 6);
    ctx.fillStyle = '#161219'; ctx.fillRect(0, GROUND_Y + 6, W, 4);
    // perspective flagstones
    ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 2;
    for (let i = -12; i <= 12; i++) { ctx.beginPath(); ctx.moveTo(W / 2 + i * 62, GROUND_Y); ctx.lineTo(W / 2 + i * 168, H); ctx.stroke(); }
    for (let y = GROUND_Y + 46; y < H; y += 58) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // faint arena emblem
    ctx.save(); ctx.globalAlpha = 0.12; ctx.strokeStyle = GOLD; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(W / 2, GROUND_Y + 96, 86, 0, 6.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, GROUND_Y + 96, 54, 0, 6.3); ctx.stroke();
    ctx.restore();
  }

  /* ---------- floating platforms ---------- */
  function drawChain(x, yBottom) {
    ctx.strokeStyle = 'rgba(34,28,38,0.9)'; ctx.lineWidth = 4;
    for (let y = 0; y < yBottom - 4; y += 16) { ctx.beginPath(); ctx.ellipse(x, y, 4, 7, 0, 0, 6.3); ctx.stroke(); }
  }
  function drawPlatforms() {
    const th = 26;
    for (const p of PLATFORMS) {
      // suspension chains into the dark above
      drawChain(p.x + 34, p.y);
      drawChain(p.x + p.w - 34, p.y);
      // stone slab
      const g = ctx.createLinearGradient(0, p.y, 0, p.y + th);
      g.addColorStop(0, '#47414f'); g.addColorStop(1, '#221d29');
      ctx.fillStyle = g; ctx.strokeStyle = OUT; ctx.lineWidth = 3;
      rr(p.x, p.y, p.w, th, 8); ctx.fill(); ctx.stroke();
      // top-lit edge
      ctx.fillStyle = '#564e60'; ctx.fillRect(p.x + 5, p.y + 2, p.w - 10, 4);
      // block seams
      ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 2;
      for (let x = p.x + p.w / 4; x < p.x + p.w - 2; x += p.w / 4) { ctx.beginPath(); ctx.moveTo(x, p.y + 5); ctx.lineTo(x, p.y + th); ctx.stroke(); }
      // faint rune glow on the underside
      ctx.fillStyle = 'rgba(201,162,39,0.16)'; ctx.fillRect(p.x + p.w / 2 - 18, p.y + th, 36, 3);
    }
  }

  /* ---------- knight ---------- */
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // legacy alias used nowhere else, kept for safety
  function roundRect(x, y, w, h, r) { rr(x, y, w, h, r); }

  function drawFighter(f) {
    // shadow on whatever surface the knight stands on (world space)
    ctx.save();
    const shY = (f.onGround ? f.y : GROUND_Y) + 8;
    const shSc = f.onGround ? 1 : 0.7;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(f.x, shY, 48 * shSc, 12 * shSc, 0, 0, 6.3); ctx.fill();
    ctx.restore();

    const P = f.pal;
    const moving = Math.abs(f.vx) > 0.6 && f.onGround;
    if (moving) f.step += 0.18 + Math.min(0.25, Math.abs(f.vx) * 0.03);
    const bob = f.onGround ? Math.sin(animClock / 320 + f.bobPhase) * 2.0 : 0;
    const hurt = f.hurt > 0 && (f.hurt % 4 < 2);
    const tint = (base) => hurt ? '#ffffff' : base;

    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.facing, 1);     // +x = forward
    if (f.dead) ctx.globalAlpha = 0.4;
    ctx.translate(0, bob);

    // sway for cape
    const sway = moving ? Math.abs(Math.sin(f.step)) * 8 : Math.sin(animClock / 500 + f.bobPhase) * 3;
    const air = f.onGround ? 0 : 8;

    // ----- cape (behind everything) -----
    ctx.fillStyle = tint(P.capeD);
    ctx.beginPath();
    ctx.moveTo(-2, -124);
    ctx.quadraticCurveTo(-32 - sway - air, -78, -24 - sway - air, -6);
    ctx.lineTo(8 - sway * 0.3, -6);
    ctx.quadraticCurveTo(10, -78, 14, -124);
    ctx.closePath(); ctx.fill();

    // ----- back-mounted shield (armor>=5) -----
    if (f.build.armor >= 5) {
      ctx.save(); ctx.translate(-16, -96);
      ctx.fillStyle = tint(P.armorD); ctx.strokeStyle = OUT; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(20, -14); ctx.lineTo(20, 12); ctx.lineTo(0, 30); ctx.lineTo(-20, 12); ctx.lineTo(-20, -14); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(0, 2, 6, 0, 6.3); ctx.fill();
      ctx.restore();
    }

    // ----- legs (back first, then front) -----
    const sw = moving ? Math.sin(f.step) * 16 : 0;
    drawLeg(-5, -sw, P, tint, true);
    drawLeg(5, sw, P, tint, false);

    // ----- torso (chest plate) -----
    if (hurt) { ctx.fillStyle = '#ffffff'; }
    else {
      const chest = ctx.createLinearGradient(-24, -124, 24, -60);
      chest.addColorStop(0, P.armorD); chest.addColorStop(0.5, P.armor); chest.addColorStop(1, P.armorL);
      ctx.fillStyle = chest;
    }
    ctx.strokeStyle = OUT; ctx.lineWidth = 3;
    rr(-25, -126, 50, 66, 11); ctx.fill(); ctx.stroke();
    // central ridge + rivets
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -122); ctx.lineTo(0, -66); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.arc(-15, -116, 2.5, 0, 6.3); ctx.arc(15, -116, 2.5, 0, 6.3); ctx.fill();
    // belt
    ctx.fillStyle = tint(P.armorD); ctx.fillRect(-25, -68, 50, 12);
    ctx.fillStyle = GOLD; ctx.fillRect(-9, -69, 18, 13);
    ctx.fillStyle = '#7a5e15'; ctx.fillRect(-9, -69, 18, 3);
    // 능력치 gem (stat>=5)
    if (f.build.stat >= 5) { ctx.fillStyle = '#79e0c8'; ctx.beginPath(); ctx.arc(0, -62, 4, 0, 6.3); ctx.fill(); }

    // ----- pauldrons -----
    ctx.strokeStyle = OUT; ctx.lineWidth = 2;
    ctx.fillStyle = tint(P.armorL);
    ctx.beginPath(); ctx.ellipse(-21, -120, 13, 11, 0, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(22, -120, 14, 12, 0, 0, 6.3); ctx.fill(); ctx.stroke();
    if (f.build.armor >= 7) { ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(22, -120, 5, 0, 6.3); ctx.arc(-21, -120, 4, 0, 6.3); ctx.fill(); }

    // ----- head / helmet -----
    drawHelmet(f, P, tint);

    // ----- sword arm + blade (front) -----
    drawSwordArm(f, P, tint);

    // ----- shield bubble (skill 2) -----
    if (f.shieldT > 0) {
      ctx.strokeStyle = 'rgba(150,200,255,0.7)'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, -72, 74, 0, 6.3); ctx.stroke();
      ctx.fillStyle = 'rgba(150,200,255,0.10)'; ctx.beginPath(); ctx.arc(0, -72, 74, 0, 6.3); ctx.fill();
    }
    // ----- haste motion lines (skill 3) -----
    if (f.hasteT > 0) {
      ctx.strokeStyle = 'rgba(185,168,255,0.55)'; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) { const yy = -46 - i * 28; ctx.beginPath(); ctx.moveTo(-28, yy); ctx.lineTo(-62, yy); ctx.stroke(); }
    }

    ctx.restore();

    // name tag (world space, never flipped)
    ctx.save();
    ctx.font = '700 22px Orbitron, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(f.name, f.x, f.y - bob - 172);
    ctx.fillStyle = f.pal.accent;
    ctx.fillText(f.name, f.x, f.y - bob - 172);
    ctx.restore();
  }

  function drawLeg(xOff, swingDeg, P, tint, back) {
    ctx.save();
    ctx.translate(xOff, -60);
    ctx.rotate(rad(swingDeg));
    ctx.fillStyle = tint(back ? '#2a2530' : P.armorD);
    ctx.strokeStyle = OUT; ctx.lineWidth = 2;
    rr(-8, 0, 16, 50, 6); ctx.fill(); ctx.stroke();
    // knee plate
    ctx.fillStyle = tint(back ? '#3a3340' : P.armor);
    rr(-9, 18, 18, 12, 4); ctx.fill(); ctx.stroke();
    // boot
    ctx.fillStyle = tint('#211c27');
    rr(-10, 48, 24, 13, 4); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function drawHelmet(f, P, tint) {
    // neck
    ctx.fillStyle = tint(P.armorD); ctx.strokeStyle = OUT; ctx.lineWidth = 2;
    rr(-8, -136, 16, 14, 3); ctx.fill(); ctx.stroke();
    // plume crest (behind helmet)
    ctx.fillStyle = tint(P.plume);
    ctx.beginPath();
    ctx.moveTo(2, -170);
    ctx.quadraticCurveTo(-30, -176, -22, -150);
    ctx.quadraticCurveTo(-12, -160, -2, -156);
    ctx.closePath(); ctx.fill();
    // helmet body
    ctx.fillStyle = tint(P.armor);
    rr(-17, -152, 34, 28, 7); ctx.fill(); ctx.stroke();
    // dome top
    ctx.fillStyle = tint(P.armorL);
    ctx.beginPath(); ctx.arc(0, -152, 17, Math.PI, 0); ctx.fill();
    ctx.strokeStyle = OUT; ctx.lineWidth = 2; ctx.stroke();
    // visor slit
    ctx.fillStyle = '#0c0a11'; rr(-15, -142, 31, 8, 3); ctx.fill();
    // eye glint (subtle team accent)
    ctx.fillStyle = f.pal.accent;
    ctx.fillRect(3, -140, 9, 3);
    // brow ridge
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-15, -134); ctx.lineTo(16, -134); ctx.stroke();
  }

  function drawSwordArm(f, P, tint) {
    const swordLen = 50 + f.build.sword * 7;
    let arm = 18; // rest angle (deg), forward-down
    if (f.atk) {
      const p = clamp(f.atk.t / f.atk.dur, 0, 1);
      if (p < 0.30) arm = lerp(18, -80, p / 0.30);
      else if (p < 0.62) arm = lerp(-80, 72, (p - 0.30) / 0.32);
      else arm = lerp(72, 18, (p - 0.62) / 0.38);
    }

    // slash trail during active frames
    if (f.atk && f.atk.t >= f.atk.as && f.atk.t <= f.atk.ae) {
      ctx.save(); ctx.translate(16, -116);
      ctx.strokeStyle = f.atk.kind === 'skill' ? 'rgba(255,214,130,0.55)'
        : f.atk.kind === 'strong' ? 'rgba(255,180,150,0.5)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 11; ctx.lineCap = 'round';
      const r = 46 + swordLen * 0.7;
      ctx.beginPath(); ctx.arc(0, 0, r, rad(arm - 58), rad(arm + 14)); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(16, -116);     // front shoulder
    ctx.rotate(rad(arm));
    ctx.strokeStyle = OUT;

    // upper arm
    ctx.fillStyle = tint(P.armor); ctx.lineWidth = 2;
    rr(0, -7, 30, 14, 6); ctx.fill(); ctx.stroke();
    // gauntlet/hand
    ctx.fillStyle = tint(P.armorL);
    ctx.beginPath(); ctx.arc(32, 0, 8, 0, 6.3); ctx.fill(); ctx.stroke();

    // grip
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(32, -4, 14, 8);
    // crossguard
    ctx.fillStyle = GOLD; rr(44, -16, 7, 32, 2); ctx.fill();
    // pommel
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(30, 0, 5, 0, 6.3); ctx.fill();

    // blade
    const grd = ctx.createLinearGradient(0, -5, 0, 5);
    grd.addColorStop(0, f.build.sword >= 5 ? '#eef3fb' : METAL);
    grd.addColorStop(0.5, METAL);
    grd.addColorStop(1, METAL_D);
    ctx.fillStyle = grd; ctx.strokeStyle = OUT; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(51, -5);
    ctx.lineTo(51 + swordLen, -3);
    ctx.lineTo(51 + swordLen + 12, 0);  // point
    ctx.lineTo(51 + swordLen, 3);
    ctx.lineTo(51, 5);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // fuller line
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(53, 0); ctx.lineTo(51 + swordLen, 0); ctx.stroke();
    // gold edge for high-level swords
    if (f.build.sword >= 7) {
      ctx.strokeStyle = 'rgba(201,162,39,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(51, -5); ctx.lineTo(51 + swordLen, -3); ctx.lineTo(51 + swordLen + 12, 0); ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1;
  }

  return {
    start, stop, handleNetData,
    // input API for on-screen (mobile) controls
    input: {
      move(d) { keys['a'] = d < 0; keys['d'] = d > 0; },
      jump() { jump(me); },
      attack(kind) { attack(me, kind); },
      skill(i) { useSkill(me, i); },
    },
  };
})();
