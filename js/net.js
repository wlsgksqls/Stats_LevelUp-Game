/* ============================================================
   NET — P2P transport over PeerJS, addressed by room code.
   The host registers a peer whose id is "ff-<CODE>"; the guest
   connects to it. Only short 6-char codes are shown to players.
   Falls back gracefully if PeerJS / signaling is unavailable.
   ============================================================ */
window.Net = (function () {
  const NS = 'ff-glx-';                 // namespace to reduce broker id collisions
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars

  let peer = null;
  let conn = null;            // active DataConnection to the opponent
  let handlers = {};
  let connected = false;

  function genCode() {
    let s = '';
    for (let i = 0; i < 6; i++) s += ALPHABET[(Math.random() * ALPHABET.length) | 0];
    return s;
  }

  function available() { return typeof window.Peer !== 'undefined'; }

  function wireConn(c) {
    conn = c;
    c.on('open', () => {
      connected = true;
      handlers.onConnect && handlers.onConnect();
    });
    c.on('data', (data) => { handlers.onData && handlers.onData(data); });
    c.on('close', () => {
      connected = false;
      handlers.onClose && handlers.onClose();
    });
    c.on('error', (err) => { handlers.onError && handlers.onError(err); });
  }

  /* host: register peer id = NS+code, wait for a guest to connect */
  function createRoom(h) {
    handlers = h || {};
    if (!available()) { handlers.onError && handlers.onError(new Error('no-peerjs')); return null; }
    const code = genCode();
    peer = new Peer(NS + code, { debug: 1 });
    peer.on('open', () => { handlers.onReady && handlers.onReady(code); });
    peer.on('connection', (c) => { wireConn(c); });
    peer.on('error', (err) => { handlers.onError && handlers.onError(err); });
    return code;
  }

  /* guest: connect to host's peer id */
  function joinRoom(code, h) {
    handlers = h || {};
    if (!available()) { handlers.onError && handlers.onError(new Error('no-peerjs')); return; }
    peer = new Peer(undefined, { debug: 1 });
    peer.on('open', () => {
      const c = peer.connect(NS + code.toUpperCase(), { reliable: true });
      wireConn(c);
      // connection-timeout guard
      setTimeout(() => {
        if (!connected) handlers.onError && handlers.onError(new Error('timeout'));
      }, 12000);
    });
    peer.on('error', (err) => { handlers.onError && handlers.onError(err); });
  }

  function send(msg) {
    if (conn && connected) {
      try { conn.send(msg); } catch (e) { /* ignore transient send errors */ }
    }
  }

  function isConnected() { return connected; }

  function close() {
    try { if (conn) conn.close(); } catch (e) {}
    try { if (peer) peer.destroy(); } catch (e) {}
    conn = null; peer = null; connected = false; handlers = {};
  }

  return { available, createRoom, joinRoom, send, isConnected, close, genCode };
})();
