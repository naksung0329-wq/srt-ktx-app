import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateClient } from '@/lib/session-pool';
import type { Carrier } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { carrier, credential, password } = (await req.json()) as {
      carrier: Carrier; credential: string; password: string;
    };
    if (!credential || !password) {
      return NextResponse.json({ success: false, error: '아이디/비밀번호 입력' }, { status: 400 });
    }
    if (carrier !== 'SRT' && carrier !== 'KTX') {
      return NextResponse.json({ success: false, error: '지원하지 않는 항공사' }, { status: 400 });
    }
    // SessionStore 통해 로그인 → 캐시. 같은 자격증명으로 재호출 시 즉시 반환.
    const client = await getOrCreateClient({ carrier, credential, password });
    return NextResponse.json({
      success: true,
      data: {
        membershipNumber: client.membershipNumber,
        ...('customerName' in client ? { name: client.customerName, email: client.email } : {}),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '로그인 오류';
    const code = e instanceof Error ? (e as Error & { code?: string }).code : undefined;
    if (code === 'IP_BLOCKED' || msg.includes('Your IP Address Blocked') || msg.includes('IP를 차단')) {
      return NextResponse.json({ success: false, error: msg, errorCode: 'IP_BLOCKED' }, { status: 429 });
    }
    return NextResponse.json({ success: false, error: msg }, { status: 401 });
  }
}
