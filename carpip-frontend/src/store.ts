import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'RETAILER' | 'WHOLESALER';
  tenant: { id: string; publicId: string; name: string; type: string; settings: Record<string, any> };
}

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  setUser: (u: User) => void;
  logout: () => void;
}

const saved = (() => {
  try { return JSON.parse(localStorage.getItem('carpip.auth') ?? 'null'); } catch { return null; }
})();

export const useAuth = create<AuthState>((set) => ({
  token: saved?.token ?? null,
  user: saved?.user ?? null,
  setAuth: (token, user) => { localStorage.setItem('carpip.auth', JSON.stringify({ token, user })); set({ token, user }); },
  setUser: (user) => set((s) => { localStorage.setItem('carpip.auth', JSON.stringify({ token: s.token, user })); return { user }; }),
  logout: () => { localStorage.removeItem('carpip.auth'); set({ token: null, user: null }); },
}));

export interface LiveEvent {
  topic: string;
  eventType: string;
  at: string;
  payload: Record<string, any>;
  key: number;
}

interface LiveState {
  events: LiveEvent[];
  connected: boolean;
  push: (e: Omit<LiveEvent, 'key'>) => void;
  setConnected: (c: boolean) => void;
}
let seq = 0;
export const useLive = create<LiveState>((set) => ({
  events: [],
  connected: false,
  push: (e) => set((s) => ({ events: [{ ...e, key: ++seq }, ...s.events].slice(0, 60) })),
  setConnected: (connected) => set({ connected }),
}));
