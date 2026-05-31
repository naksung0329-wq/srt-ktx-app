import { NextResponse } from 'next/server';
// 구버전 라우트 — /api/booking/login 으로 이동했습니다
export async function POST() {
  return NextResponse.json(
    { success: false, error: '이 엔드포인트는 더 이상 사용되지 않습니다. /api/booking/login 사용' },
    { status: 410 }
  );
}
export async function DELETE() {
  return NextResponse.json({ success: true, message: '로그아웃 완료' });
}
