export function computeNudges(commitments, userProfile, stats, historicalCommitments = []) {
  const nudges = [];
  const now = new Date();

  if (!userProfile) return nudges;

  // RULE 1: Burnout Warning
  // If user has > maxSustainableWorkload active commitments AND reliability score is dropping (using a static heuristic if not explicitly tracked over time, or just checking max workload)
  const maxWorkload = userProfile.maxSustainableWorkload || 4;
  if (commitments.length > maxWorkload) {
    // Find the single most urgent commitment — highest risk first, then nearest deadline
    const mostUrgent = [...commitments].sort((a, b) => {
      const riskDiff = (b.currentRiskScore || 0) - (a.currentRiskScore || 0);
      if (riskDiff !== 0) return riskDiff;
      return new Date(a.deadline || 0) - new Date(b.deadline || 0);
    })[0];

    const urgentLabel = mostUrgent
      ? (mostUrgent.currentRiskScore >= 65
          ? `"${mostUrgent.title}" is your most critical right now (risk: ${mostUrgent.currentRiskScore}%).`
          : `"${mostUrgent.title}" has the nearest deadline — tackle that one first.`)
      : '';

    nudges.push({
      id: 'overloaded',
      type: 'warning',
      icon: '🔥',
      title: 'You have a lot on your plate',
      body: `You have ${commitments.length} syncs listed — above your comfortable limit of ${maxWorkload}. Don't spread yourself thin. ${urgentLabel} Concentrate on it before moving to others.`,
      action: mostUrgent ? { label: 'Focus Now', commitmentId: mostUrgent._id } : null
    });
  }


  // RULE 2: Pattern-specific nudge
  const pattern = userProfile.behavioralPattern || 'MIXED';
  if (pattern === 'PROCRASTINATOR') {
    const stagnant = commitments.filter(c => {
      // Progress hasn't moved in 3+ days
      const lastUpdate = new Date(c.updatedAt || c.createdAt);
      return (now - lastUpdate) / 86400000 > 3 && c.progress < 80;
    });
    if (stagnant.length > 0) {
      nudges.push({
        id: 'stagnant_procrastinator',
        type: 'info',
        icon: '⏳',
        title: `${stagnant.length} sync${stagnant.length > 1 ? 's' : ''} untouched for 3+ days`,
        body: `"${stagnant[0].title}" hasn't moved. Your pattern shows you work best with short bursts — try just 25 minutes on it right now.`,
        action: { label: 'Open Sync', commitmentId: stagnant[0]._id }
      });
    }
  } else if (pattern === 'LAST_MINUTE_SPRINTER') {
     const urgent = commitments.filter(c => {
        const hoursLeft = (new Date(c.deadline) - now) / 3600000;
        return hoursLeft > 0 && hoursLeft <= 24 && c.progress < 80;
     });
     if (urgent.length > 0) {
        nudges.push({
          id: 'last_minute_sprinter',
          type: 'warning',
          icon: '🏃',
          title: `It's sprint time for "${urgent[0].title}"`,
          body: `You thrive under pressure, and you have less than 24 hours left. Time to focus and deliver.`,
          action: { label: 'Go Focus', commitmentId: urgent[0]._id }
        });
     }
  }

  // RULE 3: Category Weakness Spotlight
  // If user has missed >= 2 commitments in the same category recently
  if (historicalCommitments.length > 0) {
      const recentMissed = historicalCommitments.filter(c => c.status === 'MISSED' || c.status === 'FAILED');
      const categoryCounts = {};
      recentMissed.forEach(c => {
          categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
      });
      const weakCategory = Object.keys(categoryCounts).find(cat => categoryCounts[cat] >= 2);
      if (weakCategory) {
          const activeInWeakCategory = commitments.filter(c => c.category === weakCategory);
          if (activeInWeakCategory.length > 0) {
              nudges.push({
                id: `weak_category_${weakCategory}`,
                type: 'info',
                icon: '🎯',
                title: `Careful with your ${weakCategory} syncs`,
                body: `You've missed some ${weakCategory} syncs recently. Pay extra attention to "${activeInWeakCategory[0].title}" to break the cycle.`,
                action: { label: 'View Sync', commitmentId: activeInWeakCategory[0]._id }
              });
          }
      }
  }

  // RULE 4: Best Zone Active
  const hour = now.getHours();
  const bestZone = stats?.bestZone?.toLowerCase() || '';
  const isInBestZone = (
    (bestZone.includes('morning') && hour >= 6 && hour < 12) ||
    (bestZone.includes('afternoon') && hour >= 12 && hour < 17) ||
    (bestZone.includes('evening') && hour >= 17 && hour < 21)
  );
  
  const highRiskCommitments = commitments.filter(c => c.currentRiskScore >= 65);
  if (isInBestZone && highRiskCommitments.length > 0) {
    nudges.push({
      id: 'best_zone_active',
      type: 'success',
      icon: '⚡',
      title: "You're in your Best Zone right now!",
      body: `This is your peak productivity window. You have ${highRiskCommitments.length} high-risk sync${highRiskCommitments.length > 1 ? 's' : ''} — now is the perfect time to tackle "${highRiskCommitments[0].title}".`,
      action: { label: 'Go Focus', commitmentId: highRiskCommitments[0]._id }
    });
  }

  // RULE 5: Worst Day Warning
  // If today is historically the user's worst day for missing commitments,
  // and they have high-risk active items, warn them.
  if (historicalCommitments.length >= 4) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayName = dayNames[now.getDay()];
    const missedItems = historicalCommitments.filter(c => c.status === 'MISSED' || c.status === 'FAILED');
    const dayCounts = {};
    missedItems.forEach(c => {
      const day = dayNames[new Date(c.deadline).getDay()];
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    const worstEntry = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
    const highRisk = commitments.filter(c => (c.currentRiskScore || 0) >= 65);
    if (worstEntry && worstEntry[0] === todayName && worstEntry[1] >= 2 && highRisk.length > 0) {
      nudges.push({
        id: `worst_day_${todayName}`,
        type: 'warning',
        icon: '📅',
        title: `Heads up — ${todayName} is your weakest day`,
        body: `You've missed ${worstEntry[1]} commitment${worstEntry[1] > 1 ? 's' : ''} on ${todayName}s. You have ${highRisk.length} high-risk sync${highRisk.length > 1 ? 's' : ''} today — stay extra focused.`,
        action: { label: 'View Highest Risk', commitmentId: highRisk[0]._id }
      });
    }
  }

  // RULE 6: Optimistic Scheduler Scope Alert
  // If pattern is OPTIMISTIC_SCHEDULER and a commitment's estimated hours
  // far exceed the available hours before its deadline, they've underestimated again.
  if (pattern === 'OPTIMISTIC_SCHEDULER') {
    const underestimated = commitments.filter(c => {
      const daysLeft = Math.max(0, (new Date(c.deadline) - now) / 86400000);
      const hoursAvailable = daysLeft * 8;
      return hoursAvailable > 0 && (c.estimatedHours || 0) > hoursAvailable * 1.5 && (c.progress || 0) < 50;
    });
    if (underestimated.length > 0) {
      nudges.push({
        id: `optimistic_scope_${underestimated[0]._id}`,
        type: 'warning',
        icon: '📐',
        title: 'You may have underestimated again',
        body: `"${underestimated[0].title}" looks tight based on the deadline. Your pattern shows you often underestimate task durations — consider breaking it down or adjusting the deadline now.`,
        action: { label: 'Review Sync', commitmentId: underestimated[0]._id }
      });
    }
  }

  // RULE 7: Overcommitter Triage
  // If pattern is OVERCOMMITTER and they're above their workload limit,
  // surface the single highest-risk item to focus on first.
  if (pattern === 'OVERCOMMITTER' && commitments.length > maxWorkload) {
    const topRisk = [...commitments].sort((a, b) => (b.currentRiskScore || 0) - (a.currentRiskScore || 0))[0];
    // Only show if burnout nudge isn't already shown (avoid duplicate overload messages)
    const alreadyHasOverloadNudge = nudges.some(n => n.id === 'overloaded');
    if (topRisk && !alreadyHasOverloadNudge) {
      nudges.push({
        id: 'overcommitter_triage',
        type: 'warning',
        icon: '⚠️',
        title: 'Triage your workload now',
        body: `You're carrying ${commitments.length} syncs — above your limit of ${maxWorkload}. Focus on "${topRisk.title}" first — it's your highest risk item right now.`,
        action: { label: 'Go to Priority', commitmentId: topRisk._id }
      });
    }
  }

  // Filter out any dismissed nudges (read from localStorage)
  let activeNudges = nudges.filter(n => {
     try {
       const dismissedAt = localStorage.getItem(`nudge_dismissed_${n.id}`);
       if (dismissedAt) {
          const hoursSinceDismissed = (now.getTime() - parseInt(dismissedAt)) / 3600000;
          if (hoursSinceDismissed < 24) return false; // Hide for 24h
       }
     } catch (e) {
       // Ignore localStorage errors
     }
     return true;
  });

  // Prioritize (success > warning > info)
  const typeScore = { success: 3, warning: 2, info: 1 };
  activeNudges.sort((a, b) => typeScore[b.type] - typeScore[a.type]);

  // Return max 3 (raised from 2 — rules are now more targeted and specific)
  return activeNudges.slice(0, 3);
}
