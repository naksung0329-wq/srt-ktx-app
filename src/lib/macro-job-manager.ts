/**
 * 서버사이드 매크로 잡 매니저
 *
 * Next.js 서버(standalone 모드)에서 싱글톤으로 동작.
 * SrtClient / KtxClient를 직접 호출해 브라우저 없이 백그라운드 폴링 실행.
 *
 * 추가 기능
 *  - 인원 분할 예약(allowPartial): 한 명씩이라도 자리가 나면 확보해 나간다.
 *  - 결제 유도 반복 알림(telegram-reminder).
 *  - 즉시 재시도(retryNow).
 *  - keep-alive self-ping: Render 무료 인스턴스 슬립 방지(잡 실행 중에만).
 *  - 일시적 연결 오류 표현 개선.
 */
import { randomUUID } from 'node:crypto';
import { SrtClient } from './srt-client';
import { KtxClient } from './ktx-client';
import { formatReservationMessage } from './telegram';
import { startPaymentReminder } from './telegram-reminder';
import type { Carrier, Reservation, Train } from './types';

// ──────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────

export interface ServerMacroSettings {
  carrier: Carrier;
  credential: string;
  password: string;
  dep: string;
  arr: string;
  date: string;
  time: string;
  passengers: number;
  intervalMs: number;
  maxAttempts: number;
  seatPreference: 'GENERAL_FIRST' | 'SPECIAL_FIRST' | 'GENERAL_ONLY' | 'SPECIAL_ONLY';
  /** 인원 분할 예약 허용 — 한 명씩이라도 자리가 나면 확보 (기본 false) */
  allowPartial?: boolean;
  targets: { trainId: string; trainNo: string; trainTypeName: string; depTime: string }[];
  telegram?: { botToken: string; chatId: string };
}

export interface MacroJobStatus {
  id: string;
  status: 'running' | 'success' | 'failed' | 'stopped';
  attempts: number;
  maxAttempts: number;
  lastMessage: string;
  nextCheckIn: number;      // 다음 확인까지 남은 초
  reservation?: Reservation;
  reservations?: Reservation[];   // 분할 예약 시 확보된 PNR 목록
  securedCount: number;     // 확보한 인원 수
  passengers: number;       // 목표 인원 수
  partial: boolean;         // 분할 예약 모드 여부
  transientError: boolean;  // 현재 일시적 연결 오류 상태인지
  error?: string;
  createdAt: number;
  carrier: Carrier;
  dep: string;
  arr: string;
  date: string;
  time: string;
}

// ──────────────────────────────────────────────
// Internal job type
// ──────────────────────────────────────────────

interface MacroJob extends MacroJobStatus {
  settings: ServerMacroSettings;
  stopRequested: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  nextAt: number;
  errorStreak: number;
  warnedUnstable: boolean;
  client: SrtClient | KtxClient;
}

// 일시적(자동 복구 가능) 네트워크 오류 판별
function isTransient(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('fetch failed') || m.includes('network') || m.includes('timeout') ||
    m.includes('econn') || m.includes('etimedout') || m.includes('enotfound') ||
    m.includes('socket') || m.includes('eai_again') || m.includes('aborted')
  );
}

// ──────────────────────────────────────────────
// MacroJobManager
// ──────────────────────────────────────────────

class MacroJobManager {
  private readonly jobs = new Map<string, MacroJob>();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  start(settings: ServerMacroSettings): string {
    const id = randomUUID();
    const client: SrtClient | KtxClient =
      settings.carrier === 'SRT' ? new SrtClient() : new KtxClient();

    const partial = !!settings.allowPartial && settings.passengers > 1;

    const job: MacroJob = {
      id,
      status: 'running',
      attempts: 0,
      maxAttempts: settings.maxAttempts,
      lastMessage: '로그인 중...',
      nextCheckIn: Math.round(settings.intervalMs / 1000),
      reservations: [],
      securedCount: 0,
      passengers: settings.passengers,
      partial,
      transientError: false,
      createdAt: Date.now(),
      carrier: settings.carrier,
      dep: settings.dep,
      arr: settings.arr,
      date: settings.date,
      time: settings.time,
      settings,
      stopRequested: false,
      timer: null,
      nextAt: 0,
      errorStreak: 0,
      warnedUnstable: false,
      client,
    };

    this.jobs.set(id, job);
    this.ensureKeepAlive();
    void this.runJob(id);
    return id;
  }

  stop(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.stopRequested = true;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    if (job.status === 'running') job.status = 'stopped';
    this.maybeStopKeepAlive();
    return true;
  }

  /** 대기 시간을 무시하고 즉시 한 번 더 시도 */
  retryNow(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    if (job.timer) { clearTimeout(job.timer); job.timer = null; }
    job.nextAt = Date.now();
    job.lastMessage = '수동 재시도 중...';
    void this.tick(id);
    return true;
  }

