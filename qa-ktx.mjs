const BASE = 'https://jeff-mall-desired-apollo.trycloudflare.com';
const r = await fetch(BASE + '/api/booking/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ carrier: 'KTX', credential: '01095258279', password: 'choi@0113' }),
});
const j = await r.json();
console.log(`HTTP ${r.status}: ${JSON.stringify(j)}`);
