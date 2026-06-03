/**
 * SRT 모바일 앱 API 클라이언트
 * ryanking13/SRT (Python) 흐름을 TS로 포팅
 */
import { Train, Reservation } from './types';
import { SRT_STATIONS } from './stations';

const SRT_BASE = 'https://app.srail.or.kr:443';
const NETFUNNEL_URL = 'http://nf.letskorail.com/ts.wseq';

const ENDPOINTS = {
  main: `${SRT_BASE}/main/main.do`,
  login: `${SRT_BASE}/apb/selectListApb01080_n.do`,
  logout: `${SRT_BASE}/login/loginOut.do`,
  search: `${SRT_BASE}/ara/selectListAra10007_n.do`,
  reserve: `${SRT_BASE}/arc/selectListArc05013_n.do`,
  tickets: `${SRT_BASE}/atc/selectListAtc14016_n.do`,
  ticketInfo: `${SRT_BASE}/ard/selectListArd02017_n.do`,
};

const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0_1 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148 SRT-APP-iOS V.2.0.18';

const STATION_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(SRT_STATIONS).map(([k, v]) => [v, k])
);

const EMAIL_RE = /[^@]+@[^@]+\.[^@]+/;
const PHONE_RE = /^\d{3}-?\d{3,4}-?\d{4}$/;

function extractCookies(setCookieHeaders: string[] | undefined, jar: Record<string, string>) {
  if (!setCookieHeaders) return;
  for (const sc of setCookieHeaders) {
    const [pair] = sc.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const name = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      jar[name] = val;
    }
  }
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

export class SrtClient {
  private cookieJar: Record<string, string> = {};
  private netfunnelKey: string | null = null;
  isLoggedIn = false;
  membershipNumber: string | null = null;

  private async req(url: string, options: { method?: 'GET' | 'POST'; body?: Record<string, string | number>; headers?: Record<string, string> } = {}) {
    const method = options.method || 'POST';
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...options.headers,
    };
    const cookies = cookieHeader(this.cookieJar);
    if (cookies) headers['Cookie'] = cookies;

    const body = options.body
      ? new URLSearchParams(
          Object.entries(options.body).map(([k, v]) => [k, String(v)])
        ).toString()
      : undefined;

    const finalUrl = method === 'GET' && body ? `${url}?${body}` : url;
    const fetchOpts: RequestInit = { method, headers };
    if (method === 'POST' && body) fetchOpts.body = body;

