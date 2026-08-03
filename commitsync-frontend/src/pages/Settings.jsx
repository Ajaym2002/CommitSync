import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/axios';
import styles from './Settings.module.css';
import DashboardNavbar from '../components/dashboard/DashboardNavbar';

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    aiPersona: 'Supportive',
    riskSensitivity: 'Realistic',
    workingHoursStart: '09:00',
    workingHoursEnd: '17:00',
    maxSustainableWorkload: 4,
    calendarConnected: false
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [loading, setLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [toast, setToast] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordStep, setPasswordStep] = useState(1);

  const [calendarCheckLoading, setCalendarCheckLoading] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        aiPersona: user.preferences?.aiPersona || 'Supportive',
        riskSensitivity: user.preferences?.riskSensitivity || 'Realistic',
        workingHoursStart: user.preferences?.workingHours?.start || '09:00',
        workingHoursEnd: user.preferences?.workingHours?.end || '17:00',
        maxSustainableWorkload: user.behavioralProfile?.maxSustainableWorkload || 4,
        calendarConnected: user.calendarConnected || false
      });
    }
  }, [user]);

  // Live-check calendar status on mount so it reflects DB truth,
  // not stale auth context (important after returning from Google OAuth).
  useEffect(() => {
    const refreshCalendarStatus = async () => {
      try {
        const r = await api.get('/auth/me');
        const freshUser = r.data.data?.user;
        if (freshUser) {
          setFormData(prev => ({ ...prev, calendarConnected: freshUser.calendarConnected || false }));
        }
      } catch (_) {
        // silent — Settings still works without this
      }
    };
    refreshCalendarStatus();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put('/auth/settings', {
        name: formData.name,
        aiPersona: formData.aiPersona,
        riskSensitivity: formData.riskSensitivity,
        workingHours: {
          start: formData.workingHoursStart,
          end: formData.workingHoursEnd
        },
        maxSustainableWorkload: parseInt(formData.maxSustainableWorkload, 10)
      });
      setToast('Settings successfully updated!');
      setTimeout(() => setToast(''), 3000);
      
      // Ideally update auth context here if it exposes a reload function, 
      // but for now the next refresh will pick it up, or we can reload page
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      console.error(err);
      alert('Failed to update settings');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
  };

  const handlePasswordNextStep = (e) => {
    e.preventDefault();
    if (!passwordData.currentPassword) {
      alert("Please enter your current password");
      return;
    }
    setPasswordStep(2);
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      alert("New passwords do not match");
      return;
    }
    setPasswordLoading(true);
    try {
      await api.put('/auth/password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });
      setToast('Password successfully updated!');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPasswordModal(false);
      setPasswordStep(1);
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'confirm') return;
    try {
      await api.delete('/auth/account');
      logout();
      navigate('/');
    } catch (err) {
      console.error(err);
      alert('Failed to delete account');
    }
  };

  if (!user) return null;

  return (
    <div className={styles.pageWrapper}>
      <DashboardNavbar activeSection="settings" />
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Settings</h1>
          <p>Manage your account, AI preferences, and work boundaries.</p>
        </div>

        {/* Profile & Account Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Profile & Account</h2>
          
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Name</label>
              <input 
                type="text" 
                name="name" 
                value={formData.name} 
                onChange={handleChange} 
                className={styles.input} 
              />
            </div>
            
            <div className={styles.formGroup}>
              <label className={styles.label}>Email Address</label>
              <input 
                type="email" 
                value={user.email} 
                className={styles.input} 
                disabled 
              />
              <span className={styles.helpText}>Email cannot be changed.</span>
            </div>
          </div>

          {!user.isGoogleUser ? (
            <>
              <hr style={{ margin: '1.5rem 0', borderColor: 'rgba(209, 213, 219, 0.4)', borderStyle: 'solid' }} />
              <div className={styles.passwordRow}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#111827', margin: 0 }}>Password</h3>
                  <p style={{ margin: '0.25rem 0 0', color: '#6B7280', fontSize: '0.9rem' }}>Secure your account with a strong password.</p>
                </div>
                <button 
                  type="button" 
                  onClick={() => { setShowPasswordModal(true); setPasswordStep(1); setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' }); }} 
                  style={{ background: 'transparent', color: '#111827', border: '1px solid #D1D5DB', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontFamily: 'Outfit', transition: 'all 0.2s' }}
                  onMouseEnter={e => e.target.style.background = 'rgba(243, 244, 246, 0.8)'}
                  onMouseLeave={e => e.target.style.background = 'transparent'}
                >
                  Change Password
                </button>
              </div>
            </>
          ) : (
            <>
              <hr style={{ margin: '1.5rem 0', borderColor: 'rgba(209, 213, 219, 0.4)', borderStyle: 'solid' }} />
              <div className={styles.googleNotice}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M11 7h2v6h-2zm0 8h2v2h-2z"/></svg>
                <span>You are signed in via Google. Password management is handled by your Google account.</span>
              </div>
            </>
          )}
        </div>

        {/* AI Coach & Prediction Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>AI Coach & Prediction Engine (The Brain)</h2>
          
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>AI Coach Persona</label>
              <select 
                name="aiPersona" 
                value={formData.aiPersona} 
                onChange={handleChange} 
                className={styles.select}
              >
                <option value="Supportive">Supportive Friend</option>
                <option value="Strict">Strict Drill Sergeant</option>
                <option value="Analytical">Data-Driven Analyst</option>
              </select>
              <span className={styles.helpText}>How the AI talks to you on the Insights page.</span>
            </div>
            
            <div className={styles.formGroup}>
              <label className={styles.label}>Risk Sensitivity</label>
              <select 
                name="riskSensitivity" 
                value={formData.riskSensitivity} 
                onChange={handleChange} 
                className={styles.select}
              >
                <option value="Optimistic">Optimistic (Lower Risk Scores)</option>
                <option value="Realistic">Realistic (Mathematical Baseline)</option>
                <option value="Pessimistic">Pessimistic (Higher Risk Scores, Early Warnings)</option>
              </select>
              <span className={styles.helpText}>Adjusts the mathematical risk multipliers.</span>
            </div>
          </div>
        </div>

        {/* Calendar Integration Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Google Calendar Integration</h2>
          
          <div className={styles.calendarContainer}>
            <div className={styles.calendarStatus}>
              {formData.calendarConnected ? (
                <div className={styles.calendarConnected}>
                  <div className={styles.calendarIconWrapper} style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10B981' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div className={styles.calendarText}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#065F46' }}>✅ Calendar Connected</h3>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#10B981' }}>Syncing free slots and focus modes. Reality Check is active.</p>
                  </div>
                </div>
              ) : (
                <div className={styles.calendarDisconnected}>
                  <div className={styles.calendarIconWrapper} style={{ background: 'rgba(100, 116, 139, 0.1)', color: '#64748B' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div className={styles.calendarText}>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#1F2937' }}>Not Connected</h3>
                    <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: '#64748B' }}>Connect to enable the Reality Check warning, automated Focus Injection, and smarter risk scores.</p>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.calendarActions}>
              <button 
                type="button" 
                className={styles.connectCalendarBtn}
                disabled={calendarCheckLoading}
                onClick={() => {
                  setCalendarCheckLoading(true);
                  // Navigate to the backend OAuth endpoint.
                  // It will redirect to Google, then back to /auth/google/success with a fresh token.
                  const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api')
                    .replace('/api', '');
                  const token = localStorage.getItem('token');
                  window.location.replace(`${apiBase}/api/auth/google${token ? `?token=${token}` : ''}`);
                }}
              >
                {calendarCheckLoading ? 'Redirecting to Google…' : (formData.calendarConnected ? '🔄 Reconnect / Refresh Calendar' : '🗓️ Connect Google Calendar')}
              </button>
              <p className={styles.calendarHelp}>
                You will be redirected to Google to grant calendar permissions, then returned here automatically.
              </p>
            </div>
          </div>
        </div>

        {/* Work Boundaries Section */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Work Boundaries (The Physics)</h2>
          
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Working Hours Start</label>
              <input 
                type="time" 
                name="workingHoursStart" 
                value={formData.workingHoursStart} 
                onChange={handleChange} 
                className={styles.input} 
                required 
              />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Working Hours End</label>
              <input 
                type="time" 
                name="workingHoursEnd" 
                value={formData.workingHoursEnd} 
                onChange={handleChange} 
                className={styles.input} 
                required 
              />
            </div>
          </div>
          <span className={styles.helpText}>Limits how many usable hours the system calculates you have per day.</span>
          
          <div className={styles.formGroup} style={{ marginTop: '1.5rem' }}>
            <label className={styles.label}>Max Sustainable Concurrent Tasks</label>
            <input 
              type="number" 
              name="maxSustainableWorkload" 
              value={formData.maxSustainableWorkload} 
              onChange={handleChange} 
              className={styles.input} 
              min="1" 
              max="20" 
              required 
            />
            <span className={styles.helpText}>The threshold before the system flags you for extreme workload density.</span>
          </div>
        </div>

        <button type="button" onClick={handleSubmit} className={styles.saveBtn} disabled={loading}>
          {loading ? 'Saving...' : 'Save All Settings'}
        </button>

        {/* Advanced Options */}
        <div className={`${styles.section} ${styles.advancedZone}`} style={{ marginTop: '4rem' }}>
          <h2 className={`${styles.sectionTitle} ${styles.advancedTitle}`}>Data & Privacy</h2>
          <p style={{ color: '#4B5563', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
            Manage your account access or permanently delete your data.
          </p>
          <div className={styles.actionButtons}>
            <button type="button" onClick={() => logout()} className={styles.logoutBtn}>
              Log Out
            </button>
            <button type="button" onClick={() => setShowDeleteModal(true)} className={styles.deleteBtn}>
              Delete Account
            </button>
          </div>
        </div>

      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Password Modal */}
      {showPasswordModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            {passwordStep === 1 ? (
              <form onSubmit={handlePasswordNextStep}>
                <h2 className={styles.modalTitle}>Verify Identity</h2>
                <p className={styles.modalText}>Please enter your current password to continue.</p>
                <input 
                  type="password" 
                  name="currentPassword" 
                  value={passwordData.currentPassword} 
                  onChange={handlePasswordChange} 
                  placeholder="Current Password"
                  className={styles.passwordInput} 
                  required 
                  autoFocus
                />
                <div className={styles.modalActions}>
                  <button type="button" onClick={() => setShowPasswordModal(false)} className={styles.cancelBtn}>Cancel</button>
                  <button type="submit" className={styles.primaryModalBtn}>Continue</button>
                </div>
              </form>
            ) : (
              <form onSubmit={handlePasswordSubmit}>
                <h2 className={styles.modalTitle}>New Password</h2>
                <p className={styles.modalText}>Create a new strong password for your account.</p>
                <input 
                  type="password" 
                  name="newPassword" 
                  value={passwordData.newPassword} 
                  onChange={handlePasswordChange} 
                  placeholder="New Password"
                  className={styles.passwordInput} 
                  required 
                  minLength="6"
                  autoFocus
                />
                <input 
                  type="password" 
                  name="confirmPassword" 
                  value={passwordData.confirmPassword} 
                  onChange={handlePasswordChange} 
                  placeholder="Confirm New Password"
                  className={styles.passwordInput} 
                  required 
                  minLength="6"
                />
                <div className={styles.modalActions}>
                  <button type="button" onClick={() => setPasswordStep(1)} className={styles.cancelBtn}>Back</button>
                  <button type="submit" className={styles.primaryModalBtn} disabled={passwordLoading}>
                    {passwordLoading ? 'Updating...' : 'Update'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Custom Delete Modal */}
      {showDeleteModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Delete Account</h2>
            <p className={styles.modalText}>
              This will permanently wipe all your commitments and risk snapshots. <strong>This action cannot be undone.</strong>
            </p>
            <p className={styles.modalText}>
              Please type <strong>confirm</strong> below to proceed.
            </p>
            <input 
              type="text" 
              value={deleteConfirmText} 
              onChange={e => setDeleteConfirmText(e.target.value)} 
              placeholder="confirm"
              className={styles.modalInput}
            />
            <div className={styles.modalActions}>
              <button 
                type="button" 
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }} 
                className={styles.cancelBtn}
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleDeleteAccount} 
                className={styles.confirmDeleteBtn} 
                disabled={deleteConfirmText !== 'confirm'}
              >
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
