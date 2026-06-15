/* ============================================================
   CONFIG — all balance numbers in one place.
   ============================================================ */
window.CONFIG = (function () {
  /* Enhancement table indexed by CURRENT level (0 -> trying for 1, ... , 9 -> trying for 10).
     Spec: success up to 1% at the hardest, fail up to 99%, "down" (demotion) applies
     from 5강 and up to 15%. The remainder of (1 - success - down) keeps the level. */
  const ENHANCE_TABLE = [
    { success: 0.95, down: 0.00 }, // 0 -> 1
    { success: 0.90, down: 0.00 }, // 1 -> 2
    { success: 0.80, down: 0.00 }, // 2 -> 3
    { success: 0.65, down: 0.00 }, // 3 -> 4
    { success: 0.50, down: 0.00 }, // 4 -> 5
    { success: 0.35, down: 0.05 }, // 5 -> 6  (down starts here)
    { success: 0.25, down: 0.08 }, // 6 -> 7
    { success: 0.15, down: 0.10 }, // 7 -> 8
    { success: 0.08, down: 0.12 }, // 8 -> 9
    { success: 0.01, down: 0.15 }, // 9 -> 10 (success max 1%, down max 15%)
  ];

  const CATEGORIES = [
    {
      key: 'sword', name: '검', icon: '⚔️', cls: 'ep-sword',
      desc: '공격력 강화', skillIcon: '⚔️',
      skillName: '강철 베기', skillDesc: '광역 참격 + 큰 데미지',
    },
    {
      key: 'armor', name: '방어구', icon: '🛡️', cls: 'ep-armor',
      desc: '방어력 / 체력 강화', skillIcon: '🛡️',
      skillName: '불굴의 방벽', skillDesc: '잠시 데미지 무효화',
    },
    {
      key: 'stat', name: '능력치', icon: '✨', cls: 'ep-stat',
      desc: '이동속도 / 재생', skillIcon: '✨',
      skillName: '질풍 가속', skillDesc: '속도 폭증 + 체력 회복',
    },
  ];

  return {
    MAX_ATTEMPTS: 30,
    MAX_LEVEL: 10,
    MILESTONES: [5, 7, 9, 10],
    ENHANCE_TABLE,
    CATEGORIES,

    /* battle */
    BASE_HP: 100,
    TIMER_SECONDS: 100,        // 1:40
    OVERTIME_TICK: 3,          // 초당 3 데미지
    OVERTIME_TICK_INTERVAL: 1000,

    /* derived stat scaling per level */
    DMG_BASIC_BASE: 2.6,
    DMG_BASIC_PER_LV: 0.6,     // sword level -> basic 2.6 .. 8.6
    DMG_STRONG_MULT: 2.0,      // strong 5.2 .. 17.2
    HP_PER_ARMOR_LV: 9,        // armor level adds max HP
    DEF_PER_ARMOR_LV: 0.035,   // damage reduction per armor level (capped)
    DEF_CAP: 0.6,
    SPEED_BASE: 6.4,
    SPEED_PER_STAT_LV: 0.42,   // stat level
    REGEN_PER_STAT_LV: 0.12,   // hp/sec passive regen from stat level

    /* skills unlock at first milestone (5강) of their category */
    SKILL_UNLOCK_LEVEL: 5,
    SKILL_COOLDOWNS: [7000, 9000, 8000], // sword, armor, stat (ms)
  };
})();
