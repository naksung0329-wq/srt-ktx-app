/**
 * KORAIL Dynapath anti-bot bypass
 *
 * KORAIL Talk 모바일 API는 민감한 endpoint에 다음을 요구함:
 *  - `x-dynapath-m-token` 헤더 (DynaPathMasterEngine으로 생성)
 *  - `Sid` payload 필드 (AES-128-CBC로 timestamp 암호화)
 *
 * 이게 없으면 "MACRO ERROR" 응답.
 *
 * 알고리즘은 nomadamas/k-skill (MIT) 기반 — Chihun-Lee/ktx-macro의 ktx_korail.py 참고.
 * Python → TypeScript 포팅.
 */
import crypto from 'node:crypto';

export const DYNAPATH_PATHS = [
  '/classes/com.korail.mobile.certification.TicketReservation',
  '/classes/com.korail.mobile.nonMember.NonMemTicket',
  '/classes/com.korail.mobile.seatMovie.ScheduleView',
  '/classes/com.korail.mobile.seatMovie.ScheduleViewSpecial',
  '/classes/com.korail.mobile.trn.prcFare.do',
  '/classes/com.korail.mobile.login.Login',
  '/classes/com.korail.mobile.payment.ReservationPayment',
];

export const DYNAPATH_USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 13; SM-S928N Build/UP1A.231005.007)';
export const DYNAPATH_VERSION = '250601002';
export const DYNAPATH_DEVICE_ID = '558a4f02041657ea';

const SID_KEY = Buffer.from('2485dd54d9deaa36', 'utf-8'); // 16 bytes

/** Sid 생성 — `AD{timestamp}`를 AES-128-CBC로 암호화 + base64 + "\n" suffix */
export function generateSid(timestampMs: number): string {
  const plaintext = `AD${timestampMs}`;
  const cipher = crypto.createCipheriv('aes-128-cbc', SID_KEY, SID_KEY);
  cipher.setAutoPadding(true);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  return ct.toString('base64') + '\n';
}

export class DynaPathMasterEngine {
  static APP_ID = 'com.korail.talk';
  static AS_VALUE = '%5B38ff229cb34c7dda8e28220a2d750cce%5D';
  static DEVICE_MODEL = 'SM-S928N';
  static OS_TYPE = 'Android';
  static SDK_VERSION = 'v1';

  private table = '3FE9jgRD4KdCyuawklqGJYmvfMn15P7US8XbxeLQtWT6OicBAopINs2Vh0HZrz';
  private i8 = 161;
  private i9 = 30;
  private i10 = 2;
  private appStartTs = String(Date.now());

  /** UTF-8과 유사한 커스텀 변환 */
  private string2xa1s(data: string): number[] {
    const result: number[] = [];
    let idx = 0;
    while (idx < data.length) {
      const cp = data.charCodeAt(idx); idx += 1;
      if (cp < 128) {
        result.push(cp);
      } else if (cp < 2048) {
        result.push(128 | ((cp >> 7) & 15));
        result.push(cp & 127);
      } else if (cp >= 262144) {
        result.push(160);
        result.push((cp >> 14) & 127);
        result.push((cp >> 7) & 127);
        result.push(cp & 127);
      } else if ((63488 & cp) !== 55296) {
        result.push(((cp >> 14) & 15) | 144);
        result.push((cp >> 7) & 127);
        result.push(cp & 127);
      }
    }
    return result;
  }

  /** key string → BigInt (큰 정수가 필요해서 BigInt 사용) */
  private makeKey(key: string): bigint {
    let total = 0n;
    for (const char of key) {
      const cp = char.charCodeAt(0);
      let bit = 32768;
      for (let _ = 0; _ < 16; _++) {
        if ((bit & cp) !== 0) break;
        bit >>= 1;
      }
      total = total * BigInt(bit << 1) + BigInt(cp);
    }
    return total;
  }

  private internalChar(baseTable: string, remainder: number, current: string): string {
    let seen = 0;
    for (const ch of baseTable) {
      if (current.includes(ch)) continue;
      if (seen === remainder) return ch;
      seen += 1;
    }
    return ' ';
  }

  private makeEncodeTable(number: bigint, encodeSize: number, baseTable: string): string {
    let chars = '';
    let temp = number;
    for (let index = 0; index < encodeSize; index++) {
      const divisor = BigInt(encodeSize - index);
      const remainder = Number(temp % divisor);
      chars += this.internalChar(baseTable, remainder, chars);
      temp = temp / divisor;
    }
    return chars;
  }

  private encodeNormalBe(data: string, table: string): string {
    const values = this.string2xa1s(data);
    const output: string[] = [];
    const digits: number[] = new Array(this.i10 + 1).fill(0);
    let idx = 0;
    let tail = values.length % this.i10;
    const bodySize = values.length - tail;

    while (idx < bodySize) {
      let value = 0;
      for (let _ = 0; _ < this.i10; _++) {
        value = value * this.i8 + values[idx]; idx += 1;
      }
      for (let di = 0; di < this.i10 + 1; di++) {
        digits[di] = value % this.i9;
        value = Math.floor(value / this.i9);
      }
      for (let di = this.i10; di >= 0; di--) {
        output.push(table[digits[di]]);
      }
    }
    if (tail > 0) {
      let value = 0;
      for (let _ = 0; _ < tail; _++) {
        value = value * this.i8 + values[idx]; idx += 1;
      }
      for (let di = 0; di < tail + 1; di++) {
        digits[di] = value % this.i9;
        value = Math.floor(value / this.i9);
      }
      while (tail >= 0) {
        output.push(table[digits[tail]]);
        tail -= 1;
      }
    }
    return output.join('');
  }

  /** 헤더에 들어갈 token 생성 */
  generateToken(deviceId: string, timestampMs: number, nonce: string): string {
    const plaintext =
      `ai=${DynaPathMasterEngine.APP_ID}&di=${deviceId}&as=${DynaPathMasterEngine.AS_VALUE}` +
      `&su=false&dbg=false&emu=false&hk=false&it=${this.appStartTs}&ts=${timestampMs}` +
      `&rt=0&os=13&dm=${DynaPathMasterEngine.DEVICE_MODEL}` +
      `&st=${DynaPathMasterEngine.OS_TYPE}&sv=${DynaPathMasterEngine.SDK_VERSION}`;

    const dynKey = `v1+${nonce}+${timestampMs}`;
    const keyEncoded = this.encodeNormalBe(dynKey, this.table);
    const encodeTable = this.makeEncodeTable(this.makeKey(dynKey), this.i9, this.table);
    const bodyEncoded = this.encodeNormalBe(plaintext, encodeTable);
    return `bEeEP${this.table[keyEncoded.length]}${keyEncoded}${bodyEncoded}`;
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 4자리 랜덤 nonce */
export function generateNonce(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** URL이 Dynapath endpoint인지 확인 */
export function isDynapathPath(url: string): boolean {
  return DYNAPATH_PATHS.some(p => url.includes(p));
}

/** 단일 인스턴스 — token 생성 */
const engine = new DynaPathMasterEngine();
export function getDynapathToken(timestampMs: number, nonce: string): string {
  return engine.generateToken(DYNAPATH_DEVICE_ID, timestampMs, nonce);
}
