'use client';
/**
 * 클라이언트 측 로컬 스토리지
 * - Profile (SRT/KTX 계정) — 단순 난독화로 저장
 * - Telegram 설정 — 한 번 입력 후 SRT/KTX 모두 공유
 * - Theme — 2026 컬러 트렌드 옵션
 */
import type { Carrier } from './types';

const PROFILE_KEY = 'rail-profiles-v2';
const TELEGRAM_KEY = 'rail-telegram-v1';
const THEME_KEY = 'rail-theme-v1';

// === Profile ===
export interface Profile {
  id: string;
  carrier: Carrier;
  label: string;
  credential: string;
  password: string; // 단순 난독화 (XOR + base64)
  createdAt: number;
}

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function obfuscate(text: string): string {
  const seed = 0x5a;
  const out = Array.from(text).map((ch, i) =>
    String.fromCharCode(ch.charCodeAt(0) ^ (seed + (i % 7)))
  );
  return btoa(unescape(encodeURIComponent(out.join(''))));
}
function deobfuscate(b64: string): string {
  const txt = decodeURIComponent(escape(atob(b64)));
  const seed = 0x5a;
  return Array.from(txt)
    .map((ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ (seed + (i % 7))))
    .join('');
}

export function loadProfiles(): Profile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile[]) : [];
  } catch { return []; }
}

export function saveProfiles(profiles: Profile[]) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles));
}

export function addProfile(opts: {
  carrier: Carrier;
  label: string;
  credential: string;
  password: string;
}): Profile {
  const p: Profile = {
    id: uuid(),
    carrier: opts.carrier,
    label: opts.label,
    credential: opts.credential,
    password: obfuscate(opts.password),
    createdAt: Date.now(),
  };
  const profiles = loadProfiles();
  profiles.push(p);
  saveProfiles(profiles);
  return p;
}

export function getDecryptedPassword(p: Profile): string {
  return deobfuscate(p.password);
}

export function deleteProfile(id: string) {
  saveProfiles(loadProfiles().filter(p => p.id !== id));
}

// === Telegram ===
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
}

export function loadTelegram(): TelegramConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(TELEGRAM_KEY);
    return raw ? (JSON.parse(raw) as TelegramConfig) : null;
  } catch { return null; }
}

export function saveTelegram(cfg: TelegramConfig) {
  localStorage.setItem(TELEGRAM_KEY, JSON.stringify(cfg));
}

export function clearTelegram() {
  localStorage.removeItem(TELEGRAM_KEY);
}

// === Theme ===
export type ThemeName = 'light' | 'mocha' | 'dusk' | 'cherry';

export const THEMES: Array<{ id: ThemeName; name: string; emoji: string; desc: string }> = [
  { id: 'light',  name: '기본',         emoji: '☀️', desc: '깔끔한 흰색' },
  { id: 'mocha',  name: 'Mocha 2026',   emoji: '☕', desc: 'Pantone 따뜻한 갈색' },
  { id: 'dusk',   name: 'Future Dusk',  emoji: '🌙', desc: '다크 + 보라 (WGSN)' },
  { id: 'cherry', name: 'Cherry Lacquer', emoji: '🍒', desc: '강렬한 적색 액센트' },
];

export function loadTheme(): ThemeName {
  if (typeof window === 'undefined') return 'light';
  const raw = localStorage.getItem(THEME_KEY);
  return (raw === 'mocha' || raw === 'dusk' || raw === 'cherry' || raw === 'light')
    ? raw
    : 'light';
}

export function saveTheme(t: ThemeName) {
  localStorage.setItem(THEME_KEY, t);
}
