/**
 * 텔레그램 봇 알림 발송
 * 우선순위: 클라이언트 설정 > env 변수
 * 미설정 시 graceful skip
 */
import type { Reservation } from './types';

export interface TelegramOpts {
  botToken?: string;
  chatId?: string;
}

export async function notifyTelegram(
  message: string,
  opts: TelegramOpts = {}
): Promise<{ ok: boolean; error?: string }> {
  const token = opts.botToken || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = opts.chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: '텔레그램 미설정 (앱 설정에서 봇 토큰/Chat ID 입력)' };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `Telegram ${res.status}: ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function formatReservationMessage(r: Reservation): string {
  const dep = `${r.depTime.slice(0, 2)}:${r.depTime.slice(2, 4)}`;
  const arr = `${r.arrTime.slice(0, 2)}:${r.arrTime.slice(2, 4)}`;
  const date = `${r.depDate.slice(0, 4)}-${r.depDate.slice(4, 6)}-${r.depDate.slice(6, 8)}`;
  const limit =
    r.buyLimitDate && r.buyLimitTime
      ? `${r.buyLimitDate.slice(4, 6)}/${r.buyLimitDate.slice(6, 8)} ${r.buyLimitTime.slice(0, 2)}:${r.buyLimitTime.slice(2, 4)}`
      : null;

  return [
    `🎉 <b>예약 성공!</b> 결제하세요`,
    ``,
    `🚆 <b>${r.trainTypeName} ${r.trainNo}호</b>`,
    `📍 ${r.depName} → ${r.arrName}`,
    `📅 ${date} ${dep} → ${arr}`,
    `💺 ${r.seatType}`,
    `🔢 예약번호 <code>${r.id}</code>`,
    limit ? `⏰ 결제 기한: ${limit}` : '',
    r.paymentUrl ? `🔗 ${r.paymentUrl}` : '',
  ].filter(Boolean).join('\n');
}

/** 텔레그램 봇 토큰 검증 — getMe 호출 */
export async function verifyTelegram(token: string, chatId: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (!token || !chatId) return { ok: false, error: '토큰/Chat ID 필요' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json();
    if (!j.ok) return { ok: false, error: j.description || '잘못된 봇 토큰' };
    // Test message
    const t = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ RailPick 텔레그램 연동 성공!' }),
    });
    const tj = await t.json();
    if (!tj.ok) return { ok: false, error: tj.description || 'Chat ID 오류 — 봇과 먼저 대화하세요' };
    return { ok: true, name: j.result.first_name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