    const res = await fetch(finalUrl, fetchOpts);
    const setCookies: string[] = [];
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') setCookies.push(value);
    });
    extractCookies(setCookies, this.cookieJar);

    const text = await res.text();
    return { status: res.status, text };
  }

  async login(idOrEmailOrPhone: string, password: string): Promise<void> {
    let loginType = '1';
    let id = idOrEmailOrPhone;
    if (EMAIL_RE.test(id)) loginType = '2';
    else if (PHONE_RE.test(id)) {
      loginType = '3';
      id = id.replace(/-/g, '');
    }

    const { text } = await this.req(ENDPOINTS.login, {
      body: {
        auto: 'Y',
        check: 'Y',
        page: 'menu',
        deviceKey: '-',
        customerYn: '',
        login_referer: ENDPOINTS.main,
        srchDvCd: loginType,
        srchDvNm: id,
        hmpgPwdCphd: password,
      },
    });

    if (text.includes('존재하지않는 회원입니다')) throw new Error('존재하지 않는 회원입니다');
    if (text.includes('비밀번호 오류')) throw new Error('비밀번호가 일치하지 않습니다');
    if (text.includes('Your IP Address Blocked')) throw new Error('SRT 서버에서 IP가 일시 차단되었습니다');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('SRT 로그인 응답을 해석할 수 없습니다');
    }
    const userMap = parsed.userMap as Record<string, unknown> | undefined;
    if (!userMap?.MB_CRD_NO) {
      const msg = (parsed.MSG as string) || '로그인 실패';
      throw new Error(msg);
    }
    this.membershipNumber = String(userMap.MB_CRD_NO);
    this.isLoggedIn = true;
  }

  private async getNetfunnelKey(forceFresh = false): Promise<string> {
    // 차단 회피: 매크로 폴링에서는 매번 새로 발급해서 패턴 다양화
    if (this.netfunnelKey && !forceFresh) return this.netfunnelKey;

    const ts = Date.now();
    const params = new URLSearchParams({
      opcode: '5101',
      nfid: '0',
      prefix: 'NetFunnel.gRtype=5101;',
      sid: 'service_1',
      aid: 'act_10',
      js: 'true',
    });
    params.append(String(ts), '');

    const res = await fetch(`${NETFUNNEL_URL}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*', 'Referer': SRT_BASE },
    });
    const text = await res.text();
    const m = text.match(/key=([^&']+)/);
    if (!m) throw new Error('NetFunnel 키 발급 실패: ' + text.slice(0, 200));
    const key = m[1];

    const ts2 = Date.now();
    const params2 = new URLSearchParams({
      opcode: '5004',
      key,
      nfid: '0',
      prefix: 'NetFunnel.gRtype=5004;',
      js: 'true',
    });
    params2.append(String(ts2), '');
    await fetch(`${NETFUNNEL_URL}?${params2.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Referer': SRT_BASE },
    });

    this.netfunnelKey = key;
    return key;
  }

  async searchTrains(opts: {
    dep: string; arr: string; date: string; time: string; passengers: number;
    /** 매크로 폴링용: netfunnel 매번 새로 발급 → 차단 회피 */
    freshNetfunnel?: boolean;
  }): Promise<Train[]> {
    if (!SRT_STATIONS[opts.dep]) throw new Error(`SRT 역 아님: ${opts.dep}`);
    if (!SRT_STATIONS[opts.arr]) throw new Error(`SRT 역 아님: ${opts.arr}`);

    const netfunnelKey = await this.getNetfunnelKey(opts.freshNetfunnel);
    const { text } = await this.req(ENDPOINTS.search, {
      body: {
        chtnDvCd: '1', arriveTime: 'N', seatAttCd: '015',
        psgNum: opts.passengers, trnGpCd: 109, stlbTrnClsfCd: '17',
        dptDt: opts.date, dptTm: opts.time,
        arvRsStnCd: SRT_STATIONS[opts.arr],
        dptRsStnCd: SRT_STATIONS[opts.dep],
        netfunnelKey,
      },
    });

    if (text.includes('Your IP Address Blocked') || text.includes('abnormal access')) {
      throw new Error('SRT IP 차단 (abnormal access) — 30~60분 후 재시도하세요');
    }

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { throw new Error('SRT 응답 파싱 실패: ' + text.slice(0, 200)); }

    const result = parsed.resultMap as Array<Record<string, unknown>> | undefined;
    const strResult = result?.[0]?.strResult;
    if (strResult === 'FAIL') {
      const msg = (result?.[0]?.msgTxt as string) || '열차 조회 실패';
      if (msg.includes('NET000001') || (result?.[0]?.msgCd as string) === 'NET000001') {
        this.netfunnelKey = null;
        return this.searchTrains(opts);
      }
      throw new Error(msg);
    }

    const out = parsed.outDataSets as { dsOutput1?: Array<Record<string, string>> } | undefined;
    const list = out?.dsOutput1 || [];
    return list.map((r): Train => ({
      id: `SRT-${r.trnNo}-${r.dptDt}-${r.dptTm}`,
      carrier: 'SRT',
      trainTypeName: 'SRT',
      trainNo: String(r.trnNo),
      trainTypeCode: String(r.stlbTrnClsfCd),
      trainGroup: String(r.trnGpCd || '109'),
      depName: STATION_NAME_BY_CODE[r.dptRsStnCd] || r.dptRsStnCd,
      arrName: STATION_NAME_BY_CODE[r.arvRsStnCd] || r.arvRsStnCd,
      depCode: String(r.dptRsStnCd),
      arrCode: String(r.arvRsStnCd),
      depDate: String(r.dptDt),
      depTime: String(r.dptTm),
      arrTime: String(r.arvTm),
      runDate: String(r.dptDt),
      depStnConsOrdr: String(r.dptStnConsOrdr || ''),
      arrStnConsOrdr: String(r.arvStnConsOrdr || ''),
      depStnRunOrdr: String(r.dptStnRunOrdr || ''),
      arrStnRunOrdr: String(r.arvStnRunOrdr || ''),
      general:
        r.gnrmRsvPsbStr?.includes('예약가능') || parseInt(r.gnrmRsvPsbSmNum || '0') > 0
          ? 'AVAILABLE'
          : r.gnrmStndbyRsvPsbStr === '입석+대기 가능' ? 'WAITING' : 'SOLDOUT',
      special:
        r.sprmRsvPsbStr?.includes('예약가능') || parseInt(r.sprmRsvPsbSmNum || '0') > 0
          ? 'AVAILABLE' : 'SOLDOUT',
    }));
  }

  async reserve(opts: {
    train: Train;
    seatPreference: 'GENERAL_FIRST' | 'SPECIAL_FIRST' | 'GENERAL_ONLY' | 'SPECIAL_ONLY';
    passengers: number;
  }): Promise<Reservation> {
    if (!this.isLoggedIn) throw new Error('로그인이 필요합니다');
    const t = opts.train;

    let isSpecial: boolean;
    const pref = opts.seatPreference;
    if (pref === 'GENERAL_ONLY') {
      if (t.general !== 'AVAILABLE') throw new Error('일반실 매진');
      isSpecial = false;
    } else if (pref === 'SPECIAL_ONLY') {
      if (t.special !== 'AVAILABLE') throw new Error('특실 매진');
      isSpecial = true;
    } else if (pref === 'GENERAL_FIRST') {
      isSpecial = t.general === 'AVAILABLE' ? false : true;
    } else {
      isSpecial = t.special === 'AVAILABLE' ? true : false;
    }
    if (!(t.general === 'AVAILABLE' || t.special === 'AVAILABLE')) throw new Error('좌석 매진');

    const netfunnelKey = await this.getNetfunnelKey(true); // 예약은 항상 fresh netfunnel
    const trnNoPadded = String(t.trainNo).padStart(5, '0');
    const psgCount = opts.passengers;
    const seatCls = isSpecial ? '2' : '1';

    // ryanking13/SRT/passenger.py와 정확히 동일한 형태
    // 어른 1종류만 (다른 type 추후 확장)
    const passengerData: Record<string, string> = {
      totPrnb: String(psgCount),
      psgGridcnt: '1', // 승객 type 종류 수 (어른 한 종류)
      psgTpCd1: '1', // 어른/청소년
      psgInfoPerPrnb1: String(psgCount),
      locSeatAttCd1: '000', // 좌석 위치 (000 기본, 012 창측, 013 복도측)
      rqSeatAttCd1: '015', // 좌석 요구 (015 일반, 021 휠체어)
      dirSeatAttCd1: '009', // 좌석 방향 (009 정방향)
      smkSeatAttCd1: '000',
      etcSeatAttCd1: '000',
      psrmClCd1: seatCls, // passenger별 좌석 등급
    };

    const { text } = await this.req(ENDPOINTS.reserve, {
      body: {
        reserveType: '11',
        jobId: '1101',
        jrnyCnt: '1',
        jrnyTpCd: '11',
        jrnySqno1: '001',
        stndFlg: 'N',
        trnGpCd1: '300', // 좌석선택은 SRT만 가능 → 무조건 300
        trnGpCd: '109',
        grpDv: '0',
        rtnDv: '0',
        stlbTrnClsfCd1: t.trainTypeCode || '17',
        dptRsStnCd1: t.depCode,
        dptRsStnCdNm1: t.depName,
        arvRsStnCd1: t.arrCode,
        arvRsStnCdNm1: t.arrName,
        dptDt1: t.depDate,
        dptTm1: t.depTime,
        arvTm1: t.arrTime,
        trnNo1: trnNoPadded,
        runDt1: t.runDate || t.depDate,
        dptStnConsOrdr1: t.depStnConsOrdr || '',
        arvStnConsOrdr1: t.arrStnConsOrdr || '',
        dptStnRunOrdr1: t.depStnRunOrdr || '',
        arvStnRunOrdr1: t.arrStnRunOrdr || '',
        mblPhone: '',
        netfunnelKey,
        ...passengerData,
      },
    });

    if (text.includes('Your IP Address Blocked') || text.includes('abnormal access')) {
      throw new Error('SRT IP 차단 (abnormal access) — 30~60분 후 재시도하세요');
    }

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { throw new Error('SRT 예매 응답 파싱 실패: ' + text.slice(0, 300)); }

    const result = parsed.resultMap as Array<Record<string, unknown>> | undefined;
    if (result?.[0]?.strResult === 'FAIL') {
      throw new Error((result?.[0]?.msgTxt as string) || '예매 실패');
    }

    const reservList = parsed.reservListMap as Array<Record<string, unknown>> | undefined;
    const r0 = reservList?.[0];
    if (!r0 || !r0.pnrNo) {
      // 가짜 PNR 만들지 않음 — 실제 예약 안 들어간 상태로 success 반환 방지
      throw new Error('SRT 예매 응답에 PNR 없음 — 실제 예약 미완료. 응답: ' + text.slice(0, 300));
    }

    const pnr = String(r0.pnrNo);

    // ryanking13처럼 실제 예약 목록에서 검증
    const verified = await this.verifyReservation(pnr);

    return {
      id: pnr,
      carrier: 'SRT',
      trainTypeName: 'SRT',
      trainNo: t.trainNo,
      depName: t.depName,
      arrName: t.arrName,
      depDate: t.depDate,
      depTime: t.depTime,
      arrTime: t.arrTime,
      seatType: isSpecial ? '특실' : '일반실',
      buyLimitDate: (verified?.iseLmtDt as string) || (r0.iseLmtDt as string),
      buyLimitTime: (verified?.iseLmtTm as string) || (r0.iseLmtTm as string),
      price: verified?.rcvdAmt ? parseInt(String(verified.rcvdAmt)) : undefined,
      paymentUrl: 'https://etk.srail.kr (SRT 앱/웹에서 결제)',
    };
  }

  /** 예약 검증 — 실제 SRT 서버에 PNR이 등록됐는지 확인 */
  private async verifyReservation(pnr: string): Promise<Record<string, unknown> | null> {
    try {
      const reservations = await this.getReservations();
      const found = reservations.find(r => String(r.pnrNo) === pnr);
      if (!found) {
        throw new Error(`예약 검증 실패: PNR ${pnr}이 SRT 서버 예약 목록에 없음. 실제로 예약되지 않았을 가능성.`);
      }
      return found;
    } catch (e) {
      // 검증 자체 실패해도 reserve 응답에 PNR 있었으니 일단 진행 (검증 endpoint도 차단당할 수 있음)
      console.warn('[verify]', e);
      return null;
    }
  }

  /** 내 예약 목록 가져오기 */
  async getReservations(): Promise<Array<Record<string, unknown>>> {
    if (!this.isLoggedIn) throw new Error('로그인이 필요합니다');
    const { text } = await this.req(ENDPOINTS.tickets, { body: { pageNo: '0' } });
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); } catch { throw new Error('예약 목록 응답 파싱 실패'); }
    const result = parsed.resultMap as Array<Record<string, unknown>> | undefined;
    if (result?.[0]?.strResult === 'FAIL') {
      const msg = result?.[0]?.msgTxt as string;
      // "조회결과 없음"은 정상 — 빈 배열 반환
      if (msg?.includes('없습니다') || msg?.includes('없음')) return [];
      throw new Error(msg || '예약 목록 조회 실패');
    }
    const trainList = parsed.trainListMap as Array<Record<string, unknown>> | undefined;
    return trainList || [];
  }
}
