import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, X, CheckCircle, XCircle, Share2, Users, MessageCircle, AlertTriangle, TrendingUp, UserCheck, ShieldAlert, Calendar, Zap } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import styles from './FloatingActions.module.css';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';

// Notification types that show "Share to Chat" (excludes RISK_HIGH — handled separately below)
const SHARE_TYPES = ['COMMITMENT_ALERT', 'BOTTLENECK_ALERT', 'DEADLINE_NEAR', 'FRIEND_MILESTONE'];

function getNotifIcon(type) {
  if (type === 'FRIEND_REQUEST') return <UserCheck size={16} />;
  if (type === 'ACCOUNTABILITY_REQUEST') return <ShieldAlert size={16} />;
  if (type === 'TEAM_INVITE') return <Users size={16} />;
  if (['COMMITMENT_ALERT', 'RISK_HIGH', 'BOTTLENECK_ALERT'].includes(type)) return <AlertTriangle size={16} />;
  if (type === 'TEAM_RISK_HIGH') return <ShieldAlert size={16} />;
  if (['FRIEND_MILESTONE', 'COMMITMENT_COMPLETED'].includes(type)) return <TrendingUp size={16} />;
  return <Bell size={16} />;
}

function getNotifAccent(type) {
  if (['COMMITMENT_ALERT', 'RISK_HIGH', 'BOTTLENECK_ALERT'].includes(type)) return '#F59E0B';
  if (type === 'TEAM_RISK_HIGH') return '#EF4444';
  if (['FRIEND_MILESTONE', 'COMMITMENT_COMPLETED'].includes(type)) return '#10B981';
  if (type === 'DEADLINE_NEAR') return '#EF4444';
  if (['FRIEND_REQUEST', 'ACCOUNTABILITY_REQUEST', 'TEAM_INVITE'].includes(type)) return '#6366F1';
  return '#64748B';
}

