import { NextResponse } from 'next/server';
// 구버전 라우트 — /api/booking/search 로 이동
export async function POST() {
  return NextResponse.json(
    { success: false, error: '이 엔드포인트는 더 이상 사용되지 않습니다. /api/booking/search 사용' },
    { status: 410 }
  );
}
export async function GET() {
  return NextResponse.json({ success: false, error: 'deprecated' }, { status: 410 });
}
