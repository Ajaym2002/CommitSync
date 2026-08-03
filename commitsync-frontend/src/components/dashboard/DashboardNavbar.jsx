import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import styles from './DashboardNavbar.module.css';
import CommitSyncLogo from '../common/CommitSyncLogo';
import FloatingActions from '../common/FloatingActions';

export default function DashboardNavbar({ activeSection }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  // Instead of re-fetching, we can just read from the cache that FloatingActions maintains
  const notificationsData = queryClient.getQueryData(['notifications']);
  const notifications = notificationsData?.notifications || [];
  const hasUnread = notifications.some(n => !n.isRead);

  const navItems = [
    { label: 'Syncs', section: 'syncs' },
    { label: 'Team', section: 'team' },
    { label: 'Circles', section: 'circles' },
    { label: 'Insights', section: 'insights' },
    { label: 'Settings', section: 'settings' },
  ];

  const handleNavItem = (section) => {
    setMenuOpen(false);
    if (section === 'team') {
      navigate('/team');
    } else {
      navigate(`/${section}`);
    }
  };

  return (
    <>
      <nav className={styles.navbar}>
        <div
          className={styles.navLogo}
          onClick={() => navigate('/dashboard')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/dashboard')}
        >
          <CommitSyncLogo variant="dark" size={56} />
        </div>

        {/* Desktop nav pill */}
        <div className={styles.navCenter}>
          {navItems.map((item) => (
            <span
              key={item.section}
              className={`${styles.navItem} ${activeSection === item.section ? styles.navItemActive : ''}`}
              onClick={() => handleNavItem(item.section)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleNavItem(item.section)}
            >
              {item.label}
            </span>
          ))}
        </div>

        <div className={styles.navRight}>
          <FloatingActions />
          {/* Hamburger — only visible on mobile/tablet */}
          <button
            className={`${styles.hamburger} ${menuOpen ? styles.hamburgerOpen : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            <span></span>
            <span></span>
            <span></span>
            {hasUnread && <div className={styles.redDot} />}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className={styles.mobileMenu}>
          <div className={styles.mobileMenuOverlay} onClick={() => setMenuOpen(false)} />
          <div className={styles.mobileMenuPanel}>
            {navItems.map((item) => (
              <button
                key={item.section}
                className={`${styles.mobileMenuItem} ${activeSection === item.section ? styles.mobileMenuItemActive : ''}`}
                onClick={() => handleNavItem(item.section)}
              >
                {item.label}
              </button>
            ))}
            <button
              className={styles.mobileMenuItem}
              onClick={() => {
                setMenuOpen(false);
                document.getElementById('floating-actions-btn')?.click();
              }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              Notifications
              {hasUnread && <span style={{ background: '#ef4444', width: '8px', height: '8px', borderRadius: '50%' }} />}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
