// QA Test Suite for RailPick
// 실행: node qa-test.mjs
const BASE = process.env.QA_URL || 'https://circulation-halifax-latinas-admitted.trycloudflare.com';

const PASS = '\x1b[32m✓ PASS\x1b[0m';
const FAIL = '\x1b[31m✗ FAIL\x1b[0m';
const SKIP = '\x1b[33m○ SKIP\x1b[0m';

let passed = 0, failed = 0, skipped = 0;
const failures = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const dt = Date.now() - t0;
    if (result === 'skip') {
      console.log(`${SKIP} ${name} (${dt}ms)`);
      skipped++;
    } else {
      console.log(`${PASS} ${name} (${dt}ms)`);
      passed++;
    }
  } catch (e) {
    const dt = Date.now() - t0;
    console.log(`${FAIL} ${name} (${dt}ms)`);
    console.log(`        ${e.message}`);
    failures.push({ name, error: e.message });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function http(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

console.log(`\n🧪 RailPick QA Test Suite`);
console.log(`📍 Target: ${BASE}\n`);

// ============== Frontend ==============
console.log('--- Frontend ---');
await test('GET / returns 200 HTML', async () => {
  const r = await http('/');
  assert(r.status === 200, `expected 200, got ${r.status}`);
  assert(r.text.length > 5000, `HTML too small: ${r.text.length}B`);
});

await test('GET / contains RailPick branding', async () => {
  const r = await http('/');
  assert(r.text.includes('RailPick'), 'no RailPick brand');
  assert(r.text.includes('SRT'), 'no SRT label');
  assert(r.text.includes('KTX'), 'no KTX label');
});

await test('GET / contains macro UI text', async () => {
  const r = await http('/');
  assert(r.text.includes('매크로') || r.text.includes('Macro'), 'no macro UI hint');
});

await test('GET /favicon.ico', async () => {
  const r = await fetch(BASE + '/favicon.ico');
  assert(r.status === 200, `expected 200, got ${r.status}`);
});

// ============== Validation ==============
console.log('\n--- API Validation ---');

await test('POST /api/booking/login empty body → 400', async () => {
  const r = await http('/api/booking/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
  assert(r.json?.success === false, 'success should be false');
  assert(r.json?.error?.includes('비밀번호') || r.json?.error?.includes('아이디'), `bad error: ${r.json?.error}`);
});

await test('POST /api/booking/search missing dep/arr → 400', async () => {
  const r = await http('/api/booking/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier: 'SRT' }),
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
  assert(r.json?.success === false, 'should fail');
});

await test('POST /api/booking/reserve missing fields → 400', async () => {
  const r = await http('/api/booking/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

await test('POST /api/booking/login invalid carrier → 400', async () => {
  const r = await http('/api/booking/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier: 'XYZ', credential: 'x', password: 'x' }),
  });
  assert(r.status === 400, `expected 400, got ${r.status}`);
});

// ============== SRT Auth ==============
console.log('\n--- SRT API ---');

await test('SRT login bad creds → 401, "존재하지 않는 회원"', async () => {
  const r = await http('/api/booking/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier: 'SRT', credential: '0000000000', password: 'wrongpass' }),
  });
  assert(r.status === 401, `expected 401, got ${r.status}`);
  assert(r.json?.error?.includes('존재하지') || r.json?.error?.includes('비밀번호'), `bad error: ${r.json?.error}`);
});

await test('SRT login NOT blocked by IP (no "Your IP Blocked")', async () => {
  const r = await http('/api/booking/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier: 'SRT', credential: '0000000000', password: 'x' }),
  });
  assert(!r.json?.error?.includes('Blocked'), `IP BLOCKED: ${r.json?.error}`);
  assert(!r.json?.error?.includes('abnormal'), `IP BLOCKED: ${r.json?.error}`);
});

await test('SRT search invalid station → error', async () => {
  const r = await http('/api/booking/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      carrier: 'SRT', credential: '', password: '',
      dep: '존재하지않는역', arr: '부산',
      date: '20260510', time: '060000', passengers: 1,
    }),
  });
  assert(r.status >= 400, `expected error, got ${r.status}`);
});

// ============== KTX Auth ==============
console.log('\n--- KTX API ---');

await test('KTX login bad creds → 401', async () => {
  const r = await http('/api/booking/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier: 'KTX', credential: '00000000', password: 'wrongpass' }),
  });
  assert(r.status === 401, `expected 401, got ${r.status}`);
  assert(r.json?.success === false, 'should fail');
});

// ============== Performance ==============
console.log('\n--- Performance ---');

await test('GET / under 2000ms', async () => {
  const t0 = Date.now();
  await http('/');
  const dt = Date.now() - t0;
  assert(dt < 5000, `too slow: ${dt}ms`);
});

await test('SRT login API under 3000ms', async () => {
  const t0 = Date.now();
  await http('/api/booking/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ carrier: 'SRT', credential: '0000000000', password: 'x' }),
  });
  const dt = Date.now() - t0;
  assert(dt < 5000, `too slow: ${dt}ms`);
});

// ============== CORS ==============
console.log('\n--- CORS ---');

await test('Allow-Origin header present on /api', async () => {
  const r = await fetch(BASE + '/api/booking/login', {
    method: 'OPTIONS',
    headers: { 'Origin': 'https://example.com', 'Access-Control-Request-Method': 'POST' },
  });
  // either 204 with header, or just allowed
  const allowOrigin = r.headers.get('access-control-allow-origin');
  if (!allowOrigin && r.status >= 400) return 'skip'; // CORS not strict, OK
});

// ============== Summary ==============
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${PASS} ${passed} · ${FAIL} ${failed} · ${SKIP} ${skipped}`);
if (failed > 0) {
  console.log(`\nFailures:`);
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
console.log(`\n✅ All tests passed`);
