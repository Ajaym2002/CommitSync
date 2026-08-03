import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend, AreaChart, Area, CartesianGrid
} from 'recharts';
import { Brain, Activity, Target, Clock, Zap, Sunrise, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import axios from '../api/axios';
import DashboardNavbar from '../components/dashboard/DashboardNavbar';
import styles from './Insights.module.css';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { 
    opacity: 1, y: 0, 
    transition: { type: 'spring', stiffness: 300, damping: 24 } 
  }
};

export default function Insights() {
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [riskFactorData, setRiskFactorData] = useState([]);
  const [riskData, setRiskData] = useState([]);
  const [aiInsights, setAiInsights] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [behavioralProfile, setBehavioralProfile] = useState(null);

  useEffect(() => {
    const fetchInsightsData = async () => {
      try {
        setLoading(true);
        const [overviewRes, riskRes, profileRes] = await Promise.all([
          axios.get('/analytics/overview'),
          axios.get('/analytics/risk-overview'),
          axios.get('/analytics/behavioral-profile')
        ]);

        setOverview(overviewRes.data.data);
        setBehavioralProfile(profileRes.data.data);
        
        const breakdown = overviewRes.data.data.riskBreakdownCounts;
        if (breakdown) {
          setRiskFactorData([
            { name: 'Time Pressure', count: breakdown.timePressure || 0, color: '#ef4444' },
            { name: 'Workload Density', count: breakdown.workloadDensity || 0, color: '#f59e0b' },
            { name: 'Historical Reliability', count: breakdown.historicalReliability || 0, color: '#3b82f6' },
            { name: 'Recommit Frequency', count: breakdown.recommitFrequency || 0, color: '#8b5cf6' }
          ]);
        }

        const riskDist = riskRes.data.data.riskDistribution;
        setRiskData([
          { name: 'Low Risk', value: riskDist.low, color: '#10b981' },
          { name: 'Medium Risk', value: riskDist.medium, color: '#f59e0b' },
          { name: 'High Risk', value: riskDist.high, color: '#f97316' },
          { name: 'Critical Risk', value: riskDist.critical, color: '#ef4444' }
        ].filter(item => item.value > 0));

      } catch (error) {
        console.error('Error fetching insights data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchInsightsData();
  }, []);

  const handleGenerateInsight = async () => {
    try {
      setIsAiLoading(true);
      const aiRes = await axios.get('/analytics/ai-insights');
      setAiInsights(aiRes.data.data);
    } catch (err) {
      console.error("Failed to load AI Insights", err);
      if (err.response && err.response.status === 429) {
        setAiInsights({ insight: "Rate limit reached.", recommendation: "Please wait a few seconds and try again." });
      } else {
        setAiInsights({ insight: "AI Service Unavailable", recommendation: "Please check your network or API key configuration." });
      }
    } finally {
      setIsAiLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.insightsContainer}>
        <DashboardNavbar activeSection="insights" />
        <main className={styles.mainContent}>
          <div className={styles.loadingState}>
            <div className={styles.spinner}></div>
            <p>Analyzing your productivity patterns...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.insightsContainer}>
      <DashboardNavbar activeSection="insights" />
      
      <main className={styles.mainContent}>
        <motion.div 
          className={styles.header}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className={styles.title}>Your Productivity Insights</h1>
          <p className={styles.subtitle}>Data-driven analysis of your work habits and patterns</p>
        </motion.div>

        <motion.div 
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className={styles.bentoGrid}
        >
          {/* AI Recommendations Card (Large - Left) */}
          <motion.div variants={itemVariants} className={`${styles.card} ${styles.aiCard} ${styles.bentoItemLarge}`}>
            <div className={styles.cardHeader}>
              <Brain size={28} className={styles.aiIcon} />
              <h2 className={styles.cardTitle}>AI Coach Recommendations</h2>
            </div>
            
            {isAiLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '1rem' }}>
                <div className={styles.spinner} style={{ width: '20px', height: '20px', borderTopColor: '#3b82f6' }}></div>
                <p style={{ color: '#64748b' }}>Analyzing your patterns...</p>
              </div>
            ) : aiInsights ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <p className={styles.insightText}>"{aiInsights.insight}"</p>
                <div className={styles.recommendationText} style={{ marginTop: 'auto' }}>
                  <strong>Action Plan: </strong> 
                  {aiInsights.recommendation}
                </div>
              </motion.div>
            ) : (
              <div style={{ marginTop: '1rem', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <p className={styles.insightText} style={{ marginBottom: '1rem', fontSize: '1.25rem' }}>Get a personalized, data-driven analysis of your recent work habits directly from your AI Coach.</p>
                <button 
                  onClick={handleGenerateInsight}
                  style={{
                    backgroundColor: '#3b82f6',
                    color: 'white',
                    border: 'none',
                    padding: '14px 28px',
                    borderRadius: '16px',
                    fontFamily: 'Outfit, sans-serif',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                    boxShadow: '0 8px 24px rgba(59, 130, 246, 0.25)',
                    marginTop: 'auto',
                    width: 'fit-content'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#2563eb';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 12px 32px rgba(59, 130, 246, 0.35)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = '#3b82f6';
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(59, 130, 246, 0.25)';
                  }}
                >
                  <Brain size={20} /> Analyze My Habits
                </button>
              </div>
            )}
          </motion.div>

          {/* Reliability Score */}
          <motion.div variants={itemVariants} className={`${styles.card} ${styles.bentoItemSmall}`}>
            <div className={styles.cardHeader}>
              <Target size={24} className={styles.aiIcon} />
              <h2 className={styles.cardTitle}>Reliability Score</h2>
            </div>
            <div className={styles.statValue}>{overview?.reliabilityScore || 0}%</div>
            <div className={styles.statLabel}>On-Time Completion Rate</div>
          </motion.div>
          
          {/* Dominant Risk Factor */}
          <motion.div variants={itemVariants} className={`${styles.card} ${styles.bentoItemSmall}`}>
            <div className={styles.cardHeader}>
              <Clock size={24} className={styles.aiIcon} style={{ color: '#ef4444' }} />
              <h2 className={styles.cardTitle}>Dominant Risk</h2>
            </div>
            <div className={styles.statValue} style={{ fontSize: overview?.dominantRiskFactor === 'Insufficient Data' ? '1.5rem' : '2rem' }}>
              {overview?.dominantRiskFactor || 'N/A'}
            </div>
            <div className={styles.statLabel}>Primary productivity blocker</div>
          </motion.div>

          {/* Peak Productivity Window */}
          <motion.div variants={itemVariants} className={`${styles.card} ${styles.bentoItemMedium}`}>
            <div className={styles.cardHeader}>
              <Sunrise size={24} className={styles.aiIcon} style={{ color: '#f59e0b' }} />
              <h2 className={styles.cardTitle}>Peak Productivity Window</h2>
            </div>
            
            {aiInsights?.persona && (
              <div className={styles.personaBadge}>
                <span className={styles.personaLabel}>Persona:</span>
                <span className={styles.personaValue}>{aiInsights.persona.replace(/_/g, ' ')}</span>
              </div>
            )}

            <div className={styles.statValue}>{overview?.bestZone || 'N/A'}</div>
            <div className={styles.statLabel} title="Calculated based on your historical completion timestamps.">
              {overview?.bestZoneContext || 'Complete more tasks to establish a pattern'}
            </div>
          </motion.div>

          {/* Recent Velocity */}
          <motion.div variants={itemVariants} className={`${styles.card} ${styles.bentoItemMedium}`}>
            <div className={styles.cardHeader}>
              <TrendingUp size={20} className={styles.aiIcon} style={{ color: '#10B981' }} />
              <h3 className={styles.cardTitle}>Recent Velocity</h3>
            </div>
            <div className={styles.chartContainer}>
              {overview?.recentVelocity && overview.recentVelocity.some(d => d.completed > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={overview.recentVelocity} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorVelocity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                    <XAxis dataKey="name" stroke="#8b92a5" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#8b92a5" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid rgba(26,29,32,0.1)', borderRadius: '16px', color: '#1A1D20', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                      itemStyle={{ color: '#10B981', fontWeight: 600 }}
                      formatter={(value) => [value, 'Completed']}
                    />
                    <Area type="monotone" dataKey="completed" stroke="#10B981" strokeWidth={3} fillOpacity={1} fill="url(#colorVelocity)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className={styles.loadingState}>Not enough recent activity to display velocity.</div>
              )}
            </div>
          </motion.div>

          {/* Risk Factor Analysis */}
          <motion.div variants={itemVariants} className={`${styles.card} ${styles.bentoItemMedium}`}>
            <div className={styles.cardHeader}>
              <Activity size={20} className={styles.aiIcon} style={{ color: '#8b5cf6' }} />
              <h3 className={styles.cardTitle}>Risk Factors</h3>
            </div>
            <div className={styles.chartContainer}>
              {riskFactorData.some(d => d.count > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={riskFactorData} margin={{ top: 20, right: 10, left: -25, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                    <XAxis dataKey="name" stroke="#8b92a5" fontSize={9} tickLine={false} axisLine={false} tickFormatter={(value) => value.split(' ')[0]} />
                    <YAxis stroke="#8b92a5" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip 
                      cursor={{fill: 'rgba(26,29,32,0.03)'}}
                      contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid rgba(26,29,32,0.1)', borderRadius: '16px', color: '#1A1D20', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                      formatter={(value) => [value, 'Commitments']}
                    />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {riskFactorData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className={styles.loadingState} style={{ fontSize: '0.9rem', textAlign: 'center' }}>Not enough data to analyze.</div>
              )}
            </div>
          </motion.div>

          {/* Risk Distribution */}
          <motion.div variants={itemVariants} className={`${styles.card} ${styles.bentoItemMedium}`}>
            <div className={styles.cardHeader}>
              <Zap size={20} className={styles.aiIcon} style={{ color: '#f97316' }} />
              <h3 className={styles.cardTitle}>Distribution</h3>
            </div>
            <div className={styles.chartContainer}>
              {riskData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={riskData}
                      cx="50%"
                      cy="45%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                      stroke="none"
                    >
                      {riskData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid rgba(26,29,32,0.1)', borderRadius: '16px', color: '#1A1D20', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                      itemStyle={{ fontWeight: 600 }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className={styles.loadingState} style={{ fontSize: '0.9rem', textAlign: 'center' }}>No active commitments.</div>
              )}
            </div>
          </motion.div>
        </motion.div>

        {/* ── BEHAVIORAL DNA PANEL ── */}
        {behavioralProfile && (
          <motion.div 
            className={styles.dnaPanelContainer}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            <h2 className={styles.dnaPanelTitle}>Your Behavioral DNA</h2>
            <div className={styles.dnaGrid}>
              
              {/* Pattern */}
              <div className={styles.dnaCard}>
                <div className={styles.dnaCardHeader}>
                  <Brain size={20} className={styles.dnaIcon} />
                  <h3>YOUR PATTERN</h3>
                </div>
                <div className={styles.patternBadge}>
                  {behavioralProfile.behavioralPattern?.replace(/_/g, ' ') || 'MIXED'}
                </div>
                <p className={styles.dnaText}>
                  {behavioralProfile.behavioralPattern === 'LAST_MINUTE_SPRINTER' ? "You deliver under pressure but often sacrifice quality." :
                   behavioralProfile.behavioralPattern === 'PROCRASTINATOR' ? "You tend to delay tasks until the last possible moment." :
                   behavioralProfile.behavioralPattern === 'OPTIMISTIC_SCHEDULER' ? "You underestimate how long tasks take to complete." :
                   "A balanced approach to commitments."}
                </p>
              </div>

              {/* Category Strength */}
              <div className={styles.dnaCard}>
                <div className={styles.dnaCardHeader}>
                  <Target size={20} className={styles.dnaIcon} style={{ color: '#10b981' }} />
                  <h3>CATEGORY STRENGTH</h3>
                </div>
                <div className={styles.categoryList}>
                  {behavioralProfile.categoryBreakdown && Object.keys(behavioralProfile.categoryBreakdown).length > 0 ? (
                    Object.entries(behavioralProfile.categoryBreakdown).slice(0, 3).map(([cat, stats]) => (
                      <div key={cat} className={styles.categoryRow}>
                        <span className={styles.categoryName}>{cat}</span>
                        <div className={styles.categoryBarBg}>
                           <div className={styles.categoryBarFill} style={{ width: `${stats.successRate}%`, backgroundColor: stats.successRate >= 80 ? '#10b981' : stats.successRate >= 50 ? '#f59e0b' : '#ef4444' }}></div>
                        </div>
                        <span className={styles.categoryScore}>{stats.successRate}%</span>
                      </div>
                    ))
                  ) : (
                    <p className={styles.dnaText}>Complete more syncs to unlock category strengths.</p>
                  )}
                </div>
              </div>

              {/* Work Limits */}
              <div className={styles.dnaCard}>
                <div className={styles.dnaCardHeader}>
                  <Activity size={20} className={styles.dnaIcon} style={{ color: '#8b5cf6' }} />
                  <h3>YOUR WORK LIMITS</h3>
                </div>
                <div className={styles.limitItems}>
                  <div className={styles.limitItem}>
                    <span>Max Sustainable Workload:</span>
                    <strong>{behavioralProfile.maxSustainableWorkload || 4} tasks</strong>
                  </div>
                  <div className={styles.limitItem}>
                    <span>Peak Performance Time:</span>
                    <strong>
                      {behavioralProfile.bestPerformanceTimeOfDay
                        ? behavioralProfile.bestPerformanceTimeOfDay.charAt(0) + behavioralProfile.bestPerformanceTimeOfDay.slice(1).toLowerCase()
                        : overview?.bestZone?.split(' ')[0] || 'Unknown'}
                    </strong>
                  </div>
                  {behavioralProfile.worstPerformanceDayOfWeek && behavioralProfile.worstPerformanceDayOfWeek !== 'MONDAY' && (
                    <div className={styles.limitItem}>
                      <span>Weakest Day:</span>
                      <strong style={{ color: '#ef4444' }}>
                        ⚠️ {behavioralProfile.worstPerformanceDayOfWeek.charAt(0) + behavioralProfile.worstPerformanceDayOfWeek.slice(1).toLowerCase()}
                      </strong>
                    </div>
                  )}
                  <div className={styles.limitItem}>
                    <span>Burnout Recovery:</span>
                    <strong>~{behavioralProfile.burnoutRecoveryDays || 3} days needed</strong>
                  </div>
                </div>
              </div>

              
            </div>
            <p className={styles.dnaFooterText}>This profile updates automatically as you complete more syncs.</p>
          </motion.div>
        )}
      </main>
    </div>
  );
}
