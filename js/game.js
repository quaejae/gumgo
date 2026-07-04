/*
 * 금고털이 (Vault Heist) — 순수 게임 로직 (DOM/Firebase 비의존)
 * ------------------------------------------------------------------
 * 이 파일은 룰북 + 확정된 결정사항을 "실행 가능한 명세"로 인코딩한 것입니다.
 * UI(app1/app2)와 동기화(sync.js)는 이 모듈의 함수만 호출합니다.
 *
 * 확정 규칙:
 *  - 금화 밸런스: cap = round(2.5*N), total = round(0.75*cap*N/5)*5
 *  - 강탈 실패: 강탈자가 그 라운드 보유한 금화 전부(강탈분 포함) 몰수
 *  - 중복 제거: '원래 가져온 개수' 기준 동률 몰수.
 *              단 강탈로 개수가 변동된 사람(강탈자/피강탈자)과 0개는 제외
 */

/* ── 밸런스 ─────────────────────────────────────────────── */
function balanceForPlayers(n) {
  const cap = Math.round(2.5 * n);
  const total = Math.round((0.75 * cap * n) / 5) * 5;
  return { cap, total };
}

/* ── 라운드 상태 모델 ────────────────────────────────────────
 * players: [{ id, name }]
 * order:   이번 라운드 입장 순서 (players id 배열)
 * takes:   { [playerId]: number }  금고에서 원래 가져온 개수 (0..cap)
 * total:   이번 라운드 금고 초기 금화 수
 *
 * 강탈/몰수 결과는 아래 함수들이 계산해 반환합니다.
 */

/* order를 랜덤 셔플하여 반환 (Fisher–Yates) */
function makeOrder(playerIds) {
  const a = playerIds.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 엿보기: order 상 prefix(k명)까지 가져간 뒤 금고 잔여 개수.
 * k=0 → 초기 총량, k=order.length → 최종 잔여.
 */
function remainingAfter(order, takes, total, k) {
  let taken = 0;
  for (let i = 0; i < k && i < order.length; i++) {
    taken += takes[order[i]] || 0;
  }
  return total - taken;
}

/* 강탈자 선정: 최소 획득자. 최솟값이 동률이면 그 사람들은 제외하고
 * '그 다음으로 적게' 가져간 단독자를 찾는다. 끝까지 단독자가 없으면 null.
 * 반환: 강탈자 playerId 또는 null
 */
function determineRobber(takes, playerIds) {
  const entries = playerIds.map((id) => ({ id, v: takes[id] || 0 }));
  const values = [...new Set(entries.map((e) => e.v))].sort((a, b) => a - b);
  for (const v of values) {
    const group = entries.filter((e) => e.v === v);
    if (group.length === 1) return group[0].id;
    // 동률이면 다음 값으로
  }
  return null; // 전원이 어떤 값에서도 단독이 아님(모두 동률 쌍 이상) → 강탈 없음
}

/* 강탈 지목 판정.
 * state: {
 *   takes,                // 원본 획득량
 *   holdings,             // 현재 보유량(강탈 반영 진행 중), 최초엔 takes 복제
 *   robberId,
 *   robbedIds: [],        // 이미 강탈 성공으로 뺏긴 대상들
 *   robberAlive: true,    // 실패 시 false
 * }
 * targetId: 강탈자가 지목한 대상
 *
 * 성공 조건: target이 '아직 안 뺏긴 참가자(강탈자 제외) 중 원본 최다 획득자'.
 *   최다가 동률이면 그 중 누구를 지목해도 성공.
 * 성공 시: target의 현재 보유 금화를 강탈자에게 전부 이전(target→0).
 * 실패 시: 강탈자 보유 전부(강탈분 포함) 몰수(→0), robberAlive=false.
 */
function attemptRob(state, targetId, playerIds) {
  const { takes, robberId, robbedIds } = state;
  const candidates = playerIds.filter(
    (id) => id !== robberId && !robbedIds.includes(id)
  );
  const maxV = Math.max(...candidates.map((id) => takes[id] || 0));
  const success = (takes[targetId] || 0) === maxV && candidates.includes(targetId);

  if (success) {
    state.holdings[robberId] += state.holdings[targetId];
    state.holdings[targetId] = 0;
    state.robbedIds.push(targetId);
  } else {
    state.holdings[robberId] = 0;
    state.robberAlive = false;
  }
  return { success, maxV };
}

/* 중복 제거 대상 산출.
 * 기준: 원본 takes. 단 (강탈자 + 피강탈자) 제외, 0개 제외.
 * 남은 사람 중 같은 값을 2명 이상 공유하면 그 전원이 몰수 대상.
 * 반환: 몰수 대상 playerId 배열
 */
function duplicatesToConfiscate(takes, playerIds, robberId, robbedIds) {
  const excluded = new Set([robberId, ...robbedIds].filter(Boolean));
  const pool = playerIds.filter(
    (id) => !excluded.has(id) && (takes[id] || 0) > 0
  );
  const byValue = {};
  for (const id of pool) {
    const v = takes[id];
    (byValue[v] ||= []).push(id);
  }
  const victims = [];
  for (const v in byValue) {
    if (byValue[v].length >= 2) victims.push(...byValue[v]);
  }
  return victims;
}

/* 라운드 최종 순득점 계산.
 * holdings(강탈 반영) 에서 중복 몰수 대상을 0으로 만든 값이 이번 라운드 획득분.
 * 반환: { [playerId]: roundGain }
 */
function finalizeRound(holdings, confiscatedIds) {
  const gains = {};
  for (const id in holdings) {
    gains[id] = confiscatedIds.includes(id) ? 0 : holdings[id];
  }
  return gains;
}

/* Firebase는 빈 배열/null을 저장하지 않아 읽을 때 undefined가 된다.
 * 상태를 받은 직후 호출해 배열 필드를 안전하게 복원한다. */
function normalizeState(s) {
  if (!s || typeof s !== "object") return s;
  if (!Array.isArray(s.order)) s.order = s.order || [];
  if (!Array.isArray(s.duplicates)) s.duplicates = s.duplicates || [];
  if (s.robber && typeof s.robber === "object") {
    if (!Array.isArray(s.robber.robbedIds)) s.robber.robbedIds = s.robber.robbedIds || [];
    if (!s.robber.holdings) s.robber.holdings = {};
  }
  if (s.history && typeof s.history === "object") {
    for (const r in s.history) {
      const h = s.history[r];
      if (!h) continue;
      if (!Array.isArray(h.order)) h.order = h.order || [];
      if (!Array.isArray(h.robbedIds)) h.robbedIds = h.robbedIds || [];
      if (!Array.isArray(h.duplicates)) h.duplicates = h.duplicates || [];
      if (!h.takes) h.takes = {};
      if (!h.gains) h.gains = {};
    }
  }
  return s;
}

/* 브라우저(전역)와 Node(테스트) 양쪽 노출 */
const GumgoGame = {
  balanceForPlayers,
  makeOrder,
  remainingAfter,
  determineRobber,
  attemptRob,
  duplicatesToConfiscate,
  finalizeRound,
  normalizeState,
};
if (typeof window !== "undefined") window.GumgoGame = GumgoGame;
if (typeof module !== "undefined") module.exports = GumgoGame;
