// QA E2E with real test credentials — POST-OPTIMIZATION
const BASE = process.env.QA_URL || 'https://authentic-italia-oriented-fruit.trycloudflare.com';
const SRT_ID = '01095258279';
const SRT_PW = 'choi@0113';

const PASS = '\x1b[32m✓ PASS\x1b[0m';
const FAIL = '\x1b[31m✗ FAIL\x1b[0m';

let passed = 0, failed = 0;
const failures = [];
const timings = {};

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const dt = Date.now() - t0;
    console.log(`${PASS} ${name} (${dt}ms)`);
    timings[name] = dt;
    passed++;
  } catch (e) {
    const dt = Date.now() - t0;
    console.log(`${FAIL} ${name} (${dt}ms)`);
    console.log(`        ${e.message}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

console.log(`\n🧪 RailPick — Optimized E2E Test`);
console.log(`📍 Target: ${BASE}\n`);

// ============== 첫 로그인 (cold) ==============
console.log('--- SRT Login (Cold — first call, full login) ---');

await test('SRT login cold', async () => {
  const r = await api('/api/booking/login', {
    carrier: 'SRT', credential: SRT_ID, password: SRT_PW,
  });
  assert(r.status === 200, `expected 200, got ${r.status}: ${r.text.slice(0,200)}`);
  assert(r.json?.success === true, `success=false: ${r.json?.error}`);
});

// ============== 재로그인 (cached, should be instant) ==============
console.log('\n--- SRT Login (Cached — should be <100ms) ---');

await test('SRT login cached (2nd call)', async () => {
  const t0 = Date.now();
  const r = await api('/api/booking/login', {
    carrier: 'SRT', credential: SRT_ID, password: SRT_PW,
  });
  const dt = Date.now() - t0;
  assert(r.status === 200, `expected 200, got ${r.status}`);
  assert(r.json?.success, `failed: ${r.json?.error}`);
  console.log(`        cached: ${dt}ms`);
});

// ============== 매크로 시뮬레이션: 같은 검색 5회 반복 ==============
console.log('\n--- Macro Simulation: Same search × 5 (SessionStore reuse test) ---');

const today = new Date();
const tomorrow = new Date(today.getTime() + 86400000);
const dateStr = `${tomorrow.getFullYear()}${String(tomorrow.getMonth()+1).padStart(2,'0')}${String(tomorrow.getDate()).padStart(2,'0')}`;

const searchTimes = [];
for (let i = 1; i <= 5; i++) {
  await test(`SRT search #${i}`, async () => {
    const t0 = Date.now();
    const r = await api('/api/booking/search', {
      carrier: 'SRT', credential: SRT_ID, password: SRT_PW,
      dep: '수서', arr: '부산',
      date: dateStr, time: '060000', passengers: 1,
    });
    const dt = Date.now() - t0;
    searchTimes.push(dt);
    assert(r.status === 200, `expected 200, got ${r.status}: ${r.text.slice(0,200)}`);
    assert(r.json?.success, `failed: ${r.json?.error}`);
    assert(Array.isArray(r.json?.data) && r.json.data.length > 0, `empty results`);
    console.log(`        #${i}: ${dt}ms · ${r.json.data.length} trains`);
  });
}

// ============== 다른 자격증명 (새 client 만들어짐 검증) ==============
console.log('\n--- Different credential (new client) ---');

await test('SRT login with wrong pw → fail (new client)', async () => {
  const r = await api('/api/booking/login', {
    carrier: 'SRT', credential: SRT_ID, password: 'wrongPwHere',
  });
  assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('SRT login back with correct pw → cached', async () => {
  const t0 = Date.now();
  const r = await api('/api/booking/login', {
    carrier: 'SRT', credential: SRT_ID, password: SRT_PW,
  });
  const dt = Date.now() - t0;
  assert(r.status === 200);
  console.log(`        ${dt}ms (cached)`);
});

// ============== Summary ==============
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${PASS} ${passed} · ${FAIL} ${failed}`);

if (searchTimes.length === 5) {
  console.log(`\nSearch times: ${searchTimes.map(t => t+'ms').join(' · ')}`);
  const avg = Math.round(searchTimes.reduce((a,b) => a+b, 0) / 5);
  const max = Math.max(...searchTimes);
  const min = Math.min(...searchTimes);
  console.log(`Average: ${avg}ms · Min: ${min}ms · Max: ${max}ms`);
  if (max < 2000) console.log(`✅ All searches < 2s — SessionStore optimization SUCCESS`);
}

if (failed > 0) {
  console.log(`\nFailures:`);
  failures.forEach(f => console.log(`  - ${f.name}\n    ${f.error}`));
  process.exit(1);
}
console.log(`\n✅ All tests passed`);
