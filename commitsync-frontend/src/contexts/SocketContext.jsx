import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';
// Derive the backend root URL from the API URL (strip /api suffix)
const BACKEND_URL = API_URL.replace(/\/api$/, '');

export function SocketProvider({ children }) {
  const { user } = useAuth();
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);
  const [criticalAlerts, setCriticalAlerts] = useState([]);

  useEffect(() => {
    if (!user) {
      // Disconnect when user logs out
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) return;

    // Connect with JWT auth
    const newSocket = io(BACKEND_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000
    });
    
    socketRef.current = newSocket;
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('[Socket] Connected:', newSocket.id);
    });

    newSocket.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
    });

    // ── Feature 8: Listen for real-time critical alerts ──
    newSocket.on('critical_alert', (data) => {
      console.log('[Socket] critical_alert received:', data);
      setCriticalAlerts(prev => {
        // Deduplicate by commitmentId — only show once per commitment
        const exists = prev.some(a => a.commitmentId?.toString() === data.commitmentId?.toString());
        if (exists) return prev;
        return [{ ...data, id: Date.now() }, ...prev];
      });
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
    };
  }, [user]);

  const dismissAlert = (id) => {
    setCriticalAlerts(prev => prev.filter(a => a.id !== id));
  };

  const clearAllAlerts = () => setCriticalAlerts([]);

  return (
    <SocketContext.Provider value={{ socket, criticalAlerts, dismissAlert, clearAllAlerts }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
