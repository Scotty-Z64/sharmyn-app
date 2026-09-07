import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, MapPin, Navigation, Search } from 'lucide-react';
import type { PudoLockerRef } from '@/lib/store';
import { formatAddress } from '@/lib/store';

export interface PudoLocker extends PudoLockerRef {
  lat: number;
  lng: number;
}

interface Props {
  selected: PudoLockerRef | null;
  onSelect: (locker: PudoLockerRef) => void;
}

type GeoState = 'idle' | 'loading' | 'ok' | 'approx' | 'denied' | 'error';

/** Approximate location from IP — fallback when browser geolocation is blocked (e.g. inside previews). */
async function ipApproxLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch('https://ipapi.co/json/');
    if (!r.ok) return null;
    const d = (await r.json()) as { latitude?: number; longitude?: number };
    if (typeof d.latitude === 'number' && typeof d.longitude === 'number') {
      return { lat: d.latitude, lng: d.longitude };
    }
  } catch { /* ignore */ }
  return null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Tidy address: shared helper lives in @/lib/store (re-used by Track page). */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Dice bigram similarity — tolerates typos like "haartebeport" ≈ "hartebeespoort". */
function bigramSim(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) grams.set(a.slice(i, i + 2), (grams.get(a.slice(i, i + 2)) ?? 0) + 1);
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) { hit++; grams.set(g, n - 1); }
  }
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

/** Score a locker against a free-text query (substring + fuzzy token matching). */
function scoreLocker(l: PudoLocker, query: string): number {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(l.name);
  const addr = norm(l.address);
  const city = norm(l.city);
  const prov = norm(l.province);
  const words = (name + ' ' + addr + ' ' + city).split(' ');
  let total = 0;
  for (const token of q.split(' ')) {
    if (!token) continue;
    if (name.includes(token)) total += 4;
    else if (city.includes(token)) total += 3;
    else if (addr.includes(token)) total += 2;
    else if (prov.includes(token)) total += 1;
    else {
      // fuzzy fallback per word
      let best = 0;
      for (const w of words) {
        if (w.length < 3 || token.length < 3) continue;
        best = Math.max(best, bigramSim(token, w));
      }
      if (best >= 0.5) total += best * 2.5;
      else return 0; // token doesn't match at all — locker is not a hit
    }
  }
  return total;
}

