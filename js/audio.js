/* ============================================================
   AUDIO — procedural sound effects via the Web Audio API.
   No asset files (keeps the repo CDN/binary-free); every sound is
   synthesized from oscillators + filtered noise with envelopes.

   The AudioContext is created/resumed on the first user gesture
   (browser autoplay policy). All calls are no-ops until then and
   degrade silently if Web Audio is unavailable.
   ============================================================ */
window.SFX = (function () {
  let ctx = null, master = null, ready = false, enabled = true;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();   // tame layered peaks
      master.connect(comp); comp.connect(ctx.destination);
      ready = true;
    } catch (e) { ctx = null; ready = false; }
  }

  function resume() {
    if (!ctx) init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* ---- primitives ---- */
  // pitched oscillator with an attack/decay gain envelope (+ optional glide)
  function tone(o) {
    if (!ready) return;
    const t0 = ctx.currentTime + (o.when || 0);
    const dur = o.dur || 0.2;
    const peak = o.gain == null ? 0.3 : o.gain;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.f0 || 440), t0);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + (o.glide || dur));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack == null ? 0.006 : o.attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  // filtered white-noise burst (whooshes, footsteps, impacts)
  function noise(o) {
    if (!ready) return;
    const t0 = ctx.currentTime + (o.when || 0);
    const dur = o.dur || 0.2;
    const peak = o.gain == null ? 0.2 : o.gain;
    const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack == null ? 0.005 : o.attack));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(Math.max(1, o.freq || 1000), t0);
      if (o.freq1) f.frequency.exponentialRampToValueAtTime(Math.max(1, o.freq1), t0 + dur);
      if (o.q != null) f.Q.value = o.q;
      src.connect(f); f.connect(g);
    } else {
      src.connect(g);
    }
    g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.03);
  }

  /* ---- sound library ---- */
  const S = {
    /* lobby / menu */
    uiClick() {
      tone({ type: 'triangle', f0: 520, f1: 760, dur: 0.08, gain: 0.18, attack: 0.004 });
      noise({ dur: 0.03, gain: 0.05, filter: 'highpass', freq: 2200 });
    },
    uiBack() { tone({ type: 'triangle', f0: 500, f1: 300, dur: 0.1, gain: 0.16 }); },

    /* enhancement */
    enhanceSuccess() {
      tone({ type: 'triangle', f0: 660, dur: 0.16, gain: 0.22 });
      tone({ type: 'sine', f0: 990, dur: 0.26, gain: 0.18, when: 0.07 });
    },
    enhanceFail() {
      tone({ type: 'sawtooth', f0: 210, f1: 150, dur: 0.16, gain: 0.15 });
      noise({ dur: 0.12, gain: 0.07, filter: 'lowpass', freq: 800 });
    },
    enhanceDown() {
      tone({ type: 'sawtooth', f0: 330, f1: 110, dur: 0.4, gain: 0.2 });
      tone({ type: 'sine', f0: 170, f1: 80, dur: 0.45, gain: 0.14, when: 0.04 });
      noise({ dur: 0.22, gain: 0.06, filter: 'lowpass', freq: 480 });
    },
    enhanceMax() {                                   // 10강 — triumphant arpeggio + shimmer
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.2, when: i * 0.1 }));
      tone({ type: 'sine', f0: 1568, dur: 0.7, gain: 0.12, when: 0.42 });
    },

    /* countdown */
    countdownBeep() {                                // 쿠웅 — deep boom
      tone({ type: 'sine', f0: 140, f1: 70, dur: 0.5, gain: 0.5, attack: 0.004 });
      tone({ type: 'sine', f0: 70, f1: 44, dur: 0.6, gain: 0.34 });
      noise({ dur: 0.22, gain: 0.12, filter: 'lowpass', freq: 220 });
    },
    countdownGo() {                                  // 빰 빰빠밤 — brassy fanfare
      const seq = [
        { f: 392, t: 0.0,  d: 0.18 },                // 빰
        { f: 523, t: 0.26, d: 0.11 },                // 빠
        { f: 659, t: 0.37, d: 0.11 },                // 빠
        { f: 784, t: 0.48, d: 0.42 },                // 밤
      ];
      seq.forEach((n) => {
        tone({ type: 'sawtooth', f0: n.f, dur: n.d, gain: 0.22, when: n.t, attack: 0.012 });
        tone({ type: 'square', f0: n.f / 2, dur: n.d, gain: 0.07, when: n.t });
      });
    },

    /* movement */
    footstep() {
      noise({ dur: 0.06, gain: 0.1, filter: 'lowpass', freq: 520, q: 1.2 });
      tone({ type: 'sine', f0: 95, f1: 60, dur: 0.05, gain: 0.07 });
    },
    jump() { tone({ type: 'square', f0: 250, f1: 560, dur: 0.14, gain: 0.13, attack: 0.004 }); },
    land() {
      noise({ dur: 0.08, gain: 0.11, filter: 'lowpass', freq: 420 });
      tone({ type: 'sine', f0: 120, f1: 66, dur: 0.08, gain: 0.11 });
    },
    platformStep() {                                 // light 'tok' on a wooden/stone ledge
      tone({ type: 'triangle', f0: 400, f1: 230, dur: 0.07, gain: 0.14 });
      noise({ dur: 0.04, gain: 0.06, filter: 'bandpass', freq: 1300, q: 2 });
    },

    /* combat */
    attackBasic() { noise({ dur: 0.12, gain: 0.12, filter: 'bandpass', freq: 1700, freq1: 600, q: 1.1 }); },
    attackStrong() {
      noise({ dur: 0.2, gain: 0.16, filter: 'bandpass', freq: 1200, freq1: 300, q: 1 });
      tone({ type: 'sawtooth', f0: 190, f1: 90, dur: 0.18, gain: 0.1 });
    },
    hit() {
      noise({ dur: 0.1, gain: 0.17, filter: 'lowpass', freq: 1900 });
      tone({ type: 'square', f0: 170, f1: 80, dur: 0.1, gain: 0.13 });
    },

    /* skills: 검 / 방어구 / 능력치 */
    skillSword() {                                   // sharp metallic slash
      noise({ dur: 0.25, gain: 0.16, filter: 'highpass', freq: 3000, freq1: 6500 });
      tone({ type: 'sawtooth', f0: 900, f1: 220, dur: 0.22, gain: 0.16 });
      tone({ type: 'square', f0: 1320, dur: 0.12, gain: 0.07, when: 0.02 });
    },
    skillArmor() {                                   // shield up — warm rising hum + shimmer
      tone({ type: 'sine', f0: 220, f1: 440, dur: 0.4, gain: 0.2 });
      tone({ type: 'triangle', f0: 660, dur: 0.45, gain: 0.1, when: 0.08 });
      noise({ dur: 0.3, gain: 0.05, filter: 'bandpass', freq: 800, freq1: 1700, q: 3 });
    },
    skillStat() {                                    // haste — airy upward whoosh
      noise({ dur: 0.35, gain: 0.16, filter: 'bandpass', freq: 500, freq1: 3600, q: 0.8 });
      tone({ type: 'triangle', f0: 440, f1: 1320, dur: 0.3, gain: 0.1 });
    },

    /* match end */
    bodyFall() {                                     // heavy corpse thud on the ground
      noise({ dur: 0.18, gain: 0.2, filter: 'lowpass', freq: 320 });
      tone({ type: 'sine', f0: 110, f1: 50, dur: 0.18, gain: 0.18 });
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
        tone({ type: 'triangle', f0: f, dur: 0.5, gain: 0.22, when: i * 0.12 }));
    },
    lose() {                                         // somber descending dirge + low drone
      [392, 349.23, 311.13, 261.63].forEach((f, i) =>
        tone({ type: 'sawtooth', f0: f, dur: 0.5, gain: 0.17, when: i * 0.18 }));
      tone({ type: 'sine', f0: 110, f1: 65, dur: 1.2, gain: 0.16, when: 0.1 });
    },
  };

  function play(name, o) {
    if (!enabled) return;
    resume();
    const fn = S[name];
    if (fn) { try { fn(o || {}); } catch (e) { /* ignore audio glitches */ } }
  }

  function setEnabled(on) { enabled = !!on; }

  // arm the context on the first user gesture (autoplay policy)
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    window.addEventListener(ev, resume, { once: true, passive: true }));

  return { play, setEnabled, resume };
})();
