// Dynapath bypass 적용 후 KTX 검증
const BASE = 'https://view-settlement-calm-skip.trycloudflare.com';
const ID = '01095258279';
const PW = 'choi@0113';

console.log('🧪 KTX Dynapath bypass 검증\n');

const t0 = Date.now();
const r = await fetch(BASE + '/api/booking/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ carrier: 'KTX', credential: ID, password: PW }),
});
const j = await r.json();
const ms = Date.now() - t0;
console.log(`KTX login (Dynapath token + Sid 적용): ${ms}ms · status=${r.status}`);
console.log(JSON.stringify(j, null, 2));

if (j?.success) {
  console.log('\n🎉🎉🎉 KTX 로그인 성공! Dynapath bypass 작동!');
  console.log('\n--- KTX search 시도 ---');
  const tomorrow = new Date(Date.now() + 86400000);
  const date = `${tomorrow.getFullYear()}${String(tomorrow.getMonth()+1).padStart(2,'0')}${String(tomorrow.getDate()).padStart(2,'0')}`;
  const sr = await fetch(BASE + '/api/booking/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      carrier: 'KTX', credential: ID, password: PW,
      dep: '서울', arr: '부산', date, time: '060000', passengers: 1,
    }),
  });
  const sj = await sr.json();
  console.log(`search status=${sr.status}`);
  if (sj.success) {
    console.log(`✓ ${sj.data.length}개 열차`);
    sj.data.slice(0, 3).forEach(t => {
      console.log(`  ${t.trainTypeName} ${t.trainNo}호 ${t.depTime.slice(0,2)}:${t.depTime.slice(2,4)}→${t.arrTime.slice(0,2)}:${t.arrTime.slice(2,4)} 일반=${t.general} 특실=${t.special}`);
    });
  } else {
    console.log(`✗ ${sj.error}`);
  }
} else {
  console.log('\n❌ 여전히 실패');
  if (j?.errorCode === 'IP_BLOCKED' || j?.error?.includes('IP를 차단')) {
    console.log('IP_BLOCKED — anti-bot이 token이 아니라 IP 기반일 수 있음');
  } else {
    console.log('다른 에러 — 알고리즘에 잔여 오차 가능성');
  }
}
