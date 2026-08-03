import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';
import LoadingScreen from '../components/common/LoadingScreen';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (token && token !== 'undefined') {
        try {
          const res = await api.get('/auth/me');
          setUser(res.data.data ? res.data.data.user : res.data.user);
        } catch (error) {
          console.error("Auth check failed", error);
          // Only remove token if it's explicitly an unauthorized/invalid token error (401)
          if (error.response && error.response.status === 401) {
            localStorage.removeItem('token');
          }
        }
      } else {
        localStorage.removeItem('token'); // clear invalid 'undefined' token
      }
      setLoading(false);
    };
    checkAuth();
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const token = res.data.data ? res.data.data.token : res.data.token;
    const userData = res.data.data ? res.data.data.user : res.data.user;
    localStorage.setItem('token', token);
    setUser(userData);
  };

  const register = async (name, email, password) => {
    const res = await api.post('/auth/register', { name, email, password });
    if (res.data.data && res.data.data.awaitingOtp) {
      return res.data.data;
    } else if (res.data.awaitingOtp) {
      return res.data;
    }
    // Fallback if token is somehow returned directly
    const token = res.data.data ? res.data.data.token : res.data.token;
    if (token) {
      const userData = res.data.data ? res.data.data.user : res.data.user;
      localStorage.setItem('token', token);
      setUser(userData);
    }
    return res.data.data || res.data;
  };

  const verifyOtp = async (email, otp) => {
    const res = await api.post('/auth/verify-otp', { email, otp });
    const token = res.data.data ? res.data.data.token : res.data.token;
    const userData = res.data.data ? res.data.data.user : res.data.user;
    localStorage.setItem('token', token);
    setUser(userData);
  };

  const resendOtp = async (email) => {
    await api.post('/auth/resend-otp', { email });
  };

  const forgotPassword = async (email) => {
    await api.post('/auth/forgot-password', { email });
  };

  const verifyResetOtp = async (email, otp) => {
    await api.post('/auth/verify-reset-otp', { email, otp });
  };

  const resetPassword = async (email, otp, newPassword) => {
    const res = await api.post('/auth/reset-password', { email, otp, newPassword });
    const token = res.data.data ? res.data.data.token : res.data.token;
    const userData = res.data.data ? res.data.data.user : res.data.user;
    if (token) {
      localStorage.setItem('token', token);
      setUser(userData);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  const setTokenLogin = async (token) => {
    localStorage.setItem('token', token);
    const res = await api.get('/auth/me');
    setUser(res.data.data ? res.data.data.user : res.data.user);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, verifyOtp, resendOtp, forgotPassword, verifyResetOtp, resetPassword, logout, setTokenLogin, loading }}>
      {!loading ? children : <LoadingScreen message="Initializing CommitSync" />}
    </AuthContext.Provider>
  );
};
