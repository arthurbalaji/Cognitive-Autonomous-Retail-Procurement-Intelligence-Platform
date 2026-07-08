import { create } from 'zustand';
import type { User } from '@/types';
import api from '@/lib/axios';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  role: 'RETAILER' | 'WHOLESALER';
  tenantName: string;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    const { token, refreshToken, user } = response.data;
    localStorage.setItem('carpip_token', token);
    localStorage.setItem('carpip_refresh_token', refreshToken);
    set({ user, isAuthenticated: true, isLoading: false });
  },

  register: async (data: RegisterData) => {
    const response = await api.post('/auth/register', data);
    const { token, refreshToken, user } = response.data;
    localStorage.setItem('carpip_token', token);
    localStorage.setItem('carpip_refresh_token', refreshToken);
    set({ user, isAuthenticated: true, isLoading: false });
  },

  logout: () => {
    localStorage.removeItem('carpip_token');
    localStorage.removeItem('carpip_refresh_token');
    set({ user: null, isAuthenticated: false, isLoading: false });
  },

  checkAuth: () => {
    const token = localStorage.getItem('carpip_token');
    if (token) {
      try {
        // Decode JWT payload to get user info
        const payload = JSON.parse(atob(token.split('.')[1]));
        const user: User = {
          id: payload.sub,
          email: payload.email,
          name: payload.name,
          role: payload.role,
          tenantId: payload.tenantId,
          tenantName: payload.tenantName,
          tenantType: payload.tenantType,
        };
        set({ user, isAuthenticated: true, isLoading: false });
      } catch {
        localStorage.removeItem('carpip_token');
        localStorage.removeItem('carpip_refresh_token');
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } else {
      set({ isLoading: false });
    }
  },
}));
