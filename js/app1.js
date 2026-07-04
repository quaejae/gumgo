/* ================================================================
 * 금고털이 — 앱1 (진행자/방 스마트폰, 유일한 writer)
 * 상태(state)를 로컬에서 관리하고 변경 시마다 Firebase에 저장.
 * ================================================================ */

const el = document.getElementById("app");
let S = null; // 전역 상태

GumgoSync.init();

/* 새 게임 초기 상태 */
function freshState() {
  return {
    phase: "setup",
    players: [{ id: "p0", name: "" }, { id: "p1", name: "" }, { id: "p2", name: "" }, { id: "p3", name: "" }],
    config: { cap: 10, total: 30, rounds: 6 },
    round: 1,
    order: [],
    taking: { index: 0, sub: "name", remaining: 0 },
    takes: {},
    peekSel: null,
    robber: null,
    duplicates: [],
    cumulative: {},
    history: {},
    winner: null,
  };
}

function save() { GumgoSync.save(S); }
function commit() { render(); save(); }

/* 상단바 초기화 버튼(모든 화면 공통) — 이벤트 위임으로 재렌더 후에도 동작 */
el.addEventListener("click", (e) => {
  if (e.target.closest("#resetBtn")) {
    if (confirm("게임을 초기화할까요?\n진행 중인 모든 라운드 기록이 사라집니다.")) {
      S = freshState();
      commit();
    }
  }
});

function ids() { return S.players.map((p) => p.id); }
function nameOf(id) { const p = S.players.find((x) => x.id === id); return p ? p.name : "?"; }

/* 앱1은 유일 writer지만, 새로고침 대비 기존 상태가 있으면 이어받기 */
GumgoSync.once((data) => {
  S = data && data.players ? data : freshState();
  render();
});

/* ---------------------------------------------------------------- *
 * 렌더 라우터
 * ---------------------------------------------------------------- */
function render() {
  if (!S) { el.innerHTML = "<p class='muted center'>연결 중…</p>"; return; }
  const map = {
    setup: renderSetup,
    ready: renderReady,
    taking: renderTaking,
    peek: renderPeek,
    preRob: renderPreRob,
    robbing: renderRobbing,
    duplicate: renderDuplicate,
    result: renderResult,
    final: renderFinal,
  };
  (map[S.phase] || renderSetup)();
}

function topbar() {
  return `<div class="topbar">
    <span class="tag">방 ${GumgoSync.code}</span>
    <span class="round">라운드 ${S.round} / ${S.config.rounds}</span>
    <button id="resetBtn" class="reset-x">⟲ 초기화</button>
  </div>`;
}

/* ---------------------------------------------------------------- *
 * 0. 설정
 * ---------------------------------------------------------------- */
function renderSetup() {
  const rows = S.players.map((p, i) => `
    <div class="name-row">
      <span class="idx">${i + 1}</span>
      <input data-i="${i}" class="pname" placeholder="참여자 이름" value="${p.name.replace(/"/g, "&quot;")}" />
      <button data-del="${i}">✕</button>
    </div>`).join("");

  el.innerHTML = `
    <div class="topbar"><span class="tag">방 ${GumgoSync.code}</span><span class="round">설정</span></div>
    <h1>🔐 금고털이 설정</h1>
    <p class="muted">진행자 본인도 참여자에 포함하세요.</p>
    <div class="card">
      ${rows}
      <button class="btn ghost" id="addName">+ 참여자 추가</button>
    </div>
    <div class="card">
      <div class="field"><label>라운드 수</label><input id="rounds" type="number" min="1" value="${S.config.rounds}" /></div>
      <div class="field"><label>총 금화</label><input id="total" type="number" min="1" value="${S.config.total}" /></div>
      <div class="field"><label>인당 상한</label><input id="cap" type="number" min="1" value="${S.config.cap}" /></div>
      <p class="muted" style="font-size:13px">인원수를 바꾸면 총 금화·상한이 자동 추천됩니다(직접 수정 가능).</p>
    </div>
    <button class="btn" id="startBtn">순서 배정 → 시작</button>`;

  // 이벤트
  el.querySelectorAll(".pname").forEach((inp) => {
    inp.oninput = (e) => { S.players[+e.target.dataset.i].name = e.target.value; save(); };
  });
  el.querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => { if (S.players.length > 2) { S.players.splice(+b.dataset.del, 1); recalcBalance(); commit(); } };
  });
  el.querySelector("#addName").onclick = () => {
    S.players.push({ id: "p" + Date.now().toString(36), name: "" });
    recalcBalance(); commit();
  };
  el.querySelector("#rounds").oninput = (e) => { S.config.rounds = Math.max(1, +e.target.value || 1); save(); };
  el.querySelector("#total").oninput = (e) => { S.config.total = Math.max(1, +e.target.value || 1); save(); };
  el.querySelector("#cap").oninput = (e) => { S.config.cap = Math.max(1, +e.target.value || 1); save(); };
  el.querySelector("#startBtn").onclick = startGame;
}

