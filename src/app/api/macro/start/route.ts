/**
 * POST /api/macro/start
 *
 * 서버사이드 매크로 잡을 시작하고 jobId를 반환.
 * 클라이언트는 이 jobId로 /api/macro/[jobId] 를 폴링해 상태를 확인.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getMacroJobManager, type ServerMacroSettings } from '@/lib/macro-job-manager';

export const runtime = 'nodejs'; // edge runtime은 global 싱글톤 불가

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ServerMacroSettings>;

    // 필수 파라미터 검증
    const required = ['carrier', 'credential', 'password', 'dep', 'arr', 'date', 'time', 'targets'] as const;
    for (const key of required) {
      if (!body[key]) {
        return NextResponse.json({ success: false, error: `${key} 누락` }, { status: 400 });
      }
    }
    if (!Array.isArray(body.targets) || body.targets.length === 0) {
      return NextResponse.json({ success: false, error: '대상 열차를 선택하세요' }, { status: 400 });
    }

    const settings: ServerMacroSettings = {
      carrier: body.carrier!,
      credential: body.credential!,
      password: body.password!,
      dep: body.dep!,
      arr: body.arr!,
      date: body.date!,
      time: body.time!,
      passengers: body.passengers ?? 1,
      intervalMs: body.intervalMs ?? 15_000,
      maxAttempts: body.maxAttempts ?? 240,
      seatPreference: body.seatPreference ?? 'GENERAL_FIRST',
      allowPartial: body.allowPartial ?? false,
      targets: body.targets!,
      telegram: body.telegram,
    };

    const manager = getMacroJobManager();
    const jobId = manager.start(settings);

    return NextResponse.json({ success: true, jobId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
