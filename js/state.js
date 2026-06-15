/* ============================================================
   STATE — shared game state + small helpers.
   ============================================================ */
window.State = (function () {
  const C = window.CONFIG;

  function freshBuild() {
    return { sword: 0, armor: 0, stat: 0 };
  }

  const state = {
    nickname: '',
    mode: 'idle',          // 'host' | 'guest' | 'practice'
    roomCode: '',
    isHost: false,
    myId: 'p1',            // 'p1' (host) or 'p2' (guest)
    stageIndex: 0,         // 0 sword -> 1 armor -> 2 stat
    stageAttempts: C.ATTEMPTS_PER_STAGE, // remaining attempts for the CURRENT stage
    build: freshBuild(),
    opponentName: '상대',
    opponentReady: false,
    iAmReady: false,
    opponentBuild: null,   // received over network when battle starts
    lastResult: null,      // 'win' | 'lose'
  };

  /* derived combat stats from a build object */
  function statsFromBuild(b) {
    return {
      maxHp: C.BASE_HP + b.armor * C.HP_PER_ARMOR_LV,
      basic: C.DMG_BASIC_BASE + b.sword * C.DMG_BASIC_PER_LV,
      strong: (C.DMG_BASIC_BASE + b.sword * C.DMG_BASIC_PER_LV) * C.DMG_STRONG_MULT,
      defense: Math.min(C.DEF_CAP, b.armor * C.DEF_PER_ARMOR_LV),
      speed: C.SPEED_BASE + b.stat * C.SPEED_PER_STAT_LV,
      regen: b.stat * C.REGEN_PER_STAT_LV,
      skills: [
        b.sword >= C.SKILL_UNLOCK_LEVEL,
        b.armor >= C.SKILL_UNLOCK_LEVEL,
        b.stat >= C.SKILL_UNLOCK_LEVEL,
      ],
    };
  }

  function resetForRematch() {
    state.stageIndex = 0;
    state.stageAttempts = C.ATTEMPTS_PER_STAGE;
    state.build = freshBuild();
    state.opponentBuild = null;
    state.opponentReady = false;
    state.iAmReady = false;
    state.lastResult = null;
  }

  function fullReset() {
    resetForRematch();
    state.mode = 'idle';
    state.roomCode = '';
    state.isHost = false;
    state.myId = 'p1';
    state.opponentName = '상대';
  }

  /* random fallback nickname */
  const ADJ = ['붉은', '강철', '심연', '폭풍', '황혼', '서리', '광휘', '맹독', '천둥', '용맹'];
  const NOUN = ['검사', '기사', '도전자', '대장장이', '방랑자', '투사', '용병', '결투가'];
  function randomNickname() {
    const a = ADJ[(Math.random() * ADJ.length) | 0];
    const n = NOUN[(Math.random() * NOUN.length) | 0];
    return a + n + ((Math.random() * 90 + 10) | 0);
  }

  return { state, statsFromBuild, resetForRematch, fullReset, freshBuild, randomNickname };
})();