/* 인원수 기반 밸런스 자동 추천 (사용자가 수동 수정 안 했으면 갱신) */
function recalcBalance() {
  const b = GumgoGame.balanceForPlayers(S.players.length);
  S.config.cap = b.cap;
  S.config.total = b.total;
}

function startGame() {
  const named = S.players.filter((p) => p.name.trim());
  if (named.length < 2) { alert("이름을 최소 2명 입력하세요."); return; }
  S.players = named;
  S.round = 1;
  S.cumulative = {}; S.history = {}; S.winner = null;
  S.players.forEach((p) => (S.cumulative[p.id] = 0));
  newRoundOrder();
  S.phase = "ready";
  commit();
}

/* 라운드 순서 랜덤 배정 + 라운드 상태 초기화 */
function newRoundOrder() {
  S.order = GumgoGame.makeOrder(ids());
  S.takes = {};
  S.taking = { index: 0, sub: "name", remaining: S.config.total };
  S.peekSel = null;
  S.robber = null;
  S.duplicates = [];
}

/* ---------------------------------------------------------------- *
 * 1~2. 순서 배정 완료 → 게임시작 대기 (라운드1)
 * ---------------------------------------------------------------- */
function renderReady() {
  const seq = S.order.map((id, i) => `${i + 1}. ${nameOf(id)}`).join("<br/>");
  el.innerHTML = `${topbar()}
    <h1>입장 순서 배정 완료</h1>
    <div class="card center" style="font-size:20px; line-height:2">${seq}</div>
    <p class="muted center">대시보드(앱2)에도 순서가 표시되었습니다.<br/>폰을 금고 방에 두고 시작하세요.</p>
    <button class="btn" id="go">게임 시작</button>`;
  el.querySelector("#go").onclick = () => { S.phase = "taking"; commit(); };
}

/* ---------------------------------------------------------------- *
 * 3. 금화털기 (반복)
 * ---------------------------------------------------------------- */
function renderTaking() {
  const t = S.taking;
  const curId = S.order[t.index];

  if (t.sub === "name") {
    el.innerHTML = `${topbar()}
      <p class="muted center">${t.index + 1}번째 순서</p>
      <div class="big-name">${nameOf(curId)}</div>
      <p class="muted center">방에 혼자 입장한 뒤 아래 버튼을 누르세요.</p>
      <button class="btn" id="recv">금화 수령</button>`;
    el.querySelector("#recv").onclick = () => { t.sub = "slider"; commit(); };
    return;
  }

  // slider
  const maxTake = Math.min(S.config.cap, t.remaining);
  el.innerHTML = `${topbar()}
    <div class="big-name" style="font-size:28px; padding:14px">${nameOf(curId)}</div>
    <p class="vault-count">현재 금고 잔여 <b>${t.remaining}</b> 개</p>
    <div class="card slider-wrap">
      <div class="slider-value"><span id="sv">0</span> <span>/ ${maxTake}</span></div>
      <input type="range" id="sld" min="0" max="${maxTake}" value="0" />
      <p class="muted">가져갈 금화 개수를 슬라이드로 정하세요 (상한 ${S.config.cap})</p>
    </div>
    <button class="btn" id="done">완료</button>`;

  const sld = el.querySelector("#sld");
  const sv = el.querySelector("#sv");
  const upd = () => {
    sv.textContent = sld.value;
    sld.style.setProperty("--pct", (maxTake ? (sld.value / maxTake) * 100 : 0) + "%");
  };
  sld.oninput = upd; upd();

  el.querySelector("#done").onclick = () => {
    const v = +sld.value;
    S.takes[curId] = v;
    t.remaining -= v;
    t.index += 1;
    if (t.index >= S.order.length) {
      S.phase = "peek"; // 전원 완료 → 첫 참여자 재입장(엿보기)
    } else {
      t.sub = "name";
    }
    commit();
  };
}

/* ---------------------------------------------------------------- *
 * 4. 엿보기 (첫 순서 참여자만, 1회)
 * ---------------------------------------------------------------- */
