'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Train, Reservation, Carrier } from '@/lib/types';
import { SRT_STATION_LIST, KTX_STATIONS } from '@/lib/stations';
import {
  Profile, loadProfiles, addProfile, getDecryptedPassword, deleteProfile,
  TelegramConfig, loadTelegram, saveTelegram, clearTelegram,
  ThemeName, THEMES, loadTheme, saveTheme,
} from '@/lib/storage';
import type { MacroJobStatus } from '@/lib/macro-job-manager';

const SERVER_JOBS_KEY = 'railpick_server_job_ids';

type SeatPref = 'GENERAL_FIRST' | 'SPECIAL_FIRST' | 'GENERAL_ONLY' | 'SPECIAL_ONLY';

function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }
function todayPlus(days = 0) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}
function fmtDate(yyyymmdd: string) {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const dt = new Date(parseInt(yyyymmdd.slice(0,4)), parseInt(yyyymmdd.slice(4,6))-1, parseInt(yyyymmdd.slice(6,8)));
  const dow = ['일','월','화','수','목','금','토'][dt.getDay()];
  return `${yyyymmdd.slice(4,6)}.${yyyymmdd.slice(6,8)} (${dow})`;
}
const fmtHM = (hhmmss: string) => `${hhmmss.slice(0,2)}:${hhmmss.slice(2,4)}`;
const dateInputValue = (y: string) => `${y.slice(0,4)}-${y.slice(4,6)}-${y.slice(6,8)}`;
const dateInputToYMD = (s: string) => s.replace(/-/g, '');

