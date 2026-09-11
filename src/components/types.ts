export interface Place {
  id: string;
  name: string;
  category: string;
  neighbourhood?: string;
  address?: string;
  notes?: string;
  lat: number;
  lon: number;
  shortlist?: boolean;
  booking?: { level: 'required' | 'recommended' | 'held'; how: string };
  source?: { url?: string; handle?: string; confidence?: string };
}

export interface Item {
  start: string;
  end?: string | null;
  placeId?: string | null;
  title?: string | null;
  type: string;
  locked: boolean;
  notes?: string;
  mode?: string;
}

export interface Day {
  date: string;
  dayNumber: number;
  weekday: string;
  label?: string;
  color: string;
  base?: string;
  items: Item[];
}

export interface Leg {
  date: string;
  dayNumber: number;
  color: string;
  fromId: string;
  toId: string;
  from: { lat: number; lon: number; name: string };
  to: { lat: number; lon: number; name: string };
  mode: string;
  minutes: number;
  km: number;
  routed: boolean;
  depart?: string | null;
  arrive?: string | null;
}

export interface ModeSpec {
  label: string;
  kmh: number;
  overhead: number;
  color: string;
  dash: string | null;
}

export interface TripMeta {
  city: string;
  citySlug?: string;
  title?: string;
  subtitle?: string;
  start: string;
  end: string;
}

export interface Advice {
  tag: string;
  title: string;
  body: string;
}

export interface TripData {
  trip: TripMeta;
  places: Place[];
  days: Day[];
  legs: Leg[];
  advice: Advice[];
  modes: Record<string, ModeSpec>;
  routed: boolean;
}
