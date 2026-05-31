export type Carrier = 'SRT' | 'KTX';

export interface Train {
  id: string;
  carrier: Carrier;
  trainTypeName: string;
  trainNo: string;
  trainGroup?: string;
  trainTypeCode?: string;
  depName: string;
  arrName: string;
  depCode: string;
  arrCode: string;
  depDate: string;
  depTime: string;
  arrTime: string;
  runDate?: string;
  general: 'AVAILABLE' | 'SOLDOUT' | 'WAITING' | 'NONE';
  special: 'AVAILABLE' | 'SOLDOUT' | 'NONE';
  depStnConsOrdr?: string;
  arrStnConsOrdr?: string;
  depStnRunOrdr?: string;
  arrStnRunOrdr?: string;
}

export interface Reservation {
  id: string;
  carrier: Carrier;
  trainTypeName: string;
  trainNo: string;
  depName: string;
  arrName: string;
  depDate: string;
  depTime: string;
  arrTime: string;
  seatType: '일반실' | '특실';
  carNo?: string;
  seatNo?: string;
  price?: number;
  buyLimitDate?: string;
  buyLimitTime?: string;
  paymentUrl?: string;
}

export interface SearchParams {
  carrier: Carrier;
  credential: string;
  password: string;
  dep: string;
  arr: string;
  date: string;
  time: string;
  passengers: number;
}

export interface ReserveParams {
  carrier: Carrier;
  credential: string;
  password: string;
  train: Train;
  seatPreference: 'GENERAL_FIRST' | 'SPECIAL_FIRST' | 'GENERAL_ONLY' | 'SPECIAL_ONLY';
  passengers: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}
