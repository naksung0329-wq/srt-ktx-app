/**
 * Next.js instrumentation — 서버 시작 시 1회 실행.
 *
 * 매크로/텔레그램 폴링 등 장시간 백그라운드 타이머에서 떠도는
 * unhandledRejection / uncaughtException 이 발생해도 Node 프로세스가
 * 통째로 종료되지 않도록 전역 핸들러를 등록한다(서버 상시 가동 보장).
 */
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.on('unhandledRejection', (reason) => {
      console.error('[unhandledRejection]', reason);
    });
    process.on('uncaughtException', (err) => {
      console.error('[uncaughtException]', err);
    });
  }
}
