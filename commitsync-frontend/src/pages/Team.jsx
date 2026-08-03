import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import {
  Sparkles, Calendar, Trash2, Check, GripVertical, Plus, 
  RefreshCw, Users, AlertOctagon, UserPlus, FileCheck, Copy, Share2,
  ChevronDown, ChevronRight, X, Clock, Bell, Send, TrendingUp, Activity, ShieldAlert, MessageSquare
} from 'lucide-react';
import DashboardNavbar from '../components/dashboard/DashboardNavbar';
import styles from './Syncs.module.css';

let _id = 0;
const uid = () => `task-${Date.now()}-${_id++}`;

const isMemberAssigned = (assigned, memberId) => {
  if (!assigned) return false;
  const targetId = String(memberId?._id || memberId);
  if (Array.isArray(assigned)) {
    return assigned.some(u => String(u?._id || u) === targetId);
  }
  return String(assigned?._id || assigned) === targetId;
};

const getDisplayTeamName = (title, teamName) => {
  if (!teamName) return 'Team Goal';
  const normTitle = (title || '').toLowerCase().trim();
  const normTeam = (teamName || '').toLowerCase().trim();
  if (normTeam === normTitle || normTeam === `${normTitle} team` || normTeam === `${normTitle} team's goal`) {
    return 'Team Goal';
  }
  return teamName;
};