function renderPeek() {
  const firstId = S.order[0];

  // 세로 타임라인: 이름 박스를 위→아래로 쌓고, 사이의 세로 연결선(구간)을 탭.
  // 구간 k = 순서상 k번째 참여자까지 가져간 뒤의 금고 잔여 (k=0: 시작 시점)
  const gapHtml = (k) => {
    const active = S.peekSel === k;
    let badge = "";
    if (active) {
      const rem = GumgoGame.remainingAfter(S.order, S.takes, S.config.total, k);
      badge = `<span class="vbadge">잔여 <b>${rem}</b></span>`;
    }
    return `<button class="vgap ${active ? "active" : ""}" data-k="${k}"><span class="line"></span>${badge}</button>`;
  };

  const parts = [gapHtml(0)];
  S.order.forEach((id, i) => {
    const isFirst = i === 0;
    parts.push(`<div class="vnode ${isFirst ? "me" : ""}">${nameOf(id)}${isFirst ? " (나)" : ""}</div>`);
    parts.push(gapHtml(i + 1));
  });

  let caption = `<p class="muted center">이름 사이의 세로선을 눌러<br/>그 시점의 금고 잔여 금화를 확인하세요.</p>`;
  if (S.peekSel != null) {
    const label = S.peekSel === 0 ? "게임 시작 시점" : `${nameOf(S.order[S.peekSel - 1])} 입장 직후`;
    caption = `<p class="center" style="font-size:17px"><b style="color:var(--gold)">${label}</b>의 금고 잔여</p>`;
  }

  el.innerHTML = `${topbar()}
    <p class="muted center">전원 금화 수령 완료 · 첫 순서 재입장</p>
    <div class="big-name" style="font-size:26px; padding:8px">${nameOf(firstId)}</div>
    ${caption}
    <div class="card"><div class="vtimeline">${parts.join("")}</div></div>
    <button class="btn" id="donesee">엿보기 종료 → 진행</button>`;

  el.querySelectorAll(".vgap").forEach((g) => {
    g.onclick = () => { S.peekSel = +g.dataset.k; commit(); };
  });
  el.querySelector("#donesee").onclick = () => { S.phase = "preRob"; commit(); };
}

/* ---------------------------------------------------------------- *
 * 진행자 모드 시작: 강탈자 공개 대기
 * ---------------------------------------------------------------- */
function renderPreRob() {
  el.innerHTML = `${topbar()}
    <h1>진행자 화면</h1>
    <p class="muted">메인룸에 전원 모인 뒤 강탈 단계를 진행합니다.</p>
    <button class="btn" id="reveal">강탈자 공개</button>`;
  el.querySelector("#reveal").onclick = () => {
    const robberId = GumgoGame.determineRobber(S.takes, ids());
    S.robber = {
      id: robberId,
      alive: true,
      robbedIds: [],
      holdings: Object.assign({}, S.takes),
      lastResult: null,
    };
    S.phase = "robbing";
    commit();
  };
}

/* ---------------------------------------------------------------- *
 * 강탈 진행
 * ---------------------------------------------------------------- */
function renderRobbing() {
  const R = S.robber;

  // 강탈자 없음(전원 동률)
  if (!R.id) {
    el.innerHTML = `${topbar()}
      <div class="reveal"><p class="muted">이번 라운드</p><div class="who">강탈자 없음</div>
      <p class="muted">전원 동률로 강탈자가 나오지 않았습니다.</p></div>
      <button class="btn" id="toDup">중복 몰수 단계로</button>`;
    el.querySelector("#toDup").onclick = goDuplicate;
    return;
  }

  const candidates = ids().filter((id) => id !== R.id && !R.robbedIds.includes(id));

  let resultHtml = "";
  if (R.lastResult) {
    const ok = R.lastResult.success;
    resultHtml = `<div class="result-badge ${ok ? "ok" : "no"}">
      ${nameOf(R.lastResult.targetId)} 지목 → ${ok ? "강탈 성공! 🪙" : "강탈 실패 ✗"}</div>`;
  }

  let controls = "";
  if (!R.alive) {
    controls = `<p class="muted center">강탈 실패 — 강탈자의 이번 라운드 금화가 전부 몰수되었습니다.</p>
      <button class="btn" id="toDup">중복 몰수 단계로</button>`;
  } else if (candidates.length === 0) {
    controls = `<p class="muted center">더 이상 지목할 대상이 없습니다.</p>
      <button class="btn" id="toDup">중복 몰수 단계로</button>`;
  } else {
    const grid = candidates.map((id) => `<button class="btn" data-t="${id}">${nameOf(id)}</button>`).join("");
    controls = `<p class="muted center">${R.robbedIds.length ? "다음으로 많이 가져갔을 참가자를 지목" : "가장 많이 가져갔을 참가자를 지목"}</p>
      <div class="target-grid">${grid}</div>
      ${R.robbedIds.length ? `<button class="btn secondary" id="stop">강탈 멈춤 → 중복 몰수</button>` : ""}`;
  }

  el.innerHTML = `${topbar()}
    <div class="reveal"><p class="muted">이번 라운드 강탈자</p><div class="who">${nameOf(R.id)}</div></div>
    ${resultHtml}
    ${controls}`;

  el.querySelectorAll("[data-t]").forEach((b) => {
    b.onclick = () => {
      const targetId = b.dataset.t;
      const rs = { takes: S.takes, holdings: R.holdings, robberId: R.id, robbedIds: R.robbedIds, robberAlive: R.alive };
      GumgoGame.attemptRob(rs, targetId, ids());
      R.holdings = rs.holdings; R.robbedIds = rs.robbedIds; R.alive = rs.robberAlive;
      R.lastResult = { targetId, success: rs.robberAlive && R.robbedIds.includes(targetId) };
      commit();
    };
  });
  const stop = el.querySelector("#stop");
  if (stop) stop.onclick = goDuplicate;
  const toDup = el.querySelector("#toDup");
  if (toDup) toDup.onclick = goDuplicate;
}

