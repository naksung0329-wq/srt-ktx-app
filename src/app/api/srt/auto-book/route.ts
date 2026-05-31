import { NextResponse } from 'next/server';
// 구버전 자동 예매 라우트 — /api/booking/reserve 가 단일 시도. 자동 재시도는 클라이언트에서 polling
export async function POST() {
  return NextResponse.json(
    { success: false, error: '이 엔드포인트는 더 이상 사용되지 않습니다.' },
    { status: 410 }
  );
}