export default function Home() {
  // ===== Theme =====
  const [theme, setTheme] = useState<ThemeName>('light');
  const [showSettings, setShowSettings] = useState(false);
  useEffect(() => {
    const t = loadTheme();
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);
  function applyTheme(t: ThemeName) {
    setTheme(t);
    saveTheme(t);
    document.documentElement.setAttribute('data-theme', t);
  }

  // ===== Profiles =====
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [unlockedPw, setUnlockedPw] = useState<string | null>(null);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [npCarrier, setNpCarrier] = useState<Carrier>('SRT');
  const [npLabel, setNpLabel] = useState('');
  const [npCred, setNpCred] = useState('');
  const [npPw, setNpPw] = useState('');

  // ===== Telegram =====
  const [telegram, setTelegramState] = useState<TelegramConfig | null>(null);
  const [showTelegramForm, setShowTelegramForm] = useState(false);
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgVerifying, setTgVerifying] = useState(false);

  // ===== Search =====
  const [carrier, setCarrier] = useState<Carrier>('SRT');
  const [dep, setDep] = useState('수서');
  const [arr, setArr] = useState('부산');
  const [date, setDate] = useState(todayPlus(1));
  const [time, setTime] = useState('060000');
  const [psg, setPsg] = useState(1);
  const [seatPref, setSeatPref] = useState<SeatPref>('GENERAL_FIRST');

  // ===== Result =====
  const [trains, setTrains] = useState<Train[]>([]);
  const [searching, setSearching] = useState(false);
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [success, setSuccess] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [ipBlocked, setIpBlocked] = useState(false);

  // ===== 매크로 설정 =====
  const [macroIntervalSec, setMacroIntervalSec] = useState(15);
  const [macroMaxAttempts, setMacroMaxAttempts] = useState(240);
  const [showMacroSettings, setShowMacroSettings] = useState(false);

  // ===== 서버 매크로 잡 (건별) =====
  // serverJobs: jobId → MacroJobStatus
  const [serverJobs, setServerJobs] = useState<Record<string, MacroJobStatus>>({});
  // trainToJobId: trainId → jobId (현재 세션에서 시작한 매핑)
  const [trainToJobId, setTrainToJobId] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 헬퍼: trainId로 잡 가져오기
  function getTrainJob(trainId: string): MacroJobStatus | null {
    const jobId = trainToJobId[trainId];
    return jobId ? (serverJobs[jobId] ?? null) : null;
  }

  const activeJobCount = Object.values(serverJobs).filter(j => j.status === 'running').length;

  // localStorage 잡 ID 관리
  function getSavedJobIds(): string[] {
    try { return JSON.parse(localStorage.getItem(SERVER_JOBS_KEY) || '[]'); } catch { return []; }
  }
  function addSavedJobId(id: string) {
    const ids = getSavedJobIds();
    if (!ids.includes(id)) localStorage.setItem(SERVER_JOBS_KEY, JSON.stringify([...ids, id]));
  }
  function removeSavedJobId(id: string) {
    const ids = getSavedJobIds().filter(x => x !== id);
    localStorage.setItem(SERVER_JOBS_KEY, JSON.stringify(ids));
  }

  // 단일 잡 폴링
  const pollOneJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/macro/${jobId}`);
      if (res.status === 404) {
        removeSavedJobId(jobId);
        setServerJobs(prev => { const next = { ...prev }; delete next[jobId]; return next; });
        return;
      }
      const data = await res.json();
      if (!data.success) return;
      const jobStatus: MacroJobStatus = data.data;
      setServerJobs(prev => ({ ...prev, [jobId]: jobStatus }));
      if (jobStatus.status === 'success') {
        setSuccess(jobStatus.reservation ?? null);
        removeSavedJobId(jobId);
      } else if (jobStatus.status === 'failed' || jobStatus.status === 'stopped') {
        removeSavedJobId(jobId);
      }
    } catch { /* 네트워크 오류 무시 */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startGlobalPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      const ids = getSavedJobIds();
      if (ids.length === 0) { stopPolling(); return; }
      ids.forEach(id => void pollOneJob(id));
    }, 4_000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => {
    setProfiles(loadProfiles());
    setTelegramState(loadTelegram());
    const savedIds = getSavedJobIds();
    if (savedIds.length > 0) {
      savedIds.forEach(id => void pollOneJob(id));
      startGlobalPolling();
    }
    return () => stopPolling();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (carrier === 'SRT') {
      if (!SRT_STATION_LIST.includes(dep)) setDep('수서');
      if (!SRT_STATION_LIST.includes(arr)) setArr('부산');
    } else {
      if (!KTX_STATIONS.includes(dep)) setDep('서울');
      if (!KTX_STATIONS.includes(arr)) setArr('부산');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrier]);

  const stations = carrier === 'SRT' ? SRT_STATION_LIST : KTX_STATIONS;
  const activeProfile = profiles.find(p => p.id === activeProfileId) || null;
  const soldoutTrains = useMemo(() => trains.filter(t => t.general !== 'AVAILABLE' && t.special !== 'AVAILABLE'), [trains]);

  function clearMsgs() { setError(null); setInfo(null); setSuccess(null); }

  function handleAddProfile() {
    if (!npLabel || !npCred || !npPw) { setError('별칭/아이디/비밀번호 모두 입력'); return; }
    const p = addProfile({ carrier: npCarrier, label: npLabel, credential: npCred, password: npPw });
    setProfiles(loadProfiles());
    setActiveProfileId(p.id);
    setUnlockedPw(npPw);
    setCarrier(p.carrier);
    setShowAddProfile(false);
    setNpLabel(''); setNpCred(''); setNpPw('');
    setInfo(`✓ ${p.label} 저장됨`);
  }

  function handleSelectProfile(p: Profile) {
    if (activeProfileId === p.id) { setActiveProfileId(null); setUnlockedPw(null); return; }
    setActiveProfileId(p.id);
    setCarrier(p.carrier);
    setUnlockedPw(getDecryptedPassword(p));
    setInfo(`✓ ${p.label} 활성화`);
  }

  function handleDeleteProfile(id: string) {
    if (!confirm('프로필 삭제?')) return;
    deleteProfile(id);
    setProfiles(loadProfiles());
    if (activeProfileId === id) { setActiveProfileId(null); setUnlockedPw(null); }
  }

  async function handleSaveTelegram() {
    if (!tgToken || !tgChatId) { setError('봇 토큰과 Chat ID 모두 입력'); return; }
    setTgVerifying(true); clearMsgs();
    try {
      const res = await fetch('/api/booking/telegram-verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botToken: tgToken, chatId: tgChatId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '검증 실패');
      const cfg: TelegramConfig = { botToken: tgToken, chatId: tgChatId, enabled: true };
      saveTelegram(cfg);
      setTelegramState(cfg);
      setShowTelegramForm(false);
      setTgToken(''); setTgChatId('');
      setInfo(`✅ 텔레그램 연동 완료 (${data.name || '봇'})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '텔레그램 검증 실패');
    } finally { setTgVerifying(false); }
  }

  function handleClearTelegram() {
    if (!confirm('텔레그램 연동 삭제?')) return;
    clearTelegram();
    setTelegramState(null);
  }

  function swapStations() { setDep(arr); setArr(dep); }

  async function handleSearch() {
    clearMsgs();
    setSearching(true); setTrains([]);
    try {
      const res = await fetch('/api/booking/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier,
          credential: activeProfile?.credential || '',
          password: unlockedPw || '',
          dep, arr, date, time, passengers: psg,
        }),
      });
      const data = await res.json();
      if (data.errorCode === 'IP_BLOCKED' || res.status === 429) {
        setIpBlocked(true);
        throw new Error(data.error || 'IP 차단');
      }
      if (!data.success) throw new Error(data.error || '조회 실패');
      const list = (data.data as Train[]) || [];
      setTrains(list);
      if (list.length === 0) setInfo('조회 결과 없음');
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 오류');
    } finally { setSearching(false); }
  }

  async function handleReserve(train: Train) {
    if (!activeProfile || !unlockedPw) { setError('프로필 먼저 선택'); return; }
    if (activeProfile.carrier !== train.carrier) { setError(`${train.carrier} 프로필 필요`); return; }
    setReservingId(train.id); clearMsgs();
    try {
      const res = await fetch('/api/booking/reserve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: activeProfile.carrier,
          credential: activeProfile.credential,
          password: unlockedPw,
          train, seatPreference: seatPref, passengers: psg,
          telegram: telegram?.enabled ? { botToken: telegram.botToken, chatId: telegram.chatId } : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '예약 실패');
      setSuccess(data.data as Reservation);
    } catch (e) {
      setError(e instanceof Error ? e.message : '예약 오류');
    } finally { setReservingId(null); }
  }

  // 건별 매크로 시작 (열차 하나씩 독립 잡)
  async function startMacroForTrain(train: Train) {
    if (!activeProfile || !unlockedPw) { setError('프로필 활성화 필요'); return; }
    clearMsgs();

    try {
      const res = await fetch('/api/macro/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          carrier: activeProfile.carrier,
          credential: activeProfile.credential,
          password: unlockedPw,
          dep, arr, date, time, passengers: psg,
          intervalMs: macroIntervalSec * 1000,
          maxAttempts: macroMaxAttempts,
          seatPreference: seatPref,
          targets: [{ trainId: train.id, trainNo: train.trainNo, trainTypeName: train.trainTypeName, depTime: train.depTime }],
          telegram: telegram?.enabled ? { botToken: telegram.botToken, chatId: telegram.chatId } : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '매크로 시작 실패');

      const jobId: string = data.jobId;
      addSavedJobId(jobId);
      setTrainToJobId(prev => ({ ...prev, [train.id]: jobId }));
      setServerJobs(prev => ({
        ...prev,
        [jobId]: {
          id: jobId, status: 'running',
          attempts: 0, maxAttempts: macroMaxAttempts,
          lastMessage: '서버 시작 중...', nextCheckIn: macroIntervalSec,
          createdAt: Date.now(), carrier: activeProfile.carrier,
          dep, arr, date, time,
        } as MacroJobStatus,
      }));
      startGlobalPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : '매크로 시작 오류');
    }
  }

  async function stopServerMacro(jobId: string) {
    try {
      await fetch(`/api/macro/${jobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
    } catch { /* ignore */ }
    removeSavedJobId(jobId);
    setServerJobs(prev => {
      const next = { ...prev };
      if (next[jobId]) next[jobId] = { ...next[jobId], status: 'stopped' };
      return next;
    });
    setTrainToJobId(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k] === jobId) delete next[k]; });
      return next;
    });
    if (getSavedJobIds().length === 0) stopPolling();
  }

  function dismissJob(jobId: string) {
    setServerJobs(prev => { const next = { ...prev }; delete next[jobId]; return next; });
    removeSavedJobId(jobId);
    setTrainToJobId(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k] === jobId) delete next[k]; });
      return next;
    });
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: 'var(--bg-grad)' }}>
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md" style={{ background: 'color-mix(in srgb, var(--surface) 85%, transparent)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
          <span className="text-2xl">🚆</span>
          <div className="flex-1">
            <div className="font-black text-lg leading-none" style={{ color: 'var(--text)' }}>RailPick</div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>KTX · SRT 자동 예매 매크로</div>
          </div>
          {activeJobCount > 0 && (
            <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              <span className="w-1.5 h-1.5 rounded-full pulse-ring" style={{ background: 'var(--warning)' }} />
              매크로 {activeJobCount}건
            </div>
          )}
          {activeProfile && !activeJobCount && (
            <div className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
              <span className="w-1.5 h-1.5 rounded-full pulse-ring" style={{ background: 'var(--success)' }} />
              {activeProfile.label}
            </div>
          )}
          <button onClick={() => setShowSettings(!showSettings)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-base hover:scale-110 transition" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
            aria-label="설정">⚙️</button>
        </div>
        {showSettings && (
          <div className="max-w-md mx-auto px-4 pb-3">
            <div className="text-[10px] font-bold mb-1.5" style={{ color: 'var(--text-muted)' }}>테마</div>
            <div className="grid grid-cols-4 gap-1.5">
              {THEMES.map(t => (
                <button key={t.id} onClick={() => applyTheme(t.id)}
                  className={`p-2 rounded-xl border-2 text-center transition ${theme === t.id ? 'scale-95' : 'hover:scale-95'}`}
                  style={{ borderColor: theme === t.id ? 'var(--primary)' : 'var(--border)', background: theme === t.id ? 'var(--primary)' : 'var(--surface)', color: theme === t.id ? 'var(--primary-text)' : 'var(--text)' }}>
                  <div className="text-base leading-none">{t.emoji}</div>
                  <div className="text-[10px] font-bold mt-1">{t.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="max-w-md mx-auto px-4 py-4 space-y-3">
        {/* IP 차단 배너 */}
        {ipBlocked && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--danger-soft)', border: '2px solid var(--danger)' }}>
            <div className="font-black mb-1.5" style={{ color: 'var(--danger)' }}>🚫 KORAIL/SRT가 이 IP를 차단했습니다</div>
            <div className="text-xs space-y-1" style={{ color: 'var(--text)' }}>
              <div>매크로 의심 패턴 감지로 일시 차단 (1~3시간)</div>
              <ul className="list-disc list-inside text-[11px] space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                <li>1~3시간 후 다시 시도</li>
                <li>모바일 핫스팟으로 변경</li>
                <li>공유기 재시작 (새 IP 할당)</li>
                <li>VPN/프록시 사용</li>
              </ul>
              <button onClick={() => setIpBlocked(false)} className="mt-1 text-xs underline" style={{ color: 'var(--text-muted)' }}>닫기</button>
            </div>
          </div>
        )}

        {/* 알림 */}
        {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
        {info && !error && <Alert kind="info" onClose={() => setInfo(null)}>{info}</Alert>}

        {/* 예약 성공 */}
        {success && (
          <div className="rounded-2xl p-4 shadow-lg" style={{ background: 'var(--success-soft)', border: '2px solid var(--success)' }}>
            <div className="font-black mb-2 text-base" style={{ color: 'var(--success)' }}>🎉 예약 완료! 결제하세요</div>
            <div className="space-y-0.5 text-sm" style={{ color: 'var(--text)' }}>
              <div className="font-bold">{success.trainTypeName} {success.trainNo}호 · {success.seatType}</div>
              <div>{success.depName} → {success.arrName}</div>
              <div>{fmtDate(success.depDate)} · {fmtHM(success.depTime)} → {fmtHM(success.arrTime)}</div>
              <div>예약번호 <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: 'var(--surface)' }}>{success.id}</code></div>
              {success.buyLimitDate && success.buyLimitTime && (
                <div className="font-bold mt-1" style={{ color: 'var(--warning)' }}>
                  ⏰ 결제기한: {success.buyLimitDate.slice(4,6)}/{success.buyLimitDate.slice(6,8)} {success.buyLimitTime.slice(0,2)}:{success.buyLimitTime.slice(2,4)}
                </div>
              )}
              <div className="pt-2 mt-2 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                📱 <b>{success.carrier === 'SRT' ? 'SRT 앱' : '코레일톡'}</b>에서 결제 (10분 내)
                {telegram?.enabled && <div>📨 텔레그램 알림 발송됨</div>}
              </div>
            </div>
          </div>
        )}

        {/* 실행 중인 매크로 목록 (브라우저 재시작 후 복구된 잡들) */}
        {Object.values(serverJobs).filter(j => !Object.values(trainToJobId).includes(j.id)).length > 0 && (
          <div className="rounded-2xl overflow-hidden shadow" style={{ background: 'var(--surface)', border: '1.5px solid var(--warning)' }}>
            <div className="px-3 py-2 text-xs font-bold" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
              ⚡ 이전 세션 매크로 (복구됨)
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {Object.values(serverJobs).filter(j => !Object.values(trainToJobId).includes(j.id)).map(job => (
                <div key={job.id} className="px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    {job.status === 'running' && <span className="w-1.5 h-1.5 rounded-full pulse-ring flex-shrink-0" style={{ background: 'var(--success)' }} />}
                    <span className="flex-1 truncate" style={{ color: 'var(--text)' }}>
                      {job.carrier} {job.dep}→{job.arr} {job.date.slice(4,6)}/{job.date.slice(6,8)}
                    </span>
                    <span className="font-bold text-[10px] px-1.5 py-0.5 rounded" style={{
                      background: job.status === 'running' ? 'var(--success-soft)' : 'var(--surface-2)',
                      color: job.status === 'running' ? 'var(--success)' : 'var(--text-muted)',
                    }}>
                      {job.status === 'running' ? `${job.attempts}/${job.maxAttempts}회` : job.status === 'success' ? '✅ 성공' : job.status === 'failed' ? '❌ 실패' : '■ 중지'}
                    </span>
                    {job.status === 'running'
                      ? <button onClick={() => void stopServerMacro(job.id)} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: 'var(--danger)', color: '#fff' }}>중지</button>
                      : <button onClick={() => dismissJob(job.id)} className="px-2 py-0.5 rounded text-[10px] font-bold" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>닫기</button>
                    }
                  </div>
                  {job.status === 'running' && job.lastMessage && (
                    <div className="mt-1 truncate" style={{ color: 'var(--text-muted)' }}>{job.nextCheckIn}초 후 · {job.lastMessage}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* === 1. 텔레그램 === */}
        <Section title="📨 텔레그램 알림" subtitle="한 번 등록하면 SRT·KTX 모든 예약 시 자동 발송">
          {telegram?.enabled ? (
            <div className="flex items-center justify-between gap-2 p-3 rounded-xl" style={{ background: 'var(--success-soft)' }}>
              <div className="text-sm">
                <div className="font-bold" style={{ color: 'var(--success)' }}>✓ 연동됨</div>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>Chat ID: {telegram.chatId}</div>
              </div>
              <button onClick={handleClearTelegram} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--danger)' }}>해제</button>
            </div>
          ) : showTelegramForm ? (
            <div className="space-y-2">
              <Input placeholder="봇 토큰 (예: 123456:ABC-...)" value={tgToken} onChange={setTgToken} />
              <Input placeholder="Chat ID (숫자)" value={tgChatId} onChange={setTgChatId} />
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                @BotFather → /newbot → 토큰 받기<br/>
                @userinfobot → Chat ID 확인
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setShowTelegramForm(false); setTgToken(''); setTgChatId(''); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{ background: 'var(--surface-2)', color: 'var(--text)' }}>취소</button>
                <button onClick={handleSaveTelegram} disabled={tgVerifying}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{ background: 'var(--primary)', color: 'var(--primary-text)' }}>
                  {tgVerifying ? '검증 중…' : '저장 + 테스트'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowTelegramForm(true)}
              className="w-full py-3 rounded-xl text-sm font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              + 텔레그램 봇 등록
            </button>
          )}
        </Section>

        {/* === 2. 계정 프로필 === */}
        <Section title="🔑 계정" subtitle="브라우저에만 저장 (서버 미저장)" right={
          <button onClick={() => setShowAddProfile(!showAddProfile)} className="text-xs font-bold" style={{ color: 'var(--accent)' }}>
            {showAddProfile ? '취소' : '+ 추가'}
          </button>
        }>
          {profiles.length === 0 && !showAddProfile && (
            <p className="text-xs py-2" style={{ color: 'var(--text-soft)' }}>먼저 KTX 또는 SRT 계정을 추가하세요</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {profiles.map(p => {
              const active = activeProfileId === p.id;
              const isKtx = p.carrier === 'KTX';
              return (
                <button key={p.id} onClick={() => handleSelectProfile(p)}
                  className="text-left p-2.5 rounded-xl border-2 relative transition hover:scale-[0.98]"
                  style={{ borderColor: active ? (isKtx ? 'var(--ktx)' : 'var(--srt)') : 'var(--border)', background: active ? (isKtx ? 'var(--ktx-soft)' : 'var(--srt-soft)') : 'var(--surface)' }}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: isKtx ? 'var(--ktx)' : 'var(--srt)', color: '#fff' }}>{p.carrier}</span>
                    {active && <span className="ml-auto text-xs" style={{ color: 'var(--success)' }}>●</span>}
                  </div>
                  <div className="font-bold text-sm truncate" style={{ color: 'var(--text)' }}>{p.label}</div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{p.credential}</div>
                  <span onClick={(e) => { e.stopPropagation(); handleDeleteProfile(p.id); }}
                    className="absolute -top-1.5 -right-1.5 text-[10px] w-5 h-5 rounded-full flex items-center justify-center cursor-pointer hover:scale-110 transition"
                    style={{ background: 'var(--surface-2)', color: 'var(--text-soft)' }}>✕</span>
                </button>
              );
            })}
          </div>
          {showAddProfile && (
            <div className="mt-3 space-y-2 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => setNpCarrier('SRT')} className="py-2 rounded-lg text-xs font-bold transition"
                  style={{ background: npCarrier === 'SRT' ? 'var(--srt)' : 'var(--surface-2)', color: npCarrier === 'SRT' ? '#fff' : 'var(--text-muted)' }}>SRT</button>
                <button onClick={() => setNpCarrier('KTX')} className="py-2 rounded-lg text-xs font-bold transition"
                  style={{ background: npCarrier === 'KTX' ? 'var(--ktx)' : 'var(--surface-2)', color: npCarrier === 'KTX' ? '#fff' : 'var(--text-muted)' }}>KTX</button>
              </div>
              <Input placeholder="별칭 (예: 본인)" value={npLabel} onChange={setNpLabel} />
              <Input placeholder="회원번호 / 이메일 / 전화번호" value={npCred} onChange={setNpCred} />
              <Input placeholder="비밀번호" value={npPw} onChange={setNpPw} type="password" />
              <button onClick={handleAddProfile}
                className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: 'var(--primary)', color: 'var(--primary-text)' }}>저장</button>
            </div>
          )}
        </Section>

        {/* === 3. 검색 === */}
        <Section title="🔍 조회 조건">
          <div className="flex gap-1.5 p-1 rounded-xl mb-3" style={{ background: 'var(--surface-2)' }}>
            <button onClick={() => setCarrier('SRT')} className="flex-1 py-2 rounded-lg text-sm font-bold transition"
              style={{ background: carrier === 'SRT' ? 'var(--surface)' : 'transparent', color: carrier === 'SRT' ? 'var(--srt)' : 'var(--text-muted)', boxShadow: carrier === 'SRT' ? 'var(--shadow)' : 'none' }}>SRT</button>
            <button onClick={() => setCarrier('KTX')} className="flex-1 py-2 rounded-lg text-sm font-bold transition"
              style={{ background: carrier === 'KTX' ? 'var(--surface)' : 'transparent', color: carrier === 'KTX' ? 'var(--ktx)' : 'var(--text-muted)', boxShadow: carrier === 'KTX' ? 'var(--shadow)' : 'none' }}>KTX</button>
          </div>

          <div className="relative grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label>출발</Label>
              <Select value={dep} onChange={setDep} options={stations} large />
            </div>
            <div>
              <Label>도착</Label>
              <Select value={arr} onChange={setArr} options={stations} large />
            </div>
            <button onClick={swapStations}
              className="absolute top-7 left-1/2 -translate-x-1/2 -translate-y-1 w-9 h-9 rounded-full flex items-center justify-center z-10 hover:rotate-180 transition-transform duration-300"
              style={{ background: 'var(--surface)', border: '2px solid var(--border)', color: 'var(--text-muted)', boxShadow: 'var(--shadow)' }}>⇄</button>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label>날짜</Label>
              <input type="date" value={dateInputValue(date)} onChange={e => setDate(dateInputToYMD(e.target.value))}
                className="w-full mt-0.5 px-3 py-2.5 rounded-xl text-sm font-bold focus:outline-none"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <div>
              <Label>출발 시간 이후</Label>
              <Select value={time} onChange={setTime}
                options={Array.from({length:24}, (_, h) => `${pad(h)}0000`)}
                renderOption={t => `${t.slice(0,2)}:00 이후`} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl px-3 py-2.5 mb-3" style={{ background: 'var(--surface-2)' }}>
            <div>
              <div className="text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>인원</div>
              <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>어른 {psg}명</div>
            </div>
            <div className="flex items-center gap-2">
              <PsgBtn onClick={() => setPsg(Math.max(1, psg-1))} disabled={psg<=1}>−</PsgBtn>
              <span className="w-6 text-center font-bold" style={{ color: 'var(--text)' }}>{psg}</span>
              <PsgBtn onClick={() => setPsg(Math.min(9, psg+1))} disabled={psg>=9}>+</PsgBtn>
            </div>
          </div>

          <Select value={seatPref} onChange={(v) => setSeatPref(v as SeatPref)}
            options={['GENERAL_FIRST','SPECIAL_FIRST','GENERAL_ONLY','SPECIAL_ONLY']}
            renderOption={v => ({
              GENERAL_FIRST: '일반실 우선 (특실 fallback)',
              SPECIAL_FIRST: '특실 우선 (일반 fallback)',
              GENERAL_ONLY:  '일반실만',
              SPECIAL_ONLY:  '특실만',
            } as Record<string, string>)[v]} />

          <button onClick={handleSearch} disabled={searching}
            className="w-full py-3.5 rounded-2xl font-black text-base shadow-md transition mt-3 disabled:opacity-50 hover:scale-[0.98]"
            style={{ background: carrier === 'KTX' ? 'var(--ktx)' : 'var(--srt)', color: '#fff' }}>
            {searching ? '⏳ 조회 중…' : `🔍 ${carrier} 열차 조회`}
          </button>
        </Section>

        {/* 매크로 설정 (결과 있을 때만) */}
        {trains.length > 0 && soldoutTrains.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <button
              onClick={() => setShowMacroSettings(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              <span className="font-bold">⚙️ 매크로 설정 — 간격 {macroIntervalSec}초 · 최대 {macroMaxAttempts === 9999 ? '무제한' : `${macroMaxAttempts}회`}</span>
              <span>{showMacroSettings ? '▲' : '▼'}</span>
            </button>
            {showMacroSettings && (
              <div className="px-3 pb-3 grid grid-cols-2 gap-2" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="pt-2">
                  <Label>간격 (±20% 지터)</Label>
                  <Select value={String(macroIntervalSec)} onChange={(v) => setMacroIntervalSec(parseInt(v))}
                    options={['10','15','20','30','60']}
                    renderOption={v => ({ '10':'10초 (위험)', '15':'15초 (권장)', '20':'20초 (안전)', '30':'30초 (최안전)', '60':'60초' } as Record<string,string>)[v]} />
                </div>
                <div className="pt-2">
                  <Label>최대 시도</Label>
                  <Select value={String(macroMaxAttempts)} onChange={(v) => setMacroMaxAttempts(parseInt(v))}
                    options={['60','120','240','720','9999']}
                    renderOption={v => ({ '60':'60회(15분)','120':'120회(30분)','240':'240회(1시간)','720':'720회(3시간)','9999':'무제한' } as Record<string,string>)[v]} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 결과 목록 */}
        {trains.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between px-2">
              <h2 className="font-bold text-sm" style={{ color: 'var(--text)' }}>조회 결과</h2>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{trains.length}건 · 매진 {soldoutTrains.length}</span>
            </div>
            {trains.map(t => {
              const canReserve = t.general === 'AVAILABLE' || t.special === 'AVAILABLE';
              const reservingThis = reservingId === t.id;
              const isKtx = t.carrier === 'KTX';
              const trainJob = getTrainJob(t.id);
              const jobRunning = trainJob?.status === 'running';
              const jobDone = trainJob?.status === 'success';
              const jobStopped = trainJob && (trainJob.status === 'failed' || trainJob.status === 'stopped');

              return (
                <div key={t.id} className="rounded-2xl p-3 transition"
                  style={{
                    background: 'var(--surface)',
                    boxShadow: 'var(--shadow)',
                    outline: jobRunning ? '2px solid var(--success)' : jobDone ? '2px solid var(--success)' : 'none',
                  }}>
                  {/* 열차 정보 행 */}
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded" style={{ background: isKtx ? 'var(--ktx)' : 'var(--srt)', color: '#fff' }}>{t.trainTypeName}</span>
                        <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>{t.trainNo}호</span>
                        {jobRunning && <span className="w-1.5 h-1.5 rounded-full pulse-ring flex-shrink-0" style={{ background: 'var(--success)' }} />}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.depName} → {t.arrName}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-mono font-black text-base leading-none" style={{ color: 'var(--text)' }}>{fmtHM(t.depTime)}</div>
                      <div className="font-mono text-xs mt-0.5" style={{ color: 'var(--text-soft)' }}>→ {fmtHM(t.arrTime)}</div>
                    </div>
                  </div>

                  {/* 좌석 + 액션 행 */}
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <SeatChip kind={t.general}>{t.general === 'AVAILABLE' ? '일반⭕' : t.general === 'WAITING' ? '일반대기' : '일반❌'}</SeatChip>
                    <SeatChip kind={t.special}>{t.special === 'AVAILABLE' ? '특실⭕' : t.special === 'NONE' ? '특실-' : '특실❌'}</SeatChip>

                    {canReserve ? (
                      <button onClick={() => handleReserve(t)} disabled={reservingId !== null}
                        className="ml-auto text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-30 hover:scale-95 transition"
                        style={{ background: isKtx ? 'var(--ktx)' : 'var(--srt)', color: '#fff' }}>
                        {reservingThis ? '예약중…' : '예약'}
                      </button>
                    ) : jobRunning ? (
                      /* 매크로 실행 중 */
                      <div className="ml-auto flex items-center gap-1.5">
                        <span style={{ color: 'var(--success)' }}>🔄 {trainJob.attempts}/{trainJob.maxAttempts}</span>
                        <button onClick={() => void stopServerMacro(trainJob.id)}
                          className="px-2 py-1 rounded font-bold text-[10px]" style={{ background: 'var(--danger)', color: '#fff' }}>
                          중지
                        </button>
                      </div>
                    ) : jobDone ? (
                      /* 성공 */
                      <span className="ml-auto font-bold" style={{ color: 'var(--success)' }}>✅ 예약됨</span>
                    ) : jobStopped ? (
                      /* 중지/실패 → 재시작 버튼 */
                      <div className="ml-auto flex items-center gap-1.5">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{trainJob.status === 'failed' ? '❌ 실패' : '■ 중지'}</span>
                        <button onClick={() => void startMacroForTrain(t)} disabled={!activeProfile}
                          className="px-2 py-1 rounded font-bold text-[10px] disabled:opacity-40" style={{ background: 'var(--warning)', color: '#fff' }}>
                          재시작
                        </button>
                      </div>
                    ) : (
                      /* 매크로 시작 버튼 */
                      <button onClick={() => void startMacroForTrain(t)} disabled={!activeProfile || !unlockedPw}
                        className="ml-auto text-xs font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-40 hover:scale-95 transition"
                        style={{ background: 'var(--warning)', color: '#fff' }}>
                        ⚡ 매크로
                      </button>
                    )}
                  </div>

                  {/* 매크로 실행 중 상태 메시지 */}
                  {jobRunning && trainJob.lastMessage && (
                    <div className="mt-2 text-[10px] px-2 py-1 rounded-lg truncate" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                      {trainJob.nextCheckIn}초 후 재시도 · {trainJob.lastMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {!searching && trains.length === 0 && !success && (
          <div className="text-center py-10" style={{ color: 'var(--text-soft)' }}>
            <div className="text-5xl mb-2">🚄</div>
            <div className="text-xs">출발/도착역 · 날짜 · 시간 선택 후 조회</div>
            <div className="text-[10px] mt-2">매진 열차도 ⚡ 매크로로 자동 예약 가능</div>
          </div>
        )}

        <footer className="text-center pt-4 pb-2 text-[10px]" style={{ color: 'var(--text-soft)' }}>
          🚆 RailPick · 본인 명의 본인 표 예매에 한함
        </footer>
      </main>
    </div>
  );
}

// ===== Reusable components =====
function Alert({ kind, children, onClose }: { kind: 'error'|'info'|'warning'; children: React.ReactNode; onClose: () => void }) {
  const map = { error: { bg: 'var(--danger-soft)', fg: 'var(--danger)' }, info: { bg: 'var(--accent-soft)', fg: 'var(--accent)' }, warning: { bg: 'var(--warning-soft)', fg: 'var(--warning)' } };
  return (
    <div className="rounded-xl px-3 py-2.5 flex justify-between gap-2 text-sm" style={{ background: map[kind].bg, color: map[kind].fg }}>
      <span className="break-all">{children}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

function Section({ title, subtitle, right, children }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl p-3" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }}>
      <div className="flex items-center justify-between mb-2 px-1">
        <div>
          <h2 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{title}</h2>
          {subtitle && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-bold px-1" style={{ color: 'var(--text-muted)' }}>{children}</div>;
}

function Input({ placeholder, value, onChange, type = 'text' }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <input type={type} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2.5 rounded-xl text-sm focus:outline-none transition"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')} />
  );
}

function Select({ value, onChange, options, renderOption, large }: { value: string; onChange: (v: string) => void; options: string[]; renderOption?: (v: string) => string; large?: boolean }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`w-full mt-0.5 px-3 ${large ? 'py-2.5 text-base font-bold' : 'py-2 text-sm'} rounded-xl focus:outline-none`}
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
      {options.map(o => <option key={o} value={o}>{renderOption ? renderOption(o) : o}</option>)}
    </select>
  );
}

function PsgBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="w-9 h-9 rounded-full font-black disabled:opacity-30 transition hover:scale-110 active:scale-95"
      style={{ background: 'var(--surface)', border: '2px solid var(--border)', color: 'var(--text)' }}>
      {children}
    </button>
  );
}

function SeatChip({ kind, children }: { kind: 'AVAILABLE'|'SOLDOUT'|'WAITING'|'NONE'; children: React.ReactNode }) {
  const map = {
    AVAILABLE: { bg: 'var(--success-soft)', fg: 'var(--success)' },
    SOLDOUT:   { bg: 'var(--surface-2)',   fg: 'var(--text-soft)' },
    WAITING:   { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
    NONE:      { bg: 'var(--surface-2)',   fg: 'var(--text-soft)' },
  };
  return <span className="px-2 py-1 rounded-md font-medium" style={{ background: map[kind].bg, color: map[kind].fg }}>{children}</span>;
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-bold" style={{ color: highlight ? 'var(--accent)' : 'var(--text)' }}>{value}</span>
    </div>
  );
}
