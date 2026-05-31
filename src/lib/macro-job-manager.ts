/**
 * 서버사이드 매크로 잡 매니저
 *
 * Next.js 서버(standalone 모드)에서 싱글톤으로 동작.
 * SrtClient / KtxClient를 직접 호출해 브라우저 없이 백그라운드 폴링 실행.
 * 참고 앱(134.185.108.70:8000)과 동일한 서버사이드 방식.
 */
import { randomUUID } from 'node:crypto';
import { SrtClient } from './srt-client';
import { KtxClient } from './ktx-client';
import { notifyTelegram, formatReservationMessage } from './telegram';
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
  error?: string;
  createdAt: number;
  carrier: Carrier;
  dep: string;
  arr: string;
  date: string;
  time: string;
}

// ──────────────────────────────────────────────
// Internal job type (not exposed publicly)
// ──────────────────────────────────────────────

interface MacroJob extends MacroJobStatus {
  settings: ServerMacroSettings;
  stopRequested: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  nextAt: number;           // absolute ms timestamp of next attempt
  client: SrtClient | KtxClient;
}

// ──────────────────────────────────────────────
// MacroJobManager class
// ──────────────────────────────────────────────

class MacroJobManager {
  private readonly jobs = new Map<string, MacroJob>();

  /** 새 매크로 잡을 등록하고 jobId를 반환 */
  start(settings: ServerMacroSettings): string {
    const id = randomUUID();

    const client: SrtClient | KtxClient =
      settings.carrier === 'SRT' ? new SrtClient() : new KtxClient();

    const job: MacroJob = {
      id,
      status: 'running',
      attempts: 0,
      maxAttempts: settings.maxAttempts,
      lastMessage: '로그인 중...',
      nextCheckIn: Math.round(settings.intervalMs / 1000),
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
      client,
    };

    this.jobs.set(id, job);
    void this.runJob(id);
    return id;
  }

