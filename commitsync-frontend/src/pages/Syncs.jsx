import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';
import {
  Sparkles, Calendar, ChevronDown, ChevronRight, Trash2, Play,
  Check, GripVertical, Plus, RefreshCw, ArrowLeft, User, FolderHeart, X, Pencil, AlertCircle, Clock, Lightbulb, Star
} from 'lucide-react';
import DashboardNavbar from '../components/dashboard/DashboardNavbar';
import { computeNudges } from '../utils/nudgeEngine';
import styles from './Syncs.module.css';

// Template Category Images
import advImg from '../../images/templates/adventure.jpg';
import finImg from '../../images/templates/finance.jpg';
import healthImg from '../../images/templates/health.jpg';
import workImg from '../../images/templates/work.jpg';
import personalImg from '../../images/templates/personal.jpg';
import selfImpImg from '../../images/templates/self_improvement.jpg';
import studyImg from '../../images/templates/study.jpg';

// Unique ID helper
let _id = 0;
const uid = () => `task-${Date.now()}-${_id++}`;

/**
 * Client-side live risk projection.
 * Re-computes timePressure based on the CURRENT time so the displayed risk
 * is never stale between server refreshes, even if the cron hasn't run yet.
 * This is a read-only projection — it does NOT write to the server.
 */
function computeLiveRisk(commitment) {
  const now = new Date();
  const deadline = new Date(commitment.deadline);
  const created  = new Date(commitment.createdAt || commitment.updatedAt || now);

  const hoursLeft     = (deadline - now) / (1000 * 60 * 60);
  const totalTimeMs   = Math.max(1, deadline - created);
  const elapsedMs     = Math.max(0, now - created);
  const timeRatio     = Math.min(1, elapsedMs / totalTimeMs);
  const progressRatio = (commitment.progress || 0) / 100;

  // Overdue and not complete → always 100
  if (hoursLeft <= 0 && progressRatio < 1) return 100;

  // Smooth time pressure curve (mirrors backend)
  let timePressure;
  if      (hoursLeft <= 24)  timePressure = 80 + (1 - hoursLeft / 24)          * 20;
  else if (hoursLeft <= 72)  timePressure = 55 + (1 - (hoursLeft - 24) / 48)   * 25;
  else if (hoursLeft <= 168) timePressure = 25 + (1 - (hoursLeft - 72) / 96)   * 30;
  else                       timePressure = Math.max(5, 25 - (hoursLeft - 168) * 0.03);
  timePressure = Math.max(0, Math.min(100, timePressure));

  const gap         = Math.max(0, timeRatio - progressRatio);
  const progressGap = Math.min(100, gap * 100);

  // Lightweight composite (no workload/history available client-side)
  const liveScore = Math.round((timePressure * 0.55) + (progressGap * 0.45));
  return Math.max(0, Math.min(100, liveScore));
}

// Priority colour helper
const priorityClass = (p, s) => {
  if (p === 'HIGH')   return s.priorityHigh;
  if (p === 'LOW')    return s.priorityLow;
  return s.priorityMedium;
};

const CATEGORY_IMAGES = {
  'Personal': personalImg,
  'Work': workImg,
  'Adventure': advImg,
  'Study': studyImg,
  'Self Improvement': selfImpImg,
  'Health': healthImg,
  'Finance': finImg,
  'My Templates': null // Handled specially with a user icon
};

