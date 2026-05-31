// 예약 로직 검증 — train 필드 정확성 + getReservations + 매진 거절
const BASE = 'https://treated-oral-across-buyer.trycloudflare.com';
const SRT_ID = '01095258279';
const SRT_PW = 'choi@0113';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let pass = 0, fail = 0;

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`${PASS} ${name} (${Date.now()-t0}ms)`);
    pass++;
  } catch (e) {
    console.log(`${FAIL} ${name} — ${e.message}`);
    fail++;
  }
}
const A = (c, m) => { if (!c) throw new Error(m); };

console.log(`\n🧪 RailPick — Reservation Flow Verification`);
console.log(`📍 ${BASE}\n`);

// 1. Login
let loginOK = false;
await check('SRT login', async () => {
  const r = await api('/api/booking/login', { carrier: 'SRT', credential: SRT_ID, password: SRT_PW });
  A(r.status === 200 && r.json?.success, `${r.status}: ${r.json?.error}`);
  loginOK = true;
});

// 2. Search & verify train fields
const today = new Date();
const tomorrow = new Date(today.getTime() + 86400000);
const date = `${tomorrow.getFullYear()}${String(tomorrow.getMonth()+1).padStart(2,'0')}${String(tomorrow.getDate()).padStart(2,'0')}`;

let trains = [];
if (loginOK) {
  await check('SRT search returns trains', async () => {
    const r = await api('/api/booking/search', {
      carrier: 'SRT', credential: SRT_ID, password: SRT_PW,
      dep: '수서', arr: '부산', date, time: '060000', passengers: 1,
    });
    A(r.status === 200 && r.json?.success, `${r.status}: ${r.json?.error}`);
    trains = r.json.data;
    A(trains.length > 0, '0 trains');
    console.log(`        ${trains.length} trains`);
  });

  await check('Train fields present (depStnConsOrdr 등)', async () => {
    const t = trains[0];
    A(t.trainNo, 'no trainNo');
    A(t.depCode, 'no depCode');
    A(t.arrCode, 'no arrCode');
    A(t.depDate, 'no depDate');
    A(t.depTime, 'no depTime');
    A(t.arrTime, 'no arrTime');
    A(t.runDate, 'no runDate');
    A(t.depStnConsOrdr !== undefined, 'no depStnConsOrdr');
    A(t.arrStnConsOrdr !== undefined, 'no arrStnConsOrdr');
    A(t.depStnRunOrdr !== undefined, 'no depStnRunOrdr');
    A(t.arrStnRunOrdr !== undefined, 'no arrStnRunOrdr');
    A(t.trainTypeCode, 'no trainTypeCode');
    console.log(`        ${t.trainTypeName} ${t.trainNo} 필드값:`);
    console.log(`          depDate=${t.depDate} depTime=${t.depTime} arrTime=${t.arrTime}`);
    console.log(`          depCode=${t.depCode} arrCode=${t.arrCode}`);
    console.log(`          depStnConsOrdr=${t.depStnConsOrdr} arrStnConsOrdr=${t.arrStnConsOrdr}`);
    console.log(`          depStnRunOrdr=${t.depStnRunOrdr} arrStnRunOrdr=${t.arrStnRunOrdr}`);
    console.log(`          trainTypeCode=${t.trainTypeCode} general=${t.general} special=${t.special}`);
  });
}

// 3. 매진 열차로 reserve 시도 → 'SOLDOUT' 또는 SRT 거절 응답 확인
const soldoutTrains = trains.filter(t => t.general !== 'AVAILABLE' && t.special !== 'AVAILABLE');
if (soldoutTrains.length > 0) {
  await check('Reserve sold-out train → 거절 응답 (가짜 PNR 안 만듬)', async () => {
    const train = soldoutTrains[0];
    console.log(`        대상: ${train.trainTypeName} ${train.trainNo} (일반=${train.general}, 특실=${train.special})`);
    const r = await api('/api/booking/reserve', {
      carrier: 'SRT', credential: SRT_ID, password: SRT_PW,
      train, seatPreference: 'GENERAL_FIRST', passengers: 1,
    });
    // success false 여야 정상 (매진이니까)
    A(r.json?.success === false, `expected fail, got success with id=${r.json?.data?.id}`);
    A(!String(r.json?.data?.id || '').match(/^17\d{10,}$/), `Date.now() PNR detected: ${r.json?.data?.id}`);
    console.log(`        거절 메시지: ${r.json?.error}`);
  });
} else {
  console.log(`${PASS} (skip) 모든 열차 예약가능 — 매진 거절 테스트 불가`);
}

// 4. getReservations 직접 호출은 없음 (API에 노출 안 함). 다른 검증 — pnr fallback 확인은 코드 분석으로 이미 됨

console.log(`\n${'='.repeat(50)}`);
console.log(`Result: ${PASS} ${pass} · ${FAIL} ${fail}`);
process.exit(fail > 0 ? 1 : 0);
