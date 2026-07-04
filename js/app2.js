/* ================================================================
 * 금고털이 — 앱2 (대시보드, read-only)
 * Firebase 상태를 구독하여 대화면에 렌더링.
 * ================================================================ */

const el = document.getElementById("app");
GumgoSync.init();

let S = null;
render(); // 즉시 대기 화면 표시(구독 응답 전 빈 화면 방지)
GumgoSync.subscribe((data) => { S = data; render(); });

function nameOf(id) { const p = S.players.find((x) => x.id === id); return p ? p.name : "?"; }
function ids() { return S.players.map((p) => p.id); }

function render() {
  if (!S || !S.players) {
    el.innerHTML = `<div class="waiting">진행자 앱에서 게임을 설정하는 중…</div>`;
    return;
  }
  if (S.phase === "setup") {
    el.innerHTML = `<div class="waiting">참여자 설정 중…</div>`;
    return;
  }
  if (S.phase === "final") { renderWinner(); return; }

  el.innerHTML = `
    ${headerHtml()}
    ${orderStripHtml()}
    <div class="dash-body">
      <div class="score-panel">
        <div class="panel-h">누적 점수판</div>
        ${scoreTableHtml()}
      </div>
      <div class="event-panel">
        <div class="panel-h">이번 라운드</div>
        ${eventHtml()}
      </div>
    </div>`;
}

function headerHtml() {
  return `<div class="dash-header">
    <div class="dash-title">🔐 금고털이</div>
    <div class="dash-round">라운드 ${S.round} / ${S.config.rounds}</div>
  </div>`;
}

function orderStripHtml() {
  const seq = S.order.map((id) => `<span class="p">${nameOf(id)}</span>`).join(`<span class="arrow">→</span>`);
  return `<div class="order-strip"><span class="lbl">입장 순서</span><div class="seq">${seq || "-"}</div></div>`;
}

/* 누적 점수표: 행=참여자(누적 내림차순), 열=각 라운드 획득 + 총점 */
function scoreTableHtml() {
  const rounds = [];
  for (let r = 1; r <= S.config.rounds; r++) rounds.push(r);
  const ordered = ids().slice().sort((a, b) => (S.cumulative[b] || 0) - (S.cumulative[a] || 0));

  const head = `<tr><th class="rank">#</th><th style="text-align:left">참여자</th>
    ${rounds.map((r) => `<th class="${r === S.round ? "curcol" : ""}">R${r}</th>`).join("")}
    <th>누적</th></tr>`;

  const rows = ordered.map((id, i) => {
    const cells = rounds.map((r) => {
      const h = S.history && S.history[r];
      let content = "";
      if (h) {
        const gain = h.gains[id] ?? 0;
        if (h.robberId === id) {
          content = `${gain} <span class="mk">🔫</span>`;            // 강탈자
        } else if (h.robbedIds.includes(id)) {
          content = `${gain} <span class="mk">🩸</span>`;            // 강탈 당함
        } else if (h.duplicates.includes(id)) {
          content = `<s class="struck">${h.takes[id] ?? 0}</s>`;      // 중복 몰수(취소선)
        } else {
          content = `${gain}`;
        }
      }
      return `<td class="${r === S.round ? "curcol" : ""}">${content}</td>`;
    }).join("");
    return `<tr class="${i === 0 ? "lead" : ""}">
      <td class="rank">${i + 1}</td>
      <td class="name">${nameOf(id)}</td>
      ${cells}
      <td class="total">${S.cumulative[id] || 0}</td></tr>`;
  }).join("");

  const legend = `<div class="score-legend">
    <span>🔫 강탈자</span><span>🩸 강탈 당함</span><span><s class="struck">숫자</s> 중복 몰수</span></div>`;
  return `<table class="score"><thead>${head}</thead><tbody>${rows}</tbody></table>${legend}`;
}

/* 단계별 이벤트 패널 */
function eventHtml() {
  switch (S.phase) {
    case "ready":
    case "taking":
      return `<div class="event-big"><div class="k">진행 중</div>
        <div class="v">금화 수령</div>
        <p class="muted" style="margin-top:14px">참여자들이 순서대로 금고에 입장하고 있습니다.</p></div>`;
    case "peek":
      return `<div class="event-big"><div class="k">첫 순서 참여자</div>
        <div class="v">엿보기</div></div>`;
    case "preRob":
      return `<div class="event-big"><div class="k">강탈 단계</div><div class="v">대기 중…</div></div>`;
    case "robbing":
      return robbingEventHtml();
    case "duplicate":
      return duplicateEventHtml();
    case "result":
      return resultEventHtml();
    default:
      return "";
  }
}

function robbingEventHtml() {
  const R = S.robber || {};
  if (!R.id) {
    return `<div class="event-big"><div class="k">강탈자</div><div class="v">없음 (전원 동률)</div></div>`;
  }
  let last = "";
  if (R.lastResult) {
    const ok = R.lastResult.success;
    last = `<div class="event-big" style="padding-top:0">
      <div class="k">${nameOf(R.lastResult.targetId)} 지목</div>
      <div class="v ${ok ? "ok" : "no"}">${ok ? "강탈 성공" : "강탈 실패"}</div></div>`;
  }
  const robbed = R.robbedIds && R.robbedIds.length
    ? `<div class="event-list">${R.robbedIds.map((id) => `<span class="chip">${nameOf(id)} 강탈됨</span>`).join("")}</div>`
    : "";
  return `<div class="event-big"><div class="k">이번 라운드 강탈자</div>
    <div class="v robber">${nameOf(R.id)}</div></div>${last}${robbed}`;
}

function duplicateEventHtml() {
  const list = (S.duplicates && S.duplicates.length)
    ? `<div class="event-list">${S.duplicates.map((id) => `<span class="chip">${nameOf(id)} (${S.takes[id]}개)</span>`).join("")}</div>`
    : `<p class="muted" style="text-align:center; margin-top:16px">중복 몰수 대상 없음</p>`;
  return `<div class="event-big"><div class="k">중복 제거</div><div class="v no">몰수</div></div>${list}`;
}

function resultEventHtml() {
  const h = S.history[S.round];
  if (!h) return "";
  const ordered = S.order.slice();
  const rows = ordered.map((id) => {
    const took = h.takes[id] ?? 0;
    const gain = h.gains[id] ?? 0;
    let note = "";
    if (h.robberId === id) note = "강탈자";
    else if (h.robbedIds.includes(id)) note = "피강탈";
    else if (h.duplicates.includes(id)) note = "중복몰수";
    return `<tr>
      <td class="name">${nameOf(id)}</td>
      <td>${took}</td>
      <td class="total">${gain}</td>
      <td class="muted">${note}</td></tr>`;
  }).join("");
  return `<div class="panel-h" style="margin-top:0">라운드 ${S.round} 결과</div>
    <table class="score">
      <thead><tr><th style="text-align:left">참여자</th><th>가져감</th><th>획득</th><th>비고</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
}

function renderWinner() {
  el.innerHTML = `<div class="winner-screen">
    <div class="crown">🏆</div>
    <div class="wsub">최종 우승</div>
    <div class="wname">${nameOf(S.winner)}</div>
    <div class="wsub">${S.cumulative[S.winner]} 금화 획득</div>
  </div>`;
}
