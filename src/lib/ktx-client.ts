/**
 * KTX(코레일 톡) 모바일 앱 API 클라이언트
 * carpedm20/korail2 (Python) 흐름을 TS로 포팅
 *
 * 비밀번호는 AES-128-CBC로 암호화 후 base64를 두 번 적용해서 전송한다.
 */
import crypto from 'node:crypto';
import { Train, Reservation } from './types';
import {
  DYNAPATH_USER_AGENT,
  DYNAPATH_VERSION,
  isDynapathPath,
  generateSid,
  generateNonce,
  getDynapathToken,
} from './dynapath';

const KORAIL_DOMAIN = 'https://smart.letskorail.com:443';
const KORAIL_MOBILE = `${KORAIL_DOMAIN}/classes/com.korail.mobile`;

const ENDPOINTS = {
  login: `${KORAIL_MOBILE}.login.Login`,
  logout: `${KORAIL_MOBILE}.common.logout`,
  search: `${KORAIL_MOBILE}.seatMovie.ScheduleView`,
  reserve: `${KORAIL_MOBILE}.certification.TicketReservation`,
  myReservations: `${KORAIL_MOBILE}.reservation.ReservationView`,
  cancel: `${KORAIL_MOBILE}.reservationCancel.ReservationCancelChk`,
  code: `${KORAIL_MOBILE}.common.code.do`,
};

// 최신 Galaxy S24 Ultra Android 13 — Dynapath device profile과 일치 필수
const USER_AGENT = DYNAPATH_USER_AGENT;

const EMAIL_RE = /[^@]+@[^@]+\.[^@]+/;
const PHONE_RE = /^\d{3}-?\d{3,4}-?\d{4}$/;

const TRAIN_TYPE_NAME: Record<string, string> = {
  '00': 'KTX', '01': '새마을호', '02': '무궁화호', '03': '통근열차',
  '04': '누리로', '07': 'KTX-산천', '08': 'ITX-새마을', '09': 'ITX-청춘',
};