  /** jobId에 해당하는 잡을 중지 */
  stop(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.stopRequested = true;
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.status === 'running') job.status = 'stopped';
    return true;
  }

  /** 현재 상태 스냅샷 반환 */
  getStatus(id: string): MacroJobStatus | null {
    const job = this.jobs.get(id);
    if (!job) return null;

    const nextCheckIn =
      job.status === 'running'
        ? Math.max(0, Math.ceil((job.nextAt - Date.now()) / 1000))
        : job.nextCheckIn;

    return {
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      lastMessage: job.lastMessage,
      nextCheckIn,
      reservation: job.reservation,
      error: job.error,
      createdAt: job.createdAt,
      carrier: job.carrier,
      dep: job.dep,
      arr: job.arr,
      date: job.date,
      time: job.time,
    };
  }

  /** 완료된 오래된 잡 정리 (1시간 이상 지난 비활성 잡) */
  cleanup(): void {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && job.createdAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }

  // ──────────────────────────────────────────
  // Private: background job execution
  // ──────────────────────────────────────────

  private async runJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;

    // ① 로그인
    try {
      await job.client.login(job.settings.credential, job.settings.password);
      job.lastMessage = '로그인 완료. 열차 확인 중...'
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : '로그인 실패';
      job.lastMessage = job.error;
      return;
    }

    // ② 폴링 tick
    const tick = async (): Promise<void> => {
      const j = this.jobs.get(id);
      if (!j || j.stopRequested || j.status !== 'running') return;

      j.attempts += 1;

      try {
        const result = await this.attemptOnce(j);

        if (result.done && result.reservation) {
          // ✅ 예약 성공
          j.status = 'success';
          j.reservation = result.reservation;
          j.lastMessage = `예약 완료 — PNR ${result.reservation.id}`;

          // 텔레그램 알림
          if (j.settings.telegram) {
            const msg = formatReservationMessage(result.reservation);
            void notifyTelegram(msg, j.settings.telegram).catch(() => {});
          }
          return;
        }

        if (result.blocked) {
          j.status = 'failed';
          j.error = result.message ?? 'IP 차단';
          j.lastMessage = j.error;
          return;
        }

        if (j.attempts >= j.settings.maxAttempts) {
          j.status = 'failed';
          j.error = '최대 시도 횟수 도달';
          j.lastMessage = j.error;
          return;
        }

        // 다음 시도 예약 (±20% jitter)
        const base = j.settings.intervalMs;
        const jitter = (Math.random() - 0.5) * 0.4 * base;
        const nextMs = Math.max(3_000, base + jitter);
        j.nextAt = Date.now() + nextMs;
        j.nextCheckIn = Math.round(nextMs / 1000);
        j.lastMessage = result.message ?? '매진 확인 중...';

        j.timer = setTimeout(() => void tick(), nextMs);
      } catch (e) {
        if (j.stopRequested) return;

        const msg = e instanceof Error ? e.message : '알 수 없는 오류';
        j.lastMessage = `오류: ${msg}`;

        // IP 차단 감지
        if (msg.includes('IP') && msg.includes('차단')) {
          j.status = 'failed';
          j.error = msg;
          return;
        }

        const nextMs = j.settings.intervalMs;
        j.nextAt = Date.now() + nextMs;
        j.timer = setTimeout(() => void tick(), nextMs);
      }
    };

    // 첫 번째 시도는 즉시
    j.nextAt = Date.now() + job.settings.intervalMs;
    void tick();
  }

  /** 열차 조회 → 자리 있으면 예약 시도 */
  private async attemptOnce(job: MacroJob): Promise<{
    done: boolean;
    reservation?: Reservation;
    message?: string;
    blocked?: boolean;
  }> {
    const s = job.settings;
    const targetIds = new Set(s.targets.map(t => t.trainId));

    // 열차 조회
    let trains: Train[];
    if (s.carrier === 'SRT') {
      trains = await (job.client as SrtClient).searchTrains({
        dep: s.dep, arr: s.arr, date: s.date, time: s.time,
        passengers: s.passengers,
        freshNetfunnel: true, // 매크로 폴링 시 매번 새로 발급
      });
    } else {
      trains = await (job.client as KtxClient).searchTrains({
        dep: s.dep, arr: s.arr, date: s.date, time: s.time,
        passengers: s.passengers,
      });
    }

    // 대상 열차 중 자리 있는 것 탐색
    const available = trains.find(
      t => targetIds.has(t.id) && (t.general === 'AVAILABLE' || t.special === 'AVAILABLE')
    );

    if (!available) {
      const monitored = trains.filter(t => targetIds.has(t.id));
      if (monitored.length === 0) {
        return { done: false, message: '대상 열차를 찾을 수 없음 (날짜/시간 확인 필요)' };
      }
      const summary = monitored
        .map(t => {
          const hm = `${t.depTime.slice(0, 2)}:${t.depTime.slice(2, 4)}`;
          const g = t.general === 'AVAILABLE' ? '⭕' : t.general === 'WAITING' ? '대기' : '❌';
          const sp = t.special === 'AVAILABLE' ? '⭕' : '❌';
          return `${t.trainNo}호 ${hm} 일반${g}/특실${sp}`;
        })
        .join(' · ');
      return { done: false, message: `매진 (${summary})` };
    }

    // 예약 시도
    let reservation: Reservation;
    if (s.carrier === 'SRT') {
      reservation = await (job.client as SrtClient).reserve({
        train: available,
        seatPreference: s.seatPreference,
        passengers: s.passengers,
      });
    } else {
      reservation = await (job.client as KtxClient).reserve({
        train: available,
        seatPreference: s.seatPreference,
        passengers: s.passengers,
      });
    }

    return { done: true, reservation };
  }
}

// ──────────────────────────────────────────────
// 싱글톤 — global을 통해 HMR/모듈 재로딩 시에도 인스턴스 유지
// ──────────────────────────────────────────────

const g = global as typeof global & { _macroJobManager?: MacroJobManager };

export function getMacroJobManager(): MacroJobManager {
  if (!g._macroJobManager) {
    g._macroJobManager = new MacroJobManager();
    // 1시간마다 완료된 오래된 잡 정리
    setInterval(() => g._macroJobManager?.cleanup(), 3_600_000).unref();
  }
  return g._macroJobManager;
}
