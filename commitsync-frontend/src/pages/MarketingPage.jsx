import { useRef, useState } from 'react';
import styles from './MarketingPage.module.css';
import ScrollExpandingSection from '../components/marketing/ScrollExpandingSection';
import DifferenceSection from '../components/marketing/DifferenceSection';
import PositiveImpactSection from '../components/marketing/PositiveImpactSection';
import Login from '../components/auth/Login';
import CommitSyncLogo from '../components/common/CommitSyncLogo';

export default function MarketingPage() {
  const authRef = useRef(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [menuOpen, setMenuOpen] = useState(false);

  // Scroll to auth section and set mode ('login' or 'register')
  const scrollToAuth = (mode = 'login') => {
    setAuthMode(mode);
    setMenuOpen(false);
    setTimeout(() => {
      // Scroll to the absolute bottom of the page to reveal the fixed auth footer
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 50); // tiny delay so state updates before scroll
  };

  return (
    <div className={styles.marketingContainer}>

      {/* Hero section wraps the navbar so it's scoped to hero only */}
      <section className={styles.heroSection}>

        <nav className={styles.navbar}>
          <div className={styles.navLogo}>
            <CommitSyncLogo variant="dark" size={48} />
          </div>

          {/* Desktop nav items */}
          <div className={styles.navRight}>
            <span className={styles.navItem}>Syncs</span>
            <span className={styles.navItem}>Team</span>
            <span className={styles.navItem}>Circles</span>
            <span className={styles.navItem}>Insights</span>
            <button onClick={() => scrollToAuth('register')} className={styles.registerBtn}>Register</button>
          </div>

          {/* Hamburger button (mobile only) */}
          <button
            className={`${styles.hamburger} ${menuOpen ? styles.hamburgerOpen : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle navigation menu"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </nav>

        {/* Mobile menu overlay */}
        <div className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ''}`}>
          <span className={styles.mobileNavItem}>Syncs</span>
          <span className={styles.mobileNavItem}>Team</span>
          <span className={styles.mobileNavItem}>Circles</span>
          <span className={styles.mobileNavItem}>Insights</span>
          <button onClick={() => scrollToAuth('login')} className={styles.mobileGetStartedBtn}>Get Started →</button>
          <button onClick={() => scrollToAuth('register')} className={styles.mobileRegisterBtn}>Register</button>
        </div>

        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            Time is Human.
          </h1>
          <p className={styles.heroDescription}>
            A commitment tracker designed around your
            actual capacity, not just your deadlines.
          </p>
          <button onClick={() => scrollToAuth('login')} className={styles.getStartedBtn}>Get Started →</button>
        </div>

        <div className={styles.scrollIndicator}>
          <span className={styles.scrollText}>SCROLL</span>
          <div className={styles.scrollArrow}></div>
        </div>

      </section>

      {/* The scroll-triggered capsule to full-screen transition */}
      <ScrollExpandingSection />

      {/* Zone: DifferenceSection is sticky, PositiveImpact slides OVER it */}
      <div className={styles.stickyOverlapZone}>
        <DifferenceSection onScrollToAuth={scrollToAuth} />
        <PositiveImpactSection onScrollToAuth={scrollToAuth} />
      </div>

      {/* Auth section: fixed background revealed as stickyOverlapZone scrolls away */}
      <section ref={authRef} className={styles.authSectionFixed}>
        <Login key={authMode} initialMode={authMode} />
      </section>

    </div>
  );
}