export default function PudoLockerPicker({ selected, onSelect }: Props) {
  const [lockers, setLockers] = useState<PudoLocker[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [geo, setGeo] = useState<GeoState>('idle');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/data/pudo-lockers.json')
      .then((r) => {
        if (!r.ok) throw new Error('load failed');
        return r.json() as Promise<PudoLocker[]>;
      })
      .then((data) => {
        if (alive) { setLockers(data); setListLoading(false); }
      })
      .catch(() => {
        if (alive) { setLoadError(true); setListLoading(false); }
      });
    return () => {
      alive = false;
    };
  }, []);

  const locate = () => {
    setGeo('loading');
    const fallbackToIp = async () => {
      const approx = await ipApproxLocation();
      if (approx) {
        setCoords(approx);
        setGeo('approx');
      } else {
        setGeo('denied');
      }
    };
    if (!('geolocation' in navigator)) {
      void fallbackToIp();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeo('ok');
      },
      () => void fallbackToIp(),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };

  const nearest = useMemo(() => {
    if (!coords) return null;
    return lockers
      .map((l) => ({ locker: l, km: haversineKm(coords.lat, coords.lng, l.lat, l.lng) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);
  }, [coords, lockers]);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return [...lockers].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
    return lockers
      .map((l) => ({ l, s: scoreLocker(l, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.l);
  }, [lockers, query]);

  const distanceFor = (l: PudoLocker): string | null => {
    if (!coords) return null;
    const km = haversineKm(coords.lat, coords.lng, l.lat, l.lng);
    return `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
  };

  const renderRow = (l: PudoLocker, km?: number) => {
    const isSel = selected?.id === l.id;
    return (
      <button
        key={l.id}
        type="button"
        onClick={() => onSelect({ id: l.id, name: l.name, address: l.address, city: l.city, province: l.province })}
        className={`w-full text-left min-h-[44px] rounded-xl border p-3 flex items-start gap-3 transition active:scale-[0.99] ${
          isSel
            ? 'border-rose-500 bg-blush-100/60 ring-2 ring-rose-500/20'
            : 'border-rose-300/50 bg-white hover:border-rose-400'
        }`}
      >
        <MapPin className={`h-4 w-4 mt-0.5 shrink-0 ${isSel ? 'text-rose-600' : 'text-gold-500'}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold text-ink-900 leading-snug">{l.name}</span>
          <span className="block text-[12px] text-ink-500 mt-0.5">
            {l.address}, {l.city}, {l.province}
          </span>
        </span>
        {km !== undefined ? (
          <span className="shrink-0 mt-0.5 rounded-full bg-gold-400/15 border border-gold-400/40 px-2 py-0.5 text-[11px] font-semibold text-gold-500">
            {km < 10 ? km.toFixed(1) : Math.round(km)} km away
          </span>
        ) : (
          coords && (
            <span className="shrink-0 mt-0.5 rounded-full bg-gold-400/15 border border-gold-400/40 px-2 py-0.5 text-[11px] font-semibold text-gold-500">
              {distanceFor(l)}
            </span>
          )
        )}
        {isSel && <Check className="h-4 w-4 mt-1 shrink-0 text-rose-600" />}
      </button>
    );
  };

  return (
    <div className="mt-3 rounded-2xl border border-rose-300/50 bg-blush-50/60 p-4 space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={locate}
          disabled={geo === 'loading'}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-gold-500 text-white text-[12px] font-semibold uppercase tracking-[0.14em] hover:bg-gold-400 active:scale-95 transition disabled:opacity-70 shrink-0"
        >
          {geo === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
          Use my location
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-500/60" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search suburb, city or province…"
            className="w-full h-11 pl-10 pr-4 rounded-full border border-rose-300/50 bg-white text-[14px] text-ink-900 placeholder:text-ink-500/60 focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/25 transition"
          />
        </div>
      </div>

      {geo === 'approx' && (
        <p className="text-[12px] text-ink-500">
          Using an approximate location (your browser blocked precise GPS) — distances are estimates, or search your suburb above for exact lockers.
        </p>
      )}
      {geo === 'denied' && (
        <p className="text-[12px] text-ink-500">
          Location access was declined — no stress, just search for your suburb or city above.
        </p>
      )}
      {geo === 'error' && (
        <p className="text-[12px] text-ink-500">
          Location isn’t available on this device — search for your suburb or city above instead.
        </p>
      )}

      {loadError && (
        <p className="text-[12px] font-medium text-rose-600">
          We couldn’t load the locker list right now — please try again in a moment.
        </p>
      )}

      {nearest && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-500 mb-2">Nearest to you</p>
          <div className="space-y-2">{nearest.map(({ locker, km }) => renderRow(locker, km))}</div>
        </div>
      )}

      {(query.trim() || !nearest) && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-500 mb-2">
            {query.trim() ? 'Matching lockers' : 'All lockers'}
          </p>
          {listLoading ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading 2 900+ Pudo lockers across South Africa…
            </p>
          ) : filtered.length ? (
            <div className="space-y-2">{filtered.map((l) => renderRow(l))}</div>
          ) : query.trim() ? (
            <p className="text-[13px] text-ink-500">No lockers match “{query.trim()}” — try another suburb or city.</p>
          ) : null}
        </div>
      )}

      {selected && (
        <div className="rounded-xl border border-gold-400/60 bg-white p-4 shadow-[0_4px_16px_rgba(43,29,35,0.06)]">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-500">
            <Check className="h-3.5 w-3.5" /> Your pickup locker
          </p>
          <p className="mt-1.5 text-[14px] font-semibold text-ink-900">{selected.name}</p>
          <p className="text-[13px] text-ink-500">
            {formatAddress(selected)}
          </p>
          {coords && (
            <p className="mt-1 text-[12px] font-medium text-rose-600">
              {distanceFor(lockers.find((l) => l.id === selected.id) ?? { ...selected, lat: 0, lng: 0 })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
