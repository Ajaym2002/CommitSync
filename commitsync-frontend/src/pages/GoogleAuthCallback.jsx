import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';

export default function GoogleAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setTokenLogin } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  // Capture whether the user was already logged in BEFORE this component mounts.
  // This must be read before setTokenLogin() overwrites the token.
  const wasLoggedIn = useRef(!!localStorage.getItem('token'));

  useEffect(() => {
    const token = searchParams.get('token');
    const msg = searchParams.get('message');

    if (msg) {
      setError(decodeURIComponent(msg.replace(/_/g, ' ')));
      setTimeout(() => navigate('/'), 3000);
      return;
    }

    if (token) {
      setTokenLogin(token)
        .then(() => {
          // Clear all cached query data so the fresh user's data is fetched.
          // This prevents stale data showing after a re-auth from Settings.
          queryClient.clear();

          if (wasLoggedIn.current) {
            // User was already authenticated — came from Settings to connect calendar.
            // Send them back to Settings where they'll see "✅ Calendar Connected".
            navigate('/settings', { replace: true });
          } else {
            // Fresh login via Google — send to dashboard.
            navigate('/dashboard', { replace: true });
          }
        })
        .catch((err) => {
          console.error('Google auth callback error:', err);
          setError('Failed to complete authentication. Please try again.');
          setTimeout(() => navigate('/'), 3000);
        });
    } else {
      setError('No token received from Google. Please try again.');
      setTimeout(() => navigate('/'), 3000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
      fontFamily: "'Outfit', sans-serif"
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(20px)',
        borderRadius: '1.5rem',
        padding: '2.5rem 3rem',
        textAlign: 'center',
        maxWidth: '400px',
        width: '90%'
      }}>
        {error ? (
          <>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
            <h2 style={{ color: '#F87171', fontSize: '1.2rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
              Authentication Failed
            </h2>
            <p style={{ color: '#94A3B8', fontSize: '0.875rem', margin: '0 0 1rem' }}>{error}</p>
            <p style={{ color: '#64748B', fontSize: '0.8rem', margin: 0 }}>Redirecting you back…</p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🗓️</div>
            <h2 style={{ color: '#F1F5F9', fontSize: '1.2rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
              {wasLoggedIn.current ? 'Connecting your Google Calendar…' : 'Signing you in…'}
            </h2>
            <p style={{ color: '#94A3B8', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>
              Just a moment, setting everything up.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: '8px', height: '8px',
                  borderRadius: '50%',
                  background: '#E8580C',
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`
                }} />
              ))}
            </div>
          </>
        )}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
