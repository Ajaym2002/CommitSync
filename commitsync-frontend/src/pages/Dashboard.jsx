import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import { Clock, Target, Activity, Users, ArrowRight, Star, Trophy, Rocket, Flame, Sunrise, Sparkles, Zap, MessageCircle, CalendarClock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DashboardNavbar from '../components/dashboard/DashboardNavbar';
import styles from './Dashboard.module.css';

// Client-side live risk projection (mirrors backend formula)
function computeLiveRisk(commitment) {
  const now = new Date();
  const deadline = new Date(commitment.deadline);
  const created  = new Date(commitment.createdAt || commitment.updatedAt || now);
  const hoursLeft     = (deadline - now) / (1000 * 60 * 60);
  const totalTimeMs   = Math.max(1, deadline - created);
  const elapsedMs     = Math.max(0, now - created);
  const timeRatio     = Math.min(1, elapsedMs / totalTimeMs);
  const progressRatio = (commitment.progress || 0) / 100;
  if (hoursLeft <= 0 && progressRatio < 1) return 100;
  let timePressure;
  if      (hoursLeft <= 24)  timePressure = 80 + (1 - hoursLeft / 24)          * 20;
  else if (hoursLeft <= 72)  timePressure = 55 + (1 - (hoursLeft - 24) / 48)   * 25;
  else if (hoursLeft <= 168) timePressure = 25 + (1 - (hoursLeft - 72) / 96)   * 30;
  else                       timePressure = Math.max(5, 25 - (hoursLeft - 168) * 0.03);
  timePressure = Math.max(0, Math.min(100, timePressure));
  const gap = Math.max(0, timeRatio - progressRatio);
  const liveScore = Math.round((timePressure * 0.55) + (gap * 100 * 0.45));
  return Math.max(0, Math.min(100, liveScore));
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: stats, isLoading: isStatsLoading } = useQuery({
    queryKey: ['analytics_overview'],
    queryFn: async () => {
      try {
        const res = await api.get('/analytics/overview');
        return res.data.data; // assuming successResponse returns { success: true, data: { ... } }
      } catch (err) {
        return { 
          totalCommitments: 0, 
          completionRate: 0, 
          averageRisk: 0, 
          activeCommitments: 0,
          reliabilityScore: 0,
          bestZone: 'Analyzing Cycle...'
        };
      }
    }
  });

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => {
      try {
        const res = await api.get('/friends');
        return res.data.data || [];
      } catch { return []; }
    }
  });

  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      try {
        const res = await api.get('/teams');
        return res.data.data?.teams || [];
      } catch { return []; }
    }
  });

  const dashboardFriends = Array.isArray(friendsData)
    ? friendsData
    : (friendsData?.friends || []);
  const dashboardTeams = Array.isArray(teamsData)
    ? teamsData
    : (teamsData?.teams || []);

  const [readMap, setReadMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('chatReadStatus') || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const syncReadMap = () => {
      try {
        setReadMap(JSON.parse(localStorage.getItem('chatReadStatus') || '{}'));
      } catch {
        setReadMap({});
      }
    };

    window.addEventListener('storage', syncReadMap);
    window.addEventListener('focus', syncReadMap);
    return () => {
      window.removeEventListener('storage', syncReadMap);
      window.removeEventListener('focus', syncReadMap);
    };
  }, []);

  const { data: conversations = [] } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      try {
        const res = await api.get('/chat/conversations');
        return res.data.data?.conversations || [];
      } catch {
        return [];
      }
    },
    enabled: dashboardFriends.length > 0 || dashboardTeams.length > 0,
    refetchInterval: 15000
  });

  const unreadConversations = conversations.filter((conversation) => {
    const readAt = readMap[conversation._id];
    return readAt && conversation.lastMessageAt && new Date(conversation.lastMessageAt) > new Date(readAt);
  });

  const { data: unreadPulse = { count: 0, latest: null } } = useQuery({
    queryKey: ['dashboard_unread_messages', unreadConversations.map(c => `${c._id}:${c.lastMessageAt}`).join('|')],
    queryFn: async () => {
      const myId = (user?._id || user?.id || '').toString();
      const batches = await Promise.all(unreadConversations.map(async (conversation) => {
        try {
          const res = await api.get(`/chat/conversations/${conversation._id}/messages`, { params: { limit: 50 } });
          const readAt = new Date(readMap[conversation._id] || 0);
          const messages = res.data.data?.messages || [];
          return messages
            .filter(message => new Date(message.createdAt) > readAt)
            .filter(message => (message.senderId?._id || message.senderId || '').toString() !== myId)
            .filter(message => message.senderModel !== 'System')
            .map(message => ({ ...message, conversation }));
        } catch {
          return [];
        }
      }));

      const messages = batches.flat().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return {
        count: messages.length,
        latest: messages[0] || null
      };
    },
    enabled: unreadConversations.length > 0,
    staleTime: 10000
  });

  const { data: teamCommitmentGlimpses = [] } = useQuery({
    queryKey: ['dashboard_team_commitments', dashboardTeams.map(team => team._id).join('|')],
    queryFn: async () => {
      const teamCommitmentGroups = await Promise.all(dashboardTeams.map(async (team) => {
        try {
          const res = await api.get(`/teams/${team._id}/risk-dashboard`);
          return (res.data.data?.commitments || []).map(commitment => ({
            ...commitment,
            teamName: team.name
          }));
        } catch {
          return [];
        }
      }));

      return teamCommitmentGroups.flat();
    },
    enabled: dashboardTeams.length > 0,
    staleTime: 60000
  });

  const { data: commitmentsData, isLoading: isCommitmentsLoading } = useQuery({
    queryKey: ['active_commitments'],
    queryFn: async () => {
      try {
        const res = await api.get('/commitments/active');
        return res.data.data;
      } catch (err) {
        return { count: 0, commitments: [] };
      }
    },
    // Adaptive refresh: 1 min when urgent, 5 min otherwise
    refetchInterval: (query) => {
      const data = query.state.data;
      const commitments = data?.commitments || [];
      const now = new Date();
      const hasUrgent = commitments.some(
        c => (c.currentRiskScore >= 65) || (new Date(c.deadline) < now)
      );
      return hasUrgent ? 60_000 : 300_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 55_000
  });

  // Determine Dashboard State
  const commitments = commitmentsData?.commitments || [];
  const hasCommitments = commitments.length > 0;
  const teamCommitments = [
    ...teamCommitmentGlimpses,
    ...commitments.filter(c => c.isTeamCommitment)
  ]
    .filter(commitment => commitment?.deadline && !['COMPLETED', 'FAILED'].includes(commitment.status))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const topTeamCommitment = teamCommitments[0];
  const myUserId = (user?._id || user?.id || '').toString();
  const assignedTeamTasks = teamCommitments
    .flatMap(commitment => (commitment.subTasks || [])
      .filter(task => !['COMPLETED'].includes(task.status))
      .filter(task => {
        const assignees = Array.isArray(task.assignedTo) ? task.assignedTo : [task.assignedTo].filter(Boolean);
        return assignees.some(assignee => (assignee?._id || assignee || '').toString() === myUserId);
      })
      .map(task => ({
        ...task,
        teamName: commitment.teamName,
        parentTitle: commitment.title,
        deadline: task.deadline || commitment.deadline
      })))
    .filter(task => task.deadline)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const topTeamTask = assignedTeamTasks[0];

  // Parallax background calculation
  const [bgY, setBgY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      
      if (maxScroll > 0) {
        setBgY((scrollY / maxScroll) * 100);
      } else {
        setBgY(0);
      }
    };

    window.addEventListener('scroll', handleScroll);
    // Call once to set initial state
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, [commitments, stats]); // re-run if content changes height
  
  // Dynamic Z-Index Layering
  const [initialLoad, setInitialLoad] = useState(true);
  const [hoveredCard, setHoveredCard] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setInitialLoad(false);
    }, 4000); // 4 seconds delay before slipping behind plant
    return () => clearTimeout(timer);
  }, []);

  const getZIndex = (cardId) => {
    if (initialLoad) return 100;
    if (hoveredCard === cardId) return 100;
    return 10;
  };

  const handleCardInteraction = (cardId) => {
    setHoveredCard(cardId);
  };

  const handleCardLeave = () => {
    setHoveredCard(null);
  };
  
  // Greeting time logic
  const hour = new Date().getHours();
  let timeOfDay = 'Good evening';
  if (hour < 12) timeOfDay = 'Good morning';
  else if (hour < 17) timeOfDay = 'Good afternoon';

  const firstName = user?.name ? user.name.split(' ')[0] : 'there';

  const isBestZoneActive = () => {
    if (!stats?.bestZone) return false;
    const bz = stats.bestZone.toLowerCase();
    if (bz.includes('morning') && timeOfDay === 'Good morning') return true;
    if (bz.includes('afternoon') && timeOfDay === 'Good afternoon') return true;
    if (bz.includes('evening') && timeOfDay === 'Good evening') return true;
    return false;
  };

  const formatDueLabel = (dateValue) => {
    if (!dateValue) return 'No deadline';
    const due = new Date(dateValue);
    if (Number.isNaN(due.getTime())) return 'No deadline';

    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const days = Math.round((startOfDue - startOfToday) / 86400000);

    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    if (days <= 7) return `Due in ${days}d`;
    return `Due ${due.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  };

  const getLatestSenderName = () => {
    const sender = unreadPulse.latest?.senderId;
    if (sender?.name) return sender.name.split(' ')[0];

    const conversation = unreadPulse.latest?.conversation;
    const participant = conversation?.participants?.find(
      p => (p?._id || p || '').toString() !== myUserId
    );
    return participant?.name?.split(' ')[0] || (conversation?.type === 'TEAM' ? 'Team' : 'Someone');
  };

  const generateCoachingText = (item) => {
    const riskDrop = 9;
    const newRisk = Math.max(0, item._displayRisk - riskDrop);
    if (item.isTeamCommitment) {
      return `⚠️ Team bottleneck: advancing 20% drops risk to ${newRisk}%`;
    }
    if (item.estimatedHours) {
      const hours = (0.2 * item.estimatedHours).toFixed(1);
      return `💡 Spending ${hours}h drops risk to ${newRisk}%`;
    }
    return `💡 Advancing 20% drops risk to ${newRisk}%`;
  };

  const renderRingChart = (score, isLoading, large = false) => {
    if (isLoading) return null;
    
    const r = large ? 36 : 20;
    const c = large ? 40 : 24;
    const circumference = 2 * Math.PI * r;
    const offset = circumference - (score / 100) * circumference;
    
    let colorClass = styles.ringProgressWarm;
    if (score >= 75) colorClass = styles.ringProgress; // Emerald
    else if (score >= 50) colorClass = styles.ringProgressPrimary; // Indigo
    
    const size = large ? 80 : 48;

    return (
      <div className={styles.ringWrapper} style={large ? {width: '80px', height: '80px'} : {}}>
        <svg viewBox={`0 0 ${size} ${size}`} className={styles.ringSvg}>
          <circle cx={c} cy={c} r={r} className={styles.ringBg} strokeWidth={large ? 5 : 3} />
          <circle 
            cx={c} 
            cy={c} 
            r={r} 
            className={`${styles.ringProgress} ${colorClass}`}
            strokeWidth={large ? 5 : 3}
            strokeDasharray={circumference}
            strokeDashoffset={hasCommitments ? offset : circumference}
          />
        </svg>
      </div>
    );
  };

  // Get top 3 highest-risk active commitments for Focus Radar
  // Uses live risk score (max of stored vs real-time projection) for accurate ordering
  const topFocusItems = [...commitments]
    .map(c => ({ ...c, _displayRisk: Math.max(c.currentRiskScore || 0, computeLiveRisk(c)) }))
    .sort((a, b) => b._displayRisk - a._displayRisk)
    .slice(0, 3);
    
  const pinnedCommitmentId = localStorage.getItem('commitsync_pinned_commitment');
  if (pinnedCommitmentId) {
    const pinned = commitments.find(c => c._id === pinnedCommitmentId);
    if (pinned && !topFocusItems.some(c => c._id === pinnedCommitmentId)) {
      topFocusItems.push({ ...pinned, _displayRisk: Math.max(pinned.currentRiskScore || 0, computeLiveRisk(pinned)), _isPinnedExtra: true });
    }
  }

  const fullGreeting = `${timeOfDay}, `;
  const nameString = `${firstName}`;
  const punctuation = '.';

  const renderAnimatedText = (text, className, startIndex) => {
    return text.split('').map((char, index) => (
      <span 
        key={index} 
        className={`${styles.animatedChar} ${className || ''}`}
        style={{ animationDelay: `${(startIndex + index) * 0.08}s` }}
      >
        {char === ' ' ? '\u00A0' : char}
      </span>
    ));
  };

  return (
    <div 
      className={styles.dashboardContainer}
      style={{ backgroundPositionY: `${bgY}%` }}
    >
      <div 
        className={styles.plantForeground}
        style={{ backgroundPositionY: `${bgY}%` }}
      />
      <DashboardNavbar />

      <section className={styles.heroSection}>
        <h1 className={styles.heroTitle}>
          {renderAnimatedText(fullGreeting, '', 0)}
          {renderAnimatedText(nameString, styles.heroName, fullGreeting.length)}
          {renderAnimatedText(punctuation, styles.heroPunctuation, fullGreeting.length + nameString.length)}
        </h1>
        {isBestZoneActive() && (
          <div className={styles.bestZoneHeroBanner}>
            ⚡ Your productivity peak is right now.
            <div className={styles.bestZoneUnderline}></div>
          </div>
        )}
      </section>

      <main className={styles.mainContent}>
        <div className={styles.contentSection}>

        {/* ─── Metric Cards Row ─── */}
        <div className={styles.metricsRow}>
          {/* Card 1: Horizon */}
          <div 
            className={`${styles.metricCard} ${styles.metricCardHorizon} ${styles.glassCard} ${styles.centeredCard}`}
            style={{ zIndex: getZIndex('horizon') }}
            onMouseEnter={() => handleCardInteraction('horizon')}
            onMouseLeave={handleCardLeave}
            onClick={() => handleCardInteraction('horizon')}
          >
            <div className={styles.metricLabelWrapper}>
              <div className={`${styles.iconContainer} ${styles.iconContainerBlue}`}><Rocket size={20} className={styles.cardIcon} /></div>
              <div className={styles.metricLabel}>Current Horizon</div>
            </div>
            <div className={styles.metricValueContainer}>
              <div className={styles.metricValue}>{stats?.activeCommitments || 0} Active Syncs</div>
            </div>
            {stats?.completionRate !== undefined && (
              <div className={styles.metricHint}>
                <p className={styles.metricHintText}>
                  <Trophy size={16} /> All-time Completion Rate: <strong>{stats.completionRate}%</strong>
                </p>
                <p className={styles.metricHintMeta}>Keep up the great momentum!</p>
              </div>
            )}
            {!hasCommitments && (
              <div className={styles.emptyStateContainer} style={{marginTop: '1rem'}}>
                <p className={styles.emptyStateText}>Focuses your brain on 3 manageable workloads with less risk.</p>
                <button onClick={(e) => { e.stopPropagation(); navigate('/syncs'); }} className={styles.emptyStateButton}>+ New Sync</button>
              </div>
            )}
          </div>

          {/* Card 2: Reliability Score */}
          <div 
            className={`${styles.metricCard} ${styles.metricCardReliability} ${styles.glassCard} ${styles.centeredCard}`}
            style={{ zIndex: getZIndex('reliability') }}
            onMouseEnter={() => handleCardInteraction('reliability')}
            onMouseLeave={handleCardLeave}
            onClick={() => handleCardInteraction('reliability')}
          >
            <div className={styles.metricLabelWrapper}>
              <div className={`${styles.iconContainer} ${styles.iconContainerPurple}`}><Sparkles size={20} className={styles.cardIcon} /></div>
              <div className={styles.metricLabel}>Reliability Score</div>
            </div>
            <div className={styles.metricValueContainer} style={{position: 'relative', width: '80px', height: '80px'}}>
              {renderRingChart(stats?.reliabilityScore || 0, isStatsLoading, true)}
              <div className={styles.metricValue} style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '1.5rem', margin: 0}}>
                {stats?.reliabilityScore || 0}%
              </div>
            </div>
            {!hasCommitments && (
              <div className={styles.emptyStateContainer} style={{marginTop: '1rem'}}>
                <p className={styles.emptyStateText}>Builds trust with peers. Complete syncs on time to motivate yourself!</p>
              </div>
            )}
            {hasCommitments && stats?.reliabilityScore !== undefined && (
              <div className={`${styles.metricHint} ${styles.metricHintPurple}`}>
                <p className={styles.metricHintText}>
                  <Zap size={16} /> Complete active syncs to reach <strong>{Math.min(100, Math.round(stats.reliabilityScore + (100 - stats.reliabilityScore) * 0.1))}%</strong>
                </p>
              </div>
            )}
          </div>

          {/* Card 3: Best Zone */}
          <div 
            className={`${styles.metricCard} ${styles.metricCardZone} ${styles.glassCard} ${styles.centeredCard}`}
            style={{ zIndex: getZIndex('zone') }}
            onMouseEnter={() => handleCardInteraction('zone')}
            onMouseLeave={handleCardLeave}
            onClick={() => handleCardInteraction('zone')}
          >
            <div className={styles.metricLabelWrapper}>
              <div className={`${styles.iconContainer} ${styles.iconContainerAmber}`}><Sunrise size={20} className={styles.cardIcon} /></div>
              <div className={styles.metricLabel}>Your Best Zone</div>
            </div>
            <div className={styles.metricValueContainer}>
              <div className={styles.metricValue} style={{fontSize: '1.75rem'}}>
                {stats?.bestZone && stats.bestZone !== 'Not enough data' ? stats.bestZone : 'Analyzing Cycle...'}
              </div>
              <Flame size={34} className={styles.zoneSparkIcon} />
            </div>
            {stats?.bestZoneContext && stats?.bestZone !== 'Not enough data' && (
              <div className={styles.emptyStateContainer} style={{marginTop: '0.75rem'}}>
                <p className={styles.feedMeta} style={{fontSize: '0.8rem', lineHeight: '1.4', margin: 0}}>
                  {stats.bestZoneContext}
                </p>
              </div>
            )}
            {(!hasCommitments || stats?.bestZone === 'Not enough data') && (
              <div className={styles.emptyStateContainer} style={{marginTop: '1rem'}}>
                <p className={styles.emptyStateText}>Identified through analytics to boost confidence. Check back after closing syncs!</p>
              </div>
            )}
            {hasCommitments && isBestZoneActive() && (
              <div className={`${styles.metricHint} ${styles.metricHintGreen}`}>
                <p className={styles.metricHintText}>
                  <Flame size={16} /> You are in your Best Zone right now! <strong>Focus up!</strong>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ─── Best Zone Active Strip ─── */}
        {isBestZoneActive() && topFocusItems.length > 0 && (
          <div className={styles.bestZoneStrip}>
             <div className={styles.bestZoneStripLeft}>
                <div className={styles.bestZoneIconWrapper}>⚡</div>
                <div className={styles.bestZoneTextWrapper}>
                  <h4>Peak Focus Active</h4>
                  <p>Tackle "{topFocusItems[0].title}" while your energy is highest.</p>
                </div>
             </div>
             <button 
                className={styles.bestZoneStripBtn}
                onClick={(e) => { e.stopPropagation(); navigate('/syncs'); }}
             >
               Start 2h Focus Session
             </button>
          </div>
        )}

        {/* ─── Focus Radar ─── */}
        <div 
          className={`${styles.sectionCard} ${styles.glassCard}`}
          style={{ zIndex: getZIndex('focus') }}
          onMouseEnter={() => handleCardInteraction('focus')}
          onMouseLeave={handleCardLeave}
          onClick={() => handleCardInteraction('focus')}
        >
          <div className={styles.sectionHeader}>
            <div className={styles.iconContainer}><Target className={styles.cardIcon} size={20} color="#4F46E5" /></div>
            <h2 className={styles.sectionTitle}>Focus Radar</h2>
          </div>

          <div className={styles.focusRadarGrid}>
            {hasCommitments ? (
              topFocusItems.map(item => {
                const riskColor = item._displayRisk >= 75 ? '#EF4444' : item._displayRisk >= 50 ? '#F59E0B' : '#10B981';
                const riskBg = item._displayRisk >= 75 ? 'rgba(239, 68, 68, 0.1)' : item._displayRisk >= 50 ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)';
                
                const isPinned = item._id === pinnedCommitmentId;
                
                return (
                  <div key={item._id} className={styles.focusItem} style={isPinned ? { borderLeft: '4px solid #F59E0B' } : {}}>
                    <div style={{ background: riskBg, color: riskColor, padding: '0.75rem', borderRadius: '12px', textAlign: 'center', minWidth: '70px', marginRight: '1.25rem' }}>
                      <div style={{fontSize: '1.25rem', fontWeight: 800, lineHeight: 1}}>{item._displayRisk}%</div>
                      <div style={{fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px', fontWeight: 600}}>Risk</div>
                    </div>
                    
                    <div className={styles.focusItemLeft}>
                      <h3 className={styles.focusItemTitle}>
                        {item.title}
                        {isPinned && (
                          <span style={{ marginLeft: '8px', fontSize: '0.7rem', background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', gap: '4px', verticalAlign: 'middle' }}>
                            <Star size={10} style={{ fill: '#F59E0B' }} /> Priority
                          </span>
                        )}
                      </h3>
                      <div className={styles.focusItemMeta}>
                        <span className={styles.focusItemCategory}>{item.category}</span>
                        <span style={{fontSize: '0.75rem', fontWeight: 600, color: '#4F46E5', background: 'rgba(79, 70, 229, 0.1)', padding: '2px 6px', borderRadius: '4px'}}>
                          {Math.round(item.progress || 0)}% Complete
                        </span>
                      </div>
                    </div>
                    
                    <div className={`${item.isTeamCommitment ? styles.focusItemProgressBgTeam : styles.focusItemProgressBg}`} style={{ width: `${item.progress || 0}%` }}></div>

                    <div className={styles.focusItemRight}>
                      <div className={`${styles.coachingPill} ${item.isTeamCommitment ? styles.pillSlate : styles.pillPrimary}`}>
                        {generateCoachingText(item)}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className={styles.onboardingBlock}>
                <p className={styles.onboardingText}>Focuses on the top 3 syncs that need immediate attention.</p>
                <button onClick={(e) => { e.stopPropagation(); navigate('/syncs'); }} className={styles.emptyStateButton}>Get Started</button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Bottom Feeds ─── */}
        <div className={styles.bottomFeeds}>
          {/* Circles Pulse Card */}
          <div 
            className={`${styles.sectionCard} ${styles.glassCard}`}
            style={{ zIndex: getZIndex('circles') }}
            onMouseEnter={() => handleCardInteraction('circles')}
            onMouseLeave={handleCardLeave}
            onClick={(e) => { e.stopPropagation(); navigate('/circles'); }}
          >
            <div className={styles.sectionHeader} style={{justifyContent: 'space-between', cursor: 'pointer'}}>
              <div style={{display: 'flex', alignItems: 'center'}}>
                <div className={styles.iconContainer}><Activity className={styles.cardIcon} size={20} color="#10B981" /></div>
                <h2 className={styles.sectionTitle}>Circles Pulse</h2>
              </div>
              <div className={styles.navArrowContainer}>
                <ArrowRight size={18} className={styles.navArrow} />
              </div>
            </div>
            {friendsData?.friends?.length > 0 ? (
               <div className={styles.feedItem}>
                 <h4 className={styles.feedTitle}>You have {friendsData.friends.length} active connection{friendsData.friends.length > 1 ? 's' : ''}.</h4>
                 <p className={styles.feedMeta}>
                   {friendsData.friends[0]?.name ? `${friendsData.friends[0].name.split(' ')[0]} just lowered their commitment risk by 15%. Join them!` : 'Keep your circles engaged by sharing your progress.'}
                 </p>
               </div>
            ) : (
               <div className={styles.emptyFeedState}>
                 <p className={styles.feedEmptyText}>Find friends and share visibility. Get motivated by seeing your peers' recent successes!</p>
                 <button className={styles.actionLinkBtn} onClick={(e) => { e.stopPropagation(); navigate('/circles'); }}>Find Friends</button>
               </div>
            )}
          </div>

          {/* Team Commitments Card */}
          <div 
            className={`${styles.sectionCard} ${styles.glassCard}`}
            style={{ zIndex: getZIndex('team') }}
            onMouseEnter={() => handleCardInteraction('team')}
            onMouseLeave={handleCardLeave}
            onClick={(e) => { e.stopPropagation(); navigate('/team/new'); }}
          >
            <div className={styles.sectionHeader} style={{justifyContent: 'space-between', cursor: 'pointer'}}>
              <div style={{display: 'flex', alignItems: 'center'}}>
                <div className={styles.iconContainer}><Users className={styles.cardIcon} size={20} color="#64748B" /></div>
                <h2 className={styles.sectionTitle}>Team Commitments</h2>
              </div>
              <div className={styles.navArrowContainer}>
                <ArrowRight size={18} className={styles.navArrow} />
              </div>
            </div>
            {commitments.filter(c => c.isTeamCommitment).length > 0 ? (
               commitments.filter(c => c.isTeamCommitment).slice(0, 3).map(c => (
                 <div key={c._id} className={styles.feedItem}>
                   <h4 className={styles.feedTitle}>{c.title}</h4>
                   <p className={styles.feedMeta}>Due {new Date(c.deadline).toLocaleDateString()} • <span style={{color: '#D35400', fontWeight: 500}}>High Team Impact</span></p>
                 </div>
               ))
            ) : teamsData?.teams?.length > 0 ? (
               <div className={styles.feedItem}>
                 <h4 className={styles.feedTitle}>Your teams are quiet.</h4>
                 <p className={styles.feedMeta}>You are part of {teamsData.teams.length} team{teamsData.teams.length > 1 ? 's' : ''}. Start a team sync to align your efforts.</p>
                 <button className={styles.actionLinkBtn} style={{marginTop: '0.5rem'}} onClick={(e) => { e.stopPropagation(); navigate('/team'); }}>View Teams</button>
               </div>
            ) : (
               <div className={styles.emptyFeedState}>
                 <p className={styles.feedEmptyText}>Collaborate with others. Create a team to align your efforts and track shared commitments.</p>
                 <button className={styles.actionLinkBtn} onClick={(e) => { e.stopPropagation(); navigate('/team'); }}>Create Team</button>
               </div>
            )}
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}
