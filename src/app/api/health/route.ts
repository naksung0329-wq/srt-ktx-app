/** GET /api/health — keep-alive / 헬스 체크용 경량 엔드포인트 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
