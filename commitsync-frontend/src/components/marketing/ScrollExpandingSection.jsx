import { useEffect, useRef, useState } from 'react';
import styles from './ScrollExpandingSection.module.css';
import teamImage from '../../../images/vitaly-gariev-8RYyZXOvjvQ-unsplash.jpg';
import { FaArrowRight } from 'react-icons/fa';

export default function ScrollExpandingSection() {
  const trackRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    const checkSize = () => setIsSmallScreen(window.innerWidth <= 1024);
    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  // Keep a separate flag for mobile-specific layout tweaks (capsule start width)
  const isMobile = isSmallScreen && window.innerWidth <= 768;

  useEffect(() => {
    const handleScroll = () => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const windowH = window.innerHeight;
      
      // Increase initial size of capsule to 45vh height and 45% width.
      // Top margin is 5vh.
      // Total height from top of track to bottom of capsule is 50vh.
      // We want the expansion to wait until the capsule's bottom edge is visible.
      const delayOffset = windowH * 0.50; // 50vh
      
      // Finish expanding over 80vh of scroll for a snappy feel
      const scrollDistanceForAnimation = windowH * 0.8;
      const scrolled = windowH - rect.top - delayOffset;
      
      const p = Math.max(0, Math.min(1, scrolled / scrollDistanceForAnimation));
      setProgress(p);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initialize on mount
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // On mobile, start wider (80%) and taller relative to viewport so the capsule looks good
  const startWidth = isMobile ? 80 : 45;
  const widthPct  = startWidth + (100 - startWidth) * progress;  // mobile: 80%→100%, desktop: 45%→100%
  
  // Border-radius: on mobile/tablet start at 72px (moderately rounded rectangle) —
  // softer than a sharp box, but not so round that text is hidden by the curve.
  // On desktop start at 140px (dramatic rounded capsule). Both animate to 0 (full screen).
  const startBr = isSmallScreen ? 72 : 140;
  const br = startBr * (1 - progress);
  
  // Margin-top starts at 5vh so it sits tight under the text, 
  // and reaches 0vh so it perfectly fills the screen at the end.
  // On mobile, reduce margin so it's not too far from the text
  const mtStart = isMobile ? 2 : 5;
  const mt = mtStart * (1 - progress);
  
  // Subtle zoom-out effect on the image itself
  const imgScale  = 1.1 - 0.1 * progress; // 1.1 -> 1.0

  return (
    <section className={styles.container}>
      
      {/* 1. Text container. Normal flow, scrolls out naturally. */}
      <div className={styles.textContainer}>
        <div className={styles.whoAreWeBadge}>Who Are We?</div>
        <h2 className={styles.topHeading}>We Develop Tech<br />Solutions That Matter</h2>
        <p className={styles.topDescription}>
          We focus on creating impactful IT solutions that solve real-world challenges. Through
          innovative technology, we drive progress and build a brighter future. Our mission is to create a
          lasting difference by shaping tomorrow with today's solutions.
        </p>
      </div>

      {/* 2. Image Track (300vh tall to allow for expansion and a long 'hold' phase) */}
      <div ref={trackRef} className={styles.imageTrack}>
        <div className={styles.stickyWrapper}>
          
          <div 
             className={styles.imageShell}
             style={{
               width: `${widthPct}%`,
               height: `calc(45vh + (100vh - 45vh) * ${progress})`,
               borderRadius: `${br}px`,
               marginTop: `${mt}vh`
             }}
          >
            <img 
               src={teamImage} 
               alt="Team Collaborating" 
               className={styles.image} 
               style={{ transform: `scale(${imgScale})` }}
            />
            <div className={styles.imageOverlay} />
            <div className={styles.imageText}>
              <h3 className={styles.imageHeading}>Let's create a better<br />future together</h3>
              <p className={styles.imageDescription}>
                We focus on helping people manage commitments more reliably through intelligent planning and early risk awareness.
              </p>
              <button 
                className={styles.readMoreBtn} 
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('next-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                Read More <FaArrowRight style={{ marginLeft: '8px' }} />
              </button>
            </div>
          </div>
          
        </div>
      </div>
      
    </section>
  );
}
