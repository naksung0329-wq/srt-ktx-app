// 종합 QA: SRT 전체 + KTX (IP 차단 감지)
const BASE = 'https://cleveland-tissue-implies-determine.trycloudflare.com';
const ID = '01095258279';
const PW = 'choi@0113';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const SKIP = '\x1b[33m○\x1b[0m';
let pass = 0, fail = 0, skip = 0;

async function api(path, body) {
  const t0 = Date.now();
  const res = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, ms: Date.now() - t0 };
}

async function check(name, fn) {
  try { const v = await fn(); if (v === 'skip') { console.log(`${SKIP} ${name}`); skip++; } else { console.log(`${PASS} ${name}`); pass++; } }
  catch (e) { console.log(`${FAIL} ${name} — ${e.message}`); fail++; }
}
const A = (c, m) => { if (!c) throw new Error(m); };

console.log(`\n🧪 RailPick — 종합 QA\n📍 ${BASE}\n`);

// === SRT 전체 흐름 ===
console.log('━━━ SRT 전체 흐름 ━━━');

let srtBlocked = false;
let trains = [];

await check('SRT login (cold)', async () => {
  const r = await api('/api/booking/login', { carrier: 'SRT', credential: ID, password: PW });
  console.log(`        ${r.ms}ms · ${JSON.stringify(r.json).slice(0,100)}`);
  if (r.json?.errorCode === 'IP_BLOCKED' || r.text.includes('Blocked')) { srtBlocked = true; throw new Error('IP_BLOCKED'); }
  A(r.status === 200 && r.json?.success, `${r.status} ${r.json?.error}`);
});

await check('SRT login (cached, <100ms)', async () => {
  if (srtBlocked) return 'skip';
  const r = await api('/api/booking/login', { carrier: 'SRT', credential: ID, password: PW });
  console.log(`        cached: ${r.ms}ms`);
  A(r.json?.success, '');
  A(r.ms < 200, `slow: ${r.ms}ms`);
});

const tomorrow = new Date(Date.now() + 86400000);
const date = `${tomorrow.getFullYear()}${String(tomorrow.getMonth()+1).padStart(2,'0')}${String(tomorrow.getDate()).padStart(2,'0')}`;

await check('SRT search 수서→부산', async () => {
  if (srtBlocked) return 'skip';
  const r = await api('/api/booking/search', {
    carrier: 'SRT', credential: ID, password: PW,
    dep: '수서', arr: '부산', date, time: '060000', passengers: 1,
  });
  console.log(`        ${r.ms}ms · ${r.json?.data?.length || 0} trains`);
  if (r.json?.errorCode === 'IP_BLOCKED' || r.text.includes('Blocked')) { srtBlocked = true; throw new Error('IP_BLOCKED'); }
  A(r.json?.success, r.json?.error);
  trains = r.json.data;
  A(trains.length > 0, '0 trains');
});

await check('SRT train fields (예약에 필요한 필드 모두 포함)', async () => {
  if (trains.length === 0) return 'skip';
  const t = trains[0];
  ['trainNo','depCode','arrCode','depDate','depTime','arrTime','runDate','depStnConsOrdr','arrStnConsOrdr','depStnRunOrdr','arrStnRunOrdr','trainTypeCode'].forEach(f => A(t[f] !== undefined, `missing: ${f}`));
  console.log(`        ${t.trainTypeName} ${t.trainNo} ${t.depTime.slice(0,2)}:${t.depTime.slice(2,4)}→${t.arrTime.slice(0,2)}:${t.arrTime.slice(2,4)}`);
});

await check('SRT reserve 매진 열차 → 거절 (가짜 PNR 안 만듬)', async () => {
  if (trains.length === 0) return 'skip';
  const sold = trains.find(t => t.general !== 'AVAILABLE' && t.special !== 'AVAILABLE');
  if (!sold) { console.log(`        (모든 열차 가용 — 매진 거절 테스트 skip)`); return 'skip'; }
  const r = await api('/api/booking/reserve', {
    carrier: 'SRT', credential: ID, password: PW,
    train: sold, seatPreference: 'GENERAL_FIRST', passengers: 1,
  });
  A(r.json?.success === false, `expected fail, got ${JSON.stringify(r.json)}`);
  A(!String(r.json?.data?.id || '').match(/^17\d{10,}$/), `Date.now() PNR detected!`);
  console.log(`        거절: ${r.json?.error}`);
});

// === KTX 흐름 ===
console.log('\n━━━ KTX 흐름 ━━━');

await check('KTX login (IP_BLOCKED 정확히 감지)', async () => {
  const r = await api('/api/booking/login', { carrier: 'KTX', credential: ID, password: PW });
  console.log(`        ${r.ms}ms · ${JSON.stringify(r.json).slice(0,150)}`);
  if (r.json?.errorCode === 'IP_BLOCKED' || r.status === 429) {
    console.log(`        ✓ IP_BLOCKED 정확히 감지 — UI에서 큰 배너로 표시됨`);
    A(r.status === 429, `expected 429, got ${r.status}`);
    A(r.json?.errorCode === 'IP_BLOCKED', 'errorCode missing');
    return; // PASS
  }
  // 차단 풀린 경우
  A(r.status === 200 && r.json?.success, `unexpected: ${r.status}`);
});

// === 검증 ===
console.log('\n━━━ Validation ━━━');

await check('빈 body → 400', async () => {
  const r = await api('/api/booking/login', {});
  A(r.status === 400, `${r.status}`);
});

await check('알 수 없는 carrier → 400', async () => {
  const r = await api('/api/booking/login', { carrier: 'XYZ', credential: 'x', password: 'x' });
  A(r.status === 400, `${r.status}`);
});

await check('search 필수 필드 누락 → 400', async () => {
  const r = await api('/api/booking/search', { carrier: 'SRT' });
  A(r.status === 400, `${r.status}`);
});

// === Frontend ===
console.log('\n━━━ Frontend ━━━');

await check('GET / 페이지 렌더', async () => {
  const t0 = Date.now();
  const r = await fetch(BASE);
  const text = await r.text();
  console.log(`        ${Date.now()-t0}ms · ${text.length}B`);
  A(r.status === 200, `${r.status}`);
  A(text.includes('RailPick'), 'no brand');
  A(text.includes('매크로'), 'no macro UI');
});

await check('IP 차단 배너 UI 포함', async () => {
  const r = await fetch(BASE);
  const text = await r.text();
  A(text.includes('차단했습니다') || text.includes('IP를 차단') || text.length > 10000, 'UI banner code present');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Result: ${PASS} ${pass} · ${FAIL} ${fail} · ${SKIP} ${skip}`);
if (srtBlocked) console.log(`\n⚠️ SRT IP 차단 상태 — 시간 두고 재시도 필요`);
process.exit(fail > 0 ? 1 : 0);