  getStatus(id: string): MacroJobStatus | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    const nextCheckIn =
      job.status === 'running'
        ? Math.max(0, Math.ceil((job.nextAt - Date.now()) / 1000))
        : job.nextCheckIn;
    return {
      id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.maxAttempts,
      lastMessage: job.lastMessage, nextCheckIn,
      reservation: job.reservation, reservations: job.reservations,
      securedCount: job.securedCount, passengers: job.passengers, partial: job.partial,
      transientError: job.transientError, error: job.error, createdAt: job.createdAt,
      carrier: job.carrier, dep: job.dep, arr: job.arr, date: job.date, time: job.time,
    };
  }

  cleanup(): void {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && job.createdAt < cutoff) this.jobs.delete(id);
    }
    this.maybeStopKeepAlive();
  }

  // ── keep-alive (Render 슬립 방지) ──────────────
  private ensureKeepAlive(): void {
    if (this.keepAliveTimer) return;
    const base = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL;
    if (!base) return; // 로컬 등 외부 URL 없으면 생략
    this.keepAliveTimer = setInterval(() => {
      const anyRunning = [...this.jobs.values()].some(j => j.status === 'running');
      if (!anyRunning) { this.maybeStopKeepAlive(); return; }
      fetch(`${base.replace(/\/$/, '')}/api/health`).catch(() => {});
    }, 10 * 60_000);
    (this.keepAliveTimer as unknown as { unref?: () => void }).unref?.();
  }

  private maybeStopKeepAlive(): void {
    const anyRunning = [...this.jobs.values()].some(j => j.status === 'running');
    if (!anyRunning && this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  // ── 잡 실행 ────────────────────────────────────
  private async runJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    try {
      await job.client.login(job.settings.credential, job.settings.password);
      job.lastMessage = '로그인 완료. 열차 확인 중...';
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : '로그인 실패';
      job.lastMessage = job.error;
      this.maybeStopKeepAlive();
      return;
    }
    job.nextAt = Date.now() + job.settings.intervalMs;
    void this.tick(id);
  }

  private scheduleNext(job: MacroJob, ms: number): void {
    job.nextAt = Date.now() + ms;
    job.nextCheckIn = Math.round(ms / 1000);
    job.timer = setTimeout(() => void this.tick(job.id), ms);
  }

  private fireReminder(job: MacroJob, reservation: Reservation): void {
    if (!job.settings.telegram) return;
    try {
      startPaymentReminder({
        token: job.settings.telegram.botToken,
        chatId: job.settings.telegram.chatId,
        reservation,
        initialText: formatReservationMessage(reservation),
      });
    } catch { /* ignore */ }
  }

  private async tick(id: string): Promise<void> {
    const j = this.jobs.get(id);
    if (!j || j.stopRequested || j.status !== 'running') return;
    j.attempts += 1;

    try {
      const result = await this.attemptOnce(j);
      j.transientError = false;
      j.errorStreak = 0;

      if (result.reservation) {
        j.securedCount += result.count ?? 1;
        j.reservations = [...(j.reservations ?? []), result.reservation];
        j.reservation = j.reservations[0];
        this.fireReminder(j, result.reservation);

        if (j.securedCount >= j.settings.passengers) {
          j.status = 'success';
          j.lastMessage = j.partial
            ? `예약 완료 — ${j.securedCount}명 확보 (PNR ${j.reservations.length}건)`
            : `예약 완료 — PNR ${result.reservation.id}`;
          this.maybeStopKeepAlive();
          return;
        }
        // 분할 진행 중 — 남은 인원 확보 위해 빠르게 재시도
        j.lastMessage = `🎫 ${j.securedCount}/${j.settings.passengers}명 확보 — 남은 좌석 확인 중`;
        this.scheduleNext(j, Math.max(5_000, Math.round(j.settings.intervalMs / 2)));
        return;
      }

      if (result.blocked) {
        j.status = 'failed';
        j.error = result.message ?? 'IP 차단';
        j.lastMessage = j.error;
        this.maybeStopKeepAlive();
        return;
      }

      if (j.attempts >= j.settings.maxAttempts) {
        j.status = 'failed';
        j.error = '최대 시도 횟수 도달';
        j.lastMessage = j.error;
        this.maybeStopKeepAlive();
        return;
      }

      const base = j.settings.intervalMs;
      // 넓은 지터(±35%)와 최소 간격 상향으로 봇 패턴 완화
      const jitter = (Math.random() - 0.5) * 0.7 * base;
      const nextMs = Math.max(8_000, base + jitter);
      const prefix = j.partial && j.securedCount > 0 ? `(${j.securedCount}/${j.settings.passengers}명 확보) ` : '';
      j.lastMessage = prefix + (result.message ?? '매진 확인 중...');
      this.scheduleNext(j, nextMs);
    } catch (e) {
      if (j.stopRequested) return;
      const msg = e instanceof Error ? e.message : '알 수 없는 오류';

      const blocked =
        msg.includes('Your IP Address Blocked') || msg.includes('abnormal access') ||
        (msg.includes('IP') && msg.includes('차단'));
      if (blocked) {
        j.status = 'failed';
        j.error = 'IP 차단 감지 — 매크로 중지 (30~60분 후 재시도하세요)';
        j.lastMessage = j.error;
        // 차단 시 두드림 중단 + 1회 알림
        if (j.settings.telegram) {
          import('./telegram').then(({ notifyTelegram }) =>
            notifyTelegram(
              `🚫 <b>IP 차단 감지</b>\n${j.carrier} ${j.dep}→${j.arr}\n매크로를 중지했습니다. 30~60분 후 다시 시작하세요. (계속 두드리면 차단이 길어집니다)`,
              j.settings.telegram,
            ).catch(() => {})
          ).catch(() => {});
        }
        this.maybeStopKeepAlive();
        return;
      }

      if (j.attempts >= j.settings.maxAttempts) {
        j.status = 'failed';
        j.error = '최대 시도 횟수 도달';
        j.lastMessage = j.error;
        this.maybeStopKeepAlive();
        return;
      }

      const nextMs = j.settings.intervalMs;
      const sec = Math.round(nextMs / 1000);
      if (isTransient(msg)) {
        j.transientError = true;
        j.errorStreak += 1;
        j.lastMessage = `⚠️ 일시적 연결 오류 — ${sec}초 후 자동 재시도 (연속 ${j.errorStreak}회)`;
        // 연속 6회 이상 불안정하면 1회 경고 알림
        if (j.errorStreak === 6 && j.settings.telegram && !j.warnedUnstable) {
          j.warnedUnstable = true;
          import('./telegram').then(({ notifyTelegram }) =>
            notifyTelegram('⚠️ RailPick: 서버↔예매처 연결이 불안정합니다. 매크로는 계속 재시도 중입니다.', j.settings.telegram).catch(() => {})
          ).catch(() => {});
        }
      } else {
        j.transientError = false;
        j.lastMessage = `오류: ${msg} — ${sec}초 후 재시도`;
      }
      this.scheduleNext(j, nextMs);
    }
  }

  /** 열차 조회 → 자리 있으면 예약. 분할 모드면 1명씩, 아니면 남은 인원 전체. */
  private async attemptOnce(job: MacroJob): Promise<{
    reservation?: Reservation;
    count?: number;
    message?: string;
    blocked?: boolean;
  }> {
    const s = job.settings;
    const remaining = s.passengers - job.securedCount;
    const reserveCount = job.partial ? 1 : remaining;
    const searchPsg = job.partial ? 1 : remaining;
    const targetIds = new Set(s.targets.map(t => t.trainId));

    let trains: Train[];
    if (s.carrier === 'SRT') {
      trains = await (job.client as SrtClient).searchTrains({
        dep: s.dep, arr: s.arr, date: s.date, time: s.time,
        passengers: searchPsg, freshNetfunnel: true,
      });
    } else {
      trains = await (job.client as KtxClient).searchTrains({
        dep: s.dep, arr: s.arr, date: s.date, time: s.time, passengers: searchPsg,
      });
    }

    const available = trains.find(
      t => targetIds.has(t.id) && (t.general === 'AVAILABLE' || t.special === 'AVAILABLE')
    );

    if (!available) {
      const monitored = trains.filter(t => targetIds.has(t.id));
      if (monitored.length === 0) {
        return { message: '대상 열차를 찾을 수 없음 (날짜/시간 확인 필요)' };
      }
      const summary = monitored.map(t => {
        const hm = `${t.depTime.slice(0, 2)}:${t.depTime.slice(2, 4)}`;
        const g = t.general === 'AVAILABLE' ? '⭕' : t.general === 'WAITING' ? '대기' : '❌';
        const sp = t.special === 'AVAILABLE' ? '⭕' : '❌';
        return `${t.trainNo}호 ${hm} 일반${g}/특실${sp}`;
      }).join(' · ');
      return { message: `매진 (${summary})` };
    }

    let reservation: Reservation;
    if (s.carrier === 'SRT') {
      reservation = await (job.client as SrtClient).reserve({
        train: available, seatPreference: s.seatPreference, passengers: reserveCount,
      });
    } else {
      reservation = await (job.client as KtxClient).reserve({
        train: available, seatPreference: s.seatPreference, passengers: reserveCount,
      });
    }
    return { reservation, count: reserveCount };
  }
}

// ──────────────────────────────────────────────
// 싱글톤
// ──────────────────────────────────────────────
const g = global as typeof global & { _macroJobManager?: MacroJobManager };

export function getMacroJobManager(): MacroJobManager {
  if (!g._macroJobManager) {
    g._macroJobManager = new MacroJobManager();
    setInterval(() => g._macroJobManager?.cleanup(), 3_600_000).unref();
  }
  return g._macroJobManager;
}
