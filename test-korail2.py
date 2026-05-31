# 사용자 PC에서 carpedm20/korail2 직접 실행 — 같은 IP에서 라이브러리 통과 여부 결정적 검증
import sys

print("=" * 60)
print("Python carpedm20/korail2 직접 검증 (사용자 PC IP)")
print("=" * 60)

try:
    import korail2
    print(f"korail2 version: {getattr(korail2, '__version__', '?')}")
except Exception as e:
    print("import error:", e)
    sys.exit(1)

# 외부 IP 확인
try:
    import urllib.request, json as _json
    ip = _json.loads(urllib.request.urlopen('https://ipinfo.io/json', timeout=5).read())
    print(f"외부 IP: {ip.get('ip')} ({ip.get('city')}, {ip.get('country')}) - {ip.get('org')}")
except Exception as e:
    print("ipinfo 실패:", e)

print()
print("--- KTX 로그인 시도 ---")
k = korail2.Korail('01095258279', 'choi@0113', auto_login=False)
try:
    result = k.login()
    print(f"login() returned: {result}")
    print(f"logined: {k.logined}")
    print(f"name: {getattr(k, 'name', None)}")
    print(f"membership: {getattr(k, 'membership_number', None)}")
    print(f"email: {getattr(k, 'email', None)}")
    if k.logined:
        print()
        print("✅ 통과 — KORAIL이 사용자 PC IP를 정상으로 인식")
        print("   → 우리 TS 코드에 차이가 있다는 의미")
    else:
        print()
        print("❌ 실패 — Python 라이브러리도 동일하게 거부")
        print("   → IP 차단 또는 KORAIL 정책")
except Exception as e:
    print(f"❌ EXCEPTION: {type(e).__name__}: {e}")
    print()
    print("→ Python 라이브러리도 같은 IP에서 거부 = IP 차단 확정")