export default function Syncs() {
  const { user } = useAuth();
  const { criticalAlerts, dismissAlert } = useSocket();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  // Handle openReschedule state from actionable notifications (Feature 7)
  useEffect(() => {
    if (location.state?.openReschedule) {
      const commitmentId = location.state.openReschedule;
      setRescheduleData({ id: commitmentId, newDeadline: '', reason: '' });
      setShowRescheduleModal(true);
      navigate('/syncs', { replace: true, state: {} });
    }
  }, [location.state]);

  // Feature 8: Refresh commitment data whenever a new critical alert arrives
  useEffect(() => {
    if (criticalAlerts.length > 0) {
      queryClient.invalidateQueries({ queryKey: ['active_commitments'] });
    }
  }, [criticalAlerts.length]);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: commitmentsData } = useQuery({
    queryKey: ['active_commitments'],
    queryFn: async () => { const r = await api.get('/commitments/active'); return r.data.data; },
    // Adaptive refresh: poll frequently when any commitment is high-risk or overdue,
    // otherwise every 5 minutes to avoid unnecessary network traffic.
    refetchInterval: (query) => {
      const data = query.state.data;
      const commitments = data?.commitments || [];
      const now = new Date();
      const hasUrgent = commitments.some(
        c => c.currentRiskScore >= 65 || new Date(c.deadline) < now
      );
      return hasUrgent ? 60_000 : 300_000; // 1 min if urgent, 5 min otherwise
    },
    refetchIntervalInBackground: false,
    staleTime: 55_000
  });
  const allCommitments = commitmentsData?.commitments || [];
  const draftCommitments = allCommitments.filter(c => c.status === 'DRAFT');
  const commitments = allCommitments.filter(c => c.status !== 'DRAFT');

  const { data: historyData } = useQuery({
    queryKey: ['history_commitments'],
    queryFn: async () => { const r = await api.get('/commitments/history'); return r.data.data; },
    staleTime: 5 * 60 * 1000
  });
  const historicalCommitments = historyData?.commitments || [];
  const behavioralPattern = historyData?.behavioralPattern || 'MIXED';

  const { data: stats } = useQuery({
    queryKey: ['analytics_overview'],
    queryFn: async () => {
      try {
        const res = await api.get('/analytics/overview');
        return res.data.data;
      } catch (err) {
        return null;
      }
    }
  });

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => { 
      const r = await api.get('/friends'); 
      return r.data.data.friends || r.data.data; 
    }
  });
  const friends = (friendsData || []).map(f => f.friendId ? f.friendId : f).filter(Boolean);

  const { data: templatesData } = useQuery({
    queryKey: ['templates'],
    queryFn: async () => { const r = await api.get('/templates'); return r.data.data; }
  });
  const templates = templatesData || [];

  const { data: calendarData, error: calendarEventsError } = useQuery({
    queryKey: ['calendar_events'],
    queryFn: async () => { const r = await api.get('/commitments/calendar-events'); return r.data.data; }
  });
  const calendarEvents = calendarData?.events || [];
  const calendarConnected = calendarData?.calendarConnected;
  const calendarFetchError = calendarData?.fetchError;

  // ── Form persistence helpers ───────────────────────────────────────────────
  const DRAFT_KEY = 'commitsync_sync_draft';
  const loadDraft = () => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d.subTasks) d.subTasks = d.subTasks.map(t => ({ ...t, id: uid() }));
      if (d.checkedAi) d.checkedAi = new Set(d.checkedAi);
      return d;
    } catch { return null; }
  };
  const draft = loadDraft();

  // ── Form ───────────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState(draft?.formData || { title: '', reward: '', risk: '', deadline: '', saveToTemplates: false, templateCategory: 'Personal', ignoreCalendar: false });
  const [calendarWarning, setCalendarWarning] = useState('');

  // ── AI state ───────────────────────────────────────────────────────────────
  const [aiEnabled, setAiEnabled]       = useState(draft?.aiEnabled ?? true);
  const [aiSuggestions, setAiSuggestions] = useState(draft?.aiSuggestions || []);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [checkedAi, setCheckedAi]       = useState(draft?.checkedAi || new Set());

  // ── Subtask state ──────────────────────────────────────────────────────────
  const [subTasks, setSubTasks]     = useState(draft?.subTasks || []);
  const [dragIdx, setDragIdx]       = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  // createMode needed before the persistence useEffect below
  const [createMode, setCreateMode] = useState(draft?.createMode || 'SYNC');

  // ── Persist draft to sessionStorage on every relevant change ───────────────
  useEffect(() => {
    const hasContent = formData.title || formData.reward || formData.risk || formData.deadline || subTasks.length > 0;
    if (!hasContent) {
      sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        formData,
        aiEnabled,
        aiSuggestions,
        checkedAi: [...checkedAi],
        subTasks,
        createMode
      }));
    } catch { /* quota exceeded – silently ignore */ }
  }, [formData, aiEnabled, aiSuggestions, checkedAi, subTasks, createMode]);

  // ── Template UI state ──────────────────────────────────────────────────────
  const [selectedCategoryForTemplate, setSelectedCategoryForTemplate] = useState(null);
  const [templatePanelVisible, setTemplatePanelVisible] = useState(true); // for fade-transition
  // Edit template modal state
  const [editingTemplate, setEditingTemplate] = useState(null); // null or template obj
  const [editForm, setEditForm]               = useState({ name: '', category: 'Personal', risk: '', reward: '', subTasks: [] });
  const [deleteConfirmId, setDeleteConfirmId] = useState(null); // id of template pending delete

  // ── Modal state ────────────────────────────────────────────────────────────
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleData, setRescheduleData]         = useState({ id: null, newDeadline: '', reason: '' });
  const [expandedCommitments, setExpandedCommitments] = useState({});
  // ── Nudge dismissal (local state for instant UI removal) ───────────────────
  const [dismissedNudgeIds, setDismissedNudgeIds] = useState(() => {
    // Pre-populate from localStorage so already-dismissed nudges are filtered immediately on mount
    try {
      const now = Date.now();
      const ids = new Set();
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('nudge_dismissed_')) {
          const dismissedAt = parseInt(localStorage.getItem(key));
          if ((now - dismissedAt) / 3600000 < 24) {
            ids.add(key.replace('nudge_dismissed_', ''));
          }
        }
      }
      return ids;
    } catch { return new Set(); }
  });
  // Pinned (priority) commitment — stored in localStorage so it persists across reloads
  const [pinnedCommitmentId, setPinnedCommitmentId] = useState(() => {
    try { return localStorage.getItem('commitsync_pinned_commitment') || null; } catch { return null; }
  });
  // Drawer states
  const [drawerCommitmentId, setDrawerCommitmentId] = useState(null);
  const [drawerTab, setDrawerTab] = useState('overview'); // overview | tasks | insights

  const [editingActiveSyncId, setEditingActiveSyncId] = useState(null);
  const [resumingDraftId, setResumingDraftId] = useState(null);
  const [editingActiveSubtasks, setEditingActiveSubtasks] = useState([]);
  const [focusHoursInput, setFocusHoursInput] = useState({});
  const [focusStartTimeInput, setFocusStartTimeInput] = useState({});
  const [focusStatus, setFocusStatus] = useState({});
  const [expandedDeepWork, setExpandedDeepWork] = useState({});
  const [expandedSubtasksSection, setExpandedSubtasksSection] = useState({});
  const [expandedRetrospectives, setExpandedRetrospectives] = useState({});
  const [expandedHistoryTags, setExpandedHistoryTags] = useState({});

  // ── Coach tip state ────────────────────────────────────────────────────────
  const [coachTipOpen, setCoachTipOpen]     = useState({}); // { [commitmentId]: boolean }
  const [coachTipData, setCoachTipData]     = useState({}); // { [commitmentId]: { headline, tips, microGoal, encouragement, fetchedAt } }
  const [coachTipLoading, setCoachTipLoading] = useState({}); // { [commitmentId]: boolean }
  const COACH_CACHE_MS = 10 * 60 * 1000; // 10 minutes

  const handleCoachTip = async (e, commitmentId) => {
    e.stopPropagation();
    const now = Date.now();
    const cached = coachTipData[commitmentId];
    // Toggle off
    if (coachTipOpen[commitmentId]) {
      setCoachTipOpen(p => ({ ...p, [commitmentId]: false }));
      return;
    }
    // Toggle on — serve cache if fresh
    setCoachTipOpen(p => ({ ...p, [commitmentId]: true }));
    if (cached && now - cached.fetchedAt < COACH_CACHE_MS) return;
    // Fetch fresh
    setCoachTipLoading(p => ({ ...p, [commitmentId]: true }));
    try {
      const res = await api.post(`/commitments/${commitmentId}/coach-tip`);
      setCoachTipData(p => ({
        ...p,
        [commitmentId]: { ...res.data.data, fetchedAt: Date.now() }
      }));
    } catch {
      setCoachTipData(p => ({
        ...p,
        [commitmentId]: {
          headline: 'Keep going — every step counts.',
          tips: ['Focus on the next subtask only.', 'Take a 5-minute break between work blocks.', 'Your progress today compounds tomorrow.'],
          microGoal: 'Spend 25 minutes on the most important next step right now.',
          encouragement: 'You have what it takes to deliver this.',
          fetchedAt: Date.now()
        }
      }));
    } finally {
      setCoachTipLoading(p => ({ ...p, [commitmentId]: false }));
    }
  };
  
  // ── Toast state ────────────────────────────────────────────────────────────
  const [toastMessage, setToastMessage] = useState('');
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const handleStartFocus = async (id) => {
    const hours = parseFloat(focusHoursInput[id]) || 2;
    const startTimeStr = focusStartTimeInput[id];

    // Compute best free slot using current calendar events (in-scope)
    const computeBestSlot = (durationHrs) => {
      const SLEEP_START = 23;
      const SLEEP_END = 7;
      const isSleepHour = (d) => { const h = d.getHours(); return h >= SLEEP_START || h < SLEEP_END; };
      const durationMs = durationHrs * 3600000;
      const now = new Date();
      now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
      const twoDaysLater = new Date(now.getTime() + 2 * 86400000);
      const busy = [...(calendarEvents || [])].map(ev => ({ start: new Date(ev.start), end: new Date(ev.end) })).sort((a, b) => a.start - b.start);
      let candidate = new Date(now);
      for (let i = 0; i < 50; i++) {
        if (isSleepHour(candidate)) {
          candidate.setHours(SLEEP_END, 0, 0, 0);
          if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
          continue;
        }
        const candidateEnd = new Date(candidate.getTime() + durationMs);
        if (isSleepHour(candidateEnd)) {
          candidate = new Date(candidate);
          candidate.setDate(candidate.getDate() + 1);
          candidate.setHours(SLEEP_END, 0, 0, 0);
          continue;
        }
        const overlappingEvent = busy.find(event => candidate.getTime() + durationMs > event.start.getTime() && candidate.getTime() < event.end.getTime());
        if (!overlappingEvent) {
          if (candidate.getTime() + durationMs > twoDaysLater.getTime()) return null;
          return candidate;
        }
        candidate = new Date(overlappingEvent.end.getTime() + 5 * 60000);
      }
      return null;
    };

    // Set loading state
    setFocusStatus(prev => ({ ...prev, [id]: 'LOADING' }));

    try {
      let start;
      if (startTimeStr) {
        start = new Date(startTimeStr);
      } else {
        // Use computed best slot, fall back to right now
        start = computeBestSlot(hours) || new Date();
      }
      const end = new Date(start.getTime() + hours * 3600000);
      const res = await api.post(`/commitments/${id}/focus-session`, { start: start.toISOString(), end: end.toISOString() });
      if (res.data.success) {
        setFocusStatus(prev => ({ ...prev, [id]: 'ADDED' }));
        showToast('✅ Focus session scheduled on Google Calendar!');
      } else {
        setFocusStatus(prev => ({ ...prev, [id]: null }));
        showToast('Could not schedule focus session. Please try again.');
      }
    } catch (err) {
      setFocusStatus(prev => ({ ...prev, [id]: null }));
      const msg = err?.response?.data?.error || 'Failed to schedule focus session. Is Calendar connected?';
      showToast(`❌ ${msg}`);
    }
  };

  // ── Subtask helpers ────────────────────────────────────────────────────────
  const addSubTask = (task = null) =>
    setSubTasks(prev => [...prev, {
      id: uid(),
      title: task?.title || '',
      estimatedHours: task?.estimatedHours || 1,
      unit: task?.unit || 'hours', // 'hours' | 'days'
      priority: task?.priority || 'MEDIUM',
      aiIndex: task?.aiIndex ?? null
    }]);

  const removeSubTask = (id) => {
    const task = subTasks.find(t => t.id === id);
    if (task?.aiIndex != null)
      setCheckedAi(prev => { const s = new Set(prev); s.delete(task.aiIndex); return s; });
    setSubTasks(prev => prev.filter(t => t.id !== id));
  };

  const updateSubTask = (id, field, value) =>
    setSubTasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));

  const toggleAiSuggestion = (idx, suggestion) => {
    if (checkedAi.has(idx)) {
      setCheckedAi(prev => { const s = new Set(prev); s.delete(idx); return s; });
      setSubTasks(prev => prev.filter(t => t.aiIndex !== idx));
    } else {
      setCheckedAi(prev => new Set([...prev, idx]));
      setSubTasks(prev => {
        const newTask = {
          id: uid(),
          title: suggestion.title,
          estimatedHours: suggestion.estimatedHours || 1,
          unit: 'hours',
          priority: suggestion.priority || 'MEDIUM',
          aiIndex: idx
        };
        const insertAt = prev.findIndex(t => t.aiIndex !== null && t.aiIndex > idx);
        if (insertAt === -1) return [...prev, newTask];
        const arr = [...prev];
        arr.splice(insertAt, 0, newTask);
        return arr;
      });
    }
  };

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };
  const handleDrop = (e, idx) => {
    e.preventDefault();
    if (dragIdx == null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const arr = [...subTasks];
    const [moved] = arr.splice(dragIdx, 1);
    arr.splice(idx, 0, moved);
    setSubTasks(arr);
    setDragIdx(null);
    setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveAsTemplateMutation = useMutation({
    mutationFn: async (data) => { await api.post('/templates', data); },
    onSuccess: () => { queryClient.invalidateQueries(['templates']); }
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }) => { const r = await api.put(`/templates/${id}`, data); return r.data.data; },
    onSuccess: () => {
      queryClient.invalidateQueries(['templates']);
      setEditingTemplate(null);
      showToast('Template updated!');
    }
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id) => { await api.delete(`/templates/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries(['templates']);
      setDeleteConfirmId(null);
      showToast('Template deleted.');
    }
  });

  // Helper: convert a subtask's displayed value to hours for the backend
  const toHours = (task) => {
    const val = Number(task.estimatedHours) || 1;
    return task.unit === 'days' ? val * 8 : val;
  };

  const createMutation = useMutation({
    mutationFn: async (payload) => { const r = await api.post('/commitments', payload); return r.data.data; },
    onSuccess: (newSync) => {
      queryClient.invalidateQueries(['active_commitments']);

      const savedStatus = newSync?.commitment?.status;

      // ── DRAFT: silent save — keep form so user can keep editing ──
      if (savedStatus === 'DRAFT') {
        showToast('📝 Draft saved! Resume editing anytime from the Drafts shelf below.');
        return;
      }

      // ── PENDING: full commit ──
      showToast('🚀 Sync established successfully!');

      if (newSync?.calendarWarning) {
        setCalendarWarning(newSync.calendarWarning);
        setTimeout(() => setCalendarWarning(''), 8000);
      }

      const wantsTemplate = formData.saveToTemplates;
      const templatePayload = {
        name: formData.title,
        category: formData.templateCategory,
        reward: formData.reward,
        risk: formData.risk,
        subTasks: subTasks
          .filter(t => t.title.trim())
          .map(t => ({ title: t.title.trim(), estimatedHours: toHours(t), priority: t.priority }))
      };

      setFormData({ title: '', reward: '', risk: '', deadline: '', saveToTemplates: false, templateCategory: 'Personal', ignoreCalendar: false });
      setAiSuggestions([]); setCheckedAi(new Set()); setSubTasks([]);
      sessionStorage.removeItem(DRAFT_KEY);

      if (wantsTemplate) {
        saveAsTemplateMutation.mutate(templatePayload, {
          onSuccess: () => showToast('Template added successfully!')
        });
      }
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => { await api.delete(`/commitments/${id}`); },
    onSuccess: () => queryClient.invalidateQueries(['active_commitments'])
  });

  const rescheduleMutation = useMutation({
    mutationFn: async ({ id, newDeadline, reason }) => {
      await api.post(`/commitments/${id}/reschedule`, { newDeadline, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['active_commitments']);
      setShowRescheduleModal(false);
      setRescheduleData({ id: null, newDeadline: '', reason: '' });
      showToast('\u2705 Sync rescheduled successfully!');
    },
    onError: () => {
      showToast('\u274c Failed to reschedule. Please try again.');
    }
  });

  const updateProgressMutation = useMutation({
    mutationFn: async ({ id, subTaskIndex, progress }) => {
      await api.put(`/commitments/${id}/progress`, { subTaskIndex, progress });
    },
    onMutate: async ({ id, subTaskIndex, progress }) => {
      await queryClient.cancelQueries({ queryKey: ['active_commitments'] });
      const previousCommitments = queryClient.getQueryData(['active_commitments']);
      
      queryClient.setQueryData(['active_commitments'], old => {
        if (!old) return old;
        return {
          ...old,
          commitments: old.commitments.map(c => {
            if (c._id === id) {
              const newSubTasks = [...c.subTasks];
              if (newSubTasks[subTaskIndex]) {
                newSubTasks[subTaskIndex] = { ...newSubTasks[subTaskIndex], progress };
              }
              
              // Optimistically update overall progress
              const totalHours = newSubTasks.reduce((sum, t) => sum + (t.estimatedHours || 1), 0);
              const completedHours = newSubTasks.reduce((sum, t) => sum + (t.progress === 100 ? (t.estimatedHours || 1) : 0), 0);
              const newProgress = totalHours > 0 ? Math.round((completedHours / totalHours) * 100) : 0;
              
              const updatedCommitment = { ...c, subTasks: newSubTasks, progress: newProgress };
              updatedCommitment.currentRiskScore = computeLiveRisk(updatedCommitment);
              
              return updatedCommitment;
            }
            return c;
          })
        };
      });
      return { previousCommitments };
    },
    onError: (err, variables, context) => {
      if (context?.previousCommitments) {
        queryClient.setQueryData(['active_commitments'], context.previousCommitments);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['active_commitments'] });
    }
  });

  const updateCommitmentMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      await api.put(`/commitments/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['active_commitments']);
      setEditingActiveSyncId(null);
    }
  });

  const markCompleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.post(`/commitments/${id}/complete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['active_commitments']);
      queryClient.invalidateQueries(['historical_commitments']);
      setDrawerCommitmentId(null);
      showToast('\u2728 Sync marked as completed!');
    }
  });

  const handleEditActiveSync = (commitment) => {
    setEditingActiveSyncId(commitment._id);
    setEditingActiveSubtasks(commitment.subTasks.map(t => ({ ...t, id: uid() })));
  };

  const handleSaveActiveSync = (id) => {
    updateCommitmentMutation.mutate({
      id,
      payload: {
        subTasks: editingActiveSubtasks
          .filter(t => t.title.trim())
          .map(t => ({ title: t.title.trim(), estimatedHours: Number(t.estimatedHours) || 1, progress: t.progress || 0 }))
      }
    });
  };

  const updateActiveSubtask = (id, field, value) => {
    setEditingActiveSubtasks(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };
  const removeActiveSubtask = (id) => {
    setEditingActiveSubtasks(prev => prev.filter(t => t.id !== id));
  };
  const addActiveSubtask = () => {
    setEditingActiveSubtasks(prev => [...prev, { id: uid(), title: '', estimatedHours: 1, progress: 0 }]);
  };

  // ── Handlers ───────────────────────────────────────────────────────────────
  const fetchSuggestions = async () => {
    if (!formData.title) return;
    setIsSuggesting(true);
    try {
      const res = await api.post('/commitments/suggest-subtasks', { title: formData.title });
      const generated = res.data.subtasks || [];
      setAiSuggestions(generated);
      const newChecked = new Set();
      const newTasks = generated.map((s, idx) => {
        newChecked.add(idx);
        return { id: uid(), title: s.title, estimatedHours: s.estimatedHours || 1, priority: s.priority || 'MEDIUM', aiIndex: idx };
      });
      setCheckedAi(newChecked);
      setSubTasks(newTasks);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleTitleBlur = () => {
    if (aiEnabled && formData.title && aiSuggestions.length === 0) fetchSuggestions();
  };

  const submitForm = (status = 'PENDING') => {
    const payload = {
      title: formData.title,
      reward: formData.reward,
      risk: formData.risk,
      deadline: formData.deadline,
      ignoreCalendar: formData.ignoreCalendar,
      status,
      subTasks: subTasks
        .filter(t => t.title.trim())
        .map(t => ({ title: t.title.trim(), estimatedHours: toHours(t), priority: t.priority }))
    };

    if (resumingDraftId) {
      // Update the existing draft instead of creating a new commitment
      updateCommitmentMutation.mutate({ id: resumingDraftId, payload }, {
        onSuccess: () => {
          queryClient.invalidateQueries(['active_commitments']);
          if (status === 'PENDING') {
            showToast('🚀 Sync established! Draft promoted to active.');
            setResumingDraftId(null);
            setFormData({ title: '', reward: '', risk: '', deadline: '', saveToTemplates: false, templateCategory: 'Personal', ignoreCalendar: false });
            setAiSuggestions([]); setCheckedAi(new Set()); setSubTasks([]);
            sessionStorage.removeItem(DRAFT_KEY);
          } else {
            showToast('📝 Draft updated!');
          }
        }
      });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Resume a saved draft: repopulate the form at top
  const resumeDraft = (c) => {
    setResumingDraftId(c._id);
    // Convert ISO date to datetime-local format ("YYYY-MM-DDTHH:mm")
    const deadlineLocal = c.deadline
      ? (() => { const d = new Date(c.deadline); const off = d.getTimezoneOffset() * 60000; return new Date(d - off).toISOString().slice(0, 16); })()
      : '';
    setFormData({
      title: c.title || '',
      reward: c.reward || '',
      risk: c.risk || '',
      deadline: deadlineLocal,
      saveToTemplates: false,
      templateCategory: 'Personal',
      ignoreCalendar: c.ignoreCalendar || false
    });
    setSubTasks((c.subTasks || []).map(t => ({
      id: uid(), title: t.title,
      estimatedHours: t.estimatedHours || 1,
      unit: 'hours',
      priority: t.priority || 'MEDIUM',
      aiIndex: null
    })));
    setAiSuggestions([]); setCheckedAi(new Set());
    setCreateMode('SYNC');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Promote a draft directly to PENDING without opening the form
  const activateDraft = (id) => {
    updateCommitmentMutation.mutate({ id, payload: { status: 'PENDING' } }, {
      onSuccess: () => {
        queryClient.invalidateQueries(['active_commitments']);
        showToast('✅ Commitment activated and moved to Active Syncs!');
        if (resumingDraftId === id) {
          setResumingDraftId(null);
          setFormData({ title: '', reward: '', risk: '', deadline: '', saveToTemplates: false, templateCategory: 'Personal', ignoreCalendar: false });
          setSubTasks([]); setAiSuggestions([]); setCheckedAi(new Set());
        }
      }
    });
  };

  const applyTemplate = (template) => {
    setFormData(prev => ({
      ...prev,
      title: template.title || template.name,
      reward: template.reward || '',
      risk: template.risk || ''
    }));
    setSubTasks((template.subTasks || []).map((t, idx) => ({
      id: uid(), title: t.title,
      estimatedHours: t.estimatedHours || 1,
      priority: t.priority || 'MEDIUM',
      aiIndex: null
    })));
    setAiSuggestions([]); setCheckedAi(new Set());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitNewTemplate = () => {
    saveAsTemplateMutation.mutate({
      name: formData.title,
      category: formData.templateCategory,
      risk: formData.risk,
      reward: formData.reward,
      subTasks: subTasks
        .filter(t => t.title.trim())
        .map(t => ({ title: t.title.trim(), estimatedHours: toHours(t), priority: t.priority }))
    }, {
      onSuccess: () => {
        showToast('Template added successfully!');
        setFormData({ title: '', reward: '', risk: '', deadline: '', saveToTemplates: false, templateCategory: 'Personal', ignoreCalendar: false });
        setSubTasks([]);
        setCreateMode('SYNC');
        sessionStorage.removeItem(DRAFT_KEY);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  };

  // ── Computed ───────────────────────────────────────────────────────────────
  const totalHours = subTasks.reduce((s, t) => s + toHours(t), 0);

  const deadlineBudget = (() => {
    if (!formData.deadline) return null;
    const diff = new Date(formData.deadline) - new Date();
    if (diff <= 0) return null;
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return { days, hours: days * 8 };
  })();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.syncsContainer}>
      <DashboardNavbar activeSection="syncs" />

      <div className={styles.contentWrapper}>

        {/* ═══ START A NEW SYNC / TEMPLATE ════════════════════════════════════ */}
        <div className={styles.pageHeader} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className={styles.modeToggleContainer}>
            <button 
              className={`${styles.modeToggleBtn} ${createMode === 'SYNC' ? styles.modeToggleActive : ''}`}
              onClick={() => setCreateMode('SYNC')}
            >
              Start a New Sync
            </button>
            <button 
              className={`${styles.modeToggleBtn} ${createMode === 'TEMPLATE' ? styles.modeToggleActive : ''}`}
              onClick={() => setCreateMode('TEMPLATE')}
            >
              Create Template
            </button>
          </div>
          <p className={styles.pageSubtitle} style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
            {createMode === 'SYNC' 
              ? 'Define your intent — AI breaks it into steps, you shape the path.' 
              : 'Save a workflow layout to quickly spin up future syncs without AI.'}
          </p>
        </div>

        <section className={styles.sectionContainer} style={{ paddingTop: '1.5rem', paddingBottom: '1.5rem' }}>

          {calendarWarning && (
            <div className={styles.calendarWarningBanner}>
              <AlertCircle size={16} />
              <span>{calendarWarning}</span>
            </div>
          )}

          {/* ── Title input ── */}
          <div className={styles.titleSection}>
            <label className={styles.conversationalLabel}>I want to...</label>
            <div className={styles.titleInputWrapper}>
              <input
                type="text"
                className={styles.conversationalInput}
                placeholder="e.g. Plan a trip to Mysore, Prepare for finals, Learn guitar..."
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                onBlur={handleTitleBlur}
              />
              {aiEnabled && formData.title && (
                <button
                  className={styles.refreshBtn}
                  onClick={fetchSuggestions}
                  disabled={isSuggesting}
                  title="Re-generate AI suggestions"
                >
                  <RefreshCw size={14} className={isSuggesting ? styles.spinning : ''} />
                  {isSuggesting ? 'Thinking…' : (aiSuggestions.length === 0 ? 'Generate' : 'Regenerate')}
                </button>
              )}
            </div>
          </div>

          {/* ── Workspace: AI timeline + Subtask editor ── */}
          <div className={`${styles.syncWorkspace} ${createMode === 'TEMPLATE' ? styles.syncWorkspaceSingle : ''}`}>

            {/* LEFT — AI Timeline */}
            {createMode === 'SYNC' && (
            <div className={`${styles.aiPane} ${!aiEnabled ? styles.aiPaneDisabled : ''}`}>
              <div className={styles.aiHeader}>
                <div className={styles.aiTitle}>
                  <Sparkles size={15} color="#D35400" />
                  AI Assistant
                </div>
                {isSuggesting && (
                  <div className={styles.thinkingDots}>
                    <span /><span /><span />
                  </div>
                )}
              </div>

              <div className={styles.aiTimeline}>
                {isSuggesting ? (
                  /* Skeleton */
                  [80, 65, 90, 55, 70].map((w, i) => (
                    <div key={i} className={styles.aiNodeSkeleton}>
                      <div className={styles.skeletonTrack}>
                        <div className={styles.skeletonCircle} />
                        {i < 4 && <div className={styles.skeletonLine} />}
                      </div>
                      <div className={styles.skeletonContent}>
                        <div className={styles.skeletonBar} style={{ width: `${w}%` }} />
                        <div className={styles.skeletonBar} style={{ width: '45%', opacity: 0.5 }} />
                      </div>
                    </div>
                  ))
                ) : aiSuggestions.length > 0 ? (
                  aiSuggestions.map((s, idx) => {
                    const checked = checkedAi.has(idx);
                    const isLast  = idx === aiSuggestions.length - 1;
                    return (
                      <div
                        key={idx}
                        className={`${styles.aiNode} ${checked ? styles.aiNodeChecked : ''}`}
                        onClick={() => toggleAiSuggestion(idx, s)}
                        title={checked ? 'Remove from subtasks' : 'Add to subtasks'}
                      >
                        <div className={styles.nodeTrack}>
                          <div className={styles.nodeCircle}>
                            {checked
                              ? <Check size={12} strokeWidth={3} />
                              : <span className={styles.nodeNum}>{idx + 1}</span>}
                          </div>
                          {!isLast && <div className={`${styles.nodeLine} ${checked ? styles.nodeLineChecked : ''}`} />}
                        </div>
                        <div className={styles.nodeContent}>
                          <span className={styles.nodeTitle}>{s.title}</span>
                          <div className={styles.nodeMeta}>
                            <span className={styles.nodeHours}>{s.estimatedHours}h</span>
                            <span className={`${styles.nodePriority} ${priorityClass(s.priority, styles)}`}>
                              {s.priority}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className={styles.aiEmptyState}>
                    <Sparkles size={30} strokeWidth={1.5} />
                    <p>Type your goal above<br />to get AI-powered steps.</p>
                  </div>
                )}
              </div>

              {aiSuggestions.length > 0 && (
                <p className={styles.aiHint}>Click a step to add / remove it</p>
              )}
              
              <div style={{ marginTop: 'auto', paddingTop: '1.5rem', textAlign: 'center' }}>
                <button 
                  className={styles.btnSecondary} 
                  style={{ width: '100%', border: '1px dashed rgba(26,29,32,0.2)', background: 'transparent' }}
                  onClick={() => {
                    const el = document.getElementById('templates-section');
                    if (el) el.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <FolderHeart size={16} style={{ marginRight: '0.4rem', verticalAlign: 'text-bottom' }} />
                  Select from Templates
                </button>
              </div>
            </div>
            )}

            {/* RIGHT — Subtask Editor + Remaining Form */}
            <div className={styles.mainForm}>

              {/* ── Subtasks ── */}
              <div className={styles.subtasksSection}>
                <div className={styles.subtasksHeader}>
                  <span className={styles.subtasksLabel}>
                    Subtasks
                    {subTasks.length > 0 && (
                      <span className={styles.subtaskCount}>{subTasks.length}</span>
                    )}
                  </span>
                  {totalHours > 0 && (
                    <span className={styles.totalHoursBadge}>
                      Total&nbsp;<strong>{totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}h</strong>
                    </span>
                  )}
                </div>

                {/* Column header */}
                {subTasks.length > 0 && (
                  <div className={styles.subtaskColHeader}>
                    <span style={{ flex: 1, paddingLeft: '2rem' }}>Task</span>
                    <span style={{ width: '60px', textAlign: 'center' }}>Priority</span>
                    <span style={{ width: '110px', textAlign: 'center' }}>Time</span>
                    <span style={{ width: '28px' }} />
                  </div>
                )}

                <div className={styles.subtasksList}>
                  {subTasks.length === 0 ? (
                    <div className={styles.subtasksEmpty}>
                      <span>✨</span>
                      <p>
                        <span className={styles.desktopText}>Check AI steps on the left, or add your own below.</span>
                        <span className={styles.mobileText}>Check AI steps above, or add your own below.</span>
                      </p>
                    </div>
                  ) : (
                    subTasks.map((task, idx) => (
                      <div
                        key={task.id}
                        className={[
                          styles.subtaskRow,
                          dragOverIdx === idx ? styles.dragOver : '',
                          dragIdx === idx ? styles.dragging : ''
                        ].join(' ')}
                        draggable
                        onDragStart={e => handleDragStart(e, idx)}
                        onDragOver={e => handleDragOver(e, idx)}
                        onDrop={e => handleDrop(e, idx)}
                        onDragEnd={handleDragEnd}
                      >
                        <div className={styles.dragHandle}>
                          <GripVertical size={15} />
                        </div>

                        <input
                          className={styles.subtaskInput}
                          value={task.title}
                          onChange={e => updateSubTask(task.id, 'title', e.target.value)}
                          placeholder="Describe this step..."
                        />

                        <select
                          className={`${styles.prioritySelect} ${priorityClass(task.priority, styles)}`}
                          value={task.priority}
                          onChange={e => updateSubTask(task.id, 'priority', e.target.value)}
                        >
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Med</option>
                          <option value="LOW">Low</option>
                        </select>

                        <div className={styles.hoursWrapper} style={{ width: '110px', gap: '4px' }}>
                          <input
                            type="number"
                            className={styles.hoursInput}
                            value={task.estimatedHours}
                            min={task.unit === 'days' ? 0.5 : 0.5}
                            step={task.unit === 'days' ? 0.5 : 0.5}
                            onChange={e => updateSubTask(task.id, 'estimatedHours', parseFloat(e.target.value) || 0.5)}
                          />
                          <div className={styles.unitToggle}>
                            <button
                              type="button"
                              className={`${styles.unitBtn} ${task.unit !== 'days' ? styles.unitBtnActive : ''}`}
                              onClick={() => updateSubTask(task.id, 'unit', 'hours')}
                              title="Hours"
                            >h</button>
                            <button
                              type="button"
                              className={`${styles.unitBtn} ${task.unit === 'days' ? styles.unitBtnActive : ''}`}
                              onClick={() => updateSubTask(task.id, 'unit', 'days')}
                              title="Days (1 day = 8 hours)"
                            >d</button>
                          </div>
                        </div>

                        <button className={styles.removeBtn} onClick={() => removeSubTask(task.id)} title="Remove">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button className={styles.addSubtaskBtn} onClick={() => addSubTask()}>
                  <Plus size={14} />
                  Add a subtask
                </button>
              </div>

              {/* ── Risk + Reward ── */}
              <div className={styles.formGrid}>
                <div className={styles.subInputGroup}>
                  <label className={`${styles.subLabel} ${styles.dangerLabel}`}>What's the risk of failing?</label>
                  <textarea
                    rows={2}
                    className={`${styles.subTextarea} ${styles.dangerInput}`}
                    placeholder="Missing the opportunity, disappointing yourself..."
                    value={formData.risk}
                    onChange={e => setFormData({ ...formData, risk: e.target.value })}
                  />
                </div>
                <div className={styles.subInputGroup}>
                  <label className={`${styles.subLabel} ${styles.successLabel}`}>Why is this important?</label>
                  <textarea
                    rows={2}
                    className={`${styles.subTextarea} ${styles.successInput}`}
                    placeholder="Fulfilling a lifelong dream, passing the exam..."
                    value={formData.reward}
                    onChange={e => setFormData({ ...formData, reward: e.target.value })}
                  />
                </div>
              </div>

              {/* ── Add to Templates & Deadline ── */}
              <div className={styles.formGrid} style={{ alignItems: 'center', marginTop: '0rem' }}>
                {createMode === 'SYNC' ? (
                  <div className={styles.templateCheckboxWrapper}>
                    <label className={styles.checkboxLabel}>
                      <input 
                        type="checkbox" 
                        className={styles.customCheckbox}
                        checked={formData.saveToTemplates}
                        onChange={e => setFormData({...formData, saveToTemplates: e.target.checked})}
                      />
                      <span className={styles.checkboxText}>Add to Templates</span>
                    </label>
                    
                    {formData.saveToTemplates && (
                      <select 
                        className={styles.templateCategorySelect}
                        value={formData.templateCategory}
                        onChange={e => setFormData({...formData, templateCategory: e.target.value})}
                      >
                        {Object.keys(CATEGORY_IMAGES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    )}
                  </div>
                ) : (
                  <div className={styles.subInputGroup}>
                    <label className={styles.subLabel}>Template Category</label>
                    <select 
                      className={styles.templateCategorySelect}
                      style={{ marginLeft: 0, width: '100%', padding: '0.75rem 1rem' }}
                      value={formData.templateCategory}
                      onChange={e => setFormData({...formData, templateCategory: e.target.value})}
                    >
                      {Object.keys(CATEGORY_IMAGES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                )}
                
                {createMode === 'SYNC' && (
                <div className={styles.subInputGroup}>
                  <label className={styles.subLabel}>Deadline</label>
                  <div className={styles.deadlineInputWrapper}>
                    <Calendar size={18} className={styles.deadlineIcon} />
                    <input
                      type="datetime-local"
                      className={styles.deadlineInput}
                      value={formData.deadline}
                      onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                    />
                  </div>
                  {deadlineBudget && (
                    <div className={styles.deadlineHint}>
                      <span>📅 {deadlineBudget.days} working day{deadlineBudget.days !== 1 ? 's' : ''} → ~{deadlineBudget.hours}h budget</span>
                      {totalHours > 0 && totalHours > deadlineBudget.hours && (
                        <span className={styles.overBudget}>⚠️ Subtask hours exceed deadline budget</span>
                      )}
                      {totalHours > 0 && totalHours <= deadlineBudget.hours && (
                        <span className={styles.onTrack}>✅ On track ({deadlineBudget.hours - totalHours}h to spare)</span>
                      )}
                    </div>
                  )}
                  
                  <div className={styles.templateCheckboxWrapper} style={{ marginTop: '0.5rem', paddingLeft: 0 }}>
                    <label className={styles.checkboxLabel}>
                      <input 
                        type="checkbox" 
                        className={styles.customCheckbox}
                        checked={formData.ignoreCalendar}
                        onChange={e => setFormData({...formData, ignoreCalendar: e.target.checked})}
                      />
                      <span className={styles.checkboxText} style={{ fontSize: '0.85rem', color: '#64748B' }}>Ignore calendar for risk calculation</span>
                    </label>
                  </div>
                </div>
                )}
              </div>

              {/* ── Resume Draft Banner ── */}
              {resumingDraftId && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.08) 100%)',
                  border: '1px solid rgba(99,102,241,0.25)',
                  borderRadius: '12px',
                  padding: '0.85rem 1.1rem',
                  marginBottom: '0.75rem',
                  animation: 'fadeSlideDown 0.3s ease-out'
                }}>
                  <Pencil size={16} color="#6366F1" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#4338CA' }}>Editing saved draft</span>
                    <span style={{ fontSize: '0.82rem', color: '#6366F1', marginLeft: '0.4rem' }}>— changes will update your draft. Click “Establish Sync” to activate it.</span>
                  </div>
                  <button
                    onClick={() => {
                      setResumingDraftId(null);
                      setFormData({ title: '', reward: '', risk: '', deadline: '', saveToTemplates: false, templateCategory: 'Personal', ignoreCalendar: false });
                      setSubTasks([]); setAiSuggestions([]); setCheckedAi(new Set());
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818CF8', padding: '0.2rem', borderRadius: '50%' }}
                    title="Discard and start fresh"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* ── Actions ── */}
              <div className={styles.actionRow} style={{ marginTop: '0.75rem' }}>
                {createMode === 'SYNC' ? (
                  <>
                    <div className={styles.toggleSwitch} onClick={() => setAiEnabled(!aiEnabled)}>
                      <div className={`${styles.toggleTrack} ${aiEnabled ? styles.on : ''}`}>
                        <div className={styles.toggleThumb} />
                      </div>
                      <span style={{ fontSize: '0.9rem', color: '#334155', fontWeight: 500 }}>AI Suggestions</span>
                    </div>
                    <div className={styles.submitButtonGroup}>
                      <button 
                        className={`${styles.btnSecondary} ${styles.btnSaveDraft}`}
                        onClick={() => submitForm('DRAFT')} 
                        disabled={!formData.title || !formData.deadline || createMutation.isPending || updateCommitmentMutation.isPending}
                      >
                        {(createMutation.isPending || updateCommitmentMutation.isPending) ? <RefreshCw size={14} className={styles.spinning} /> : <Pencil size={14} />}
                        {resumingDraftId ? 'Update Draft' : 'Save Draft'}
                      </button>
                      <button 
                        className={`${styles.btnPrimary} ${styles.btnEstablishSync}`}
                        onClick={() => submitForm('PENDING')} 
                        disabled={!formData.title || !formData.deadline || createMutation.isPending || updateCommitmentMutation.isPending}
                      >
                        {(createMutation.isPending || updateCommitmentMutation.isPending) ? <RefreshCw size={14} className={styles.spinning} style={{ marginRight: '6px' }} /> : null}
                        {resumingDraftId ? 'Establish Sync' : 'Establish Sync'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                    <button 
                      className={styles.btnPrimary} 
                      onClick={submitNewTemplate} 
                      disabled={!formData.title || saveAsTemplateMutation.isPending}
                      style={{ 
                        borderTopRightRadius: 0,
                        paddingTop: '0.75rem',
                        paddingBottom: '0.75rem'
                      }}
                    >
                      {saveAsTemplateMutation.isPending ? <RefreshCw size={14} className={styles.spinning} style={{ marginRight: '6px' }} /> : null}
                      Save Template
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ═══ TEMPLATES ══════════════════════════════════════════════════════ */}
        <div id="templates-section" className={styles.pageHeader} style={{ marginTop: '1.5rem' }}>
          <div>
            <h1 className={styles.pageTitle}>Templates</h1>
            <p className={styles.pageSubtitle}>Jumpstart your syncs with saved workflows.</p>
          </div>
        </div>

        <section 
          className={styles.sectionContainer} 
          style={{
            position: 'relative',
            minHeight: '420px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            padding: 0,
          }}
        >
          {/* Animated background layer — fades between states */}
          <div
            style={{
              position: 'absolute', inset: 0,
              backgroundImage: selectedCategoryForTemplate && CATEGORY_IMAGES[selectedCategoryForTemplate]
                ? `linear-gradient(rgba(10,18,35,0.62), rgba(10,18,35,0.78)), url(${CATEGORY_IMAGES[selectedCategoryForTemplate]})`
                : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              transition: 'background-image 0.5s ease',
              zIndex: 0,
            }}
          />

          {/* Content sits above the bg */}
          <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem 2rem' }}>
            {!selectedCategoryForTemplate ? (
              <div
                className={styles.categorySelectorView}
                style={{ flex: 1, animation: templatePanelVisible ? 'fadeSlideDown 0.35s ease-out both' : 'none' }}
              >
                <div className={styles.categorySelectorHeader} style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                  <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Explore Workflows</h2>
                </div>
                <div className={styles.categoryGalleryContainer}>
                  {Object.keys(CATEGORY_IMAGES).map(cat => (
                    <div
                      key={cat}
                      className={styles.categoryGalleryItem}
                      onClick={() => {
                        setTemplatePanelVisible(false);
                        setTimeout(() => {
                          setSelectedCategoryForTemplate(cat);
                          setTemplatePanelVisible(true);
                        }, 220);
                      }}
                    >
                      {CATEGORY_IMAGES[cat] ? (
                        <img src={CATEGORY_IMAGES[cat]} alt={cat} className={styles.categoryGalleryImage} />
                      ) : (
                        <div className={styles.myTemplatesFallback}>
                          <User size={32} color="#ffffff" />
                        </div>
                      )}
                      <span className={styles.categoryGalleryLabel}>{cat}</span>
                    </div>
                  ))}
                </div>
                <div style={{ textAlign: 'center', marginTop: '1.5rem', marginBottom: '0.5rem' }}>
                  <button
                    className={styles.btnPrimary}
                    onClick={() => {
                      setCreateMode('TEMPLATE');
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderTopRightRadius: 0, whiteSpace: 'nowrap', padding: '0.75rem 1.5rem' }}
                  >
                    <Plus size={18} />
                    New Template
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={styles.templateDetailView}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', animation: templatePanelVisible ? 'fadeSlideDown 0.35s ease-out both' : 'none' }}
              >
                {/* Top bar */}
                <div className={styles.templateDetailTopBar}>
                  <button
                    onClick={() => {
                      setTemplatePanelVisible(false);
                      setTimeout(() => {
                        setSelectedCategoryForTemplate(null);
                        setTemplatePanelVisible(true);
                      }, 220);
                    }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer', backdropFilter: 'blur(8px)', flexShrink: 0, transition: 'background 0.2s ease' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.22)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <h2 style={{ color: '#fff', margin: 0, flex: 1, textAlign: 'center', fontSize: '1.4rem', fontFamily: 'Libre Baskerville, serif', fontWeight: 400, letterSpacing: '0.02em', paddingRight: '36px', textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
                    {selectedCategoryForTemplate}
                  </h2>
                </div>

                {/* Template cards */}
                {templates.filter(t => t.category === selectedCategoryForTemplate).length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem', marginTop: '1.75rem', flex: 1, overflowY: 'auto', maxHeight: '280px', paddingRight: '0.25rem' }}>
                    {templates.filter(t => t.category === selectedCategoryForTemplate).map(t => (
                      <div
                        key={t._id}
                        className={styles.darkTemplateCard}
                        onClick={() => applyTemplate(t)}
                      >
                        {/* Edit / Delete icons — appear on hover via CSS */}
                        <div className={styles.darkTemplateCardActions} onClick={e => e.stopPropagation()}>
                          <button
                            className={styles.darkTemplateIconBtn}
                            title="Edit template"
                            onClick={() => {
                              setEditForm({
                                name: t.name || t.title || '',
                                category: t.category,
                                risk: t.risk || '',
                                reward: t.reward || '',
                                subTasks: (t.subTasks || []).map(s => ({ ...s, _uid: Math.random().toString(36).slice(2) }))
                              });
                              setEditingTemplate(t);
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            className={`${styles.darkTemplateIconBtn} ${styles.darkTemplateIconBtnDanger}`}
                            title="Delete template"
                            onClick={() => setDeleteConfirmId(t._id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>

                        <div style={{ flex: 1 }}>
                          <h3 style={{ margin: '0 0 0.4rem', fontSize: '1rem', fontWeight: 600, color: '#fff', lineHeight: 1.3 }}>{t.title || t.name}</h3>
                          <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.55)', fontWeight: 500 }}>
                            {t.subTasks?.length || 0} subtask{(t.subTasks?.length || 0) !== 1 ? 's' : ''}
                          </p>
                        </div>

                        <div className={styles.darkTemplateCardCta}>
                          Use Template <ChevronRight size={13} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '2px' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '2rem' }}>
                    <Sparkles size={32} style={{ opacity: 0.4, color: '#fff' }} />
                    <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.95rem', margin: 0 }}>No templates in this category yet.</p>
                    <button
                      className={styles.btnPrimary}
                      onClick={() => { setCreateMode('TEMPLATE'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      style={{ marginTop: '0.5rem', padding: '0.6rem 1.5rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                    >
                      <Plus size={15} /> Create One
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ═══ DRAFTS SHELF ════════════════════════════════════════════════════ */}
        {draftCommitments.length > 0 && (
          <section className={styles.sectionContainer} style={{ marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#A78BFA', boxShadow: '0 0 0 3px rgba(167,139,250,0.25)' }}></div>
                <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Drafts</h2>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', background: 'rgba(139,92,246,0.1)', color: '#7C3AED', padding: '0.2rem 0.65rem', borderRadius: '999px', border: '1px solid rgba(139,92,246,0.2)' }}>
                  {draftCommitments.length} unfinished
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#94A3B8' }}>Resume editing, or activate to move to Active Syncs.</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {draftCommitments.map(c => (
                <div
                  key={c._id}
                  style={{
                    background: resumingDraftId === c._id
                      ? 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.06) 100%)'
                      : 'rgba(255,255,255,0.55)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    border: resumingDraftId === c._id
                      ? '1.5px solid rgba(99,102,241,0.45)'
                      : '1.5px dashed rgba(167,139,250,0.45)',
                    borderRadius: '14px',
                    padding: '1rem 1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    transition: 'all 0.25s ease',
                    boxShadow: resumingDraftId === c._id ? '0 0 0 3px rgba(99,102,241,0.1)' : '0 4px 16px rgba(0,0,0,0.03)'
                  }}
                >
                  {/* Draft pencil icon */}
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(99,102,241,0.15) 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Pencil size={16} color="#7C3AED" />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontFamily: 'Libre Baskerville, serif', fontWeight: 400, color: '#1A1D20', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                        {c.title}
                      </h3>
                      <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(139,92,246,0.12)', color: '#6D28D9', border: '1px solid rgba(139,92,246,0.2)', flexShrink: 0 }}>
                        DRAFT
                      </span>
                      {resumingDraftId === c._id && (
                        <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(99,102,241,0.15)', color: '#4338CA' }}>
                          ✏️ Editing…
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, background: 'rgba(100,116,139,0.1)', color: '#475569', padding: '0.18rem 0.5rem', borderRadius: '6px' }}>
                        {c.category}
                      </span>
                      {c.deadline && (
                        <span style={{ fontSize: '0.72rem', color: '#94A3B8', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Calendar size={11} />
                          {new Date(c.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {c.subTasks?.length > 0 && (
                        <span style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                          {c.subTasks.length} subtask{c.subTasks.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className={styles.draftActions}>
                    <button
                      className={styles.btnSecondary}
                      style={{
                        padding: '0.45rem 1rem', fontSize: '0.8rem',
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        background: resumingDraftId === c._id ? 'rgba(99,102,241,0.1)' : undefined,
                        borderColor: resumingDraftId === c._id ? 'rgba(99,102,241,0.4)' : undefined,
                        color: resumingDraftId === c._id ? '#4338CA' : undefined
                      }}
                      onClick={() => resumeDraft(c)}
                    >
                      <Pencil size={13} />
                      {resumingDraftId === c._id ? 'Editing…' : 'Resume'}
                    </button>
                    <button
                      className={styles.btnPrimary}
                      style={{ padding: '0.45rem 1rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                      onClick={() => activateDraft(c._id)}
                      disabled={updateCommitmentMutation.isPending}
                    >
                      <Play size={13} />
                      Activate
                    </button>
                    <button
                      className={styles.btnSecondary}
                      style={{ padding: '0.45rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', color: '#EF4444', borderColor: 'rgba(239,68,68,0.2)' }}
                      onClick={() => { deleteMutation.mutate(c._id); if (resumingDraftId === c._id) setResumingDraftId(null); }}
                      title="Delete draft"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ═══ ACTIVE SYNCS ════════════════════════════════════════════════════ */}
        <section className={styles.sectionContainer}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Active Syncs</h2>
            <p className={styles.sectionSubtitle}>Track progress, assess risks, and stay accountable.</p>
          </div>

          {/* ── Calendar Reality Check Warning (Idea 1) ── */}
          {calendarWarning && (
            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
            }}>
              <AlertCircle size={18} color="#F59E0B" style={{ marginTop: '2px', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 0.25rem', color: '#D97706', fontSize: '0.9rem', fontWeight: 600 }}>Reality Check</h4>
                <p style={{ margin: 0, color: '#92400E', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  {calendarWarning}
                </p>
              </div>
              <button 
                onClick={() => setCalendarWarning('')} 
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#B45309', padding: '0.25rem' }}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* ── NUDGES ── */}

          {(() => {
            if (!user) return null;
            // Provide behavioralProfile and other required context to the nudge engine
            const userProfile = {
               behavioralPattern: user.behavioralProfile?.behavioralPattern || behavioralPattern,
               maxSustainableWorkload: user.behavioralProfile?.maxSustainableWorkload || 4
            };
            const allNudges = computeNudges(commitments, userProfile, stats, historicalCommitments);
            // Filter out nudges dismissed this session (instant local removal)
            const nudges = allNudges.filter(n => !dismissedNudgeIds.has(n.id));
            
            if (nudges.length === 0) return null;

            return (
              <div className={styles.nudgesContainer}>
                {nudges.map(nudge => (
                  <div key={nudge.id} className={`${styles.nudgeCard} ${styles[`nudge_${nudge.type}`]}`}>
                    <div className={styles.nudgeIcon}>{nudge.icon}</div>
                    <div className={styles.nudgeContent}>
                      <div className={styles.nudgeTitle}>{nudge.title}</div>
                      <div className={styles.nudgeBody}>{nudge.body}</div>
                    </div>
                    <div className={styles.nudgeActions}>
                      {nudge.action && (
                        <button 
                          className={styles.nudgeActionBtn}
                          onClick={() => {
                            if (nudge.action.commitmentId) {
                               setExpandedCommitments(p => ({ ...p, [nudge.action.commitmentId]: true }));
                               const el = document.getElementById(`commitment-${nudge.action.commitmentId}`);
                               if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                          }}
                        >
                          {nudge.action.label}
                        </button>
                      )}
                      <button 
                        className={styles.nudgeDismissBtn}
                        onClick={() => {
                          // Persist to localStorage (nudgeEngine reads this to hide for 24h)
                          localStorage.setItem(`nudge_dismissed_${nudge.id}`, Date.now().toString());
                          // Instantly update local state — no network round-trip needed
                          setDismissedNudgeIds(prev => new Set([...prev, nudge.id]));
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ── FEATURE 8: Real-time critical alert banners ── */}
          {criticalAlerts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {criticalAlerts.map(alert => (
                <div
                  key={alert.id}
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderLeft: '4px solid #EF4444',
                    borderRadius: '12px',
                    padding: '0.85rem 1rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    animation: 'fadeSlideDown 0.3s ease-out'
                  }}
                >
                  <AlertCircle size={18} color="#EF4444" style={{ marginTop: '2px', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#DC2626', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                      🚨 Critical Risk Alert — "{alert.title}"
                    </div>
                    <div style={{ color: '#7F1D1D', fontSize: '0.8rem', lineHeight: 1.5 }}>
                      {alert.message}
                    </div>
                    {alert.actionType === 'RESCHEDULE' && (
                      <button
                        onClick={() => {
                          setRescheduleData({ id: alert.commitmentId, newDeadline: '', reason: '' });
                          setShowRescheduleModal(true);
                          dismissAlert(alert.id);
                        }}
                        style={{
                          marginTop: '0.5rem',
                          backgroundColor: '#DC2626',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '0.35rem 0.75rem',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontFamily: 'Outfit, sans-serif'
                        }}
                      >
                        Reschedule Now →
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#DC2626', padding: '0.1rem', flexShrink: 0 }}
                    title="Dismiss"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className={styles.commitmentsList}>
            {commitments.length > 0 ? (
              // Sort: pinned commitment always floats to the top
              [...commitments]
                .sort((a, b) => (b._id === pinnedCommitmentId ? 1 : 0) - (a._id === pinnedCommitmentId ? 1 : 0))
                .map(c => {
                const isExpanded = drawerCommitmentId === c._id;
                
                // displayRisk: take the max of the server-stored score and the
                // client-side live projection. This means overdue items instantly
                // show 100% even before the next cron run.
                const liveScore   = computeLiveRisk(c);
                const displayRisk = Math.max(c.currentRiskScore || 0, liveScore);

                const riskColor = displayRisk >= 70 ? styles.riskHigh
                  : displayRisk >= 40 ? styles.riskMed : styles.riskLow;
                  
                const lineRiskColor = displayRisk >= 70 ? styles.lineRiskHigh
                  : displayRisk >= 40 ? styles.lineRiskMed : styles.lineRiskLow;

                const isPinned = pinnedCommitmentId === c._id;

                return (
                  <div id={`commitment-${c._id}`} key={c._id} className={`${styles.commitmentItem} ${isExpanded ? styles.expanded : ''} ${isPinned ? styles.pinnedItem : ''}`}>
                    {/* ── Priority Focus Banner ── */}
                    {isPinned && (
                      <div className={styles.priorityBanner}>
                        <Star size={13} style={{ fill: '#F59E0B', color: '#F59E0B', flexShrink: 0 }} />
                        <span>Priority Focus &mdash; You set this as your #1 right now</span>
                        <button
                          onClick={e => { e.stopPropagation(); setPinnedCommitmentId(null); localStorage.removeItem('commitsync_pinned_commitment'); }}
                          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#B45309', display: 'flex', padding: '0 0.25rem' }}
                          title="Unpin"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    <div className={styles.commitmentHeader} onClick={() => {
                        if (editingActiveSyncId !== c._id) setDrawerCommitmentId(isExpanded ? null : c._id);
                    }}>
                      <div className={styles.commitmentMainInfo}>
                        <div className={styles.commitmentTitleBlock}>
                          <h3 className={styles.commitmentTitle}>{c.title}</h3>
                          <div className={styles.metaRow}>
                            <span className={styles.categoryBadge}>{c.category}</span>
                            <span className={styles.deadlineBadge}>
                              <Calendar size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '4px' }} />
                              {c.deadline ? new Date(c.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No deadline'}
                            </span>
                            {c.ignoreCalendar && (
                              <span className={styles.categoryBadge} style={{ background: 'rgba(100, 116, 139, 0.1)', color: '#64748B' }}>
                                Calendar Ignored
                              </span>
                            )}
                            {c.rescheduledCount > 0 && (
                              <span className={styles.categoryBadge} style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#D97706' }}>
                                Rescheduled: {c.rescheduledCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className={styles.commitmentStats}>
                        {c.accountabilityPartners && c.accountabilityPartners.length > 0 && (
                          <div 
                            className={styles.partnerAvatars} 
                            title="Accountability Partners (Click to view Circles)"
                            onClick={(e) => { e.stopPropagation(); navigate('/circles'); }}
                          >
                            {c.accountabilityPartners.map((partner, idx) => {
                              const partnerIdStr = typeof partner === 'object' && partner._id ? partner._id.toString() : partner.toString();
                              
                              let friendData = friends.find(f => f._id.toString() === partnerIdStr);
                              
                              // Fallback if backend populate worked but friends query didn't match
                              if (!friendData && typeof partner === 'object' && partner.name) {
                                friendData = partner;
                              }

                              const initial = friendData?.name ? friendData.name.charAt(0).toUpperCase() : 'U';

                              return friendData?.profilePicture ? (
                                <img 
                                  key={partnerIdStr} 
                                  src={friendData.profilePicture} 
                                  alt={friendData.name || 'Partner'} 
                                  className={styles.stackedAvatar}
                                />
                              ) : (
                                <div key={partnerIdStr} className={styles.stackedAvatar}>
                                  <span>{initial}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className={styles.statPill}>
                          <span className={`${styles.statValue} ${riskColor}`}>{displayRisk}%</span>
                          <span className={styles.statLabel}>Risk</span>
                        </div>
                        
                        <div className={styles.circularProgressContainer}>
                           <svg viewBox="0 0 36 36" className={styles.circularChart}>
                             <path className={styles.circleBg}
                               d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                             />
                             <path className={styles.circle}
                               strokeDasharray={`${c.progress || 0}, 100`}
                               d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                             />
                             <text x="18" y="20.35" className={styles.percentage}>{c.progress || 0}%</text>
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
                        {/* Lightbulb removed as per request (since AI & Alerts tab exists) */}
                        {/* ── Priority Pin button ── */}
                        <button
                          className={`${styles.pinBtn} ${isPinned ? styles.pinBtnActive : ''}`}
                          title={isPinned ? 'Remove priority focus' : 'Set as Priority Focus'}
                          onClick={e => {
                            e.stopPropagation();
                            const next = isPinned ? null : c._id;
                            setPinnedCommitmentId(next);
                            try {
                              if (next) localStorage.setItem('commitsync_pinned_commitment', next);
                              else localStorage.removeItem('commitsync_pinned_commitment');
                            } catch {}
                          }}
                        >
                          <Star size={14} style={{ fill: isPinned ? 'currentColor' : 'none' }} />
                        </button>
                        <ChevronRight size={20} className={styles.expandIcon} />
                      </div>
                    </div>

                    
                    {isExpanded && createPortal(
                      <div className={styles.drawerOverlay} onClick={(e) => { e.stopPropagation(); setDrawerCommitmentId(null); }}>
                        <div className={styles.drawerContainer} onClick={e => e.stopPropagation()}>
                          <div className={styles.drawerHeader}>
                            <div className={styles.drawerHeaderTop}>
                              <h2 className={styles.drawerTitle}>{c.title}</h2>
                              <button className={styles.drawerCloseBtn} onClick={() => setDrawerCommitmentId(null)}><X size={18} /></button>
                            </div>
                            <div className={styles.metaRow}>
                              <span className={styles.categoryBadge}>{c.category}</span>
                              <span className={styles.deadlineBadge}><Calendar size={13} style={{marginRight: '4px', verticalAlign: 'middle', display: 'inline-block'}}/>{c.deadline ? new Date(c.deadline).toLocaleDateString('en-GB') : 'No deadline'}</span>
                              <div className={styles.statPill} style={{marginLeft: 'auto'}}>
                                 <span className={styles.statValue}>{displayRisk}%</span>
                                 <span className={styles.statLabel}>Risk</span>
                              </div>
                            </div>
                          </div>
                          
                          <div className={styles.drawerTabs}>
                            <button className={`${styles.drawerTab} ${drawerTab === 'overview' ? styles.drawerTabActive : ''}`} onClick={() => setDrawerTab('overview')}>Overview</button>
                            <button className={`${styles.drawerTab} ${drawerTab === 'tasks' ? styles.drawerTabActive : ''}`} onClick={() => setDrawerTab('tasks')}>Tasks</button>
                            <button className={`${styles.drawerTab} ${drawerTab === 'insights' ? styles.drawerTabActive : ''}`} onClick={() => setDrawerTab('insights')}>AI & Alerts</button>
                          </div>

                          <div className={styles.drawerContent}>
                            {drawerTab === 'overview' && (
                              <>
                                <div className={styles.detailsGrid}>
                                  <div className={styles.detailBlock}>
                                    <h4 className={styles.detailTitle}>The Goal (Reward)</h4>
                                    <p className={styles.detailContent}>{c.reward || 'Not specified'}</p>
                                  </div>
                                  <div className={styles.detailBlock}>
                                    <h4 className={styles.detailTitle}>The Risk</h4>
                                    <p className={styles.detailContent}>{c.risk || 'Not specified'}</p>
                                  </div>
                                </div>
                                <div style={{ border: '1px solid rgba(26,29,32,0.08)', borderRadius: '12px', marginTop: '1rem' }}>
                                  <div style={{ padding: '0.75rem 1rem', background: 'rgba(99,102,241,0.06)', borderBottom: '1px solid rgba(26,29,32,0.08)' }}>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1A1D20', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      🎯 Deep Work Session
                                    </span>
                                  </div>
                                  <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.3)' }}>
                                    <div style={{ background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(26,29,32,0.1)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                                      <h5 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#1A1D20' }}>📅 Your Upcoming Calendar (Next 2 Days)</h5>
                                      {calendarEventsError || calendarConnected === false ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                          <p style={{ fontSize: '0.8rem', color: '#F97316', margin: 0 }}>Google Calendar not connected.</p>
                                          <a href="/settings" style={{ fontSize: '0.8rem', color: '#6366F1', textDecoration: 'underline' }}>Connect in Settings →</a>
                                        </div>
                                      ) : calendarFetchError ? (
                                        <p style={{ fontSize: '0.8rem', color: '#EF4444', margin: 0 }}>Could not load calendar events. Your token may have expired — <a href="/settings" style={{ color: '#6366F1' }}>reconnect in Settings</a>.</p>
                                      ) : calendarEvents.length === 0 ? (
                                        <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0 }}>✅ Calendar connected — no events in the next 2 days. Great time to focus!</p>
                                      ) : (
                                        <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
                                          {calendarEvents.map(ev => {
                                            const start = new Date(ev.start);
                                            const end = new Date(ev.end);
                                            const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                                            const startStr = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                            const endStr = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                            return (
                                              <div key={ev.id} style={{ background: '#EEF2FF', border: '1px solid #C7D2FE', padding: '0.5rem 0.75rem', borderRadius: '8px', minWidth: '155px', flexShrink: 0 }}>
                                                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#3730A3', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{dateStr}</div>
                                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1A1D20', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.summary || 'Busy'}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#4F46E5' }}>{startStr} – {endStr}</div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                    {(() => {
                                      const hrs = parseFloat(focusHoursInput[c._id]) || 2;
                                      const findBestSlot = (durationHrs) => {
                                        const SLEEP_START = 23;
                                        const SLEEP_END = 7;
                                        const isSleepHour = (d) => { const h = d.getHours(); return h >= SLEEP_START || h < SLEEP_END; };
                                        const durationMs = durationHrs * 3600000;
                                        const now = new Date();
                                        now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
                                        const twoDaysLater = new Date(now.getTime() + 2 * 86400000);
                                        const busy = (calendarEvents || []).map(ev => ({
                                          start: new Date(ev.start),
                                          end: new Date(ev.end)
                                        })).sort((a, b) => a.start - b.start);
                                        let candidate = new Date(now);
                                        let skippedSleep = false;
                                        for (let i = 0; i < 50; i++) {
                                          if (isSleepHour(candidate)) {
                                            skippedSleep = true;
                                            candidate.setHours(SLEEP_END, 0, 0, 0);
                                            if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
                                            continue;
                                          }
                                          const candidateEnd = new Date(candidate.getTime() + durationMs);
                                          if (isSleepHour(candidateEnd)) {
                                            skippedSleep = true;
                                            candidate = new Date(candidate);
                                            candidate.setDate(candidate.getDate() + 1);
                                            candidate.setHours(SLEEP_END, 0, 0, 0);
                                            continue;
                                          }
                                          const overlappingEvent = busy.find(event => 
                                            candidate.getTime() + durationMs > event.start.getTime() && 
                                            candidate.getTime() < event.end.getTime()
                                          );
                                          if (!overlappingEvent) {
                                            if (candidate.getTime() + durationMs > twoDaysLater.getTime()) return null;
                                            return { slot: candidate, skippedSleep };
                                          }
                                          candidate = new Date(overlappingEvent.end.getTime() + 5 * 60000);
                                        }
                                        return null;
                                      };
                                      const suggestion = calendarConnected !== false && !calendarFetchError ? findBestSlot(hrs) : null;
                                      const suggestedStart = suggestion?.slot || null;
                                      const skippedSleep = suggestion?.skippedSleep || false;
                                      const currentStartStr = focusStartTimeInput[c._id];
                                      const displayStart = currentStartStr ? new Date(currentStartStr) : suggestedStart;
                                      const displayEnd = displayStart ? new Date(displayStart.getTime() + hrs * 3600000) : null;
                                      const toLocalISO = (d) => { const off = d.getTimezoneOffset() * 60000; return new Date(d - off).toISOString().slice(0, 16); };
                                      const hasClash = displayStart && (calendarEvents || []).some(ev => {
                                        const es = new Date(ev.start), ee = new Date(ev.end);
                                        return displayStart < ee && displayEnd > es;
                                      });
                                      return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                          {suggestedStart && !currentStartStr && (
                                            <div style={{ background: skippedSleep ? 'rgba(16,185,129,0.08)' : 'rgba(99,102,241,0.08)', border: `1px solid ${skippedSleep ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.25)'}`, borderRadius: '8px', padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: skippedSleep ? '#065F46' : '#4338CA' }}>
                                              {skippedSleep ? '🌙' : '💡'} <strong>Suggested slot:</strong> {suggestedStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} {suggestedStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} – {new Date(suggestedStart.getTime() + hrs * 3600000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                              {skippedSleep && <div style={{ fontSize: '0.75rem', marginTop: '3px', color: '#064E3B' }}>Shifted to morning — the earlier slot falls in sleep hours 😴. You can still pick any time manually below.</div>}
                                              {!skippedSleep && ' (no conflicts)'}
                                            </div>
                                          )}
                                          {hasClash && (
                                            <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#991B1B' }}>
                                              ⚠️ Selected time overlaps an existing event.{suggestedStart ? <> Try <strong>{suggestedStart.toLocaleDateString('en-US', { weekday: 'short' })} {suggestedStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</strong> instead.</> : ' Please pick a free slot.'}
                                            </div>
                                          )}
                                          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Start Time</label>
                                              <input
                                                type="datetime-local"
                                                value={currentStartStr || (suggestedStart ? toLocalISO(suggestedStart) : toLocalISO(new Date()))}
                                                onChange={e => { e.stopPropagation(); setFocusStartTimeInput({...focusStartTimeInput, [c._id]: e.target.value}); setFocusStatus(p => ({ ...p, [c._id]: null })); }}
                                                onClick={e => e.stopPropagation()}
                                                className={styles.hoursInput}
                                                style={{ padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.8)', borderColor: hasClash ? '#EF4444' : undefined, minWidth: '220px' }}
                                              />
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                              <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Duration</label>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                <input
                                                  type="number" min="0.5" step="0.5"
                                                  value={hrs}
                                                  onChange={e => { e.stopPropagation(); setFocusHoursInput({...focusHoursInput, [c._id]: e.target.value}); setFocusStartTimeInput({...focusStartTimeInput, [c._id]: ''}); setFocusStatus(p => ({ ...p, [c._id]: null })); }}
                                                  onClick={e => e.stopPropagation()}
                                                  className={styles.hoursInput}
                                                  style={{ width: '65px', padding: '0.4rem 0.5rem', background: 'rgba(255,255,255,0.8)' }}
                                                />
                                                <span style={{ fontSize: '0.82rem', color: '#64748B' }}>hr</span>
                                              </div>
                                            </div>
                                            {displayEnd && (
                                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                <label style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Ends At</label>
                                                <div style={{ padding: '0.4rem 0.75rem', background: 'rgba(241,245,249,0.8)', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.85rem', color: '#475569', fontWeight: 600 }}>
                                                  {displayEnd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                                </div>
                                              </div>
                                            )}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignSelf: 'flex-end' }}>
                                              <button
                                                className={focusStatus[c._id] === 'ADDED' ? styles.btnSuccess : styles.btnScheduleFocus}
                                                onClick={(e) => { e.stopPropagation(); handleStartFocus(c._id); }}
                                                disabled={focusStatus[c._id] === 'ADDED' || focusStatus[c._id] === 'LOADING'}
                                              >
                                                {focusStatus[c._id] === 'LOADING' ? (
                                                  <>
                                                    <RefreshCw size={14} className={styles.spinning} style={{ marginRight: '6px' }} />
                                                    Scheduling…
                                                  </>
                                                ) : focusStatus[c._id] === 'ADDED' ? '✅ Scheduled' : 'Schedule Focus'}
                                              </button>
                                              {focusStatus[c._id] === 'ADDED' && (
                                                <span style={{ fontSize: '0.7rem', color: '#64748B', maxWidth: '140px', textAlign: 'center', lineHeight: 1.2 }}>
                                                  Change time/duration to schedule another
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })()}
                                    <p style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '0.75rem', marginBottom: 0 }}>
                                      This creates an event in your Google Calendar and triggers focus mode.
                                    </p>
                                  </div>
                                </div>
                              </>
                            )}
                            
                            {drawerTab === 'tasks' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600 }}>Track and manage task breakdown</span>
                                  {editingActiveSyncId !== c._id ? (
                                    <button className={styles.btnSecondary} style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }} onClick={(e) => { e.stopPropagation(); handleEditActiveSync(c); }}>Edit Subtasks</button>
                                  ) : (
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                      <button className={styles.btnSecondary} style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }} onClick={() => setEditingActiveSyncId(null)}>Cancel</button>
                                      <button className={styles.btnPrimary} style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }} onClick={() => handleSaveActiveSync(c._id)} disabled={updateCommitmentMutation.isLoading}>Save Changes</button>
                                    </div>
                                  )}
                                </div>
                                {editingActiveSyncId === c._id ? (
                                  <div className={styles.subInputList}>
                                    {editingActiveSubtasks.map((st) => (
                                      <div key={st.id} className={styles.subtaskInputRow}>
                                        <input type="text" className={styles.subInput} value={st.title} onChange={(e) => updateActiveSubtask(st.id, 'title', e.target.value)} placeholder="Subtask description..." />
                                        <div className={styles.hoursWrapper}>
                                          <input type="number" className={styles.hoursInput} min="0.5" step="0.5" value={st.estimatedHours} onChange={(e) => updateActiveSubtask(st.id, 'estimatedHours', e.target.value)} />
                                          <span className={styles.hoursLabel}>hrs</span>
                                        </div>
                                        <button className={styles.removeSubBtn} onClick={() => removeActiveSubtask(st.id)}><X size={16} /></button>
                                      </div>
                                    ))}
                                    <button className={styles.addSubtaskBtn} onClick={addActiveSubtask}><Plus size={16} /> Add Subtask</button>
                                  </div>
                                ) : (
                                  <div className={styles.activeTimeline}>
                                    {c.subTasks?.length > 0 ? c.subTasks.map((t, i) => {
                                      const isLast = i === c.subTasks.length - 1;
                                      const isCompleted = t.progress === 100;
                                      const dynamicHeight = Math.min(120, Math.max(30, (t.estimatedHours || 1) * 12));
                                      return (
                                        <div key={i} className={styles.activeNodeContainer}>
                                          <div className={styles.activeNodeVisual}>
                                            <div className={`${styles.activeNodeCircle} ${isCompleted ? styles.completedCircle : ''}`} onClick={() => updateProgressMutation.mutate({ id: c._id, subTaskIndex: i, progress: isCompleted ? 0 : 100 })}>
                                              {isCompleted ? <Check size={12} strokeWidth={3} color="#10B981" /> : null}
                                            </div>
                                            {!isLast && <div className={`${styles.activeNodeLine} ${lineRiskColor}`} style={{ height: `${dynamicHeight}px` }}></div>}
                                          </div>
                                          <div className={styles.activeNodeContent} style={{ minHeight: isLast ? 'auto' : `${dynamicHeight + 20}px` }}>
                                            <span className={`${styles.activeNodeTitle} ${isCompleted ? styles.completedText : ''}`}>{t.title}</span>
                                            <span className={styles.activeNodeHours}>{t.estimatedHours}h</span>
                                          </div>
                                        </div>
                                      );
                                    }) : <p style={{ color: '#334155', fontSize: '0.9rem' }}>No subtasks defined.</p>}
                                    
                                    {/* Mark as Complete Button - appears when all subtasks are 100% */}
                                    {c.progress === 100 && (
                                      <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-start', marginLeft: '3px' }}>
                                        <button
                                          className={styles.btnSuccess}
                                          onClick={(e) => { e.stopPropagation(); markCompleteMutation.mutate(c._id); }}
                                          disabled={markCompleteMutation.isPending}
                                        >
                                          {markCompleteMutation.isPending ? <RefreshCw size={14} className={styles.spinning} /> : <Check size={14} />}
                                          Mark as Completed
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {drawerTab === 'insights' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                {/* Coach Button Trigger */}
                                {!coachTipOpen[c._id] && (
                                  <button
                                    onClick={(e) => handleCoachTip(e, c._id)}
                                    style={{ padding: '1rem', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}
                                  >
                                    <div style={{ background: '#F59E0B', padding: '0.5rem', borderRadius: '50%', color: 'white', display: 'flex' }}><Lightbulb size={20} /></div>
                                    <div style={{ textAlign: 'left' }}>
                                      <h5 style={{ margin: '0 0 0.2rem', color: '#92400E', fontSize: '1rem' }}>Generate AI Coaching Tip</h5>
                                      <p style={{ margin: 0, color: '#B45309', fontSize: '0.85rem' }}>Get personalized advice on how to tackle this commitment right now.</p>
                                    </div>
                                  </button>
                                )}
                                
                                {coachTipOpen[c._id] && (
                                  <div className={styles.coachPanel} onClick={e => e.stopPropagation()} style={{ position: 'relative', marginTop: 0, border: '1px solid #FDE68A' }}>
                                    <div className={styles.coachPanelHeader}>
                                      <div className={styles.coachPanelTitle}>
                                        <Lightbulb size={16} className={styles.coachPanelIcon} />
                                        <span>AI Coach</span>
                                        <span className={styles.coachPersonaBadge}>{coachTipData[c._id] ? 'Personalised' : 'Loading...'}</span>
                                      </div>
                                    </div>
                                    {coachTipLoading[c._id] ? (
                                      <div className={styles.coachSkeleton}>
                                        <div className={styles.coachSkeletonLine} style={{ width: '75%' }} />
                                        <div className={styles.coachSkeletonLine} style={{ width: '90%' }} />
                                        <div className={styles.coachSkeletonLine} style={{ width: '60%' }} />
                                        <p className={styles.coachLoadingText}>Analyzing your pattern...</p>
                                      </div>
                                    ) : coachTipData[c._id] ? (
                                      <>
                                        <p className={styles.coachHeadline}>{coachTipData[c._id].headline}</p>
                                        <div className={styles.coachTipsList}>
                                          {(coachTipData[c._id].tips || []).map((tip, i) => (
                                            <div key={i} className={styles.coachTipItem}>
                                              <span className={styles.coachTipNum}>{i + 1}</span>
                                              <span>{tip}</span>
                                            </div>
                                          ))}
                                        </div>
                                        {coachTipData[c._id].microGoal && (
                                          <div className={styles.coachMicroGoal}>
                                            <span className={styles.coachMicroGoalLabel}>🎯 30-MIN MICRO GOAL</span>
                                            <p className={styles.coachMicroGoalText}>{coachTipData[c._id].microGoal}</p>
                                          </div>
                                        )}
                                        {coachTipData[c._id].encouragement && (
                                          <p className={styles.coachEncouragement}>
                                            {coachTipData[c._id].encouragement} <span style={{ fontSize: '0.9rem' }}>✨</span>
                                          </p>
                                        )}
                                        <span className={styles.coachCacheNote}>
                                          Refreshed {Math.round((Date.now() - coachTipData[c._id].fetchedAt) / 60000)} min ago
                                          {' · '}
                                          <button
                                            className={styles.coachRefreshBtn}
                                            onClick={async (e) => {
                                              e.stopPropagation();
                                              setCoachTipData(p => { const n = { ...p }; delete n[c._id]; return n; });
                                              setCoachTipLoading(p => ({ ...p, [c._id]: true }));
                                              try {
                                                const res = await api.post(`/commitments/${c._id}/coach-tip`);
                                                setCoachTipData(p => ({ ...p, [c._id]: { ...res.data.data, fetchedAt: Date.now() } }));
                                              } finally {
                                                setCoachTipLoading(p => ({ ...p, [c._id]: false }));
                                              }
                                            }}
                                          >Refresh</button>
                                        </span>
                                      </>
                                    ) : null}
                                  </div>
                                )}
                                
                                {(c.interventions || []).length > 0 && (
                                  <div>
                                    <h5 style={{ margin: '0 0 1rem', color: '#1A1D20', fontSize: '1rem' }}>Alert History</h5>
                                    <div className={styles.interventionHistory}>
                                      {(() => {
                                        const reversed = [...c.interventions].reverse();
                                        return reversed.map((inv, idx) => (
                                          <div key={inv._id || idx} className={styles.interventionItem}>
                                            <span className={`${styles.interventionBadge} ${inv.type === 'CRITICAL_ALERT' ? styles.criticalAlert : styles.warningAlert}`}>
                                              {inv.type === 'CRITICAL_ALERT' ? '🔴 Critical Alert' : '⚠️ Warning'}
                                            </span>
                                            <p className={styles.interventionMsg}>{inv.message}</p>
                                            {inv.calendarHint && (
                                              <div className={styles.calendarHint}>
                                                <span>{inv.calendarHint}</span>
                                              </div>
                                            )}
                                            <span className={styles.interventionTime}>
                                              {new Date(inv.triggeredAt || inv.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                                            </span>
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <div className={styles.drawerActions}>
                            <button
                              className={styles.btnDrawerDelete}
                              onClick={() => { setDrawerCommitmentId(null); deleteMutation.mutate(c._id); }}
                            >
                              <Trash2 size={16} />
                              <span>Delete</span>
                            </button>
                            <button
                              className={styles.btnDrawerReschedule}
                              onClick={() => { setDrawerCommitmentId(null); setRescheduleData({ id: c._id, newDeadline: '', reason: '' }); setShowRescheduleModal(true); }}
                            >
                              <Calendar size={16} />
                              <span>Reschedule</span>
                            </button>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </div>
                );
              })
            ) : (
              <div className={styles.emptyState}>
                <Play size={32} className={styles.emptyStateIcon} />
                <p>No active syncs yet. Take a deep breath and start one above.</p>
              </div>
            )}
          </div>
        </section>

        {/* ═══ HISTORY SECTION ═════════════════════════════════════════════════ */}
        {historicalCommitments.length > 0 && (
          <section className={styles.sectionContainer} style={{ paddingTop: '2rem', marginTop: '2rem', borderTop: '1px solid rgba(26,29,32,0.1)' }}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <Clock size={20} className={styles.sectionIcon} style={{ color: '#64748B' }} />
                History
              </h2>
              <span className={styles.syncCount}>
                {historicalCommitments.length > 5 ? `Showing latest 5 of ${historicalCommitments.length} past syncs` : `${historicalCommitments.length} past syncs`}
              </span>
            </div>
            
            <div style={{ paddingLeft: '0.5rem', position: 'relative', marginTop: '1.5rem', marginBottom: '3rem' }}>
              {/* Vertical timeline spine */}
              <div style={{ position: 'absolute', left: '21px', top: '24px', bottom: '20px', width: '2px', background: 'linear-gradient(to bottom, rgba(26,29,32,0.15) 0%, rgba(26,29,32,0.1) 80%, rgba(26,29,32,0) 100%)' }}></div>
              
              {historicalCommitments.slice(0, 5).map(c => {
                const isMissed = c.status === 'MISSED' || c.status === 'FAILED';
                const statusColor = isMissed ? '#EF4444' : '#10B981';
                
                // Calculate actual time (1 day = 8 hours active)
                const createdDate = new Date(c.createdAt);
                const endDate = new Date(c.updatedAt || c.deadline);
                const activeHours = Math.max(0, (endDate - createdDate) / (1000 * 60 * 60));
                const activeDays = activeHours / 24;
                const actualHours = Math.round(activeDays * 8);

                return (
                  <div key={c._id} style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem', position: 'relative' }}>
                    {/* Node Icon */}
                    <div style={{ 
                      width: '30px', height: '30px', borderRadius: '50%', 
                      background: isMissed ? '#FEE2E2' : '#D1FAE5',
                      border: `2.5px solid ${isMissed ? '#FCA5A5' : '#6EE7B7'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, position: 'relative', zIndex: 2, marginTop: '2px',
                      boxShadow: '0 0 0 4px #F8FAFC' /* Creates a gap effect in the spine */
                    }}>
                      {isMissed ? <X size={15} color="#DC2626" strokeWidth={3.5} /> : <Check size={15} color="#059669" strokeWidth={3.5} />}
                    </div>

                    {/* Content Card (Frosted glass) */}
                    <div 
                      style={{ 
                        flex: 1, 
                        background: 'rgba(255, 255, 255, 0.6)', 
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid rgba(26, 29, 32, 0.08)',
                        borderRadius: '16px',
                        padding: '1.25rem 1.5rem',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.03)',
                        transition: 'all 0.3s ease'
                      }}
                      onMouseEnter={(e) => { 
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)'; 
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 12px 40px rgba(0, 0, 0, 0.06)';
                      }}
                      onMouseLeave={(e) => { 
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.6)'; 
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.03)';
                      }}
                    >
                      <div className={styles.historyCardHeader}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h3 style={{ margin: '0 0 0.5rem', color: isMissed ? '#1A1D20' : '#475569', fontSize: '1.15rem', fontFamily: 'Libre Baskerville, serif', fontWeight: 400, textDecoration: isMissed ? 'none' : 'line-through', opacity: isMissed ? 1 : 0.65 }}>
                            {c.title}
                          </h3>
                          {/* Tag row — status always visible; secondary tags collapse on mobile */}
                          <div className={styles.historyTagRow}>
                            {/* Always-visible: status pill */}
                            <span className={styles.historyTagStatus} style={{ background: isMissed ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)', color: isMissed ? '#DC2626' : '#059669' }}>
                              {c.status}
                            </span>

                            {/* Secondary tags — hidden on mobile unless expanded */}
                            <span className={`${styles.historySecondaryTags} ${expandedHistoryTags[c._id] ? styles.historyTagsVisible : ''}`}>
                              <span className={styles.historyTag} style={{ background: 'rgba(100,116,139,0.1)', color: '#64748B' }}>
                                {c.category}
                              </span>
                              {c.rescheduledCount > 0 && (
                                <span className={styles.historyTag} style={{ background: 'rgba(245,158,11,0.12)', color: '#D97706' }}>
                                  Rescheduled: {c.rescheduledCount}
                                </span>
                              )}
                              {behavioralPattern !== 'INSUFFICIENT_DATA' && (
                                <span className={styles.historyTag} style={{ background: 'rgba(139,92,246,0.1)', color: '#7C3AED' }}>
                                  {behavioralPattern.replace(/_/g, ' ')}
                                </span>
                              )}
                              {c.retrospective?.reflection && (
                                <button
                                  className={`${styles.btnRetrospectiveInsight} ${expandedRetrospectives[c._id] ? styles.expanded : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedRetrospectives(prev => ({ ...prev, [c._id]: !prev[c._id] }));
                                  }}
                                >
                                  <Lightbulb size={12} />
                                  {expandedRetrospectives[c._id] ? 'Hide Insight' : 'Retrospective Insight'}
                                </button>
                              )}
                            </span>

                            {/* Mobile-only toggle chip */}
                            <button
                              className={`${styles.historyTagToggle} ${expandedHistoryTags[c._id] ? styles.historyTagToggleExpanded : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedHistoryTags(prev => ({ ...prev, [c._id]: !prev[c._id] }));
                              }}
                              title={expandedHistoryTags[c._id] ? 'Hide details' : 'Show all details'}
                            >
                              {expandedHistoryTags[c._id]
                                ? <><ChevronDown size={10} style={{ transform: 'rotate(180deg)' }} /> Less</>
                                : <><span style={{ letterSpacing: '0.04em' }}>⋯</span> Details</>
                              }
                            </button>
                          </div>

                        </div>
                        
                        <div className={styles.historyCardStats}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span style={{ fontSize: '1.2rem', fontFamily: 'Outfit, sans-serif', fontWeight: 700, color: '#334155' }}>{c.estimatedHours || 0}h</span>
                            <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Est</span>
                          </div>
                          <div style={{ width: '1px', height: '24px', background: 'rgba(26,29,32,0.1)' }}></div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <span style={{ fontSize: '1.2rem', fontFamily: 'Outfit, sans-serif', fontWeight: 700, color: '#334155' }}>{actualHours || 0}h</span>
                            <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Actual</span>
                          </div>
                          
                          {isMissed && (
                            <button
                              className={styles.btnHistoryRestart}
                              onClick={() => { setRescheduleData({ id: c._id, newDeadline: '', reason: '' }); setShowRescheduleModal(true); }}
                            >
                              <RefreshCw size={14} style={{ marginRight: '0.4rem' }} />
                              Restart
                            </button>
                          )}
                        </div>
                      </div>

                      {/* AI Retrospective Insight */}
                      {c.retrospective?.reflection && expandedRetrospectives[c._id] && (
                        <div style={{ 
                          marginTop: '1.25rem', 
                          padding: '1rem 1.25rem', 
                          background: isMissed ? 'rgba(239, 68, 68, 0.03)' : 'rgba(16, 185, 129, 0.03)', 
                          borderLeft: `3px solid ${isMissed ? '#FCA5A5' : '#6EE7B7'}`, 
                          borderRadius: '0 12px 12px 0' 
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <Lightbulb size={16} color={isMissed ? '#DC2626' : '#059669'} strokeWidth={2.5} />
                            <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: isMissed ? '#DC2626' : '#059669' }}>
                              Retrospective Insight
                            </span>
                            {c.retrospective.generatedAt && (
                              <span style={{ fontSize: '0.65rem', color: '#94A3B8', marginLeft: 'auto' }}>
                                {new Date(c.retrospective.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                          <p style={{ margin: '0 0 0.6rem', fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                            {c.retrospective.reflection}
                          </p>
                          {c.retrospective.nextTimeAdvice && (
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: 'rgba(255,255,255,0.5)', padding: '0.6rem 0.8rem', borderRadius: '8px' }}>
                              <span style={{ fontSize: '1rem' }}>💡</span>
                              <p style={{ margin: 0, fontSize: '0.85rem', color: isMissed ? '#92400E' : '#065F46', lineHeight: 1.4 }}>
                                <span style={{ fontWeight: 700, marginRight: '0.3rem' }}>Next Time:</span>
                                {c.retrospective.nextTimeAdvice}
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* ═══ MODALS ══════════════════════════════════════════════════════════ */}

      {showRescheduleModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent} style={{ position: 'relative' }}>
            {/* Loading overlay inside the modal */}
            {rescheduleMutation.isPending && (
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 'inherit',
                background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(6px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '1rem', zIndex: 10
              }}>
                <RefreshCw size={28} className={styles.spinning} style={{ color: '#D35400' }} />
                <p style={{ margin: 0, fontFamily: 'Outfit, sans-serif', fontWeight: 600, fontSize: '1rem', color: '#1A1D20' }}>
                  Rescheduling your sync…
                </p>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748B' }}>Updating deadline &amp; recalculating risk</p>
              </div>
            )}
            <h2 className={styles.modalTitle}>Reschedule Sync</h2>
            <div className={styles.subInputGroup}>
              <label className={styles.subLabel}>New Deadline</label>
              <input
                type="datetime-local"
                className={styles.subInput}
                value={rescheduleData.newDeadline}
                onChange={e => setRescheduleData({ ...rescheduleData, newDeadline: e.target.value })}
                disabled={rescheduleMutation.isPending}
              />
            </div>
            <div className={styles.subInputGroup}>
              <label className={styles.subLabel}>Reason</label>
              <textarea
                className={styles.subTextarea}
                placeholder="Why are you rescheduling?"
                value={rescheduleData.reason}
                onChange={e => setRescheduleData({ ...rescheduleData, reason: e.target.value })}
                disabled={rescheduleMutation.isPending}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={`${styles.btnSecondary} ${styles.btnModalCancel}`} onClick={() => setShowRescheduleModal(false)} disabled={rescheduleMutation.isPending}>Cancel</button>
              <button
                className={`${styles.btnPrimary} ${styles.btnModalConfirm}`}
                onClick={() => rescheduleMutation.mutate(rescheduleData)}
                disabled={!rescheduleData.newDeadline || !rescheduleData.reason || rescheduleMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {rescheduleMutation.isPending ? (
                  <><RefreshCw size={14} className={styles.spinning} /> Rescheduling…</>
                ) : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}


      {toastMessage && (
        <div className={styles.toastPopup}>
          {toastMessage}
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteConfirmId && (
        <div className={styles.modalOverlay} onClick={() => setDeleteConfirmId(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <h2 className={styles.modalTitle}>Delete Template?</h2>
            <p style={{ color: '#334155', marginBottom: '1.5rem', lineHeight: 1.6 }}>This action cannot be undone. The template will be permanently removed.</p>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setDeleteConfirmId(null)}>Cancel</button>
              <button
                className={styles.btnPrimary}
                style={{ background: '#EF4444', borderColor: '#EF4444' }}
                disabled={deleteTemplateMutation.isPending}
                onClick={() => deleteTemplateMutation.mutate(deleteConfirmId)}
              >
                {deleteTemplateMutation.isPending ? <RefreshCw size={14} className={styles.spinning} style={{ marginRight: 6 }} /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Template Modal ── */}
      {editingTemplate && (
        <div className={styles.modalOverlay} onClick={() => setEditingTemplate(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ maxWidth: '540px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 className={styles.modalTitle} style={{ margin: 0 }}>Edit Template</h2>
              <button className={styles.removeBtn} onClick={() => setEditingTemplate(null)}><X size={18} /></button>
            </div>

            {/* Name */}
            <div className={styles.subInputGroup} style={{ marginBottom: '1rem' }}>
              <label className={styles.subLabel}>Template Name</label>
              <input
                className={styles.subInput}
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="e.g. Morning Study Routine"
              />
            </div>

            {/* Category */}
            <div className={styles.subInputGroup} style={{ marginBottom: '1rem' }}>
              <label className={styles.subLabel}>Category</label>
              <select
                className={styles.subSelect}
                value={editForm.category}
                onChange={e => setEditForm({ ...editForm, category: e.target.value })}
              >
                {Object.keys(CATEGORY_IMAGES).map(cat => <option key={cat} value={cat}>{cat}</option>)}
              </select>
            </div>

            {/* Reward */}
            <div className={styles.subInputGroup} style={{ marginBottom: '1rem' }}>
              <label className={`${styles.subLabel} ${styles.successLabel}`}>Reward / End Goal</label>
              <textarea
                className={styles.subTextarea}
                value={editForm.reward}
                onChange={e => setEditForm({ ...editForm, reward: e.target.value })}
                placeholder="What do you gain if you succeed?"
                rows={2}
              />
            </div>

            {/* Risk */}
            <div className={styles.subInputGroup} style={{ marginBottom: '1.25rem' }}>
              <label className={`${styles.subLabel} ${styles.dangerLabel}`}>Risk if Failed</label>
              <textarea
                className={styles.subTextarea}
                value={editForm.risk}
                onChange={e => setEditForm({ ...editForm, risk: e.target.value })}
                placeholder="What do you lose if this slips?"
                rows={2}
              />
            </div>

            {/* Subtasks */}
            <div className={styles.subInputGroup} style={{ marginBottom: '1rem' }}>
              <div className={styles.subtasksHeader}>
                <label className={styles.subtasksLabel}>Subtasks <span className={styles.subtaskCount}>{editForm.subTasks.length}</span></label>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {editForm.subTasks.map((st, idx) => (
                  <div key={st._uid || idx} className={styles.subtaskRow}>
                    <input
                      className={styles.subtaskInput}
                      value={st.title}
                      placeholder="Subtask title"
                      onChange={e => {
                        const updated = [...editForm.subTasks];
                        updated[idx] = { ...updated[idx], title: e.target.value };
                        setEditForm({ ...editForm, subTasks: updated });
                      }}
                    />
                    <select
                      className={`${styles.prioritySelect} ${styles['priority' + (st.priority?.charAt(0) + st.priority?.slice(1).toLowerCase() || 'Medium')]}`}
                      value={st.priority || 'MEDIUM'}
                      onChange={e => {
                        const updated = [...editForm.subTasks];
                        updated[idx] = { ...updated[idx], priority: e.target.value };
                        setEditForm({ ...editForm, subTasks: updated });
                      }}
                    >
                      <option value="HIGH">HIGH</option>
                      <option value="MEDIUM">MED</option>
                      <option value="LOW">LOW</option>
                    </select>
                    <div className={styles.hoursWrapper}>
                      <input
                        type="number" min="0" step="0.5"
                        className={styles.hoursInput}
                        value={st.estimatedHours || 1}
                        onChange={e => {
                          const updated = [...editForm.subTasks];
                          updated[idx] = { ...updated[idx], estimatedHours: parseFloat(e.target.value) || 1 };
                          setEditForm({ ...editForm, subTasks: updated });
                        }}
                      />
                      <span className={styles.hoursLabel}>hr</span>
                    </div>
                    <button
                      className={styles.removeBtn}
                      onClick={() => setEditForm({ ...editForm, subTasks: editForm.subTasks.filter((_, i) => i !== idx) })}
                    ><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <button
                className={styles.addSubtaskBtn}
                style={{ marginTop: '0.5rem' }}
                onClick={() => setEditForm({ ...editForm, subTasks: [...editForm.subTasks, { title: '', estimatedHours: 1, priority: 'MEDIUM', _uid: Math.random().toString(36).slice(2) }] })}
              >
                <Plus size={14} /> Add Subtask
              </button>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setEditingTemplate(null)}>Cancel</button>
              <button
                className={styles.btnPrimary}
                disabled={!editForm.name || updateTemplateMutation.isPending}
                onClick={() => updateTemplateMutation.mutate({
                  id: editingTemplate._id,
                  data: {
                    name: editForm.name,
                    category: editForm.category,
                    risk: editForm.risk,
                    reward: editForm.reward,
                    subTasks: editForm.subTasks
                      .filter(s => s.title.trim())
                      .map(({ title, estimatedHours, priority }) => ({ title, estimatedHours, priority }))
                  }
                })}
              >
                {updateTemplateMutation.isPending ? <RefreshCw size={14} className={styles.spinning} style={{ marginRight: 6 }} /> : null}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
