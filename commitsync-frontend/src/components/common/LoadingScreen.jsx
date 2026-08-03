import React from 'react';
import CommitSyncLogo from './CommitSyncLogo';
import styles from './LoadingScreen.module.css';

export default function LoadingScreen({ message = 'Synchronizing your workspace' }) {
  return (
    <div className={styles.container} role="status" aria-live="polite">
      <div className={styles.card}>
        <div className={styles.logoBox}>
          <div className={styles.pulseRing} />
          <CommitSyncLogo variant="light" size={54} />
        </div>

        <h3 className={styles.title}>
          {message}
        </h3>

        <div className={styles.progressContainer}>
          <div className={styles.progressBar} />
        </div>

        <span className={styles.subtext}>Human-Aware System</span>
      </div>
    </div>
  );
}
