import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegram } from '@/lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { botToken, chatId } = (await req.json()) as { botToken: string; chatId: string };
    const r = await verifyTelegram(botToken, chatId);
    return NextResponse.json({ success: r.ok, name: r.name, error: r.error });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : '오류' }, { status: 500 });
  }
}
