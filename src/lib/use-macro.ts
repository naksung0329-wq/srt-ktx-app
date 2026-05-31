'use client';
/**
 * 매크로 (자동 재시도 예약) 훅
 *
 * 매진된 열차를 선택하면 일정 간격으로 search API를 폴링해서
 * 자리가 나는 즉시 reserve API를 호출. 성공 시 즉시 멈추고 알림.
 *
 * 클라이언트 폴링 방식 — 브라우저 탭이 열려 있을 때만 동작.
 * 모바일에서는 Wake Lock으로 화면 꺼짐 방지.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import type { Train, Reservation, Carrier } from './types';

export interface MacroTarget {
  trainId: string;          // train 식별자
  trainNo: string;
  trainTypeName: string;
  depTime: string;
}

export interface MacroSettings {
  carrier: Carrier;
  credential: string;
  password: string;
  // 검색 파라미터 (재조회용)
  dep: string;
  arr: string;
  date: string;
  time: string;
  passengers: number;
  // 매크로 동작
  intervalMs: number;       // 폴링 간격 (ms)
  maxAttempts: number;      // 최대 시도 횟수
  seatPreference: 'GENERAL_FIRST' | 'SPECIAL_FIRST' | 'GENERAL_ONLY' | 'SPECIAL_ONLY';
  targets: MacroTarget[];   // 모니터링할 열차들 (여러 개 가능)
  telegram?: { botToken: string; chatId: string };
}

export type MacroState =
  | { status: 'idle' }
  | { status: 'running'; attempts: number; lastChecked: number; lastMessage?: string; nextCheckIn: number }
  | { status: 'success'; reservation: Reservation; attempts: number }
  | { status: 'failed'; error: string; attempts: number }
  | { status: 'stopped'; attempts: number };

export function useMacro() {
  const [state, setState] = useState<MacroState>({ status: 'idle' });
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const reservingRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const settingsRef = useRef<MacroSettings | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nextAtRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // 카운트다운 표시용 1초 tick
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      releaseWakeLock();
    };
  }, []);

  async function requestWakeLock() {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };
      if (nav.wakeLock) {
        wakeLockRef.current = await nav.wakeLock.request('screen');
      }
    } catch { /* ignore */ }
  }
  function releaseWakeLock() {
    try {
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
    } catch { /* ignore */ }
  }

  const cleanup = useCallback(() => {
    if (intervalRef.current) { clearTimeout(intervalRef.current); intervalRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    releaseWakeLock();
  }, []);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    cleanup();
    setState({ status: 'stopped', attempts: attemptsRef.current });
  }, [cleanup]);

  async function attemptOnce(s: MacroSettings, signal: AbortSignal): Promise<{ done: boolean; reservation?: Reservation; message?: string; blocked?: boolean; }> {
    // 1) search (매크로 모드: netfunnel 매번 새로)
    const sres = await fetch('/api/booking/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carrier: s.carrier, credential: s.credential, password: s.password,
        dep: s.dep, arr: s.arr, date: s.date, time: s.time, passengers: s.passengers,
        macro: true,
      }),
      signal,
    });
    const sdata = await sres.json();
    if (!sdata.success) {
      // IP 차단 감지 → 매크로 즉시 중지
      if (sdata.errorCode === 'IP_BLOCKED' || sres.status === 429) {
        return { done: false, message: sdata.error || 'IP 차단', blocked: true };
      }
      return { done: false, message: `조회실패: ${sdata.error || ''}` };
    }
    const trains = (sdata.data as Train[]) || [];

    // 매크로 대상 중 자리 난 것 찾기
    const targetIds = new Set(s.targets.map(t => t.trainId));
    const available = trains.find(t => targetIds.has(t.id) && (t.general === 'AVAILABLE' || t.special === 'AVAILABLE'));

    if (!available) {
      // 가장 최근 상태 메시지
      const monitored = trains.filter(t => targetIds.has(t.id));
      if (monitored.length === 0) return { done: false, message: '대상 열차 사라짐 (시간/날짜 변경 필요)' };
      const summary = monitored.map(t => `${t.trainNo}호 ${t.depTime.slice(0,2)}:${t.depTime.slice(2,4)} ${t.general==='AVAILABLE'?'⭕':t.general==='WAITING'?'대':'❌'}/${t.special==='AVAILABLE'?'⭕':'❌'}`).join(' · ');
      return { done: false, message: `매진 (${summary})` };
    }

    // 2) reserve
    if (reservingRef.current) return { done: false, message: '예약 중…' };
    reservingRef.current = true;
    try {
      const rres = await fetch('/api/booking/reserve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: s.carrier, credential: s.credential, password: s.password,
          train: available, seatPreference: s.seatPreference, passengers: s.passengers,
          telegram: s.telegram,
        }),
        signal,
      });
      const rdata = await rres.json();
      if (rdata.success) {
        return { done: true, reservation: rdata.data as Reservation };
      }
      return { done: false, message: `예약시도 실패: ${rdata.error || ''}` };
    } finally {
      reservingRef.current = false;
    }
  }

  const start = useCallback(async (settings: MacroSettings) => {
    cleanup();
    attemptsRef.current = 0;
    stopRequestedRef.current = false;
    reservingRef.current = false;
    settingsRef.current = settings;

    await requestWakeLock();

    setState({ status: 'running', attempts: 0, lastChecked: Date.now(), nextCheckIn: settings.intervalMs / 1000 });

    const tick = async () => {
      if (stopRequestedRef.current || !settingsRef.current) return;
      attemptsRef.current += 1;
      // 매 시도마다 새 AbortController (이전 시도가 끝났거나 abort된 후)
      abortRef.current = new AbortController();
      try {
        const r = await attemptOnce(settingsRef.current, abortRef.current.signal);
        if (r.done && r.reservation) {
          cleanup();
          setState({ status: 'success', reservation: r.reservation, attempts: attemptsRef.current });
          return;
        }
        // IP 차단 → 매크로 즉시 중지
        if (r.blocked) {
          cleanup();
          setState({ status: 'failed', error: r.message || 'IP 차단', attempts: attemptsRef.current });
          return;
        }
        // jitter — 차단 회피 위해 다음 시도 간격에 ±20% 랜덤 추가
        const baseMs = settingsRef.current.intervalMs;
        const jitter = (Math.random() - 0.5) * 0.4 * baseMs;
        const nextMs = Math.max(3000, baseMs + jitter);
        const now = Date.now();
        nextAtRef.current = now + nextMs;
        setState({
          status: 'running',
          attempts: attemptsRef.current,
          lastChecked: now,
          lastMessage: r.message,
          nextCheckIn: Math.round(nextMs / 1000),
        });
        if (attemptsRef.current >= settingsRef.current.maxAttempts) {
          cleanup();
          setState({ status: 'failed', error: '최대 시도 횟수 도달', attempts: attemptsRef.current });
          return;
        }
        // jittered 다음 시도 예약
        if (!stopRequestedRef.current) intervalRef.current = setTimeout(tick, nextMs);
      } catch (e) {
        if (e instanceof Error && (e.name === 'AbortError' || stopRequestedRef.current)) return;
        const baseMs = settingsRef.current?.intervalMs || 10000;
        const nextMs = Math.max(5000, baseMs); // 에러 후엔 jitter 없이 base 간격
        const now = Date.now();
        nextAtRef.current = now + nextMs;
        setState({
          status: 'running',
          attempts: attemptsRef.current,
          lastChecked: now,
          lastMessage: `오류: ${e instanceof Error ? e.message : '알 수 없음'}`,
          nextCheckIn: Math.round(nextMs / 1000),
        });
        if (!stopRequestedRef.current) intervalRef.current = setTimeout(tick, nextMs);
      }
    };

    // 즉시 1회 실행 (이후 setTimeout chain)
    nextAtRef.current = Date.now() + settings.intervalMs;
    void tick();

    // 1초마다 nextCheckIn 카운트다운 업데이트
    tickRef.current = setInterval(() => {
      setState(prev => {
        if (prev.status !== 'running') return prev;
        const remaining = Math.max(0, Math.ceil((nextAtRef.current - Date.now()) / 1000));
        return { ...prev, nextCheckIn: remaining };
      });
    }, 1000);
  }, [cleanup]);

  return { state, start, stop };
}
