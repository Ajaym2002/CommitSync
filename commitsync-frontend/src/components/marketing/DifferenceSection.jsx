import { useState } from 'react';
import styles from './DifferenceSection.module.css';
import { 
  FaTrophy, FaShieldAlt, FaUsers, FaCogs, FaLightbulb, FaCheckSquare,
  FaRegClock, FaExclamationTriangle, FaUsersSlash, FaUnlink, FaEyeSlash, FaCalendarTimes,
  FaArrowRight
} from 'react-icons/fa';

export default function DifferenceSection({ onScrollToAuth }) {
  const [useCommitSync, setUseCommitSync] = useState(true);

  const doFeatures = [
    {
      icon: <FaTrophy />,
      title: "Unified Clarity",
      description: "Everything organized in one place, creating a crystal-clear path from intention to flawless execution."
    },
    {
      icon: <FaShieldAlt />,
      title: "Proactive Risk Awareness",
      description: "Intelligent planning highlights potential roadblocks early, so you can mitigate them before they become problems."
    },
    {
      icon: <FaUsers />,
      title: "Dependable Accountability",
      description: "Seamlessly track commitments across the team, fostering a more organized, balanced, and productive daily life."
    },
    {
      icon: <FaCogs />,
      title: "Seamless Collaboration",
      description: "Keep everyone on the same page with integrated tools that make teamwork feel effortless and natural."
    },
    {
      icon: <FaLightbulb />,
      title: "Intelligent Planning",
      description: "Smart workflows and intuitive interfaces help you plan your week based on your actual capacity."
    },
    {
      icon: <FaCheckSquare />,
      title: "Clear Deadlines",
      description: "Never miss a beat with visually clear timelines that keep your most important priorities in focus."
    }
  ];

  const dontFeatures = [
    {
      icon: <FaUnlink />,
      title: "Fragmented Planning",
      description: "Tasks and communications are scattered across multiple tools, leading to missed deadlines and confusion."
    },
    {
      icon: <FaExclamationTriangle />,
      title: "Reactive Management",
      description: "Risks are only noticed when it's already too late, causing unnecessary stress and project delays."
    },
    {
      icon: <FaUsersSlash />,
      title: "Unclear Accountability",
      description: "It is difficult to track who is responsible for what, inevitably leading to dropped tasks and frustration."
    },
    {
      icon: <FaRegClock />,
      title: "Disconnected Teams",
      description: "Siloed information forces team members to constantly ask for updates, breaking their flow."
    },
    {
      icon: <FaEyeSlash />,
      title: "Blind Spots",
      description: "Lack of a unified dashboard leaves you guessing about the actual status of critical project phases."
    },
    {
      icon: <FaCalendarTimes />,
      title: "Missed Deadlines",
      description: "Poor visibility and scattered priorities guarantee that commitments will eventually fall through the cracks."
    }
  ];

  const features = useCommitSync ? doFeatures : dontFeatures;

  return (
    <section id="next-section" className={styles.container}>
      {/* On mobile/tablet: contentWrapper is scrollable within the sticky container.
          When user scrolls to the bottom of the cards, the outer page scroll takes
          over and PositiveImpactSection slides up over this stuck section. */}
      <div className={styles.contentWrapper}>
        
        {/* Header Area */}
        <div className={styles.header}>
          
          <div className={styles.headerLeft}>
            <div className={styles.subheading}>
              <div className={styles.dots}>
                <div className={styles.dotBlue}></div>
                <div className={styles.dotGrey}></div>
              </div>
              What Is The Difference?
            </div>
            
            <h2 className={styles.mainHeading}>
              When people <br />
              <span className={useCommitSync ? styles.textDo : styles.textDont}>
                {useCommitSync ? "do" : "don't"}
              </span>
              
              <div 
                className={`${styles.toggleSwitch} ${useCommitSync ? styles.toggleDo : styles.toggleDont}`}
                onClick={() => setUseCommitSync(!useCommitSync)}
              >
                <div className={`${styles.slider} ${useCommitSync ? styles.sliderRight : styles.sliderLeft}`} />
              </div>
              
              use CommitSync.
            </h2>
          </div>

          <div className={styles.headerRight}>
            <button className={styles.ctaBtn} onClick={() => onScrollToAuth('login')}>
              Work with us 
              <div className={styles.btnIconCircle}>
                <FaArrowRight className={styles.btnIcon} />
              </div>
            </button>
          </div>

        </div>

        {/* Grid Area */}
        <div className={styles.gridArea}>
          {features.map((feature, idx) => {
            const isFeatured = idx === 0;
            return (
              <div 
                key={idx} 
                className={`${styles.gridCard} ${isFeatured ? styles.featuredCard : ''}`}
              >
                <div 
                  className={styles.iconWrapper} 
                  style={{ 
                    color: isFeatured 
                      ? (useCommitSync ? '#007aff' : '#ff453a') 
                      : '#1d1d1f' 
                  }}
                >
                  {feature.icon}
                </div>
                <h3 className={styles.cardTitle}>{feature.title}</h3>
                <p className={styles.cardDescription}>{feature.description}</p>
              </div>
            );
          })}
        </div>

      </div>

      {/* Scroll-more indicator — only visible on small screens when content overflows */}
      <div className={styles.scrollMoreHint}>
        <span className={styles.scrollMoreDot}></span>
        <span className={styles.scrollMoreDot}></span>
        <span className={styles.scrollMoreDot}></span>
      </div>

    </section>
  );
}