export default function Team() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Teams Query ────────────────────────────────────────────────────────────
  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => { const r = await api.get('/teams'); return r.data.data.teams; }
  });
  const teams = Array.isArray(teamsData) ? teamsData : (teamsData?.teams || []);

  // ── Friends Query ──────────────────────────────────────────────────────────
  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => { 
      try { const r = await api.get('/friends'); return r.data.data.friends || r.data.data; } 
      catch (e) { return []; } 
    }
  });
  const friends = friendsData || [];

  // ── Fetch All Team Commitments ─────────────────────────────────────────────
  const { data: allTeamCommitmentsData } = useQuery({
    queryKey: ['allTeamCommitments', teams.map(t => t._id)],
    queryFn: async () => {
      const results = await Promise.all(
        teams.map(async (t) => {
          try {
            const r = await api.get(`/teams/${t._id}/risk-dashboard`);
            // Attach team info to each commitment for display
            return r.data.data.commitments.map(c => ({ ...c, teamName: t.name }));
          } catch (e) { return []; }
        })
      );
      return results.flat().sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    },
    enabled: teams.length > 0,
    refetchInterval: 15000 // Poll every 15s
  });
  const activeCommitments = allTeamCommitmentsData || [];

  const { data: allHistoricalTeamCommitmentsData } = useQuery({
    queryKey: ['historicalTeamCommitments', teams.map(t => t._id)],
    queryFn: async () => {
      const results = await Promise.all(
        teams.map(async (t) => {
          try {
            const r = await api.get(`/teams/${t._id}/commitments/history`);
            return r.data.data.commitments.map(c => ({ ...c, teamName: t.name, teamAdminId: t.adminId }));
          } catch (e) { return []; }
        })
      );
      return results.flat().sort((a, b) => new Date(b.updatedAt || b.deadline) - new Date(a.updatedAt || a.deadline));
    },
    enabled: teams.length > 0,
    staleTime: 5 * 60 * 1000
  });
  const historicalCommitments = allHistoricalTeamCommitmentsData || [];
  // ── State ──────────────────────────────────────────────────────────────────
  const TEAM_DRAFT_KEY = 'commitsync_team_draft';
  const loadTeamDraft = () => {
    try {
      const raw = sessionStorage.getItem(TEAM_DRAFT_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d.subTasks) d.subTasks = d.subTasks.map(t => ({ ...t, id: uid() }));
      if (d.checkedAi) d.checkedAi = new Set(d.checkedAi);
      return d;
    } catch { return null; }
  };
  const teamDraft = loadTeamDraft();

  const [viewMode, setViewMode] = useState('CREATE'); // 'CREATE' | 'JOIN'
  const [formData, setFormData] = useState(teamDraft?.formData || { title: '', deadline: '' });
  const [selectedFriends, setSelectedFriends] = useState(teamDraft?.selectedFriends || []);
  const [joinCode, setJoinCode] = useState('');
  
  // ── Invite Code State ──────────────────────────────────────────────────────
  const [expireDays, setExpireDays] = useState(7);
  const [localInviteCode, setLocalInviteCode] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  
  // ── AI State ───────────────────────────────────────────────────────────────
  const [aiEnabled, setAiEnabled] = useState(teamDraft?.aiEnabled ?? true);
  const [aiSuggestions, setAiSuggestions] = useState(teamDraft?.aiSuggestions || []);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [checkedAi, setCheckedAi] = useState(teamDraft?.checkedAi || new Set());
  const [subTasks, setSubTasks] = useState(teamDraft?.subTasks || []);
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [expandedCommitments, setExpandedCommitments] = useState({});
  const [showAssignDropdown, setShowAssignDropdown] = useState(null); // { commitmentId, subtaskId }

  // ── Persist team draft to sessionStorage ──────────────────────────────
  useEffect(() => {
    const hasContent = formData.title || formData.deadline || subTasks.length > 0;
    if (!hasContent) { sessionStorage.removeItem(TEAM_DRAFT_KEY); return; }
    try {
      sessionStorage.setItem(TEAM_DRAFT_KEY, JSON.stringify({
        formData, selectedFriends, aiEnabled, aiSuggestions,
        checkedAi: [...checkedAi], subTasks
      }));
    } catch { /* quota exceeded – silently ignore */ }
  }, [formData, selectedFriends, aiEnabled, aiSuggestions, checkedAi, subTasks]);
  
  // Custom states for Team creation flow
  const [isCreating, setIsCreating] = useState(false);
  const [createdInviteData, setCreatedInviteData] = useState(null); // { code: string }
  
  // Custom states for Proofs
  const [proofSubmissionModal, setProofSubmissionModal] = useState(null); // { c, t }
  const [proofUrl, setProofUrl] = useState('');
  const [adminReviewModal, setAdminReviewModal] = useState(null); // { c, t }

  // ── Team Drawer & Inline Invite State ──────────────────────────────────────
  const [drawerCommitmentId, setDrawerCommitmentId] = useState(null);
  const [drawerTab, setDrawerTab] = useState('overview'); // 'overview' | 'tasks' | 'pulse'
  const [inDrawerInviteSection, setInDrawerInviteSection] = useState(null); // { teamId, code, selectedFriends, isCopied, isSending }
  const [toastMessage, setToastMessage] = useState(null);
  const [nudgingUserIds, setNudgingUserIds] = useState(new Set());

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(prev => prev === msg ? null : prev);
    }, 3000);
  };

  const handleSendNudge = async (teamId, targetUserId, memberName, commitmentId) => {
    if (nudgingUserIds.has(targetUserId)) return;
    setNudgingUserIds(prev => new Set([...prev, targetUserId]));
    try {
      await api.post(`/teams/${teamId}/nudge/${targetUserId}`, { commitmentId });
      showToast(`⚡ Nudge sent to ${memberName}! Real-time alert dispatched.`);
    } catch (err) {
      showToast(`Failed to send nudge: ${err.response?.data?.error || err.message}`);
    } finally {
      setNudgingUserIds(prev => {
        const next = new Set(prev);
        next.delete(targetUserId);
        return next;
      });
    }
  };


  const openInviteInDrawer = async (commitment) => {
    const teamId = typeof commitment.teamId === 'object' ? commitment.teamId._id : commitment.teamId;
    let code = '';
    try {
      const res = await api.post(`/teams/${teamId}/invite-code`, { expirationDays: 7 });
      code = res.data?.data?.inviteCode?.code || res.data?.data?.code || '';
    } catch (err) {
      const teamDoc = teams.find(t => t._id === teamId);
      code = teamDoc?.inviteCode || 'TEAM' + (teamId || '').substring(0, 6).toUpperCase();
    }
    setInDrawerInviteSection({
      teamId,
      code: code || 'TEAMSYNC',
      selectedFriends: [],
      isCopied: false,
      isSending: false
    });
  };

  const handleCopyDrawerInviteCode = () => {
    if (!inDrawerInviteSection?.code) return;
    navigator.clipboard.writeText(inDrawerInviteSection.code);
    setInDrawerInviteSection(prev => ({ ...prev, isCopied: true }));
    setTimeout(() => {
      setInDrawerInviteSection(prev => prev ? ({ ...prev, isCopied: false }) : null);
    }, 2000);
  };

  const handleShareDrawerInviteCode = async () => {
    const code = inDrawerInviteSection?.code;
    if (!code) return;
    try {
      await navigator.share({ title: 'Join my team on CommitSync', text: `Use invite code: ${code} to join my team on CommitSync!` });
    } catch {
      handleCopyDrawerInviteCode();
    }
  };

  const handleSendDrawerFriendInvites = async () => {
    if (!inDrawerInviteSection || inDrawerInviteSection.selectedFriends.length === 0) return;
    setInDrawerInviteSection(prev => ({ ...prev, isSending: true }));
    try {
      await api.post(`/teams/${inDrawerInviteSection.teamId}/invite`, { friends: inDrawerInviteSection.selectedFriends });
      queryClient.invalidateQueries(['teams']);
      queryClient.invalidateQueries(['allTeamCommitments']);
      showToast('Invite requests sent successfully! 🎉');
      setInDrawerInviteSection(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send invite requests');
      setInDrawerInviteSection(prev => ({ ...prev, isSending: false }));
    }
  };

  // ── Subtask Helpers ────────────────────────────────────────────────────────
  const addSubTask = (task = null) => {
    setSubTasks(prev => [...prev, {
      id: uid(),
      title: task?.title || '',
      estimatedDays: task?.estimatedDays || 1,
      priority: task?.priority || 'MEDIUM',
      assignedTo: task?.assignedTo || '',
      isParallel: task?.isParallel || false,
      requireProof: task?.requireProof || false,
      dependsOn: [],
      aiIndex: task?.aiIndex ?? null
    }]);
  };

  const removeSubTask = (id) => {
    const task = subTasks.find(t => t.id === id);
    if (task?.aiIndex != null) {
      setCheckedAi(prev => { const s = new Set(prev); s.delete(task.aiIndex); return s; });
    }
    setSubTasks(prev => prev.filter(t => t.id !== id));
  };

  const updateSubTask = (id, field, value) => {
    setSubTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const toggleAiSuggestion = (idx, suggestion) => {
    if (checkedAi.has(idx)) {
      setCheckedAi(prev => { const s = new Set(prev); s.delete(idx); return s; });
      setSubTasks(prev => prev.filter(t => t.aiIndex !== idx));
    } else {
      setCheckedAi(prev => new Set([...prev, idx]));
      setSubTasks(prev => {
        const newTask = {
          id: uid(), title: suggestion.title, estimatedDays: suggestion.estimatedDays || 1,
          priority: suggestion.priority || 'MEDIUM', assignedTo: '',
          isParallel: suggestion.isParallel || false, requireProof: false, dependsOn: [], aiIndex: idx
        };
        const insertAt = prev.findIndex(t => t.aiIndex !== null && t.aiIndex > idx);
        if (insertAt === -1) return [...prev, newTask];
        const arr = [...prev]; arr.splice(insertAt, 0, newTask);
        return arr;
      });
    }
  };

  // Drag & Drop
  const handleDragStart = (e, idx) => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; };
  const handleDragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOverIdx !== idx) setDragOverIdx(idx); };
  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx == null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const arr = [...subTasks]; const [moved] = arr.splice(dragIdx, 1); arr.splice(idx, 0, moved);
    setSubTasks(arr); setDragIdx(null); setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  // ── Mutations ──────────────────────────────────────────────────────────────
  const joinTeamMutation = useMutation({
    mutationFn: async (code) => { const r = await api.post(`/teams/join/${code}`); return r.data.data; },
    onSuccess: () => { 
      queryClient.invalidateQueries(['teams']); 
      queryClient.invalidateQueries(['allTeamCommitments']);
      alert('Successfully joined the team!');
      setJoinCode('');
    },
    onError: (err) => alert(err.response?.data?.error || 'Failed to join team')
  });

  const createTeamCommitmentFullFlow = async () => {
    setIsCreating(true);
    try {
      // 1. Create Team first
      const teamRes = await api.post('/teams', { 
        name: formData.title + ' Team',
        inviteCode: localInviteCode || undefined,
        expireDays: localInviteCode ? expireDays : undefined
      });
      const newTeamId = teamRes.data.data.team._id;

      // 2. Generate invite code if not generated yet (fallback for sharing later)
      let finalInviteCode = localInviteCode;
      if (!finalInviteCode) {
        const inviteRes = await api.post(`/teams/${newTeamId}/invite-code`, { expirationDays: 7 });
        finalInviteCode = inviteRes.data.data.inviteCode.code;
      }

      // 3. Invite selected friends
      if (selectedFriends.length > 0) {
        await api.post(`/teams/${newTeamId}/invite`, { friends: selectedFriends });
      }

      // 4. Create Commitment
      await api.post(`/teams/${newTeamId}/commitments`, {
        title: formData.title,
        description: formData.title + ' Team Commitment',
        deadline: formData.deadline,
        subTasks: subTasks.filter(t => t.title.trim()).map(t => ({
          title: t.title.trim(),
          assignedTo: t.assignedTo || api.defaults.userId, // fallback to creator if not assigned
          estimatedDays: Number(t.estimatedDays) || 1,
          priority: t.priority,
          isParallel: t.isParallel,
          requireProof: t.requireProof
        }))
      });

      queryClient.invalidateQueries(['teams']);
      queryClient.invalidateQueries(['allTeamCommitments']);
      setFormData({ title: '', deadline: '' });
      setAiSuggestions([]); setCheckedAi(new Set()); setSubTasks([]); setSelectedFriends([]);
      setLocalInviteCode('');
      sessionStorage.removeItem(TEAM_DRAFT_KEY);
      
      // Instead of alert, show our custom modal
      setCreatedInviteData({ code: finalInviteCode });
    } catch (err) {
      alert('Failed to create team commitment: ' + err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const submitProofMutation = useMutation({
    mutationFn: async ({ teamId, commitmentId, subtaskId, proofUrl }) => {
      await api.put(`/teams/${teamId}/commitments/${commitmentId}/subtasks/${subtaskId}/progress`, {
        status: 'COMPLETED', proofUrl
      });
    },
    onSuccess: () => queryClient.invalidateQueries(['allTeamCommitments'])
  });

  const approveProofMutation = useMutation({
    mutationFn: async ({ teamId, commitmentId, subtaskId }) => {
      await api.put(`/teams/${teamId}/commitments/${commitmentId}/subtasks/${subtaskId}/approve`);
    },
    onSuccess: () => queryClient.invalidateQueries(['allTeamCommitments'])
  });

  const rejectProofMutation = useMutation({
    mutationFn: async ({ teamId, commitmentId, subtaskId }) => {
      await api.put(`/teams/${teamId}/commitments/${commitmentId}/subtasks/${subtaskId}/reject`);
    },
    onSuccess: () => queryClient.invalidateQueries(['allTeamCommitments'])
  });

  const assignSubtaskMutation = useMutation({
    mutationFn: async ({ teamId, commitmentId, subtaskId, assignedTo }) => {
      await api.put(`/teams/${teamId}/commitments/${commitmentId}/subtasks/${subtaskId}/assign`, { assignedTo });
    },
    onMutate: async ({ teamId, commitmentId, subtaskId, assignedTo }) => {
      const queryKey = ['allTeamCommitments', teams.map(t => t._id)];
      // Cancel any outgoing refetches (so they don't overwrite our optimistic update)
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousCommitments = queryClient.getQueryData(queryKey);

      // Optimistically update to the new value
      queryClient.setQueryData(queryKey, (old) => {
        if (!old) return old;

        // Find the team members list to reconstruct the user objects
        const teamDoc = teams.find(tm => tm._id === teamId);
        const acceptedMembers = teamDoc?.members || [];
        const pendingMembers = teamDoc?.pendingInvites || [];
        const allMembers = [
          ...acceptedMembers.map(m => ({ user: m.userId, status: 'ACCEPTED' })),
          ...pendingMembers.map(p => ({ user: p, status: 'PENDING' }))
        ];

        const updatedUsers = assignedTo.map(id => {
          const found = allMembers.find(m => m.user?._id === id);
          return found ? found.user : { _id: id, name: 'User' };
        });

        return old.map(c => {
          if (c._id !== commitmentId) return c;
          return {
            ...c,
            subTasks: c.subTasks?.map(t => {
              if (t._id !== subtaskId) return t;
              return { ...t, assignedTo: updatedUsers };
            })
          };
        });
      });

      // Return a context object with the snapshotted value
      return { previousCommitments, queryKey };
    },
    onError: (err, newVariables, context) => {
      if (context?.previousCommitments) {
        queryClient.setQueryData(context.queryKey, context.previousCommitments);
      }
      alert(err.response?.data?.error || 'Failed to assign subtask');
    },
    onSuccess: () => {
      setShowAssignDropdown(null);
    },
    onSettled: (data, error, variables, context) => {
      if (context?.queryKey) {
        queryClient.invalidateQueries({ queryKey: context.queryKey });
      }
    }
  });

  const generateInviteCode = async (teamId) => {
    try {
      const res = await api.post(`/teams/${teamId}/invite-code`, { expirationDays: 7 });
      setCreatedInviteData({ code: res.data.data.inviteCode.code });
    } catch (err) { alert('Failed to generate invite code. Are you admin?'); }
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const fetchSuggestions = async () => {
    if (!formData.title) return;
    setIsSuggesting(true);
    try {
      const res = await api.post('/commitments/suggest-subtasks', { title: formData.title, isTeam: true });
      const generated = res.data.subtasks || [];
      setAiSuggestions(generated);
      const newChecked = new Set();
      const newTasks = generated.map((s, idx) => {
        newChecked.add(idx);
        return { 
          id: uid(), title: s.title, estimatedDays: s.estimatedDays || 1, 
          priority: s.priority || 'MEDIUM', assignedTo: '', 
          isParallel: s.isParallel || false, requireProof: false, dependsOn: [], aiIndex: idx 
        };
      });
      setCheckedAi(newChecked);
      setSubTasks(newTasks);
    } catch (err) { console.error(err); } finally { setIsSuggesting(false); }
  };

  const generateLocalInviteCode = () => {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    setLocalInviteCode(code);
    setIsCopied(false);
  };

  const handleCopyCode = () => {
    if (!localInviteCode) return;
    navigator.clipboard.writeText(localInviteCode);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleShareCode = () => {
    if (!localInviteCode) return;
    if (navigator.share) {
      navigator.share({
        title: 'Join my Team on CommitSync',
        text: `Join my team using invite code: ${localInviteCode}`,
      }).catch(console.error);
    } else {
      handleCopyCode();
      alert('Invite code copied to clipboard!');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.syncsContainer}>
      <DashboardNavbar activeSection="team" />

      <div className={styles.contentWrapper}>

        <div className={styles.pageHeader} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className={styles.modeToggleContainer}>
            <button className={`${styles.modeToggleBtn} ${viewMode === 'CREATE' ? styles.modeToggleActive : ''}`} onClick={() => setViewMode('CREATE')}>
              Create Team Commitment
            </button>
            <button className={`${styles.modeToggleBtn} ${viewMode === 'JOIN' ? styles.modeToggleActive : ''}`} onClick={() => setViewMode('JOIN')}>
              Join Team Commitment
            </button>
          </div>
          <p className={styles.pageSubtitle} style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
            {viewMode === 'CREATE' ? 'Rally your team around a shared goal and divide the work efficiently.' : 'Enter a unique invite code to join your team.'}
          </p>
        </div>

        {/* ═══ JOIN MODE ════════════════════════════════════════════════════ */}
        {viewMode === 'JOIN' && (
          <section className={styles.sectionContainer} style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
            <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>Enter Invite Code</h2>
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <input 
                type="text" 
                className={styles.conversationalInput} 
                style={{ width: '250px', textAlign: 'center', letterSpacing: '2px' }}
                placeholder="e.g. AB12CD"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
              />
              <button className={styles.btnPrimary} onClick={() => joinTeamMutation.mutate(joinCode)} disabled={!joinCode}>
                <UserPlus size={16} /> Join
              </button>
            </div>
          </section>
        )}

        {/* ═══ CREATE MODE ══════════════════════════════════════════════════ */}
        {viewMode === 'CREATE' && (
        <section className={styles.sectionContainer} style={{ paddingTop: '1.5rem', paddingBottom: '1.5rem' }}>
          
          <div className={styles.titleSection}>
            <label className={styles.conversationalLabel}>Name Your Team's Goal</label>
            <div className={styles.titleInputWrapper}>
              <input
                type="text"
                className={styles.conversationalInput}
                placeholder="e.g. Launch the MVP, Organize the annual conference..."
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                onBlur={() => { if (aiEnabled && formData.title && aiSuggestions.length === 0) fetchSuggestions(); }}
              />
              {aiEnabled && formData.title && (
                <button className={styles.refreshBtn} onClick={fetchSuggestions} disabled={isSuggesting}>
                  <RefreshCw size={14} className={isSuggesting ? styles.spinning : ''} />
                  {isSuggesting ? 'Thinking…' : (aiSuggestions.length === 0 ? 'Generate Tasks' : 'Regenerate')}
                </button>
              )}
            </div>
          </div>

          <div className={styles.syncWorkspace}>
            {/* LEFT — AI Timeline */}
            <div className={`${styles.aiPane} ${!aiEnabled ? styles.aiPaneDisabled : ''}`}>
              <div className={styles.aiHeader}>
                <div className={styles.aiTitle}><Sparkles size={15} color="#D35400" /> AI Team Assistant</div>
                {isSuggesting && <div className={styles.thinkingDots}><span /><span /><span /></div>}
              </div>

              <div className={styles.aiTimeline}>
                {isSuggesting ? (
                  [80, 65, 90].map((w, i) => (
                    <div key={i} className={styles.aiNodeSkeleton}>
                      <div className={styles.skeletonTrack}><div className={styles.skeletonCircle} />{i < 2 && <div className={styles.skeletonLine} />}</div>
                      <div className={styles.skeletonContent}><div className={styles.skeletonBar} style={{ width: `${w}%` }} /></div>
                    </div>
                  ))
                ) : aiSuggestions.length > 0 ? (
                  aiSuggestions.map((s, idx) => {
                    const checked = checkedAi.has(idx);
                    return (
                      <div key={idx} className={`${styles.aiNode} ${checked ? styles.aiNodeChecked : ''}`} onClick={() => toggleAiSuggestion(idx, s)}>
                        <div className={styles.nodeTrack}>
                          <div className={styles.nodeCircle}>{checked ? <Check size={12} strokeWidth={3} /> : <span className={styles.nodeNum}>{idx + 1}</span>}</div>
                          {idx !== aiSuggestions.length - 1 && <div className={`${styles.nodeLine} ${checked ? styles.nodeLineChecked : ''}`} />}
                        </div>
                        <div className={styles.nodeContent}>
                          <span className={styles.nodeTitle}>{s.title}</span>
                          <div className={styles.nodeMeta}>
                            <span className={styles.nodeHours}>{s.estimatedDays} days</span>
                            <span className={styles.nodePriority}>{s.isParallel ? 'Parallel' : 'Sequential'}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className={styles.aiEmptyState}>
                    <Sparkles size={30} strokeWidth={1.5} />
                    <p>Type your team goal above to get an AI-powered step breakdown.</p>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT — Subtask Editor & Details */}
            <div className={styles.mainForm}>

              {/* Add Friends Section */}
              <div className={styles.subInputGroup}>
                <label className={styles.subLabel}>Invite Team Members (From Friends List)</label>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  {friends.length === 0 ? (
                    <p style={{ fontSize: '0.9rem', color: '#334155' }}>No friends added yet. Add friends from the Circles page first!</p>
                  ) : (
                    friends.map(friend => {
                      const fId = friend.friendId?._id || friend._id;
                      const fName = friend.friendId?.name || friend.name;
                      const isSelected = selectedFriends.includes(fId);
                      return (
                        <div 
                          key={fId}
                          onClick={() => {
                            if (isSelected) setSelectedFriends(selectedFriends.filter(id => id !== fId));
                            else setSelectedFriends([...selectedFriends, fId]);
                          }}
                          style={{
                            padding: '0.5rem 1rem', borderRadius: '20px', cursor: 'pointer',
                            backgroundColor: isSelected ? '#4f46e5' : '#f1f5f9',
                            color: isSelected ? 'white' : '#475569',
                            fontWeight: 500, fontSize: '0.9rem', border: '1px solid',
                            borderColor: isSelected ? '#4338ca' : '#e2e8f0', transition: 'all 0.2s'
                          }}
                        >
                          {fName} {isSelected && <Check size={14} style={{ display: 'inline', marginLeft: '4px' }} />}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Generate Invite Code Section */}
              <div className={styles.subInputGroup} style={{ marginTop: '1.5rem' }}>
                <label className={styles.subLabel}>Team Invite Code</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.9rem', color: '#475569' }}>Expires in:</span>
                    <input 
                      type="number" 
                      className={styles.smallNumberInput} 
                      value={expireDays} 
                      onChange={e => setExpireDays(e.target.value)} 
                      min="1" 
                    />

                    <span style={{ fontSize: '0.9rem', color: '#475569' }}>days</span>
                  </div>
                  
                  <button className={styles.btnSecondary} onClick={generateLocalInviteCode}>
                    Generate Invite Code
                  </button>

                  {localInviteCode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: '#f1f5f9', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 600, letterSpacing: '1px', color: '#0f172a' }}>
                        {localInviteCode}
                      </span>
                      <button onClick={handleCopyCode} style={{ background: 'none', border: 'none', cursor: 'pointer', color: isCopied ? '#10b981' : '#334155' }} title="Copy Code">
                        {isCopied ? <Check size={16} /> : <Copy size={16} />}
                      </button>
                      <button onClick={handleShareCode} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#334155' }} title="Share Code">
                        <Share2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.subtasksSection}>
                <div className={styles.subtasksHeader}>
                  <span className={styles.subtasksLabel}>Subtasks</span>
                </div>

                {subTasks.length > 0 && (
                  <div className={styles.subtaskColHeader} style={{ display: 'flex', paddingRight: '20px' }}>
                    <span style={{ flex: 1, paddingLeft: '2rem' }}>Task</span>
                    <span style={{ width: '80px', textAlign: 'center' }}>Days</span>
                    <span style={{ width: '60px', textAlign: 'center' }}>Parallel</span>
                    <span style={{ width: '70px', textAlign: 'center' }}>Proof</span>
                    <span style={{ width: '28px' }} />
                  </div>
                )}

                <div className={styles.subtasksList}>
                  {subTasks.length === 0 ? (
                    <div className={styles.subtasksEmpty}><p>Check AI steps on the left, or add your own.</p></div>
                  ) : (
                    subTasks.map((task, idx) => (
                      <div key={task.id} className={styles.subtaskRow} draggable onDragStart={e => handleDragStart(e, idx)} onDragOver={e => handleDragOver(e, idx)} onDrop={e => handleDrop(e, idx)} onDragEnd={handleDragEnd}>
                        <div className={styles.dragHandle}><GripVertical size={15} /></div>
                        
                        <input className={styles.subtaskInput} value={task.title} onChange={e => updateSubTask(task.id, 'title', e.target.value)} placeholder="Task description..." />
                        
                        <div className={styles.hoursWrapper} style={{ width: '80px', justifyContent: 'center' }}>
                          <input type="number" className={styles.hoursInput} value={task.estimatedDays} min="0.5" step="0.5" onChange={e => updateSubTask(task.id, 'estimatedDays', parseFloat(e.target.value) || 1)} />
                          <span className={styles.hoursLabel}>d</span>
                        </div>

                        <div style={{ width: '60px', display: 'flex', justifyContent: 'center' }}>
                          <input type="checkbox" checked={task.isParallel} onChange={e => updateSubTask(task.id, 'isParallel', e.target.checked)} title="Can be done in parallel" />
                        </div>

                        <div style={{ width: '70px', display: 'flex', justifyContent: 'center' }}>
                          <input type="checkbox" checked={task.requireProof} onChange={e => updateSubTask(task.id, 'requireProof', e.target.checked)} title="Require Proof of Work" />
                        </div>

                        <button className={styles.removeBtn} onClick={() => removeSubTask(task.id)}><Trash2 size={13} /></button>
                      </div>
                    ))
                  )}
                </div>
                <button className={styles.addSubtaskBtn} onClick={() => addSubTask()}><Plus size={14} /> Add subtask</button>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.subInputGroup}>
                  <label className={styles.subLabel}>Deadline</label>
                  <div className={styles.deadlineInputWrapper}>
                    <Calendar size={18} className={styles.deadlineIcon} />
                    <input type="datetime-local" className={styles.deadlineInput} value={formData.deadline} onChange={e => setFormData({ ...formData, deadline: e.target.value })} />
                  </div>
                </div>
              </div>

              <div className={styles.actionRow} style={{ marginTop: '0.75rem' }}>
                <div className={styles.toggleSwitch} onClick={() => setAiEnabled(!aiEnabled)}>
                  <div className={`${styles.toggleTrack} ${aiEnabled ? styles.on : ''}`}><div className={styles.toggleThumb} /></div>
                  <span style={{ fontSize: '0.9rem', color: '#334155', fontWeight: 500 }}>AI Suggestions</span>
                </div>
                <button className={styles.btnPrimary} onClick={createTeamCommitmentFullFlow} disabled={!formData.title || !formData.deadline || subTasks.length === 0 || isCreating}>
                  {isCreating ? <RefreshCw size={14} className={styles.spinning} style={{ marginRight: '6px' }} /> : null}
                  Create Team Commitment
                </button>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* ═══ ACTIVE TEAM SYNCS ═══════════════════════════════════════════════════ */}
        <section className={styles.sectionContainer} style={{ marginTop: '2rem' }}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Active Team Commitments</h2>
            <p className={styles.sectionSubtitle}>Track progress, assess bottlenecks, and review proofs.</p>
          </div>

          <div className={styles.commitmentsList}>
            {activeCommitments.length > 0 ? (
              activeCommitments.map(c => {
                const riskColor = c.teamRiskScore >= 70 ? styles.riskHigh : c.teamRiskScore >= 40 ? styles.riskMed : styles.riskLow;
                const isExpanded = drawerCommitmentId === c._id;
                
                // Calculate progress manually based on COMPLETED subtasks
                const totalDays = c.subTasks?.reduce((sum, t) => sum + (t.estimatedDays || 1), 0) || 1;
                const completedDays = c.subTasks?.reduce((sum, t) => sum + (t.status === 'COMPLETED' ? (t.estimatedDays || 1) : 0), 0) || 0;
                const progress = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
                
                return (
                  <div key={c._id} className={`${styles.commitmentItem} ${isExpanded ? styles.expanded : ''}`}>
                    <div 
                      className={styles.commitmentHeader} 
                      onClick={() => { setDrawerCommitmentId(c._id); setDrawerTab('overview'); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className={styles.commitmentMainInfo}>
                        <div className={styles.commitmentTitleBlock}>
                          <h3 className={styles.commitmentTitle}>{c.title}</h3>
                          <span className={styles.categoryBadge} style={{ marginTop: '0.25rem', display: 'inline-block' }}>
                            {getDisplayTeamName(c.title, c.teamName)}
                          </span>

                        </div>
                      </div>

                      <div className={styles.commitmentStats}>
                        <button 
                          className={styles.inviteBtn} 
                          onClick={(e) => { e.stopPropagation(); setDrawerCommitmentId(c._id); setDrawerTab('overview'); openInviteInDrawer(c); }} 
                          title="Invite Team Members"
                        >
                          <UserPlus size={13} style={{ marginRight: '0.35rem' }} /> Invite
                        </button>
                        
                        <div className={styles.statPill}>
                          <span className={`${styles.statValue} ${riskColor}`}>{c.teamRiskScore || 0}%</span>
                          <span className={styles.statLabel}>Risk</span>
                        </div>
                        
                        <div className={styles.circularProgressContainer}>
                          <svg viewBox="0 0 36 36" className={styles.circularChart}>
                            <path className={styles.circleBg} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path className={styles.circle} strokeDasharray={`${progress}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <text x="18" y="20.35" className={styles.percentage}>{progress}%</text>
                          </svg>
                          <span className={styles.statLabel}>Progress</span>
                        </div>

                        <div className={styles.statPill}>
                          <span className={styles.statValue}>
                            {(() => {
                              if (!c.deadline) return 'N/A';
                              const diff = new Date(c.deadline) - new Date();
                              if (diff <= 0) return 'Overdue';
                              const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                              const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                              return `${days}d ${hours}h`;
                            })()}
                          </span>
                          <span className={styles.statLabel}>Deadline</span>
                        </div>
                        <ChevronRight size={20} className={styles.expandIcon} />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className={styles.emptyState}>
                <Sparkles size={32} className={styles.emptyStateIcon} />
                <p>No active team commitments. Start one above!</p>
              </div>
            )}
          </div>
        </section>

        {/* ═══ TEAM HISTORY SECTION ═════════════════════════════════════════════════ */}
        {historicalCommitments.length > 0 && (
          <section className={styles.sectionContainer} style={{ paddingTop: '2rem', marginTop: '2rem', borderTop: '1px solid rgba(26,29,32,0.1)' }}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <Clock size={20} className={styles.sectionIcon} style={{ color: '#64748B' }} />
                Team History
              </h2>
              <span className={styles.syncCount}>{historicalCommitments.length} past team syncs</span>
            </div>
            
            <div className={styles.syncList}>
              {historicalCommitments.map(c => {
                const isMissed = c.status === 'FAILED';
                const statusColor = isMissed ? '#EF4444' : '#10B981';
                
                // Calculate actual time (1 day = 8 hours active)
                const createdDate = new Date(c.createdAt);
                const endDate = new Date(c.updatedAt || c.deadline);
                const activeHours = Math.max(0, (endDate - createdDate) / (1000 * 60 * 60));
                const activeDays = activeHours / 24;
                const actualHours = Math.round(activeDays * 8);

                const totalEstimatedDays = c.subTasks?.reduce((acc, st) => acc + (st.estimatedDays || 1), 0) || 0;
                const totalEstimatedHours = totalEstimatedDays * 8;

                const currentUserId = user?._id || user?.id;
                const isAdmin = c.teamAdminId === currentUserId || (typeof c.teamAdminId === 'object' && c.teamAdminId._id === currentUserId);

                return (
                  <div key={c._id} className={`${styles.commitmentItem} ${styles.ghostCard}`}>
                    <div className={styles.commitmentHeader}>
                      <div className={styles.commitmentMainInfo}>
                        <div className={styles.commitmentTitleBlock}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                            <div className={styles.categoryIcon} style={{ filter: 'grayscale(100%)', opacity: 0.7, padding: '0', background: 'transparent' }}>
                              <Users size={18} color={statusColor} />
                            </div>
                            <h3 className={styles.commitmentTitle} style={{ color: '#64748B', textDecoration: isMissed ? 'line-through' : 'none' }}>
                              {c.title}
                            </h3>
                          </div>
                          <div className={styles.metaRow} style={{ marginTop: '0.4rem', gap: '0.5rem' }}>
                            <span className={styles.categoryBadge} style={{ background: 'rgba(100, 116, 139, 0.1)', color: '#64748B' }}>
                              {c.status}
                            </span>
                            <span className={styles.categoryBadge} style={{ background: 'rgba(100, 116, 139, 0.1)', color: '#64748B' }}>
                              Team: {getDisplayTeamName(c.title, c.teamName)}
                            </span>

                          </div>
                        </div>
                      </div>
                      <div className={styles.commitmentStats}>
                        <div className={styles.statPill} style={{ background: 'transparent', padding: '0 0.5rem' }}>
                          <span className={styles.statValue} style={{ color: '#64748B' }}>{totalEstimatedHours}h</span>
                          <span className={styles.statLabel}>ESTIMATED</span>
                        </div>
                        <div className={styles.statPill} style={{ background: 'transparent', padding: '0 0.5rem' }}>
                          <span className={styles.statValue} style={{ color: '#64748B' }}>{actualHours || 0}h</span>
                          <span className={styles.statLabel}>ACTUAL</span>
                        </div>
                        {isMissed && isAdmin && (
                          <button
                            className={styles.btnSecondary}
                            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', borderColor: 'rgba(26,29,32,0.2)', marginLeft: '1rem' }}
                            onClick={() => alert('Team Rescheduling coming soon!')}
                          >
                            <Calendar size={14} style={{ marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
                            Reschedule
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* ── Invite Code Modal ── */}
      {createdInviteData && (
        <div className={styles.modalOverlay} onClick={() => setCreatedInviteData(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 className={styles.modalTitle} style={{ margin: 0 }}>Team Created!</h2>
              <button className={styles.removeBtn} onClick={() => setCreatedInviteData(null)}>
                <X size={18} />
              </button>
            </div>
            
            <p style={{ color: '#334155', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
              Your team commitment is set. Share this invite code with your friends to let them join the team.
            </p>
            
            <div style={{ padding: '1rem', background: '#f8fafc', border: '1px dashed #64748B', borderRadius: '8px', marginBottom: '1.5rem' }}>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '2px', color: '#1e293b' }}>
                {createdInviteData.code}
              </span>
            </div>
            
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button 
                className={styles.btnSecondary}
                onClick={() => {
                  navigator.clipboard.writeText(createdInviteData.code);
                  setIsCopied(true);
                  setTimeout(() => setIsCopied(false), 2000);
                }}
                style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0.6rem', color: isCopied ? '#10B981' : 'inherit' }}
              >
                {isCopied ? (
                  <><Check size={16} style={{ marginRight: '0.5rem' }} /> Copied</>
                ) : (
                  <><Copy size={16} style={{ marginRight: '0.5rem' }} /> Copy Code</>
                )}
              </button>
              <button 
                className={styles.btnPrimary}
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: 'Join my CommitSync Team',
                      text: `Use my invite code ${createdInviteData.code} to join our team commitment!`,
                    }).catch(console.error);
                  } else {
                    navigator.clipboard.writeText(`Use my invite code ${createdInviteData.code} to join our team commitment!`);
                    alert('Invite message copied to clipboard!');
                  }
                }}
                style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0.6rem' }}
              >
                <Share2 size={16} style={{ marginRight: '0.5rem' }} /> Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Proof Submission Modal ── */}
      {proofSubmissionModal && (
        <div className={styles.modalOverlay} onClick={() => setProofSubmissionModal(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Submit Proof</h2>
            <p style={{ color: '#334155', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Subtask: <strong>{proofSubmissionModal.t.title}</strong>
            </p>
            <div className={styles.subInputGroup}>
              <label className={styles.subLabel}>Drive Link (Image, Audio, Document)</label>
              <input 
                className={styles.subInput} 
                type="text" 
                placeholder="https://drive.google.com/..." 
                value={proofUrl}
                onChange={e => setProofUrl(e.target.value)}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setProofSubmissionModal(null)}>Cancel</button>
              <button className={styles.btnPrimary} disabled={!proofUrl.trim()} onClick={() => {
                submitProofMutation.mutate({
                  teamId: proofSubmissionModal.c.teamId,
                  commitmentId: proofSubmissionModal.c._id,
                  subtaskId: proofSubmissionModal.t._id,
                  proofUrl
                });
                setProofSubmissionModal(null);
                setProofUrl('');
              }}>
                Submit Proof
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Admin Review Modal ── */}
      {adminReviewModal && (
        <div className={styles.modalOverlay} onClick={() => setAdminReviewModal(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Review Proof</h2>
            <p style={{ color: '#334155', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              Subtask: <strong>{adminReviewModal.t.title}</strong>
            </p>
            
            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '2rem' }}>
              <span className={styles.subLabel}>Proof Link:</span>
              <div style={{ marginTop: '0.5rem' }}>
                <a href={adminReviewModal.t.proof?.url} target="_blank" rel="noopener noreferrer" style={{ color: '#0ea5e9', wordBreak: 'break-all' }}>
                  {adminReviewModal.t.proof?.url || 'No URL provided'}
                </a>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <button 
                className={styles.btnPrimary} 
                style={{ backgroundColor: '#10b981', display: 'flex', justifyContent: 'center', width: '100%' }}
                onClick={() => {
                  approveProofMutation.mutate({
                    teamId: adminReviewModal.c.teamId,
                    commitmentId: adminReviewModal.c._id,
                    subtaskId: adminReviewModal.t._id
                  });
                  setAdminReviewModal(null);
                }}
              >
                Approve Proof
              </button>
              
              <button 
                className={styles.btnSecondary} 
                style={{ color: '#ef4444', borderColor: '#ef4444', display: 'flex', justifyContent: 'center', width: '100%' }}
                onClick={() => {
                  rejectProofMutation.mutate({
                    teamId: adminReviewModal.c.teamId,
                    commitmentId: adminReviewModal.c._id,
                    subtaskId: adminReviewModal.t._id
                  });
                  setAdminReviewModal(null);
                }}
              >
                Request Resubmission
              </button>
              
              <button 
                className={styles.btnSecondary} 
                style={{ display: 'flex', justifyContent: 'center', width: '100%' }}
                onClick={() => {
                  // Message User (open direct chat with the assigned user)
                  const targetUser = adminReviewModal.t.assignedTo?.[0]?._id;
                  if (targetUser) {
                    navigate('/circles', { state: { openChatWith: targetUser } });
                  } else {
                    alert('No specific assigned user to message.');
                  }
                }}
              >
                Message User
              </button>
              
              <div style={{ borderTop: '1px solid #e2e8f0', marginTop: '0.5rem', paddingTop: '1rem', display: 'flex', justifyContent: 'center' }}>
                <button className={styles.btnSecondary} style={{ border: 'none', color: '#334155' }} onClick={() => setAdminReviewModal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TEAM COMMITMENT SIDE DRAWER ════════════════════════════════════════ */}
      {(() => {
        const c = activeCommitments.find(item => item._id === drawerCommitmentId);
        if (!c) return null;

        const teamIdStr = typeof c.teamId === 'object' ? c.teamId._id : c.teamId;
        const teamDoc = teams.find(tm => tm._id === teamIdStr);
        const currentUserId = user?._id || user?.id;
        const isAdmin = teamDoc && (
          teamDoc.adminId === currentUserId ||
          teamDoc.adminId?._id === currentUserId ||
          teamDoc.members?.some(m => (m.userId._id === currentUserId || m.userId === currentUserId) && m.role === 'ADMIN')
        );

        const membersList = teamDoc?.members || [];
        const totalDays = c.subTasks?.reduce((sum, t) => sum + (t.estimatedDays || 1), 0) || 1;
        const completedDays = c.subTasks?.reduce((sum, t) => sum + (t.status === 'COMPLETED' ? (t.estimatedDays || 1) : 0), 0) || 0;
        const progress = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
        const riskColor = c.teamRiskScore >= 70 ? styles.riskHigh : c.teamRiskScore >= 40 ? styles.riskMed : styles.riskLow;

        return createPortal(
          <div className={styles.drawerOverlay} onClick={(e) => { e.stopPropagation(); setDrawerCommitmentId(null); }}>
            <div className={styles.drawerContainer} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className={styles.drawerHeader}>
                <div className={styles.drawerHeaderTop}>
                  <div>
                    <h2 className={styles.drawerTitle}>{c.title}</h2>
                    <div style={{ fontSize: '0.85rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                      <Users size={14} color="#6366F1" />
                      <span>{getDisplayTeamName(c.title, c.teamName || teamDoc?.name)}</span>
                    </div>

                  </div>
                  <button className={styles.drawerCloseBtn} onClick={() => setDrawerCommitmentId(null)}>
                    <X size={18} />
                  </button>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.deadlineBadge}>
                    <Calendar size={13} style={{ marginRight: '4px', verticalAlign: 'middle', display: 'inline-block' }} />
                    {c.deadline ? new Date(c.deadline).toLocaleDateString('en-GB') : 'No deadline'}
                  </span>
                  <div className={styles.statPill} style={{ marginLeft: 'auto' }}>
                    <span className={`${styles.statValue} ${riskColor}`}>{c.teamRiskScore || 0}%</span>
                    <span className={styles.statLabel}>Risk Score</span>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className={styles.drawerTabs}>
                <button 
                  className={`${styles.drawerTab} ${drawerTab === 'overview' ? styles.drawerTabActive : ''}`} 
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDrawerTab('overview'); }}
                >
                  Overview
                </button>
                <button 
                  className={`${styles.drawerTab} ${drawerTab === 'tasks' ? styles.drawerTabActive : ''}`} 
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDrawerTab('tasks'); setInDrawerInviteSection(null); }}
                >
                  Tasks & Proofs
                </button>
                <button 
                  className={`${styles.drawerTab} ${drawerTab === 'pulse' ? styles.drawerTabActive : ''}`} 
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDrawerTab('pulse'); setInDrawerInviteSection(null); }}
                >
                  Team Pulse
                </button>
              </div>

              {/* Content */}
              <div className={styles.drawerContent}>
                {/* ── TAB 1: OVERVIEW ── */}
                {drawerTab === 'overview' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Bottleneck Warning Banner */}
                    {c.bottleneckTasks?.length > 0 && (
                      <div style={{ padding: '0.85rem 1rem', backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <AlertOctagon size={20} color="#ef4444" style={{ flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 700, color: '#dc2626', fontSize: '0.85rem' }}>Bottleneck Warning</div>
                          <span style={{ color: '#991b1b', fontSize: '0.82rem' }}>
                            "{c.bottleneckTasks[0].title || 'A critical subtask'}" is delaying this commitment.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Progress & Time Remaining Card */}
                    <div style={{ background: '#FFFFFF', border: '1px solid rgba(26, 29, 32, 0.08)', borderRadius: '14px', padding: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div className={styles.circularProgressContainer} style={{ width: '48px', height: '48px' }}>
                          <svg viewBox="0 0 36 36" className={styles.circularChart}>
                            <path className={styles.circleBg} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <path className={styles.circle} strokeDasharray={`${progress}, 100`} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                            <text x="18" y="20.35" className={styles.percentage}>{progress}%</text>
                          </svg>
                        </div>
                        <div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1A1D20' }}>{progress}%</div>
                          <div style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Completed</div>
                        </div>
                      </div>

                      <div style={{ borderLeft: '1px solid rgba(26, 29, 32, 0.08)', paddingLeft: '1rem' }}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1A1D20' }}>
                          {(() => {
                            if (!c.deadline) return 'N/A';
                            const diff = new Date(c.deadline) - new Date();
                            if (diff <= 0) return 'Overdue';
                            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                            return `${days}d ${hours}h`;
                          })()}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 600, textTransform: 'uppercase' }}>Time Remaining</div>
                      </div>
                    </div>

                    {/* Team Roster Section */}
                    <div className={styles.detailBlock}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <h4 className={styles.detailTitle} style={{ margin: 0 }}>Team Members ({membersList.length})</h4>
                        <button 
                          className={styles.inviteBtn} 
                          style={{ padding: '0.3rem 0.75rem', fontSize: '0.78rem' }} 
                          onClick={(e) => { e.stopPropagation(); inDrawerInviteSection ? setInDrawerInviteSection(null) : openInviteInDrawer(c); }}
                        >
                          {inDrawerInviteSection 
                            ? <><X size={12} style={{ marginRight: '0.3rem' }} /> Close Invite</>
                            : <><UserPlus size={12} style={{ marginRight: '0.3rem' }} /> Invite More</>
                          }
                        </button>
                      </div>
                      
                      {/* ── Inline Invite Section (Positioned right below Invite More button) ── */}
                      {inDrawerInviteSection && (
                        <div style={{ background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '14px', padding: '1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#4338CA' }}>Invite Team Members</div>

                          {/* Invite Code Row */}
                          <div>
                            <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6366F1', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.4rem' }}>
                              Team Invite Code
                            </label>
                            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                              <input
                                type="text"
                                readOnly
                                value={inDrawerInviteSection.code}
                                style={{ flex: 1, padding: '0.45rem 0.65rem', fontSize: '0.88rem', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '2px', textAlign: 'center', background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '8px', color: '#1E1B4B', minWidth: 0 }}
                              />
                              <button
                                title={inDrawerInviteSection.isCopied ? 'Copied!' : 'Copy code'}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyDrawerInviteCode(); }}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.45rem', borderRadius: '7px', color: inDrawerInviteSection.isCopied ? '#10B981' : '#6366F1', transition: 'none', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                              >
                                {inDrawerInviteSection.isCopied ? <Check size={18} strokeWidth={3} /> : <Copy size={18} />}
                              </button>
                              <button
                                title="Share invite"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleShareDrawerInviteCode(); }}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.45rem', borderRadius: '7px', color: '#6366F1', transition: 'none', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                              >
                                <Share2 size={18} />
                              </button>
                            </div>
                          </div>

                          {/* Friends Picker */}
                          {friends.length > 0 && (
                            <div>
                              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.4rem' }}>
                                Select Friends from Circles
                              </label>
                              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                {friends.map(friend => {
                                  const fId = friend.friendId?._id || friend._id;
                                  const fName = friend.friendId?.name || friend.name || 'Friend';
                                  const isSelected = inDrawerInviteSection.selectedFriends.includes(fId);
                                  return (
                                    <div
                                      key={fId}
                                      onClick={(e) => { e.stopPropagation(); setInDrawerInviteSection(prev => ({ ...prev, selectedFriends: isSelected ? prev.selectedFriends.filter(id => id !== fId) : [...prev.selectedFriends, fId] })); }}
                                      style={{ padding: '0.3rem 0.65rem', borderRadius: '20px', cursor: 'pointer', backgroundColor: isSelected ? '#4F46E5' : '#F1F5F9', color: isSelected ? '#FFFFFF' : '#475569', fontWeight: 600, fontSize: '0.75rem', border: `1px solid ${isSelected ? '#4338CA' : '#E2E8F0'}`, display: 'flex', alignItems: 'center', gap: '0.3rem', transition: 'all 0.2s' }}
                                    >
                                      {fName} {isSelected && <Check size={11} strokeWidth={3} />}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {friends.length === 0 && (
                            <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0 }}>No friends in your Circles yet — share the invite code above directly!</p>
                          )}

                          {/* Send Button */}
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                              className={styles.sendInvitesBtn}
                              disabled={inDrawerInviteSection.selectedFriends.length === 0 || inDrawerInviteSection.isSending}
                              onClick={(e) => { e.stopPropagation(); handleSendDrawerFriendInvites(); }}
                            >
                              {inDrawerInviteSection.isSending ? (
                                <><RefreshCw size={12} className={styles.spinning} style={{ marginRight: '5px' }} /> Sending…</>
                              ) : (
                                <><Send size={12} style={{ marginRight: '5px' }} /> Send Invites{inDrawerInviteSection.selectedFriends.length > 0 ? ` (${inDrawerInviteSection.selectedFriends.length})` : ''}</>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {membersList.map(m => {
                          const memberUserId = m.userId?._id || m.userId;
                          const memberName = m.userId?.name || 'Member';
                          const isMemberAdmin = m.role === 'ADMIN';

                          return (
                            <div key={memberUserId || memberName} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(26,29,32,0.08)', padding: '0.6rem 0.85rem', borderRadius: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: isMemberAdmin ? 'linear-gradient(135deg, #6366F1, #8B5CF6)' : '#E2E8F0', color: isMemberAdmin ? '#FFFFFF' : '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>
                                  {memberName.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1A1D20' }}>{memberName}</div>
                                  <span style={{ fontSize: '0.68rem', color: isMemberAdmin ? '#6366F1' : '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>
                                    {isMemberAdmin ? '👑 Team Admin' : 'Member'}
                                  </span>
                                </div>
                              </div>

                              {isAdmin && memberUserId !== currentUserId && (
                                <button
                                  style={{ background: 'transparent', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '0.3rem', borderRadius: '6px', transition: 'all 0.2s' }}
                                  title="Remove member from team"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`Remove ${memberName} from the team?`)) {
                                      try {
                                        await api.delete(`/teams/${teamIdStr}/members/${memberUserId}`);
                                        queryClient.invalidateQueries(['teams']);
                                        queryClient.invalidateQueries(['allTeamCommitments']);
                                        showToast(`${memberName} removed from team`);
                                      } catch (err) { alert('Failed to remove member'); }
                                    }
                                  }}
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── TAB 2: TASKS & PROOFS ── */}
                {drawerTab === 'tasks' && (
                  <div className={styles.detailBlock} style={{ background: 'transparent', padding: '0' }}>
                    <h4 className={styles.detailTitle} style={{ marginBottom: '1.25rem' }}>Subtasks & Proof Breakdown</h4>
                    <div className={styles.activeTimeline}>
                      {c.subTasks?.length > 0 ? c.subTasks.map((t, i) => {
                        const isLast = i === c.subTasks.length - 1;
                        const isCompleted = t.status === 'COMPLETED';
                        const needsReview = t.status === 'NEEDS_REVIEW';
                        const dynamicHeight = Math.max(40, (t.estimatedDays || 1) * 12);
                        const assignedUserNames = t.assignedTo?.length > 0 ? t.assignedTo.map(u => u.name).join(', ') : 'Unassigned';

                        return (
                          <div key={i} className={styles.activeNodeContainer}>
                            <div className={styles.activeNodeVisual}>
                              <div 
                                className={`${styles.activeNodeCircle} ${isCompleted ? styles.completedCircle : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (t.status === 'PENDING' || t.status === 'IN_PROGRESS') {
                                    if (t.requireProof) {
                                      setProofSubmissionModal({ c, t });
                                    } else {
                                      submitProofMutation.mutate({ teamId: teamIdStr, commitmentId: c._id, subtaskId: t._id, proofUrl: '' });
                                    }
                                  }
                                }}
                                style={{ cursor: (t.status === 'PENDING' || t.status === 'IN_PROGRESS') ? 'pointer' : 'default' }}
                              >
                                {isCompleted ? <Check size={12} strokeWidth={3} color="#10B981" /> : null}
                              </div>
                              {!isLast && <div className={`${styles.activeNodeLine}`} style={{ height: `${dynamicHeight}px` }}></div>}
                            </div>

                            <div className={styles.activeNodeContent} style={{ minHeight: isLast ? 'auto' : `${dynamicHeight + 20}px` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'nowrap' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span className={`${styles.activeNodeTitle} ${isCompleted ? styles.completedText : ''}`}>
                                    {t.title}
                                  </span>
                                  <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.78rem', color: '#475569', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span className={styles.assignedBadge}>Assigned: {assignedUserNames}</span>
                                    <span>•</span>
                                    <span>{t.estimatedDays} days</span>
                                    <span>•</span>
                                    <span>{t.isParallel ? 'Parallel' : 'Sequential'}</span>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>

                                  {/* Admin Assign Button */}
                                  {isAdmin && (
                                    <div style={{ position: 'relative' }}>
                                      <button 
                                        className={styles.assignBtn} 
                                        onClick={(e) => { e.stopPropagation(); setShowAssignDropdown({ commitmentId: c._id, subtaskId: t._id }); }}
                                      >
                                        Assign
                                      </button>
                                      
                                      {showAssignDropdown?.commitmentId === c._id && showAssignDropdown?.subtaskId === t._id && (
                                        <div onClick={e => e.stopPropagation()} className={styles.assignDropdown}>
                                          <div className={styles.assignDropdownHeader}>
                                            <span className={styles.assignDropdownTitle}>Assign to</span>
                                            <div className={styles.assignDropdownClose} onClick={() => setShowAssignDropdown(null)}>
                                              <X size={14} />
                                            </div>
                                          </div>
                                          <div className={styles.assignDropdownList}>
                                            {(() => {
                                              const acceptedMembers = teamDoc?.members || [];
                                              const pendingMembers = teamDoc?.pendingInvites || [];
                                              const allMembers = [
                                                ...acceptedMembers.map(m => ({ user: m.userId, status: 'ACCEPTED' })),
                                                ...pendingMembers.map(p => ({ user: p, status: 'PENDING' }))
                                              ];
                                              
                                              return allMembers.map(m => {
                                                const isPending = m.status === 'PENDING';
                                                const isAssigned = t.assignedTo?.some(u => u._id === m.user?._id);
                                                return (
                                                  <div 
                                                    key={m.user?._id || Math.random()} 
                                                    className={`${styles.assignDropdownItem} ${isAssigned ? styles.assignDropdownItemActive : ''} ${isPending ? styles.pendingItem : ''}`}
                                                    onClick={() => {
                                                      if (isPending || !m.user?._id) return;
                                                      let newAssignedTo = t.assignedTo?.map(u => u._id) || [];
                                                      if (isAssigned) newAssignedTo = newAssignedTo.filter(id => id !== m.user._id);
                                                      else newAssignedTo.push(m.user._id);
                                                      assignSubtaskMutation.mutate({ teamId: teamIdStr, commitmentId: c._id, subtaskId: t._id, assignedTo: newAssignedTo });
                                                    }}
                                                  >
                                                    <div className={`${styles.assignDropdownCheckbox} ${isAssigned ? styles.assignDropdownCheckboxActive : ''}`}>
                                                      {isAssigned && <Check size={10} color="white" strokeWidth={3} />}
                                                    </div>
                                                    <span className={`${styles.assignDropdownText} ${isAssigned ? styles.assignDropdownTextActive : ''}`}>
                                                      {m.user?.name || 'User'} {isPending && '(Pending)'}
                                                    </span>
                                                  </div>
                                                );
                                              });
                                            })()}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Proof Review / Pending Badge */}
                                  {needsReview && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{ fontSize: '0.72rem', color: '#D97706', backgroundColor: '#FEF3C7', padding: '0.2rem 0.5rem', borderRadius: '4px', border: '1px solid #FCD34D', fontWeight: 600 }}>
                                        Needs Review
                                      </span>
                                      {isAdmin && (
                                        <button 
                                          className={styles.btnSecondary} 
                                          style={{ color: '#0EA5E9', borderColor: '#BAE6FD', backgroundColor: '#F0F9FF', padding: '0.25rem 0.6rem', fontSize: '0.75rem' }} 
                                          onClick={(e) => { e.stopPropagation(); setAdminReviewModal({ c, t }); }}
                                        >
                                          <FileCheck size={12} style={{ marginRight: '0.2rem' }} /> Review Proof
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }) : <p style={{ color: '#475569', fontSize: '0.9rem' }}>No subtasks defined.</p>}
                    </div>
                  </div>
                )}

                {/* ── TAB 3: TEAM PULSE ── */}
                {drawerTab === 'pulse' && (() => {
                  const createdDate = new Date(c.createdAt || Date.now());
                  const daysElapsed = Math.max(0.5, (new Date() - createdDate) / (1000 * 60 * 60 * 24));
                  const totalCompletedSubtasks = c.subTasks?.filter(t => t.status === 'COMPLETED').length || 0;
                  const velocityRate = (totalCompletedSubtasks / daysElapsed).toFixed(1);

                  const totalCompletedDaysAcrossTeam = c.subTasks?.reduce((sum, t) => sum + (t.status === 'COMPLETED' ? (t.estimatedDays || 1) : 0), 0) || 0;

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                      {/* Summary Metric Cards (4 items) */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.65rem' }}>
                        <div style={{ background: '#FFFFFF', border: '1px solid rgba(26,29,32,0.08)', borderRadius: '12px', padding: '0.85rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1A1D20' }}>{c.subTasks?.length || 0}</div>
                          <div style={{ fontSize: '0.65rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginTop: '2px' }}>Total Tasks</div>
                        </div>
                        <div style={{ background: '#FFFFFF', border: '1px solid rgba(26,29,32,0.08)', borderRadius: '12px', padding: '0.85rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10B981' }}>
                            {totalCompletedSubtasks}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginTop: '2px' }}>Completed</div>
                        </div>
                        <div style={{ background: '#FFFFFF', border: '1px solid rgba(26,29,32,0.08)', borderRadius: '12px', padding: '0.85rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#6366F1' }}>
                            {velocityRate}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginTop: '2px' }}>Tasks/Day</div>
                        </div>
                        <div style={{ background: '#FFFFFF', border: '1px solid rgba(26,29,32,0.08)', borderRadius: '12px', padding: '0.85rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: c.teamRiskScore >= 70 ? '#EF4444' : c.teamRiskScore >= 40 ? '#F59E0B' : '#10B981' }}>
                            {c.teamRiskScore || 0}%
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#64748B', fontWeight: 700, textTransform: 'uppercase', marginTop: '2px' }}>Risk Index</div>
                        </div>
                      </div>

                      {/* Velocity Sparkline Banner */}
                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '0.85rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <TrendingUp size={18} color="#6366F1" />
                          <div>
                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1E293B' }}>Completion Velocity</div>
                            <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Pace: {velocityRate} tasks completed per day over the last {Math.ceil(daysElapsed)} days</span>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#4F46E5', background: '#EEF2FF', padding: '0.25rem 0.65rem', borderRadius: '8px' }}>
                          {totalCompletedSubtasks}/{c.subTasks?.length || 0} Done
                        </div>
                      </div>

                      {/* Individual Member Contribution & Pulse */}
                      <div className={styles.detailBlock}>
                        <h4 className={styles.detailTitle} style={{ marginBottom: '1rem' }}>Member Contribution & Real-Time Status</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                          {membersList.map(m => {
                            const memberUserId = m.userId?._id || m.userId;
                            const memberName = m.userId?.name || 'Teammate';

                            const assignedTasks = c.subTasks?.filter(t => isMemberAssigned(t.assignedTo, memberUserId)) || [];
                            const completedMemberTasks = assignedTasks.filter(t => t.status === 'COMPLETED');
                            
                            const memberTotalDays = assignedTasks.reduce((sum, t) => sum + (t.estimatedDays || 1), 0);
                            const memberCompletedDays = completedMemberTasks.reduce((sum, t) => sum + (t.estimatedDays || 1), 0);
                            const memberPct = memberTotalDays > 0 ? Math.round((memberCompletedDays / memberTotalDays) * 100) : 0;
                            const teamWorkSharePct = totalCompletedDaysAcrossTeam > 0 ? Math.round((memberCompletedDays / totalCompletedDaysAcrossTeam) * 100) : 0;

                            const hasBottleneck = c.bottleneckTasks?.some(b => isMemberAssigned(b.assignedTo, memberUserId));
                            const isOverdue = assignedTasks.some(t => t.status !== 'COMPLETED' && c.deadline && new Date(c.deadline) < new Date());

                            const statusDotColor = assignedTasks.length === 0 ? '#94A3B8' : (hasBottleneck || isOverdue) ? '#EF4444' : memberPct < 50 ? '#F59E0B' : '#10B981';
                            const statusText = assignedTasks.length === 0 ? 'No tasks' : hasBottleneck ? 'Bottleneck' : isOverdue ? 'Overdue' : memberPct < 50 ? 'Behind' : 'On Track';
                            const isNudgingThisUser = nudgingUserIds.has(memberUserId);

                            return (
                              <div key={memberUserId} style={{ background: '#FFFFFF', border: '1px solid rgba(26,29,32,0.08)', borderRadius: '12px', padding: '0.85rem 1rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#F1F5F9', color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800 }}>
                                      {memberName.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: statusDotColor, boxShadow: `0 0 0 3px ${statusDotColor}22` }} />
                                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1A1D20' }}>{memberName}</span>
                                    <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', padding: '0.15rem 0.5rem', borderRadius: '6px', background: `${statusDotColor}15`, color: statusDotColor }}>
                                      {statusText}
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569' }}>
                                      {completedMemberTasks.length}/{assignedTasks.length} tasks ({memberPct}%) • {teamWorkSharePct}% team work
                                    </span>
                                    {memberUserId !== currentUserId && (
                                      <>
                                        <button
                                          className={styles.btnSecondary}
                                          disabled={isNudgingThisUser}
                                          style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#D35400', borderColor: 'rgba(211,84,0,0.3)', opacity: isNudgingThisUser ? 0.6 : 1 }}
                                          onClick={() => handleSendNudge(teamIdStr, memberUserId, memberName, c._id)}
                                        >
                                          {isNudgingThisUser ? (
                                            <RefreshCw size={11} className={styles.spinning} />
                                          ) : (
                                            <Bell size={11} />
                                          )}
                                          Nudge
                                        </button>
                                        
                                        <button
                                          className={styles.btnSecondary}
                                          style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#4F46E5', borderColor: 'rgba(79,70,229,0.3)' }}
                                          onClick={() => navigate('/circles', { state: { openChatWith: memberUserId } })}
                                          title={`Message ${memberName}`}
                                        >
                                          <MessageSquare size={11} /> Chat
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div style={{ width: '100%', height: '6px', background: '#F1F5F9', borderRadius: '99px', overflow: 'hidden' }}>
                                  <div style={{ width: `${memberPct}%`, height: '100%', background: statusDotColor, borderRadius: '99px', transition: 'width 0.4s ease' }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })()}

              </div>

              {/* Footer Actions */}
              <div className={styles.drawerActions}>
                <button className={styles.btnPrimary} onClick={() => { setDrawerCommitmentId(null); setInDrawerInviteSection(null); }}>
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Toast Popup */}
      {toastMessage && (
        <div className={styles.toastPopup}>
          {toastMessage}
        </div>
      )}
    </div>
  );
}