export default function FloatingActions() {
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const navigate = useNavigate();
  const { socket, criticalAlerts, dismissAlert } = useSocket() || { socket: null, criticalAlerts: [], dismissAlert: () => {} };
  const [socketToast, setSocketToast] = useState(null);
  const [sharingId, setSharingId] = useState(null); // tracks which partner RISK_HIGH is being shared
  const [shareSuccess, setShareSuccess] = useState(null); // notif._id that was just shared successfully
  const [shareError, setShareError] = useState(null);  // notif._id that failed to share

  // Show latest socket alert as toast and auto-dismiss after 8 seconds
  useEffect(() => {
    if (criticalAlerts.length > 0) {
      const latest = criticalAlerts[0];
      setSocketToast(latest);
      const t = setTimeout(() => {
        setSocketToast(null);
        dismissAlert(latest.id);
      }, 8000);
      return () => clearTimeout(t);
    }
  }, [criticalAlerts]);

  // Real-time: update notification list when a new_notification event arrives via socket
  useEffect(() => {
    if (!socket) return;
    const handleNewNotification = (notif) => {
      queryClient.setQueryData(['notifications'], (old) => {
        if (!old) return { notifications: [notif] };
        const exists = old.notifications?.some(n => n._id === notif._id);
        if (exists) return old;
        return { ...old, notifications: [notif, ...(old.notifications || [])] };
      });
    };
    socket.on('new_notification', handleNewNotification);
    return () => socket.off('new_notification', handleNewNotification);
  }, [socket, queryClient]);

  const { data: notificationsData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      try {
        const res = await api.get('/notifications');
        return res.data.data;
      } catch { return []; }
    },
    enabled: !!user,
    refetchInterval: 15000
  });

  // Also fetch conversations so we can resolve target convId for Share to Chat
  const { data: convsData } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => {
      const r = await api.get('/chat/conversations');
      return r.data.data.conversations;
    },
    enabled: !!user && isNotificationsOpen
  });
  const conversations = convsData || [];

  const notifications = notificationsData?.notifications || [];
  const hasUnread = notifications.some(n => !n.isRead);

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => { await api.put('/notifications/read-all'); },
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  const acceptAccMutation = useMutation({
    mutationFn: async ({ commitmentId, notificationId }) =>
      api.post(`/commitments/${commitmentId}/partner/accept/${notificationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['commitments', 'active']);
    }
  });
  const rejectAccMutation = useMutation({
    mutationFn: async ({ commitmentId, notificationId }) =>
      api.post(`/commitments/${commitmentId}/partner/reject/${notificationId}`),
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  const acceptFriendMutation = useMutation({
    mutationFn: async (id) => api.post(`/friends/accept/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['friends']);
    }
  });
  const rejectFriendMutation = useMutation({
    mutationFn: async (id) => api.post(`/friends/reject/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  const acceptTeamMutation = useMutation({
    mutationFn: async (id) => api.post(`/teams/accept-invite/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['teams']);
      queryClient.invalidateQueries(['allTeamCommitments']);
    }
  });
  const rejectTeamMutation = useMutation({
    mutationFn: async (id) => api.post(`/teams/reject-invite/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: async (id) => api.delete(`/notifications/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  const toggleNotifications = () => {
    setIsNotificationsOpen(prev => !prev);
    if (!isNotificationsOpen && hasUnread) {
      const actionableTypes = ['FRIEND_REQUEST', 'ACCOUNTABILITY_REQUEST'];
      const hasOnlyActionable = notifications.every(n => actionableTypes.includes(n.type));
      if (!hasOnlyActionable) {
        markAllAsReadMutation.mutate();
        queryClient.setQueryData(['notifications'], (old) => {
          if (!old) return old;
          return {
            ...old,
            notifications: old.notifications?.map(n =>
              actionableTypes.includes(n.type) ? n : { ...n, isRead: true }
            )
          };
        });
      }
    }
  };

  // Resolve target conversation for a generic shareable notification (team or name-based match)
  const resolveTargetConvId = (notif) => {
    const teamConv = conversations.find(c =>
      c.type === 'TEAM' && c.teamId?._id?.toString() === notif.relatedId?.toString()
    );
    if (teamConv) return teamConv._id;

    const directConv = conversations.find(c =>
      c.type === 'DIRECT' && c.participants.some(p => notif.message.includes(p.name))
    );
    if (directConv) return directConv._id;
    return null;
  };

  // For partner-side RISK_HIGH: find the direct conversation with the commitment owner by their userId
  const resolveOwnerConvId = (notif) => {
    if (!notif.relatedUserId) return null;
    const ownerIdStr = notif.relatedUserId._id?.toString() || notif.relatedUserId?.toString();
    return conversations.find(c =>
      c.type === 'DIRECT' &&
      c.participants.some(p => (p._id?.toString() || p.toString()) === ownerIdStr)
    )?._id || null;
  };

  // For TEAM_RISK_HIGH: find the team group conversation using relatedTeamId
  const resolveTeamConvId = (notif) => {
    const teamIdStr = notif.relatedTeamId?._id?.toString() || notif.relatedTeamId?.toString();
    if (!teamIdStr) return null;
    return conversations.find(c =>
      c.type === 'TEAM' && c.teamId?._id?.toString() === teamIdStr
    )?._id || null;
  };

  // Check if current user is admin or ADMIN-role member of the team linked to a TEAM_RISK_HIGH notif
  const isTeamAdminForNotif = (notif) => {
    const teamIdStr = notif.relatedTeamId?._id?.toString() || notif.relatedTeamId?.toString();
    if (!teamIdStr) return false;
    const myId = user?._id?.toString() || user?.id?.toString();
    const teamConv = conversations.find(c =>
      c.type === 'TEAM' && c.teamId?._id?.toString() === teamIdStr
    );
    if (!teamConv) return false;
    // adminId is now populated in the teamId object
    if (teamConv.teamId?.adminId?.toString() === myId) return true;
    // Also check members with role ADMIN
    return (teamConv.teamId?.members || []).some(
      m => (m.userId?.toString() || m.userId) === myId && m.role === 'ADMIN'
    );
  };

  // Generic share (non-RISK_HIGH)
  // If no existing conversation is found, we try to create one via the relatedUserId
  const handleShareToChat = async (notif) => {
    setSharingId(notif._id);
    try {
      let targetConvId = resolveTargetConvId(notif);

      // If we still have no conversation, try creating a direct chat with the related user
      if (!targetConvId && notif.relatedUserId) {
        const ownerIdStr = notif.relatedUserId._id?.toString() || notif.relatedUserId?.toString();
        try {
          const r = await api.post('/chat/direct', { targetUserId: ownerIdStr });
          targetConvId = r.data.data.conversation._id;
          queryClient.invalidateQueries(['conversations']);
        } catch (_) {
          // Could not auto-create a conversation
        }
      }

      if (!targetConvId) {
        // No conversation found and couldn't create one — show inline error
        setShareError(notif._id);
        setTimeout(() => setShareError(null), 3500);
        return;
      }

      // Post the system message now so the nav happens instantly with the right conv
      await api.post(`/chat/conversations/${targetConvId}/system-message`, { notificationId: notif._id });
      queryClient.invalidateQueries(['messages', targetConvId]);

      setShareSuccess(notif._id);
      setTimeout(() => {
        setShareSuccess(null);
        setIsNotificationsOpen(false);
        navigate('/circles', { state: { shareToChat: { notif, targetConvId, alreadyPosted: true } } });
      }, 900);
    } catch (e) {
      console.error('Share to Chat failed:', e);
      setShareError(notif._id);
      setTimeout(() => setShareError(null), 3500);
    } finally {
      setSharingId(notif._id === sharingId ? null : sharingId);
      setSharingId(null);
    }
  };

  // Partner shares a RISK_HIGH to the direct chat with the commitment owner
  // Creates the conversation if it doesn't exist, then posts a rich system message
  const handlePartnerShareRiskToChat = async (notif) => {
    setSharingId(notif._id);
    try {
      const ownerIdStr = notif.relatedUserId._id?.toString() || notif.relatedUserId?.toString();
      let convId = resolveOwnerConvId(notif);
      if (!convId) {
        // Create or fetch the direct conversation with the owner
        const r = await api.post('/chat/direct', { targetUserId: ownerIdStr });
        convId = r.data.data.conversation._id;
        queryClient.invalidateQueries(['conversations']);
      }
      // Post the notification as a rich system message (with risk breakdown stats)
      await api.post(`/chat/conversations/${convId}/system-message`, { notificationId: notif._id });
      queryClient.invalidateQueries(['messages', convId]);

      setShareSuccess(notif._id);
      setTimeout(() => {
        setShareSuccess(null);
        setIsNotificationsOpen(false);
        // Navigate to Circles with the correct conversation pre-selected
        navigate('/circles', { state: { shareToChat: { notif, targetConvId: convId, alreadyPosted: true } } });
      }, 900);
    } catch (e) {
      console.error('Share to Chat (partner risk) failed:', e);
      setShareError(notif._id);
      setTimeout(() => setShareError(null), 3500);
    } finally {
      setSharingId(null);
    }
  };

  // Team admin shares a TEAM_RISK_HIGH to the team group chat
  const handleTeamShareToChat = async (notif) => {
    setSharingId(notif._id);
    try {
      const convId = resolveTeamConvId(notif);
      if (!convId) {
        setShareError(notif._id);
        setTimeout(() => setShareError(null), 3500);
        return;
      }
      await api.post(`/chat/conversations/${convId}/system-message`, { notificationId: notif._id });
      queryClient.invalidateQueries(['messages', convId]);

      setShareSuccess(notif._id);
      setTimeout(() => {
        setShareSuccess(null);
        setIsNotificationsOpen(false);
        navigate('/circles', { state: { shareToChat: { notif, targetConvId: convId, alreadyPosted: true } } });
      }, 900);
    } catch (e) {
      console.error('Share to Chat (team risk) failed:', e);
      setShareError(notif._id);
      setTimeout(() => setShareError(null), 3500);
    } finally {
      setSharingId(null);
    }
  };

  if (!user) return null;
  const publicRoutes = ['/', '/login', '/auth/google/success', '/auth/google/error'];
  if (publicRoutes.includes(location.pathname)) return null;

  return (
    <>
      {/* ── Feature 8: Real-time critical alert toast ── */}
      {socketToast && (
        <div style={{
          position: 'fixed',
          bottom: '5rem',
          right: '1.5rem',
          zIndex: 10000,
          maxWidth: '340px',
          background: 'linear-gradient(135deg, #1A1D20 0%, #2D1616 100%)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderLeft: '4px solid #EF4444',
          borderRadius: '14px',
          padding: '1rem 1.1rem',
          boxShadow: '0 8px 32px rgba(239,68,68,0.2)',
          animation: 'slideInRight 0.3s ease',
          color: '#fff'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <AlertTriangle size={15} color="#EF4444" />
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Critical Alert — Real-Time
                </span>
              </div>
              <p style={{ margin: 0, fontSize: '0.83rem', color: '#E2E8F0', lineHeight: 1.5 }}>
                <strong style={{ color: '#fff' }}>"{socketToast.title}"</strong> is at {socketToast.riskScore}% risk.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button
                  onClick={() => {
                    setSocketToast(null);
                    navigate('/syncs');
                  }}
                  style={{
                    padding: '0.35rem 0.8rem',
                    background: '#EF4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '7px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}
                >
                  <Calendar size={12} /> Reschedule →
                </button>
                <button
                  onClick={() => { setSocketToast(null); dismissAlert(socketToast.id); }}
                  style={{ padding: '0.35rem 0.7rem', background: 'rgba(255,255,255,0.1)', color: '#94A3B8', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
            <button onClick={() => { setSocketToast(null); dismissAlert(socketToast.id); }} style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: '2px', flexShrink: 0 }}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      <div className={styles.floatingContainer}>
        <button id="floating-actions-btn" className={styles.actionBtn} onClick={toggleNotifications} title="Notifications">
          <Bell className={styles.icon} />
          {hasUnread && <span className={styles.redDot} />}
        </button>
      </div>

      {/* Notification Panel */}
      {isNotificationsOpen && (
        <div className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <div>
              <h3 className={styles.panelTitle}>Notifications</h3>
              {notifications.length > 0 && (
                <span className={styles.panelCount}>{notifications.filter(n => !n.isRead).length} unread</span>
              )}
            </div>
            <button className={styles.closeBtn} onClick={() => setIsNotificationsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className={styles.sidebarContent}>
            {notifications.length === 0 ? (
              <div className={styles.emptyState}>
                <Bell size={32} style={{ opacity: 0.2, marginBottom: '0.75rem' }} />
                <p>All caught up!</p>
                <span>No new notifications.</span>
              </div>
            ) : (
              notifications.map(notif => {
                const accent = getNotifAccent(notif.type);
                const isShareable = SHARE_TYPES.includes(notif.type);
                // Notification TTL check: createdAt + 7 days
                const isExpired = notif.createdAt && (Date.now() - new Date(notif.createdAt).getTime() > 7 * 24 * 60 * 60 * 1000);
                // Feature 7: Actionable notification flags
                const isReschedule = notif.actionType === 'RESCHEDULE' && notif.actionPayload?.commitmentId;
                const isBlockFocus = notif.suggestedFocusSlot?.start;

                return (
                  <div
                    key={notif._id}
                    className={`${styles.notificationItem} ${!notif.isRead ? styles.unread : ''}`}
                    style={{ '--accent': accent }}
                  >
                    {/* Remove button */}
                    <button
                      onClick={() => deleteNotificationMutation.mutate(notif._id)}
                      className={styles.notifDeleteBtn}
                      title="Remove"
                    >
                      <X size={12} />
                    </button>

                    {/* Icon + type label */}
                    <div className={styles.notifTopRow}>
                      <span className={styles.notifIcon} style={{ color: accent, background: `${accent}18` }}>
                        {getNotifIcon(notif.type)}
                      </span>
                      <span className={styles.notifTypeLabel} style={{ color: accent }}>
                        {notif.type.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <p className={styles.notificationMessage}>{notif.message}</p>
                    <span className={styles.notificationTime}>
                      {new Date(notif.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>

                    {/* ── Feature 7: Inline action buttons for RESCHEDULE ── */}
                    {isReschedule && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                        <button
                          style={{
                            padding: '0.3rem 0.7rem',
                            background: '#EF4444',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '7px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.3rem'
                          }}
                          onClick={() => {
                            setIsNotificationsOpen(false);
                            navigate('/syncs', { state: { openReschedule: notif.actionPayload.commitmentId } });
                          }}
                        >
                          <Calendar size={12} /> Reschedule →
                        </button>
                        {isBlockFocus && (
                          <button
                            style={{
                              padding: '0.3rem 0.7rem',
                              background: '#6366F1',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '7px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.3rem'
                            }}
                            onClick={async () => {
                              try {
                                await api.post(`/commitments/${notif.actionPayload.commitmentId}/focus-session`, {
                                  start: notif.suggestedFocusSlot.start,
                                  end: notif.suggestedFocusSlot.end
                                });
                                deleteNotificationMutation.mutate(notif._id);
                              } catch (e) {
                                alert('Failed to block focus session. Is Calendar connected?');
                              }
                            }}
                          >
                            <Zap size={12} /> Block Focus Time
                          </button>
                        )}
                      </div>
                    )}

                    {/* ── Share to Chat buttons ── */}
                    {isShareable && !isExpired && (
                      <div className={styles.shareBtnWrapper}>
                        {shareSuccess === notif._id ? (
                          <span className={styles.shareSuccessBadge}>
                            <CheckCircle size={13} /> Shared!
                          </span>
                        ) : shareError === notif._id ? (
                          <span className={styles.shareErrorBadge}>
                            <XCircle size={13} /> No chat found
                          </span>
                        ) : (
                          <button
                            className={styles.shareBtn}
                            onClick={() => handleShareToChat(notif)}
                            disabled={sharingId === notif._id}
                            title="Share this alert to the relevant chat"
                          >
                            {sharingId === notif._id ? (
                              <><span className={styles.shareBtnSpinner} /> Sharing...</>
                            ) : (
                              <><Share2 size={13} /> Share to Chat</>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {notif.type === 'RISK_HIGH' && notif.relatedUserId && !isExpired && (
                      <div className={styles.shareBtnWrapper}>
                        {shareSuccess === notif._id ? (
                          <span className={styles.shareSuccessBadge}>
                            <CheckCircle size={13} /> Shared!
                          </span>
                        ) : shareError === notif._id ? (
                          <span className={styles.shareErrorBadge}>
                            <XCircle size={13} /> Failed — try again
                          </span>
                        ) : (
                          <button
                            className={styles.shareBtn}
                            onClick={() => handlePartnerShareRiskToChat(notif)}
                            disabled={sharingId === notif._id}
                            title="Share this risk alert with the commitment owner in chat"
                          >
                            {sharingId === notif._id ? (
                              <><span className={styles.shareBtnSpinner} /> Sharing...</>
                            ) : (
                              <><Share2 size={13} /> Share to Chat</>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* ── TEAM_RISK_HIGH: Share to team group chat (admin/owner only) ── */}
                    {notif.type === 'TEAM_RISK_HIGH' && !isExpired && isTeamAdminForNotif(notif) && (
                      <div className={styles.shareBtnWrapper}>
                        {shareSuccess === notif._id ? (
                          <span className={styles.shareSuccessBadge}>
                            <CheckCircle size={13} /> Shared to Team Chat!
                          </span>
                        ) : shareError === notif._id ? (
                          <span className={styles.shareErrorBadge}>
                            <XCircle size={13} /> No team chat found
                          </span>
                        ) : (
                          <button
                            className={styles.shareBtn}
                            onClick={() => handleTeamShareToChat(notif)}
                            disabled={sharingId === notif._id}
                            title="Share team risk alert to the team group chat"
                          >
                            {sharingId === notif._id ? (
                              <><span className={styles.shareBtnSpinner} /> Sharing...</>
                            ) : (
                              <><Share2 size={13} /> Share to Chat</>
                            )}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Actionable items */}
                    {['FRIEND_REQUEST', 'ACCOUNTABILITY_REQUEST', 'TEAM_INVITE'].includes(notif.type) && (
                      <div className={styles.actionRow}>
                        {notif.actionStatus === 'ACCEPTED' && (
                          <span className={styles.statusBadge} style={{ color: '#10B981' }}>
                            <CheckCircle size={13} /> Accepted
                          </span>
                        )}
                        {notif.actionStatus === 'DECLINED' && (
                          <span className={styles.statusBadge} style={{ color: '#EF4444' }}>
                            <XCircle size={13} /> Declined
                          </span>
                        )}
                        {(!notif.actionStatus || notif.actionStatus === 'PENDING') && (
                          <>
                            <button
                              className={styles.acceptBtn}
                              onClick={() => {
                                if (notif.type === 'FRIEND_REQUEST') acceptFriendMutation.mutate(notif._id);
                                else if (notif.type === 'ACCOUNTABILITY_REQUEST') acceptAccMutation.mutate({ commitmentId: notif.relatedId, notificationId: notif._id });
                                else if (notif.type === 'TEAM_INVITE') acceptTeamMutation.mutate(notif._id);
                              }}
                            >✓ Accept</button>
                            <button
                              className={styles.declineBtn}
                              onClick={() => {
                                if (notif.type === 'FRIEND_REQUEST') rejectFriendMutation.mutate(notif._id);
                                else if (notif.type === 'ACCOUNTABILITY_REQUEST') rejectAccMutation.mutate({ commitmentId: notif.relatedId, notificationId: notif._id });
                                else if (notif.type === 'TEAM_INVITE') rejectTeamMutation.mutate(notif._id);
                              }}
                            >✕ Decline</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
