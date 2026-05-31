# SRT/KTX 자동 예매

코레일(KTX)와 SRT 기차 티켓을 한 화면에서 조회 + 예매할 수 있는 모바일 친화 웹앱.

## 기능

- KTX(코레일톡) / SRT 양쪽 지원 — 한 사용자가 여러 프로필 등록 가능
- 프로필을 브라우저 localStorage에 저장 (마스터 패스프레이즈로 AES-GCM 암호화 옵션)
- 출/도착역 + 날짜/시간 + 인원 수 + 좌석 종류 선호도 설정
- 열차 조회 후 원하는 열차 "예약 시도"
- 예약 성공 시 텔레그램 봇으로 알림 발송 (env 설정 시)

## API

| Endpoint | Body | 설명 |
|---|---|---|
| `POST /api/booking/login` | `{carrier, credential, password}` | 로그인 검증 |
| `POST /api/booking/search` | `{carrier, credential, password, dep, arr, date, time, passengers}` | 열차 조회 |
| `POST /api/booking/reserve` | `{carrier, credential, password, train, seatPreference, passengers}` | 예매 + 텔레그램 알림 |

`carrier`는 `"SRT"` 또는 `"KTX"`. 매 요청마다 자격 증명을 받아 즉시 로그인 → 작업 → 응답 (Vercel 무상태).

## 환경변수 (.env.local)

```
TELEGRAM_BOT_TOKEN=123456:ABC...     # @BotFather 에서 발급
TELEGRAM_CHAT_ID=123456789            # @userinfobot 으로 본인 chat id 확인
```

미설정 시 텔레그램 알림은 graceful skip되고 예매 자체에는 영향 없음.

## 로컬 실행

```bash
npm install
npm run dev
# http://localhost:3000
```

## Vercel 배포

1. GitHub 등에 push
2. https://vercel.com/new 에서 import
3. **Settings → Environment Variables**에 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 추가
4. Deploy

`vercel.json`의 `maxDuration: 60`은 예매 라우트(`/api/booking/reserve`)에 적용됨.

## 알아둘 점

- **KTX(KORAIL) 매크로 검출**: 코레일이 자체 안티봇으로 클라우드 IP나 비정상 패턴을 차단할 수 있음. 실패 메시지에 "원활한 서비스 이용을 위해…" 가 나오면 검출된 것. 필요 시 `src/lib/ktx-client.ts` 의 `version`을 코레일톡 최신 버전으로 갱신.
- **SRT netfunnel**: 큐 토큰을 매 검색/예매마다 자동 발급. 만료 시 1회 재시도.
- **자동 재시도(매크로 폴링)**: 현재 버전은 단일 시도만. 매진된 표를 자동 polling 하려면 `setInterval`로 클라이언트에서 검색→예약 반복 호출 추가.
- **합법성**: 본인 명의 본인 표 예매에 한해 사용. KORAIL/SRT 약관상 매크로는 금지될 수 있으니 책임은 사용자에게 있음.

## 디렉토리

```
src/
├── app/
│   ├── page.tsx                     # 메인 화면
│   ├── api/booking/
│   │   ├── login/route.ts           # 로그인 검증
│   │   ├── search/route.ts          # 열차 조회
│   │   └── reserve/route.ts         # 예매 + 텔레그램
│   └── api/srt/                     # 구버전 — 410 stub
└── lib/
    ├── srt-client.ts                # SRT 모바일 API + netfunnel
    ├── ktx-client.ts                # 코레일톡 API + AES 비밀번호
    ├── stations.ts                  # 역 코드/목록
    ├── storage.ts                   # localStorage 프로필 (AES-GCM)
    ├── telegram.ts                  # 봇 알림
    └── types.ts                     # 공유 타입
```
