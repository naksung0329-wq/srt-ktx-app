/**
 * 서버 메모리에 인증된 SrtClient/KtxClient 인스턴스를 캐시.
 * 매크로 폴링 시 매번 새 로그인하지 않도록 같은 인스턴스를 재사용.
 *
 * - sessionId는 fetch-then-cache 키 (자격증명 hash 기반)
 * - TTL 25분 (SRT 세션 30분 만료보다 짧게)
 * - 자격증명 평문은 메모리에만, 디스크 미저장
 *
 * 주의: 단일 Node.js 프로세스 가정 (사용자 PC dev/start). Vercel 같은 멀티 인스턴스 환경에서는 부적합.
 */
import crypto from 'node:crypto';
import { SrtClient } from './srt-client';
import { KtxClient } from './ktx-client';
import type { Carrier } from './types';

type Client = SrtClient | KtxClient;

interface PoolEntry {
  client: Client;
  carrier: Carrier;
  credential: string;
  createdAt: number;
  lastUsedAt: number;
}

const POOL = new Map<string, PoolEntry>();
const TTL_MS = 25 * 60 * 1000; // 25분

function key(carrier: Carrier, credential: string, password: string): string {
  // 비밀번호도 키에 포함 → 비번 바뀐 경우 새 클라이언트
  return crypto.createHash('sha256').update(`${carrier}|${credential}|${password}`).digest('hex').slice(0, 32);
}

function evictExpired() {
  const now = Date.now();
  for (const [k, v] of POOL.entries()) {
    if (now - v.lastUsedAt > TTL_MS) POOL.delete(k);
  }
}

export interface GetOptions {
  carrier: Carrier;
  credential: string;
  password: string;
  /** force re-login even if cached */
  refresh?: boolean;
}

/**
 * 캐시된 client 가져오거나 없으면 새로 만들어 login한 후 반환.
 * 한 번 호출 후에는 매크로 동안 같은 client 재사용 가능.
 */
export async function getOrCreateClient(opts: GetOptions): Promise<Client> {
  evictExpired();
  const k = key(opts.carrier, opts.credential, opts.password);

  if (!opts.refresh) {
    const existing = POOL.get(k);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.client;
    }
  }

  // 새 client 생성 + 로그인
  const client: Client = opts.carrier === 'SRT' ? new SrtClient() : new KtxClient();
  await client.login(opts.credential, opts.password);

  const entry: PoolEntry = {
    client,
    carrier: opts.carrier,
    credential: opts.credential,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  };
  POOL.set(k, entry);
  return client;
}

export function poolStats() {
  evictExpired();
  return {
    size: POOL.size,
    entries: Array.from(POOL.values()).map(v => ({
      carrier: v.carrier,
      credential: v.credential.replace(/.(?=.{4})/g, '*'),
      ageSec: Math.round((Date.now() - v.createdAt) / 1000),
      idleSec: Math.round((Date.now() - v.lastUsedAt) / 1000),
    })),
  };
}

/** 명시적 invalidate — 로그아웃이나 만료 감지 시 */
export function invalidate(carrier: Carrier, credential: string, password: string) {
  POOL.delete(key(carrier, credential, password));
}
