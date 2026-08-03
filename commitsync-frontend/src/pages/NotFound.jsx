import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import CommitSyncLogo from '../components/common/CommitSyncLogo';
import { Home, LayoutDashboard, ArrowLeft } from 'lucide-react';
import styles from './NotFound.module.css';

export default function NotFound() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className={styles.container}>
      <Link to={user ? '/dashboard' : '/'} className={styles.logoHeader}>
        <CommitSyncLogo variant="light" size={44} />
      </Link>

      <div className={styles.contentCard}>
        <div className={styles.badge}>
          <span className={styles.badgeDot} />
          Error 404
        </div>

        <h1 className={styles.title}>
          This commitment <span className={styles.titleItalic}>doesn't exist</span>
        </h1>
        
        <p className={styles.description}>
          The link you followed might be broken, or the page may have been relocated to another workspace.
        </p>

        <div className={styles.actions}>
          <button onClick={() => navigate(-1)} className={styles.secondaryBtn}>
            <ArrowLeft size={17} />
            Go Back
          </button>
          
          <Link to={user ? '/dashboard' : '/'} className={styles.primaryBtn}>
            {user ? <LayoutDashboard size={17} /> : <Home size={17} />}
            {user ? 'Return to Dashboard' : 'Back to Home'}
          </Link>
        </div>
      </div>
    </div>
  );
}
