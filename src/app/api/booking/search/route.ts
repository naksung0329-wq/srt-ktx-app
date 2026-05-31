import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateClient, invalidate } from '@/lib/session-pool';
import type { Carrier } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  carrier: Carrier;
  credential: string;
  password: string;
  dep: string;
  arr: string;
  date: string;
  time: string;
  passengers: number;
  /** 매크로 모드 — netfunnel 매번 새로 발급 + 차단 명확히 보고 */
  macro?: boolean;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.dep || !body.arr || !body.date) {
    return NextResponse.json({ success: false, error: '출발/도착/날짜 필요' }, { status: 400 });
  }
  if (!body.credential || !body.password) {
    return NextResponse.json({ success: false, error: '로그인 자격 증명 필요' }, { status: 400 });
  }

  const time = body.time || '000000';
  const psg = body.passengers || 1;

  try {
    const client = await getOrCreateClient({
      carrier: body.carrier, credential: body.credential, password: body.password,
    });
    const opts = body.carrier === 'SRT'
      ? { dep: body.dep, arr: body.arr, date: body.date, time, passengers: psg, freshNetfunnel: !!body.macro }
      : { dep: body.dep, arr: body.arr, date: body.date, time, passengers: psg };
    const trains = await client.searchTrains(opts);
    return NextResponse.json({ success: true, data: trains });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '조회 오류';
    // SRT IP 차단은 명확한 에러 코드로 보고 → 클라이언트가 매크로 자동 중지
    if (msg.includes('Your IP Address Blocked') || msg.includes('abnormal access')) {
      return NextResponse.json({
        success: false,
        error: 'SRT가 사용자 IP를 일시 차단했습니다 (매크로 의심). 30분~1시간 후 다시 시도하거나 폴링 간격을 늘리세요.',
        errorCode: 'IP_BLOCKED',
      }, { status: 429 });
    }
    if (msg.includes('로그인') || msg.includes('세션') || msg.includes('만료') || msg.includes('Need to Login')) {
      invalidate(body.carrier, body.credential, body.password);
      try {
        const client = await getOrCreateClient({
          carrier: body.carrier, credential: body.credential, password: body.password, refresh: true,
        });
        const opts2 = body.carrier === 'SRT'
          ? { dep: body.dep, arr: body.arr, date: body.date, time, passengers: psg, freshNetfunnel: true }
          : { dep: body.dep, arr: body.arr, date: body.date, time, passengers: psg };
        const trains = await client.searchTrains(opts2);
        return NextResponse.json({ success: true, data: trains });
      } catch (e2) {
        return NextResponse.json({ success: false, error: e2 instanceof Error ? e2.message : msg }, { status: 500 });
      }
    }
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
