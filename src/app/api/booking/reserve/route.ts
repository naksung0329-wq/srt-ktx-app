import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateClient, invalidate } from '@/lib/session-pool';
import { notifyTelegram, formatReservationMessage } from '@/lib/telegram';
import type { Carrier, Train } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  carrier: Carrier;
  credential: string;
  password: string;
  train: Train;
  seatPreference: 'GENERAL_FIRST' | 'SPECIAL_FIRST' | 'GENERAL_ONLY' | 'SPECIAL_ONLY';
  passengers: number;
  telegram?: { botToken: string; chatId: string };
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ success: false, error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.credential || !body.password || !body.train) {
    return NextResponse.json({ success: false, error: '필수 필드 누락' }, { status: 400 });
  }
  const psg = body.passengers || 1;
  const pref = body.seatPreference || 'GENERAL_FIRST';

  async function doReserve() {
    const client = await getOrCreateClient({
      carrier: body.carrier, credential: body.credential, password: body.password,
    });
    return client.reserve({ train: body.train, seatPreference: pref, passengers: psg });
  }

  try {
    let reservation;
    try {
      reservation = await doReserve();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('로그인') || msg.includes('세션') || msg.includes('만료') || msg.includes('Need to Login')) {
        invalidate(body.carrier, body.credential, body.password);
        reservation = await doReserve();
      } else { throw e; }
    }

    const tg = await notifyTelegram(formatReservationMessage(reservation), body.telegram);
    return NextResponse.json({
      success: true,
      data: reservation,
      telegram: tg.ok ? 'sent' : `skipped: ${tg.error}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '예매 오류';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
