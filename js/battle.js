/* ============================================================
   BATTLE — Screen 4. 2D side-view fighter on a canvas.
   World coords are shared by both peers: p1 (host) on the left,
   p2 (guest) on the right. Each peer drives only its own
   fighter and announces hits / death to the other.
   ============================================================ */
window.Battle = (function () {
  const C = window.CONFIG;
  const { $ } = UI;
  const st = State.state;

  /* world constants */
  const W = 1920, H = 1080, GROUND_Y = 880;
  const GRAVITY = 0.92, JUMP_V = -20, FRICTION = 0.80, MAXFALL = 26;

  let canvas, ctx;
  let me = null, opp = null;            // fighters
  let p1 = null, p2 = null;             // left/right references (for HUD)
  let netMode = false;
  let onEnd = null;
  let running = false, ended = false;
  let rafId = 0, lastTs = 0, acc = 0;
  const STEP = 1000 / 60;

  let timeLeft = C.TIMER_SECONDS;
  let overtime = false, otAcc = 0;
  let particles = [];
  let netAcc = 0;

  const keys = Object.create(null);
  let inputBound = false;

  /* ---------- fighter factory ---------- */
  function makeFighter(id, x, build, name, color) {
    const s = State.statsFromBuild(build);
    return {
      id, name, color, build, stats: s,
      x, y: GROUND_Y, vx: 0, vy: 0,
      w: 64, h: 150, facing: id === 'p1' ? 1 : -1,
      onGround: true,
      hp: s.maxHp, maxHp: s.maxHp,
      cd: { basic: 0, strong: 0 },
      skillCd: [0, 0, 0],
      atk: null,            // {kind,t,dur,as,ae,reach,hh,dmg,kb,hit}
      shieldT: 0, hasteT: 0, regenAcc: 0,
      hurt: 0, dead: false,
      ai: null,
    };
  }

  /* ---------- public start ---------- */
  function start(cfg) {
    netMode = cfg.mode !== 'practice';
    onEnd = cfg.onEnd;

    const hostBuild = st.isHost ? st.build : st.opponentBuild;
    const guestBuild = st.isHost ? st.opponentBuild : st.build;
    const hostName = st.isHost ? st.nickname : st.opponentName;
    const guestName = st.isHost ? st.opponentName : st.nickname;

    p1 = makeFighter('p1', 520, hostBuild || State.freshBuild(), hostName || 'P1', '#2ff3ff');
    p2 = makeFighter('p2', W - 520, guestBuild || State.freshBuild(), guestName || 'P2', '#ff3df0');

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

    // HUD static labels
    $('#hud-name-p1').textContent = p1.name;
    $('#hud-name-p2').textContent = p2.name;
    setupSkillHud();

    timeLeft = C.TIMER_SECONDS; overtime = false; otAcc = 0;
    particles = []; ended = false; running = true;
    $('#overtime-badge').classList.add('hidden');

    updateHud();
    lastTs = performance.now(); acc = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  /* ---------- input ---------- */
  function bindInput() {
    if (inputBound) return;
    inputBound = true;
    window.addEventListener('keydown', (e) => {
      if (UI.currentScreen() !== 'battle') return;
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (k === 'w' || k === ' ') { e.preventDefault(); jump(me); }
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
  }

  /* ---------- actions ---------- */
  function jump(f) {
    if (!f || f.dead || !running) return;
    if (f.onGround) { f.vy = JUMP_V; f.onGround = false; }
  }

  function attack(f, kind) {
    if (!f || f.dead || !running || f.atk) return;
    if (kind === 'basic' && f.cd.basic > 0) return;
    if (kind === 'strong' && f.cd.strong > 0) return;

    const base = f.stats.basic;
    let a;
    if (kind === 'basic') {
      a = { kind, t: 0, dur: 18, as: 7, ae: 13, reach: 96, hh: 96, dmg: base, kb: 9 };
      f.cd.basic = 26;
    } else { // strong
      a = { kind, t: 0, dur: 34, as: 16, ae: 24, reach: 128, hh: 120, dmg: f.stats.strong, kb: 18 };
      f.cd.strong = 64;
    }
    a.hit = false;
    f.atk = a;
    if (netMode && f === me) Net.send({ t: 'a', kind, dmg: a.dmg, reach: a.reach, hh: a.hh, kb: a.kb });
  }

  function useSkill(f, idx) {
    if (!f || f.dead || !running) return;
    if (!f.stats.skills[idx]) { if (f === me) UI.toast('🔒 ' + C.CATEGORIES[idx].skillName + ' — 5강 필요'); return; }
    if (f.skillCd[idx] > 0) return;
    f.skillCd[idx] = C.SKILL_COOLDOWNS[idx];
    if (idx === 0) {
      // 강철 베기 — big lunging slash
      const a = { kind: 'skill', t: 0, dur: 40, as: 14, ae: 30, reach: 175, hh: 150, dmg: f.stats.strong * 1.5, kb: 24, hit: false };
      f.atk = a; f.vx += f.facing * 16;
      if (netMode && f === me) Net.send({ t: 'a', kind: 'skill', dmg: a.dmg, reach: a.reach, hh: a.hh, kb: a.kb });
    } else if (idx === 1) {
      // 불굴의 방벽 — invulnerable shield
      f.shieldT = 2200;
      spawnRing(f, '#2ff3ff');
    } else if (idx === 2) {
      // 질풍 가속 — haste + heal
      f.hasteT = 3500;
      f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.12);
      spawnRing(f, '#9a6bff');
    }
    if (netMode && f === me && idx > 0) Net.send({ t: 'sk', idx });
    if (f === me) UI.toast('✨ ' + C.CATEGORIES[idx].skillName + ' 발동!');
  }

  /* ---------- network inbound ---------- */
  function handleNetData(msg) {
    if (!msg || !msg.t) return;
    if (msg.t === 's') {
      // opponent's authoritative state about itself
      opp.x = msg.x; opp.y = msg.y; opp.vx = msg.vx; opp.facing = msg.facing;
      opp.hp = msg.hp; opp.shieldT = msg.shield ? 1 : 0; opp.hasteT = msg.haste ? 1 : 0;
      opp.onGround = msg.g;
    } else if (msg.t === 'a') {
      // opponent started a swing — visual only on our side
      opp.atk = { kind: msg.kind, t: 0, dur: msg.kind === 'strong' ? 34 : msg.kind === 'skill' ? 40 : 18,
                  as: 99, ae: 99, reach: msg.reach, hh: msg.hh, dmg: 0, kb: 0, hit: true };
    } else if (msg.t === 'h') {
      // we got hit
      applyDamage(me, msg.dmg, msg.kx, msg.kind);
    } else if (msg.t === 'sk') {
      if (msg.idx === 1) { opp.shieldT = 2200; spawnRing(opp, '#2ff3ff'); }
      if (msg.idx === 2) { opp.hasteT = 3500; spawnRing(opp, '#9a6bff'); }
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
    spawnHit((f.x), f.y - f.h * 0.55, f.color, kind);
    UI.toast && void 0;
  }

  /* ---------- simulation step ---------- */
  function physics(f) {
    // face the opponent (1v1)
    const other = (f === p1) ? p2 : p1;
    if (other) f.facing = other.x >= f.x ? 1 : -1;

    let speed = f.stats.speed * (f.hasteT > 0 ? 1.7 : 1);
    if (f === me && !f.dead) {
      let dir = 0;
      if (keys['a']) dir -= 1;
      if (keys['d']) dir += 1;
      f.vx += dir * speed * 0.5;
      if (keys['s'] && !f.onGround) f.vy += 2.2; // fast fall
    } else if (f.ai && !f.dead) {
      aiThink(f, speed);
    }

    f.vx *= FRICTION;
    if (Math.abs(f.vx) > speed * 1.6) f.vx = Math.sign(f.vx) * speed * 1.6;
    f.x += f.vx;
    f.x = Math.max(70, Math.min(W - 70, f.x));

    if (!f.onGround) {
      f.vy = Math.min(MAXFALL, f.vy + GRAVITY);
      f.y += f.vy;
      if (f.y >= GROUND_Y) { f.y = GROUND_Y; f.vy = 0; f.onGround = true; }
    }

    // timers
    if (f.cd.basic > 0) f.cd.basic--;
    if (f.cd.strong > 0) f.cd.strong--;
    for (let i = 0; i < 3; i++) if (f.skillCd[i] > 0) f.skillCd[i] = Math.max(0, f.skillCd[i] - STEP);
    if (f.shieldT > 0) f.shieldT = Math.max(0, f.shieldT - STEP);
    if (f.hasteT > 0) f.hasteT = Math.max(0, f.hasteT - STEP);
    if (f.hurt > 0) f.hurt--;

    // passive regen from 능력치
    if (f.stats.regen > 0 && !f.dead && f.hp > 0) {
      f.regenAcc += f.stats.regen * (STEP / 1000);
      if (f.regenAcc >= 1) { f.hp = Math.min(f.maxHp, f.hp + Math.floor(f.regenAcc)); f.regenAcc -= Math.floor(f.regenAcc); }
    }

    // attack progression
    if (f.atk) {
      f.atk.t++;
      if (f.atk.t > f.atk.dur) f.atk = null;
    }
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
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function resolveHits(attacker, defender) {
    if (!attacker.atk || attacker.atk.hit) return;
    const hb = hitboxOf(attacker);
    if (!hb) return;
    if (overlap(hb, bodyOf(defender))) {
      attacker.atk.hit = true;
      if (netMode) {
        // only `me` does hit detection in net mode
        Net.send({ t: 'h', dmg: attacker.atk.dmg, kx: attacker.facing, kind: attacker.atk.kind });
        spawnHit(defender.x, defender.y - defender.h * 0.55, defender.color, attacker.atk.kind);
      } else {
        applyDamage(defender, attacker.atk.dmg, attacker.facing, attacker.atk.kind);
      }
    }
  }

  /* ---------- simple AI ---------- */
  function aiThink(f, speed) {
    const target = me;
    const dx = target.x - f.x;
    const dist = Math.abs(dx);
    const dir = Math.sign(dx) || 1;
    f.ai.t += STEP;

    // low hp -> sometimes shield/haste
    if (f.hp < f.maxHp * 0.35) {
      if (f.stats.skills[1] && f.skillCd[1] <= 0 && Math.random() < 0.02) useSkill(f, 1);
      if (f.stats.skills[2] && f.skillCd[2] <= 0 && Math.random() < 0.02) useSkill(f, 2);
    }

    if (dist > 150) {
      f.vx += dir * speed * 0.42;
      if (target.y < GROUND_Y - 40 && f.onGround && Math.random() < 0.03) jump(f);
      if (Math.random() < 0.01 && f.onGround) jump(f);
    } else {
      // in range: attack with reaction delay
      if (f.ai.t > 650 + Math.random() * 650) {
        f.ai.t = 0;
        const r = Math.random();
        if (f.stats.skills[0] && f.skillCd[0] <= 0 && r < 0.15) useSkill(f, 0);
        else if (r < 0.38) attack(f, 'strong');
        else attack(f, 'basic');
      }
      // spacing jitter
      if (Math.random() < 0.02) f.vx += dir * speed * 0.3;
      if (Math.random() < 0.012 && f.onGround) jump(f);
    }
  }

  /* ---------- particles ---------- */
  function spawnHit(x, y, color, kind) {
    const n = kind === 'strong' || kind === 'skill' ? 22 : 12;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * (kind === 'basic' ? 7 : 12);
      particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 2, life: 1, decay: 0.04 + Math.random() * 0.04, color, size: 2 + Math.random() * 4 });
    }
  }
  function spawnRing(f, color) {
    for (let i = 0; i < 28; i++) {
      const ang = (i / 28) * Math.PI * 2;
      particles.push({ x: f.x, y: f.y - f.h * 0.5, vx: Math.cos(ang) * 6, vy: Math.sin(ang) * 6, life: 1, decay: 0.03, color, size: 4 });
    }
  }
  function spawnBlock(f) {
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2;
      particles.push({ x: f.x, y: f.y - f.h * 0.5, vx: Math.cos(ang) * 4, vy: Math.sin(ang) * 4, life: 1, decay: 0.05, color: '#cfefff', size: 3 });
    }
  }
  function stepParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  /* ---------- main loop ---------- */
  function loop(ts) {
    if (!running) return;
    let dt = ts - lastTs; lastTs = ts;
    if (dt > 100) dt = 100;
    acc += dt;
    while (acc >= STEP) { update(STEP); acc -= STEP; }
    render();
    rafId = requestAnimationFrame(loop);
  }

  function update(ms) {
    if (ended) return;

    physics(p1); physics(p2);

    // hit resolution
    if (netMode) { resolveHits(me, opp); }
    else { resolveHits(p1, p2); resolveHits(p2, p1); }

    stepParticles();

    // timer / overtime
    if (!overtime) {
      timeLeft -= ms / 1000;
      if (timeLeft <= 0) { timeLeft = 0; overtime = true; $('#overtime-badge').classList.remove('hidden'); }
    } else {
      otAcc += ms;
      if (otAcc >= C.OVERTIME_TICK_INTERVAL) {
        otAcc -= C.OVERTIME_TICK_INTERVAL;
        // each peer ticks only its own fighter; practice ticks both
        const tickTargets = netMode ? [me] : [p1, p2];
        tickTargets.forEach((f) => {
          if (!f.dead) { f.hp = Math.max(0, f.hp - C.OVERTIME_TICK); spawnHit(f.x, f.y - f.h * 0.55, '#ff4d5e', 'basic'); }
        });
      }
    }

    // net sync (about my own fighter)
    if (netMode) {
      netAcc += ms;
      if (netAcc >= 33) {
        netAcc = 0;
        Net.send({ t: 's', x: me.x, y: me.y, vx: me.vx, facing: me.facing, hp: me.hp, g: me.onGround, shield: me.shieldT > 0, haste: me.hasteT > 0 });
      }
    }

    // death detection
    if (netMode) {
      if (me.hp <= 0 && !me.dead) { me.dead = true; Net.send({ t: 'dead' }); finish('lose'); }
    } else {
      const a = p1.hp <= 0, b = p2.hp <= 0;
      if (a || b) {
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

  /* ---------- HUD ---------- */
  function setupSkillHud() {
    const myStats = me.stats;
    ['#skill-1', '#skill-2', '#skill-3'].forEach((sel, i) => {
      const el = $(sel);
      el.classList.toggle('unlocked', myStats.skills[i]);
      el.querySelector('.skill-cd-overlay').style.height = '0%';
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

    // skill cooldown overlays
    ['#skill-1', '#skill-2', '#skill-3'].forEach((sel, i) => {
      const el = $(sel);
      const ready = me.stats.skills[i] && me.skillCd[i] <= 0;
      el.classList.toggle('ready', ready);
      const ov = el.querySelector('.skill-cd-overlay');
      ov.style.height = me.stats.skills[i] ? (me.skillCd[i] / C.SKILL_COOLDOWNS[i] * 100) + '%' : '0%';
    });
  }

  /* ---------- render ---------- */
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawStage();
    // draw far fighter first for slight depth (right one behind)
    drawFighter(p1); drawFighter(p2);
    drawParticles();
  }

  function drawStage() {
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#160d33'); g.addColorStop(0.6, '#0a0e22'); g.addColorStop(1, '#05060f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // distant neon pillars
    ctx.save();
    for (let i = 0; i < 7; i++) {
      const x = 120 + i * 270;
      ctx.fillStyle = i % 2 ? 'rgba(255,61,240,0.06)' : 'rgba(47,243,255,0.06)';
      ctx.fillRect(x, 200, 90, GROUND_Y - 200);
    }
    ctx.restore();

    // ground
    ctx.fillStyle = '#0c1130';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = 'rgba(47,243,255,0.4)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, GROUND_Y); ctx.lineTo(W, GROUND_Y); ctx.stroke();
    // ground grid
    ctx.strokeStyle = 'rgba(47,243,255,0.08)'; ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 80) { ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x - 60, H); ctx.stroke(); }
  }

  function drawFighter(f) {
    const bodyX = f.x, top = f.y - f.h;
    ctx.save();

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(f.x, GROUND_Y + 6, 46, 12, 0, 0, Math.PI * 2); ctx.fill();

    // hurt flash / death dim
    const flash = f.hurt > 0 && (f.hurt % 4 < 2);
    const main = f.dead ? '#444' : (flash ? '#ffffff' : f.color);

    // body
    ctx.shadowColor = f.color; ctx.shadowBlur = f.dead ? 0 : 18;
    ctx.fillStyle = main;
    roundRect(bodyX - f.w / 2, top + 36, f.w, f.h - 36, 12); ctx.fill();
    // head
    ctx.beginPath(); ctx.arc(bodyX, top + 22, 22, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // eyes (facing)
    ctx.fillStyle = '#05060f';
    ctx.fillRect(bodyX + f.facing * 4 - 3, top + 16, 6, 6);

    // armor plating glow by armor level
    const armorLv = f.build.armor;
    if (armorLv > 0) {
      ctx.strokeStyle = `rgba(47,243,255,${0.25 + armorLv * 0.06})`; ctx.lineWidth = 3;
      roundRect(bodyX - f.w / 2 - 3, top + 40, f.w + 6, 50, 8); ctx.stroke();
    }

    // weapon (sword) — length scales with sword level
    const swLen = 60 + f.build.sword * 9;
    const hx = bodyX + f.facing * (f.w / 2 + 6);
    const hy = top + 70;
    ctx.save();
    ctx.translate(hx, hy);
    let ang = f.facing === 1 ? -0.5 : Math.PI + 0.5;
    if (f.atk) {
      const prog = Math.min(1, f.atk.t / f.atk.dur);
      const swing = (f.atk.kind === 'basic' ? 1.6 : 2.4);
      ang += f.facing * (-0.8 + prog * swing);
    }
    ctx.rotate(ang);
    ctx.shadowColor = f.build.sword >= 5 ? '#ffd23f' : '#bcd';
    ctx.shadowBlur = f.dead ? 0 : 12;
    ctx.fillStyle = f.build.sword >= 9 ? '#ffd23f' : '#d7e6ff';
    ctx.fillRect(0, -4, swLen, 8);
    ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-10, -6, 12, 12); // hilt
    ctx.restore();

    // attack swoosh
    if (f.atk && f.atk.t >= f.atk.as && f.atk.t <= f.atk.ae) {
      const hb = hitboxOf(f);
      if (hb) {
        ctx.fillStyle = f.atk.kind === 'skill' ? 'rgba(255,210,63,0.28)'
          : f.atk.kind === 'strong' ? 'rgba(255,61,240,0.25)' : 'rgba(47,243,255,0.22)';
        ctx.beginPath();
        ctx.ellipse(hb.x + hb.w / 2, hb.y + hb.h / 2, hb.w / 2, hb.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // shield bubble
    if (f.shieldT > 0) {
      ctx.strokeStyle = 'rgba(47,243,255,0.8)'; ctx.lineWidth = 4;
      ctx.shadowColor = '#2ff3ff'; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(bodyX, top + f.h / 2, f.h * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // haste trail
    if (f.hasteT > 0) {
      ctx.fillStyle = 'rgba(154,107,255,0.3)';
      roundRect(bodyX - f.w / 2 - f.facing * 22, top + 36, f.w, f.h - 36, 12); ctx.fill();
    }

    // name tag
    ctx.shadowBlur = 0;
    ctx.fillStyle = f.color; ctx.font = 'bold 22px Orbitron, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(f.name, bodyX, top - 14);

    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 8;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    });
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { start, stop, handleNetData };
})();
