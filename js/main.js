/* ============================================================
   MAIN — orchestrates screen flow, room handshake, and the
   rematch / quit lifecycle. Wires the modules together.
   ============================================================ */
(function () {
  const C = window.CONFIG;
  const { $ } = UI;
  const st = State.state;

  let peerConnected = false;
  let myRematch = false, oppRematch = false, oppQuit = false;

  /* ---------------- helpers ---------------- */
  function resolveNickname() {
    let n = $('#nickname').value.trim();
    if (!n) { n = State.randomNickname(); $('#nickname').value = n; UI.toast('랜덤 이름 부여: ' + n); }
    st.nickname = n;
    return n;
  }

  function netHandlers(extra) {
    return Object.assign({
      onData: handleData,
      onClose: handleDisconnect,
      onError: handleNetError,
    }, extra || {});
  }

  /* ---------------- LOBBY ---------------- */
  function createRoom() {
    resolveNickname();
    st.mode = 'host'; st.isHost = true; st.myId = 'p1'; peerConnected = false;
    if (!Net.available()) {
      UI.popup({ title: 'P2P 사용 불가', warn: true,
        body: '온라인 매칭 서버(PeerJS)에 연결할 수 없습니다.<br>「혼자 연습 (vs AI)」으로 플레이할 수 있어요.' });
      return;
    }
    UI.show('room');
    setupRoomScreen('host');
    $('#room-code').textContent = '연결 중...';
    $('#room-hint').textContent = 'P2P 방을 생성하는 중입니다...';

    const code = Net.createRoom(netHandlers({
      onReady: (code) => {
        st.roomCode = code;
        $('#room-code').textContent = code;
        $('#room-hint').textContent = '친구에게 방 코드를 공유하세요. 상대 접속 시 [게임 시작]이 활성화됩니다.';
        renderPlayers();
      },
      onConnect: () => {
        peerConnected = true;
        Net.send({ type: 'hello', name: st.nickname, role: 'host' });
      },
    }));
    if (!code) { handleNetError(new Error('no-peerjs')); }
  }

  function openJoin() {
    resolveNickname();
    st.mode = 'guest'; st.isHost = false; st.myId = 'p2'; peerConnected = false;
    if (!Net.available()) {
      UI.popup({ title: 'P2P 사용 불가', warn: true,
        body: '온라인 매칭 서버(PeerJS)에 연결할 수 없습니다.<br>「혼자 연습 (vs AI)」으로 플레이할 수 있어요.' });
      return;
    }
    UI.show('room');
    setupRoomScreen('guest');
    $('#room-code').textContent = '------';
    $('#room-hint').textContent = '상대에게 받은 방 코드를 입력하고 [참여]를 누르세요.';
    renderPlayers();
  }

  function confirmJoin() {
    const code = $('#join-code-input').value.trim().toUpperCase();
    if (code.length < 6) { $('#join-status').textContent = '6자리 코드를 입력하세요.'; return; }
    st.roomCode = code;
    $('#join-status').textContent = '방에 접속 중...';
    $('#btn-join-confirm').disabled = true;
    Net.joinRoom(code, netHandlers({
      onConnect: () => {
        peerConnected = true;
        Net.send({ type: 'hello', name: st.nickname, role: 'guest' });
        $('#join-status').textContent = '접속 완료! 방장의 시작을 기다리세요.';
        $('#room-code').textContent = code;
        renderPlayers();
      },
    }));
  }

  function startPractice() {
    resolveNickname();
    st.mode = 'practice'; st.isHost = true; st.myId = 'p1';
    st.opponentName = 'AI 검투사';
    State.resetForRematch();
    UI.loading('결투장 입장 중...', 1500).then(() => { UI.show('enhance'); Enhance.enter(); });
  }

  /* ---------------- ROOM ---------------- */
  function setupRoomScreen(role) {
    const joinBox = $('#join-box');
    const startBtn = $('#btn-start-game');
    if (role === 'host') {
      joinBox.classList.add('hidden');
      startBtn.classList.remove('hidden');
    } else {
      joinBox.classList.remove('hidden');
      $('#btn-join-confirm').disabled = false;
      $('#join-code-input').value = '';
      $('#join-status').textContent = '';
      startBtn.classList.add('hidden');
    }
    startBtn.disabled = true;
    renderPlayers();
  }

  function renderPlayers() {
    const list = $('#players-list');
    const hostName = st.isHost ? st.nickname : (peerConnected ? st.opponentName : null);
    const guestName = st.isHost ? (peerConnected ? st.opponentName : null) : st.nickname;

    const row = (name, slotCls, tag) => {
      if (name) {
        return `<li class="${slotCls}"><span class="player-dot"></span><span>${name}</span><span class="player-tag">${tag}</span></li>`;
      }
      return `<li class="empty ${slotCls}"><span class="player-dot waiting"></span><span>대기 중...</span><span class="player-tag">${tag}</span></li>`;
    };
    list.innerHTML = row(hostName, 'slot-p1', '방장') + row(guestName, 'slot-p2', '참여자');

    // host enables start when guest connected
    if (st.isHost) {
      const ready = peerConnected && !!st.opponentName;
      $('#btn-start-game').disabled = !ready;
      $('#room-hint').textContent = ready
        ? '상대가 입장했습니다! [게임 시작]을 누르세요.'
        : ($('#room-code').textContent && $('#room-code').textContent !== '연결 중...'
            ? '친구에게 방 코드를 공유하세요.' : $('#room-hint').textContent);
    }
  }

  function hostStartGame() {
    if (!peerConnected) return;
    Net.send({ type: 'go' });
    enterMatch();
  }

  function enterMatch() {
    State.resetForRematch();
    UI.loading('결투장 입장 중...', 1700).then(() => { UI.show('enhance'); Enhance.enter(); });
  }

  function leaveRoom() {
    Net.close();
    State.fullReset();
    peerConnected = false;
    UI.show('lobby');
  }

  /* ---------------- ENHANCE -> BATTLE ---------------- */
  function enhanceDone() {
    if (st.mode === 'practice') {
      st.opponentBuild = aiBuild();
      goBattle();
      return;
    }
    st.iAmReady = true;
    Net.send({ type: 'ready', build: st.build });
    Enhance.refreshReadyHint();
    $('#btn-stage-next').disabled = true;
    $('#btn-stage-next').textContent = '상대 대기 중...';
    maybeStartBattle();
  }

  function maybeStartBattle() {
    if (st.iAmReady && st.opponentReady && st.opponentBuild) goBattle();
  }

  function goBattle() {
    UI.loading('전투 시작!', 1600).then(() => {
      UI.show('battle');
      Battle.start({ mode: st.mode, onEnd: showResult });
    });
  }

  /* realistic AI build: simulate 30 forge attempts PER category with real odds */
  function aiBuild() {
    const b = { sword: 0, armor: 0, stat: 0 };
    ['sword', 'armor', 'stat'].forEach((k) => {
      let attempts = C.ATTEMPTS_PER_STAGE;
      while (attempts-- > 0) {
        const lv = b[k];
        if (lv >= C.MAX_LEVEL) break;
        const row = C.ENHANCE_TABLE[lv];
        const r = Math.random();
        if (r < row.success) b[k] = lv + 1;
        else if (r < row.success + row.down) b[k] = Math.max(0, lv - 1);
      }
    });
    return b;
  }

  /* ---------------- RESULT ---------------- */
  function showResult(result) {
    myRematch = false; oppRematch = false; // reset per match (oppQuit persists if set during battle)
    UI.show('result');
    const titleMap = { win: ['승리!', 'result-win'], lose: ['패배...', 'result-lose'], draw: ['무승부', 'result-win'] };
    const [title, cls] = titleMap[result] || titleMap.lose;
    const sub = result === 'win' ? '상대를 쓰러뜨렸습니다.' : result === 'lose' ? '다음엔 더 강하게 단련하세요.' : '동시에 쓰러졌습니다.';

    $('#screen-result').innerHTML = `
      <div class="bg-grid"></div>
      <div class="result-card">
        <div class="result-title ${cls}">${title}</div>
        <div class="result-sub">${sub}</div>
        <div class="result-notice" id="result-notice"></div>
        <div class="result-buttons">
          <button id="btn-rematch" class="btn btn-primary btn-big">다시 하기</button>
          <button id="btn-exit" class="btn btn-ghost btn-big">나가기</button>
        </div>
      </div>`;

    $('#btn-rematch').addEventListener('click', requestRematch);
    $('#btn-exit').addEventListener('click', exitToLobby);

    if (oppQuit) markOpponentQuit();
  }

  function requestRematch() {
    if (oppQuit) return;
    if (st.mode === 'practice') { State.resetForRematch(); enterMatch(); return; }
    myRematch = true;
    Net.send({ type: 'rematch' });
    const btn = $('#btn-rematch');
    if (btn) { btn.disabled = true; btn.textContent = '수락 대기 중...'; }
    setNotice('상대의 수락을 기다리는 중...');
    checkRematch();
  }

  function checkRematch() {
    if (myRematch && oppRematch && !oppQuit) {
      myRematch = false; oppRematch = false;
      State.resetForRematch();
      enterMatch();
    }
  }

  function setNotice(text, warn) {
    const n = $('#result-notice');
    if (n) { n.textContent = text; n.classList.toggle('warn', !!warn); }
  }

  function markOpponentQuit() {
    setNotice(`${st.opponentName}님이 게임을 종료했습니다.`, true);
    const btn = $('#btn-rematch');
    if (btn) { btn.disabled = true; btn.textContent = '다시 하기'; }
  }

  function exitToLobby() {
    if (st.mode !== 'practice' && peerConnected && !oppQuit) Net.send({ type: 'quit' });
    Net.close();
    peerConnected = false; oppQuit = false; myRematch = false; oppRematch = false;
    State.fullReset();
    $('#nickname').value = st.nickname || '';
    UI.show('lobby');
  }

  /* ---------------- NET DISPATCH ---------------- */
  function handleData(msg) {
    if (!msg) return;
    // battle realtime packets use short key `t`
    if (msg.t) { Battle.handleNetData(msg); return; }

    switch (msg.type) {
      case 'hello':
        st.opponentName = msg.name || '상대';
        if (st.isHost && msg.role === 'guest' &&
            msg.name && msg.name.toLowerCase() === st.nickname.toLowerCase()) {
          Net.send({ type: 'dupname' });
        }
        peerConnected = true;
        renderPlayers();
        if (UI.currentScreen() === 'enhance') Enhance.refreshReadyHint();
        break;
      case 'dupname':
        UI.popup({ title: '⚠ 이름 중복', warn: true,
          body: '상대와 닉네임이 중복됩니다.<br>다른 이름으로 다시 입장해 주세요.',
          actions: [{ label: '확인', primary: true, onClick: leaveRoom }] });
        break;
      case 'go':
        if (UI.currentScreen() === 'room') enterMatch();
        break;
      case 'ready':
        st.opponentBuild = msg.build;
        Enhance.setOpponentReady(true);
        maybeStartBattle();
        break;
      case 'rematch':
        oppRematch = true;
        if (UI.currentScreen() === 'result' && !myRematch) {
          setNotice(`${st.opponentName}님이 결투를 다시 신청했습니다.`);
        }
        checkRematch();
        break;
      case 'quit':
        oppQuit = true;
        handleOpponentGone();
        break;
    }
  }

  function handleOpponentGone() {
    oppQuit = true;
    if (UI.currentScreen() === 'battle') {
      Battle.stop();
      st.lastResult = 'win';
      UI.show('result');
      showResult('win');
    }
    if (UI.currentScreen() === 'result') markOpponentQuit();
    if (UI.currentScreen() === 'room' || UI.currentScreen() === 'enhance') {
      UI.popup({ title: '상대 퇴장', warn: true,
        body: `${st.opponentName}님이 나갔습니다.`,
        actions: [{ label: '로비로', primary: true, onClick: leaveRoom }] });
    }
  }

  function handleDisconnect() {
    if (st.mode === 'practice') return;
    if (oppQuit) return;
    oppQuit = true;
    UI.toast('상대와의 연결이 끊어졌습니다.');
    handleOpponentGone();
  }

  function handleNetError(err) {
    const code = (err && (err.type || err.message)) || '';
    if (st.mode === 'guest' && (code === 'peer-unavailable' || code === 'timeout')) {
      $('#join-status').textContent = '방을 찾을 수 없습니다. 코드를 확인하세요.';
      $('#btn-join-confirm').disabled = false;
      return;
    }
    if (code === 'no-peerjs' || code === 'network' || code === 'server-error' || code === 'socket-error') {
      UI.popup({ title: 'P2P 연결 오류', warn: true,
        body: '매칭 서버에 연결할 수 없습니다.<br>네트워크를 확인하거나 「혼자 연습」으로 플레이하세요.',
        actions: [{ label: '로비로', primary: true, onClick: leaveRoom }] });
    }
  }

  /* ---------------- MOBILE TOUCH CONTROLS ---------------- */
  function setupTouch() {
    const forceTouch = /[?&]touch=1/.test(location.search);
    const isMobile = forceTouch || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (!isMobile) return;
    document.body.classList.add('touch');

    // strong attack
    const strong = $('#mstrong');
    strong.addEventListener('touchstart', (e) => { e.preventDefault(); Battle.input.attack('strong'); }, { passive: false });
    strong.addEventListener('click', () => Battle.input.attack('strong'));

    // skill buttons (press = fire)
    document.querySelectorAll('.mskill').forEach((el) => {
      const idx = +el.dataset.skill;
      el.addEventListener('touchstart', (e) => { e.preventDefault(); Battle.input.skill(idx); }, { passive: false });
      el.addEventListener('click', () => Battle.input.skill(idx));
    });

    // virtual joystick: left/right = move, push up = jump
    const joy = $('#mjoy'), knob = $('#mjoy-knob');
    let joyId = null, joyUp = false;
    const place = (t) => {
      const r = joy.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const d = Math.hypot(dx, dy), max = R * 0.7;
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const hx = dx / R, vy = dy / R;
      Battle.input.move(Math.abs(hx) > 0.3 ? Math.sign(hx) : 0);
      if (vy < -0.5) { if (!joyUp) { joyUp = true; Battle.input.jump(); } }
      else if (vy > -0.3) { joyUp = false; }
    };
    joy.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0]; joyId = t.identifier; place(t); e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      if (joyId === null) return;
      for (const t of e.changedTouches) if (t.identifier === joyId) { place(t); e.preventDefault(); break; }
    }, { passive: false });
    const endTouch = (e) => {
      if (joyId === null) return;
      for (const t of e.changedTouches) if (t.identifier === joyId) {
        joyId = null; joyUp = false; knob.style.transform = 'translate(0,0)'; Battle.input.move(0); break;
      }
    };
    window.addEventListener('touchend', endTouch);
    window.addEventListener('touchcancel', endTouch);
  }

  /* ---------------- WIRE UP ---------------- */
  function wire() {
    UI.init();
    Enhance.init({ onDone: enhanceDone });
    setupTouch();

    $('#btn-create-room').addEventListener('click', createRoom);
    $('#btn-join-room').addEventListener('click', openJoin);
    $('#btn-practice').addEventListener('click', startPractice);
    $('#nickname').addEventListener('keydown', (e) => { if (e.key === 'Enter') createRoom(); });

    $('#btn-copy-code').addEventListener('click', () => {
      const code = $('#room-code').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(() => UI.toast('방 코드 복사됨: ' + code));
      else UI.toast('코드: ' + code);
    });
    $('#btn-join-confirm').addEventListener('click', confirmJoin);
    $('#join-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmJoin(); });
    $('#btn-start-game').addEventListener('click', hostStartGame);
    $('#btn-room-back').addEventListener('click', leaveRoom);

    // make on-screen skill icons clickable too (re-use keyboard handler)
    ['#skill-1', '#skill-2', '#skill-3'].forEach((sel, i) => {
      const el = $(sel);
      if (el) el.addEventListener('click', () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: String(i + 1) }));
      });
    });

    UI.show('lobby');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
