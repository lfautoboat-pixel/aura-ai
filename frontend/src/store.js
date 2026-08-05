import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("aura_token");
    if (!token) { setLoading(false); return; }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch { localStorage.removeItem("aura_token"); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = (token, u) => { localStorage.setItem("aura_token", token); setUser(u); };
  const logout = () => { localStorage.removeItem("aura_token"); setUser(null); };

  return (
    <AuthCtx.Provider value={{ user, setUser, loading, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
