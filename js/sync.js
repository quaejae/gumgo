/*
 * Firebase Realtime DB 동기화 래퍼.
 * - 앱1(진행자/방)이 유일한 writer, 앱2(대시보드)는 read-only.
 * - 방 코드로 세션 구분 (?room=CODE, 기본 MAIN).
 */
const GumgoSync = {
  db: null,
  ref: null,
  code: "MAIN",

  roomCode() {
    const p = new URLSearchParams(location.search);
    return (p.get("room") || "MAIN").toUpperCase();
  },

  init() {
    firebase.initializeApp(FIREBASE_CONFIG);
    this.db = firebase.database();
    this.code = this.roomCode();
    this.ref = this.db.ref("rooms/" + this.code + "/state");
    return this;
  },

  save(state) {
    if (!this.ref) return Promise.resolve();
    return this.ref.set(state);
  },

  once(cb) {
    this.ref.once("value", (s) => cb(s.val()));
  },

  subscribe(cb) {
    this.ref.on("value", (s) => cb(s.val()));
  },
};