function extractCookies(setCookieHeaders: string[] | undefined, jar: Record<string, string>) {
  if (!setCookieHeaders) return;
  for (const sc of setCookieHeaders) {
    const [pair] = sc.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}
function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

export class KtxClient {
  private cookieJar: Record<string, string> = {};
  private device = 'AD';
  // Dynapath bypass 버전 통일 (Chihun-Lee/ktx-macro)
  private version = DYNAPATH_VERSION;
  private key = 'korail1234567890';
  private idx: string | null = null;
  isLoggedIn = false;
  membershipNumber: string | null = null;
  customerName: string | null = null;
  email: string | null = null;

  private async req(url: string, params: Record<string, string | number>, method: 'GET' | 'POST' = 'POST') {
    // Dynapath 주입 — 민감 endpoint에는 token 헤더 + Sid payload 필수
    const finalParams: Record<string, string | number> = { ...params };
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': '*/*',
      'Accept-Encoding': 'gzip',
      'Connection': 'Keep-Alive',
      'Host': 'smart.letskorail.com',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    };
    if (isDynapathPath(url)) {
      const ts = Date.now();
      const nonce = generateNonce();
      headers['x-dynapath-m-token'] = getDynapathToken(ts, nonce);
      finalParams.Sid = generateSid(ts);
    }
    const qs = new URLSearchParams(
      Object.entries(finalParams).map(([k, v]) => [k, String(v)])
    ).toString();
    const cookies = cookieHeader(this.cookieJar);
    if (cookies) headers['Cookie'] = cookies;
    if (process.env.KTX_DEBUG === '1') {
      console.log(`[KTX ${method}] ${url}`);
      console.log(`  Dynapath: ${isDynapathPath(url) ? 'YES' : 'no'}`);
      console.log(`  body: ${qs.slice(0, 300)}`);
    }

    let res: Response;
    if (method === 'GET') {
      res = await fetch(`${url}?${qs}`, { method: 'GET', headers });
    } else {
      res = await fetch(url, { method: 'POST', headers, body: qs });
    }
    // Node 18.14+의 getSetCookie() 사용해 multiple set-cookie 정확히 파싱
    const setCookies: string[] =
      typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : (() => {
            const out: string[] = [];
            res.headers.forEach((v, k) => { if (k.toLowerCase() === 'set-cookie') out.push(v); });
            return out;
          })();
    extractCookies(setCookies, this.cookieJar);
    const text = await res.text();
    return { status: res.status, text };
  }

  private async fetchEncryptionKey(): Promise<{ key: string; idx: string }> {
    const { text } = await this.req(ENDPOINTS.code, { code: 'app.login.cphd' });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch {
      throw new Error('KTX 암호화 키 응답 파싱 실패');
    }
    if (parsed.strResult !== 'SUCC') throw new Error('KTX 암호화 키 발급 실패');
    const cphd = parsed['app.login.cphd'] as { idx: string; key: string } | undefined;
    if (!cphd) throw new Error('KTX 암호화 키 응답 형식 오류');
    return { key: cphd.key, idx: cphd.idx };
  }

  private encryptPassword(password: string, aesKey: string): string {
    // KORAIL은 32바이트 키 반환 → AES-256-CBC 사용 (carpedm20/korail2와 동일)
    // IV는 키의 처음 16바이트
    const keyBuf = Buffer.from(aesKey, 'utf-8'); // 전체 사용 (16 또는 32 byte 자동 결정)
    const ivBuf = Buffer.from(aesKey.substring(0, 16), 'utf-8');
    const algorithm = keyBuf.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc';
    const cipher = crypto.createCipheriv(algorithm, keyBuf, ivBuf);
    cipher.setAutoPadding(true);
    const encrypted = Buffer.concat([cipher.update(password, 'utf-8'), cipher.final()]);
    // base64 두 번 인코딩 (carpedm20과 동일)
    const b64 = encrypted.toString('base64');
    return Buffer.from(b64, 'utf-8').toString('base64');
  }

  async login(idOrEmailOrPhone: string, password: string): Promise<void> {
    const id = idOrEmailOrPhone;
    let txtInputFlg = '2';
    if (EMAIL_RE.test(id)) txtInputFlg = '5';
    else if (PHONE_RE.test(id)) txtInputFlg = '4';

    const { key: aesKey, idx } = await this.fetchEncryptionKey();
    this.idx = idx;
    const encPw = this.encryptPassword(password, aesKey);

    const { text } = await this.req(ENDPOINTS.login, {
      Device: this.device,
      Version: this.version, // HACK: login은 새 버전 (anti-bot 우회)
      txtInputFlg,
      txtMemberNo: id.replace(/-/g, ''),
      txtPwd: encPw,
      idx,
    });

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch {
      throw new Error('KTX 로그인 응답 파싱 실패');
    }

    if (parsed.strResult !== 'SUCC' || !parsed.strMbCrdNo) {
      const code = parsed.h_msg_cd as string;
      const msg = (parsed.h_msg_txt as string) || code || 'KTX 로그인 실패';
      // KORAIL anti-bot: IP 차단을 명확히 보고
      if (code === 'MACRO ERROR' || msg.includes('원활한 서비스')) {
        const err = new Error('KORAIL이 IP를 차단했습니다 (매크로 의심). 1~3시간 후 재시도하거나 다른 IP(모바일 핫스팟, VPN)에서 시도하세요.');
        (err as Error & { code?: string }).code = 'IP_BLOCKED';
        throw err;
      }
      throw new Error(msg);
    }
    this.key = String(parsed.Key);
    this.membershipNumber = String(parsed.strMbCrdNo);
    this.customerName = (parsed.strCustNm as string) || null;
    this.email = (parsed.strEmailAdr as string) || null;
    this.isLoggedIn = true;
  }

  async searchTrains(opts: {
    dep: string; arr: string; date: string; time: string; passengers: number;
    trainType?: '00' | '07' | '109';
  }): Promise<Train[]> {
    const trainType = opts.trainType || '109';
    const { text } = await this.req(ENDPOINTS.search, {
      Device: this.device, Version: this.version, // search는 기본 버전 (190617001)
      radJobId: '1', selGoTrain: trainType,
      txtCardPsgCnt: '0', txtGdNo: '',
      txtGoAbrdDt: opts.date, txtGoEnd: opts.arr,
      txtGoHour: opts.time, txtGoStart: opts.dep,
      txtJobDv: '', txtMenuId: '11',
      txtPsgFlg_1: opts.passengers, txtPsgFlg_2: '0',
      txtPsgFlg_8: '0', txtPsgFlg_3: '0',
      txtPsgFlg_4: '0', txtPsgFlg_5: '0',
      txtSeatAttCd_2: '000', txtSeatAttCd_3: '000', txtSeatAttCd_4: '015',
      txtTrnGpCd: trainType,
    }, 'GET');
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch {
      throw new Error('KTX 검색 응답 파싱 실패');
    }
    if (parsed.strResult !== 'SUCC') {
      const code = parsed.h_msg_cd as string;
      if (['P100', 'WRG000000', 'WRD000061', 'WRT300005'].includes(code)) return [];
      const msg = (parsed.h_msg_txt as string) || code || 'KTX 검색 실패';
      if (code === 'MACRO ERROR' || msg.includes('원활한 서비스')) {
        const err = new Error('KORAIL이 IP를 차단했습니다 (매크로 의심). 1~3시간 후 재시도 또는 다른 IP에서 시도');
        (err as Error & { code?: string }).code = 'IP_BLOCKED';
        throw err;
      }
      throw new Error(msg);
    }

    const trnInfos = (parsed.trn_infos as { trn_info?: Array<Record<string, string>> })?.trn_info || [];
    return trnInfos.map((info): Train => {
      const trainTypeCode = info.h_trn_clsf_cd;
      return {
        id: `KTX-${info.h_trn_no}-${info.h_dpt_dt}-${info.h_dpt_tm}`,
        carrier: 'KTX',
        trainTypeName: TRAIN_TYPE_NAME[trainTypeCode] || info.h_trn_clsf_nm || '열차',
        trainNo: info.h_trn_no,
        trainTypeCode,
        trainGroup: info.h_trn_gp_cd,
        depName: info.h_dpt_rs_stn_nm,
        arrName: info.h_arv_rs_stn_nm,
        depCode: info.h_dpt_rs_stn_cd,
        arrCode: info.h_arv_rs_stn_cd,
        depDate: info.h_dpt_dt,
        depTime: info.h_dpt_tm,
        arrTime: info.h_arv_tm,
        runDate: info.h_run_dt,
        general: info.h_gen_rsv_cd === '11' ? 'AVAILABLE' : info.h_gen_rsv_cd === '00' ? 'NONE' : 'SOLDOUT',
        special: info.h_spe_rsv_cd === '11' ? 'AVAILABLE' : info.h_spe_rsv_cd === '00' ? 'NONE' : 'SOLDOUT',
      };
    });
  }

  async reserve(opts: {
    train: Train;
    seatPreference: 'GENERAL_FIRST' | 'SPECIAL_FIRST' | 'GENERAL_ONLY' | 'SPECIAL_ONLY';
    passengers: number;
  }): Promise<Reservation> {
    if (!this.isLoggedIn) throw new Error('로그인이 필요합니다');
    const t = opts.train;
    const pref = opts.seatPreference;

    let seatType: '1' | '2';
    if (pref === 'GENERAL_ONLY') {
      if (t.general !== 'AVAILABLE') throw new Error('일반실 매진');
      seatType = '1';
    } else if (pref === 'SPECIAL_ONLY') {
      if (t.special !== 'AVAILABLE') throw new Error('특실 매진');
      seatType = '2';
    } else if (pref === 'GENERAL_FIRST') {
      seatType = t.general === 'AVAILABLE' ? '1' : '2';
    } else {
      seatType = t.special === 'AVAILABLE' ? '2' : '1';
    }

    const params: Record<string, string | number> = {
      Device: this.device, Version: this.version, Key: this.key, // reserve도 기본 버전
      txtGdNo: '', txtJobId: '1101',
      txtTotPsgCnt: opts.passengers,
      txtSeatAttCd1: '000', txtSeatAttCd2: '000', txtSeatAttCd3: '000',
      txtSeatAttCd4: '015', txtSeatAttCd5: '000',
      hidFreeFlg: 'N', txtStndFlg: 'N', txtMenuId: '11',
      txtSrcarCnt: '0', txtJrnyCnt: '1',
      txtJrnySqno1: '001', txtJrnyTpCd1: '11',
      txtDptDt1: t.depDate, txtDptRsStnCd1: t.depCode,
      txtDptTm1: t.depTime, txtArvRsStnCd1: t.arrCode,
      txtTrnNo1: t.trainNo, txtRunDt1: t.runDate || t.depDate,
      txtTrnClsfCd1: t.trainTypeCode || '00',
      txtPsrmClCd1: seatType, txtTrnGpCd1: t.trainGroup || '109',
      txtChgFlg1: '',
      txtJrnySqno2: '', txtJrnyTpCd2: '', txtDptDt2: '',
      txtDptRsStnCd2: '', txtDptTm2: '', txtArvRsStnCd2: '',
      txtTrnNo2: '', txtRunDt2: '', txtTrnClsfCd2: '',
      txtPsrmClCd2: '', txtChgFlg2: '',
      txtPsgTpCd1: '1', txtDiscKndCd1: '000',
      txtCompaCnt1: opts.passengers,
      txtCardCode_1: '', txtCardNo_1: '', txtCardPw_1: '',
    };

    const { text } = await this.req(ENDPOINTS.reserve, params, 'GET');
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch {
      throw new Error('KTX 예매 응답 파싱 실패: ' + text.slice(0, 200));
    }
    if (parsed.strResult !== 'SUCC') {
      const code = parsed.h_msg_cd as string;
      if (code === 'ERR211161') throw new Error('매진되었습니다');
      if (code === 'P058') throw new Error('로그인이 필요합니다');
      throw new Error((parsed.h_msg_txt as string) || code || 'KTX 예매 실패');
    }

    if (!parsed.h_pnr_no) {
      throw new Error('KTX 예매 응답에 PNR 없음 — 실제 예약 미완료. 응답: ' + text.slice(0, 300));
    }

    const pnr = String(parsed.h_pnr_no);

    // 실제 예약 목록에서 매칭 검증 (carpedm20/korail2와 동일)
    const verified = await this.verifyReservation(pnr);

    return {
      id: pnr,
      carrier: 'KTX',
      trainTypeName: t.trainTypeName,
      trainNo: t.trainNo,
      depName: t.depName,
      arrName: t.arrName,
      depDate: t.depDate,
      depTime: t.depTime,
      arrTime: t.arrTime,
      seatType: seatType === '2' ? '특실' : '일반실',
      buyLimitDate: verified?.h_ntisu_lmt_dt as string,
      buyLimitTime: verified?.h_ntisu_lmt_tm as string,
      price: verified?.h_rsv_amt ? parseInt(String(verified.h_rsv_amt)) : undefined,
      paymentUrl: 'https://www.letskorail.com (코레일톡 앱/웹에서 결제)',
    };
  }

  /** 예약 검증 — 실제 KORAIL 서버에 PNR이 등록됐는지 */
  private async verifyReservation(pnr: string): Promise<Record<string, unknown> | null> {
    try {
      const reservations = await this.getReservations();
      const found = reservations.find(r => String(r.h_pnr_no) === pnr);
      if (!found) {
        throw new Error(`KTX 예약 검증 실패: PNR ${pnr}이 KORAIL 서버 예약 목록에 없음`);
      }
      return found;
    } catch (e) {
      console.warn('[KTX verify]', e);
      return null;
    }
  }

  /** 내 예약 목록 가져오기 — carpedm20/korail2의 reservations() */
  async getReservations(): Promise<Array<Record<string, unknown>>> {
    if (!this.isLoggedIn) throw new Error('로그인이 필요합니다');
    const { text } = await this.req(ENDPOINTS.myReservations, {
      Device: this.device,
      Version: this.version,
      Key: this.key,
    }, 'GET');
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { return []; }
    if (parsed.strResult !== 'SUCC') return [];
    const jrnyInfos = parsed.jrny_infos as { jrny_info?: Array<Record<string, unknown>> } | undefined;
    const reservations: Array<Record<string, unknown>> = [];
    for (const info of jrnyInfos?.jrny_info || []) {
      const trainInfos = (info.train_infos as { train_info?: Array<Record<string, unknown>> })?.train_info || [];
      reservations.push(...trainInfos);
    }
    return reservations;
  }
}
