// Deprecated — page.tsx에 통합됨
export interface SearchParams {
  departureStation: string;
  arrivalStation: string;
  date: string;
  time: string;
}
export default function SearchForm(_props: { onResults?: (trains: unknown[], params: SearchParams) => void }) {
  return null;
}