function goDuplicate() {
  const R = S.robber || { id: null, robbedIds: [] };
  S.duplicates = GumgoGame.duplicatesToConfiscate(S.takes, ids(), R.id, R.robbedIds);
  S.phase = "duplicate";
  commit();
}

/* ---------------------------------------------------------------- *
 * 중복 몰수
 * ---------------------------------------------------------------- */
function renderDuplicate() {
  const chips = S.duplicates.length
    ? S.duplicates.map((id) => `<span class="chip">${nameOf(id)} (${S.takes[id]}개)</span>`).join("")
    : `<p class="muted center">중복 몰수 대상 없음</p>`;
  el.innerHTML = `${topbar()}
    <h1>중복 제거 (몰수)</h1>
    <p class="muted">같은 개수를 가져간 참가자(강탈 변동자·0개 제외)</p>
    <div class="card"><div class="chip-list">${chips}</div></div>
    <button class="btn" id="toResult">결과 발표</button>`;
  el.querySelector("#toResult").onclick = finalizeAndResult;
}

/* ---------------------------------------------------------------- *
 * 결과 확정
 * ---------------------------------------------------------------- */
function finalizeAndResult() {
  const holdings = S.robber ? S.robber.holdings : Object.assign({}, S.takes);
  const gains = GumgoGame.finalizeRound(holdings, S.duplicates);
  ids().forEach((id) => { S.cumulative[id] = (S.cumulative[id] || 0) + (gains[id] || 0); });
  S.history[S.round] = {
    order: S.order.slice(),
    takes: Object.assign({}, S.takes),
    robberId: S.robber ? S.robber.id : null,
    robbedIds: S.robber ? S.robber.robbedIds.slice() : [],
    duplicates: S.duplicates.slice(),
    gains,
  };
  S.phase = "result";
  commit();
}

function renderResult() {
  const last = S.round >= S.config.rounds;
  el.innerHTML = `${topbar()}
    <h1>라운드 ${S.round} 결과 발표</h1>
    <p class="muted">결과가 대시보드(앱2)에 표시되었습니다.</p>
    <div class="card center" style="font-size:18px">
      ${ids().sort((a, b) => S.cumulative[b] - S.cumulative[a])
        .map((id, i) => `${i + 1}. ${nameOf(id)} — <b style="color:var(--gold)">${S.cumulative[id]}</b>`).join("<br/>")}
    </div>
    ${last
      ? `<button class="btn" id="finalBtn">🏆 최종 우승 발표</button>`
      : `<button class="btn" id="nextBtn">다음 라운드</button>`}`;

  if (last) {
    el.querySelector("#finalBtn").onclick = () => {
      let win = null, best = -1;
      ids().forEach((id) => { if (S.cumulative[id] > best) { best = S.cumulative[id]; win = id; } });
      S.winner = win; S.phase = "final"; commit();
    };
  } else {
    el.querySelector("#nextBtn").onclick = () => {
      S.round += 1;
      newRoundOrder();
      S.phase = "taking"; // 요구사항 14: 3번(금화수령)으로 복귀
      commit();
    };
  }
}

function renderFinal() {
  el.innerHTML = `${topbar()}
    <div class="reveal">
      <div style="font-size:60px">🏆</div>
      <p class="muted">최종 우승</p>
      <div class="who" style="color:var(--gold); font-size:40px">${nameOf(S.winner)}</div>
      <p class="muted">${S.cumulative[S.winner]} 금화</p>
    </div>
    <button class="btn secondary" id="again">새 게임</button>`;
  el.querySelector("#again").onclick = () => { S = freshState(); commit(); };
}
