/**
 * GET  /api/macro/[jobId]  → 잡 상태 조회
 * POST /api/macro/[jobId]  → 잡 중지
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMacroJobManager } from '@/lib/macro-job-manager';

export const runtime = 'nodejs';

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { jobId } = await params;
  const status = getMacroJobManager().getStatus(jobId);
  if (!status) {
    return NextResponse.json({ success: false, error: '잡을 찾을 수 없음' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: status });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { jobId } = await params;
  const body = await req.json().catch(() => ({})) as { action?: string };

  if (body.action === 'stop') {
    const ok = getMacroJobManager().stop(jobId);
    if (!ok) {
      return NextResponse.json({ success: false, error: '잡을 찾을 수 없음' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  if (body.action === 'retry') {
    const ok = getMacroJobManager().retryNow(jobId);
    if (!ok) {
      return NextResponse.json({ success: false, error: '재시도 불가 (잡 없음 또는 비실행)' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: '알 수 없는 action' }, { status: 400 });
}
