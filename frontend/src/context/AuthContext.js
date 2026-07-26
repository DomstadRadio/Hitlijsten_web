/**
 * Auth context: beheert JWT token, ingelogde user en login/logout functies.
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

const TOKEN_KEY = 'hitlijsten_token';

export function AuthProvider({ children }) {
  const [token, setToken]   = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser]     = useState(null);
  const [loading, setLoading] = useState(true);

  // Voeg token toe aan alle axios requests
  useEffect(() => {
    const interceptor = axios.interceptors.request.use(config => {
      const t = localStorage.getItem(TOKEN_KEY);
      if (t) config.headers.Authorization = `Bearer ${t}`;
      return config;
    });
    return () => axios.interceptors.request.eject(interceptor);
  }, []);

  // Haal user info op bij laden
  const fetchMe = useCallback(async (t) => {
    if (!t) { setUser(null); setLoading(false); return; }
    try {
      const res = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${t}` },
      });
      setUser(res.data);
    } catch {
      // Token ongeldig — opruimen
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(token); }, [token, fetchMe]);

  const login = async (username, password) => {
    const res = await axios.post('/api/auth/login', { username, password });
    const { token: t, user: u } = res.data;
    localStorage.setItem(TOKEN_KEY, t);
    setToken(t);
    setUser(u);
    return u;
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    axios.post('/api/auth/logout').catch(() => {});
  };

  /** Controleer of de ingelogde gebruiker een permissie heeft. */
  const hasPerm = (perm) => {
    if (!user) return false;
    const perms = (user.permissions || '').split(',').map(p => p.trim());
    return perms.includes('*') || perms.includes(perm);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, hasPerm }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
