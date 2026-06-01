/**
 * 결제 유도 반복 알림 (2중 알림)
 *
 * 예약 성공 후 결제 전까지 텔레그램으로 반복 알림을 보내고,
 * 메시지의 인라인 버튼("결제 완료 — 알림 중지")을 누르면 멈춘다.
 *
 * - 토큰별 단일 getUpdates 폴러가 callback_query 를 수신해 해당 reminder 를 중지.
 * - 버튼 감지에 실패하더라도 maxCount 도달 시 자동 종료되므로 무한 반복되지 않는다.
 * - 서버 메모리 기반(잡 매니저와 동일). 프로세스 재시작 시 사라진다.
 */
import type { Reservation } from './types';

type Timer = ReturnType<typeof setInterval>;
function unref(t: Timer) { (t as unknown as { unref?: () => void }).unref?.(); }

async function tg(token: string, method: string, body: unknown): Promise<{ ok: boolean; result?: unknown }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; result?: unknown };
  } catch {
    return { ok: false };
  }
}

function buttonKeyboard(callbackData: string) {
  return { inline_keyboard: [[{ text: '✅ 결제 완료 — 알림 중지', callback_data: callbackData }]] };
}

// ── 토큰별 콜백 폴러 ───────────────────────────────
interface TokenPoller {
  offset: number;
  timer: Timer | null;
  polling: boolean;
  handlers: Map<string, () => void>; // callbackData → onPressed
}
const pollers = new Map<string, TokenPoller>();

function ensurePoller(token: string): TokenPoller {
  const existing = pollers.get(token);
  if (existing) return existing;

  const p: TokenPoller = { offset: 0, timer: null, polling: true, handlers: new Map() };
  pollers.set(token, p);

  const poll = async () => {
    if (!p.polling) return;
    const j = await tg(token, 'getUpdates', {
      offset: p.offset, timeout: 0, allowed_updates: ['callback_query'],
    });
    if (j.ok && Array.isArray(j.result)) {
      for (const u of j.result as Array<Record<string, unknown>>) {
        p.offset = (u.update_id as number) + 1;
        const cq = u.callback_query as { id: string; data?: string } | undefined;
        if (cq?.data) {
          await tg(token, 'answerCallbackQuery', {
            callback_query_id: cq.id, text: '결제 완료 처리됨 — 알림을 중지합니다.',
          });
          const h = p.handlers.get(cq.data);
          if (h) h();
        }
      }
    }
  };

  const timer = setInterval(() => void poll(), 5000);
  unref(timer);
  p.timer = timer;
  return p;
}

function maybeStopPoller(token: string) {
  const p = pollers.get(token);
  if (p && p.handlers.size === 0) {
    p.polling = false;
    if (p.timer) clearInterval(p.timer);
    pollers.delete(token);
  }
}

// ── 개별 reminder ─────────────────────────────────
interface Reminder { stopped: boolean; timer: Timer | null; count: number; }
const reminders = new Map<string, Reminder>();

export interface ReminderOpts {
  token: string;
  chatId: string;
  reservation: Reservation;
  initialText: string;
  intervalSec?: number;   // 반복 간격 (기본 45초)
  maxCount?: number;      // 최대 반복 횟수 (기본 12회 ≈ 9분)
}

/** 결제 유도 반복 알림 시작. 즉시 첫 메시지(버튼 포함)를 보낸다. */
export function startPaymentReminder(opts: ReminderOpts): { callbackData: string; stop: () => void } {
  const { token, chatId, reservation } = opts;
  const intervalMs = (opts.intervalSec ?? 45) * 1000;
  const maxCount = opts.maxCount ?? 12;
  const callbackData = `paid:${reservation.id}:${Date.now().toString(36)}`.slice(0, 60);

  // 첫 알림 (결제 정보 + 중지 버튼)
  void tg(token, 'sendMessage', {
    chat_id: chatId, text: opts.initialText, parse_mode: 'HTML',
    disable_web_page_preview: true, reply_markup: buttonKeyboard(callbackData),
  });

  const poller = ensurePoller(token);
  const reminder: Reminder = { stopped: false, timer: null, count: 0 };
  reminders.set(callbackData, reminder);

  const stop = () => {
    if (reminder.stopped) return;
    reminder.stopped = true;
    if (reminder.timer) clearInterval(reminder.timer);
    reminders.delete(callbackData);
    poller.handlers.delete(callbackData);
    maybeStopPoller(token);
  };

  poller.handlers.set(callbackData, () => {
    void tg(token, 'sendMessage', { chat_id: chatId, text: '✅ 결제 완료를 확인했습니다. 알림을 중지합니다.' });
    stop();
  });

  const dep = `${reservation.depTime.slice(0, 2)}:${reservation.depTime.slice(2, 4)}`;
  const appName = reservation.carrier === 'SRT' ? 'SRT 앱' : '코레일톡';
  const timer = setInterval(() => {
    if (reminder.stopped) return;
    reminder.count += 1;
    if (reminder.count > maxCount) {
      void tg(token, 'sendMessage', {
        chat_id: chatId,
        text: 'ℹ️ 결제 알림을 종료합니다. 아직 결제 전이라면 앱에서 서둘러 결제하세요.',
      });
      stop();
      return;
    }
    void tg(token, 'sendMessage', {
      chat_id: chatId,
      parse_mode: 'HTML',
      reply_markup: buttonKeyboard(callbackData),
      text:
        `🔔 <b>아직 결제 전입니다 (${reminder.count}/${maxCount})</b>\n` +
        `🚆 ${reservation.trainTypeName} ${reservation.trainNo}호 · ${dep}\n` +
        `🔢 PNR <code>${reservation.id}</code>\n` +
        `👉 <b>${appName}</b>에서 결제하세요. 완료하셨으면 아래 버튼을 누르세요.`,
    });
  }, intervalMs);
  unref(timer);
  reminder.timer = timer;

  return { callbackData, stop };
}
