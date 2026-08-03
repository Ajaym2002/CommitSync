import styles from './PositiveImpactSection.module.css';
import { FaArrowRight, FaCheckCircle, FaStar, FaRocket } from 'react-icons/fa';

import imgTime from '../../../images/aziz-acharki-U3C79SeHa7k-unsplash.jpg';
import imgAhead from '../../../images/darya-tryfanava-jTkBvOPhL5o-unsplash.jpg';
import imgGoals from '../../../images/jametlene-reskp-2E2K_W05vHk-unsplash.jpg';

export default function PositiveImpactSection({ onScrollToAuth }) {
  return (
    <section className={styles.sectionWrapper}>
      <div className={styles.container}>
        
        {/* Row 1: Text Left, Image Right */}
        <div className={styles.contentRow}>
          <div className={styles.textCol}>
            <div className={styles.indicatorWrap}>
              <div className={styles.indicatorDot}></div>
              <span className={styles.indicatorText}>Reliability</span>
            </div>
            <h2 className={styles.mainHeading}>Achieve Your Goals On Time</h2>
            <p className={styles.description}>
              By having complete visibility over your commitments, you can plan realistically and execute flawlessly. Never let another deadline catch you by surprise.
            </p>
            <button className={styles.ctaBtn} onClick={() => onScrollToAuth('login')}>
              Learn How 
              <div className={styles.btnIconCircle}>
                <FaArrowRight className={styles.btnIcon} />
              </div>
            </button>
          </div>
          <div className={styles.imageCol}>
            <img src={imgTime} alt="Completing commitments on time" className={styles.featureImage} />
          </div>
        </div>

        {/* Row 2: Image Left, Text Right */}
        <div className={`${styles.contentRow} ${styles.reversed}`}>
          <div className={styles.textCol}>
            <div className={styles.indicatorWrap}>
              <div className={styles.indicatorDot}></div>
              <span className={styles.indicatorText}>Momentum</span>
            </div>
            <h2 className={styles.mainHeading}>Get Ahead In Life</h2>
            <p className={styles.description}>
              CommitSync helps you prioritize what truly matters, allowing you to build momentum and systematically get ahead of your responsibilities instead of just reacting to them.
            </p>
            <button className={styles.ctaBtn} onClick={() => onScrollToAuth('login')}>
              Start Building 
              <div className={styles.btnIconCircle}>
                <FaArrowRight className={styles.btnIcon} />
              </div>
            </button>
          </div>
          <div className={styles.imageCol}>
            <img src={imgAhead} alt="Getting ahead in life" className={styles.featureImage} />
          </div>
        </div>

        {/* Row 3: Text Left, Image Right */}
        <div className={styles.contentRow}>
          <div className={styles.textCol}>
            <div className={styles.indicatorWrap}>
              <div className={styles.indicatorDot}></div>
              <span className={styles.indicatorText}>Focus</span>
            </div>
            <h2 className={styles.mainHeading}>Say Goodbye to Procrastination</h2>
            <p className={styles.description}>
              With a clear roadmap and intelligent risk awareness, you eliminate the overwhelming confusion that causes procrastination. Focus deeply on the task at hand.
            </p>
            <button className={styles.ctaBtn} onClick={() => onScrollToAuth('login')}>
              Find Your Focus 
              <div className={styles.btnIconCircle}>
                <FaArrowRight className={styles.btnIcon} />
              </div>
            </button>
          </div>
          <div className={styles.imageCol}>
            <img src={imgGoals} alt="Say goodbye to procrastination" className={styles.featureImage} />
          </div>
        </div>

      </div>
    </section>
  );
}
