import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../api/axios';
import { UserCheck, ShieldAlert, Check, X } from 'lucide-react';
import styles from './RequestManager.module.css';

export default function RequestManager({ notifications }) {
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState([]);

  if (!Array.isArray(notifications)) return null;

  const friendRequests = notifications.filter(
    n => n.type === 'FRIEND_REQUEST' && !n.isRead && !dismissed.includes(n._id)
  );
  const accRequests = notifications.filter(
    n => n.type === 'ACCOUNTABILITY_REQUEST' && !n.isRead && !dismissed.includes(n._id)
  );

  const dismiss = (id) => setDismissed(prev => [...prev, id]);

  // ── Friend request mutations ───────────────────────────────────────────────
  const acceptFriendMutation = useMutation({
    mutationFn: async (id) => api.post(`/friends/accept/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    }
  });
  const rejectFriendMutation = useMutation({
    mutationFn: async (id) => api.post(`/friends/reject/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });

  // ── Accountability request mutations ──────────────────────────────────────
  // relatedId on the notification is the commitment ID
  const acceptAccMutation = useMutation({
    mutationFn: async ({ commitmentId, notificationId }) =>
      api.post(`/commitments/${commitmentId}/partner/accept/${notificationId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['commitments'] });
      queryClient.invalidateQueries({ queryKey: ['commitments', 'active'] });
    }
  });
  const rejectAccMutation = useMutation({
    mutationFn: async ({ commitmentId, notificationId }) =>
      api.post(`/commitments/${commitmentId}/partner/reject/${notificationId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });

  const totalRequests = friendRequests.length + accRequests.length;
  if (totalRequests === 0) return null;

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>
        Pending Requests
        <span style={{ marginLeft: '0.5rem', background: '#D35400', color: '#fff', borderRadius: '999px', fontSize: '0.72rem', padding: '0.1rem 0.55rem', fontWeight: 700 }}>
          {totalRequests}
        </span>
      </h3>

      <div className={styles.requestsList}>
        {/* ── Friend Requests ── */}
        {friendRequests.map(req => (
          <div key={req._id} className={styles.requestCard}>
            <div className={styles.iconWrapperFriend}>
              <UserCheck size={20} />
            </div>
            <div className={styles.reqContent}>
              <p className={styles.reqMessage}>{req.message}</p>
              <p className={styles.reqType}>Friend Request</p>
            </div>
            <div className={styles.actions}>
              <button
                onClick={() => acceptFriendMutation.mutate(req._id)}
                className={`${styles.actionBtn} ${styles.acceptBtn}`}
                disabled={acceptFriendMutation.isPending}
                title="Accept friend request"
              >
                <Check size={16} />
              </button>
              <button
                onClick={() => rejectFriendMutation.mutate(req._id)}
                className={`${styles.actionBtn} ${styles.rejectBtn}`}
                disabled={rejectFriendMutation.isPending}
                title="Decline friend request"
              >
                <X size={16} />
              </button>
              <button
                onClick={() => dismiss(req._id)}
                className={`${styles.actionBtn} ${styles.dismissBtn}`}
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}

        {/* ── Accountability Partner Requests ── */}
        {accRequests.map(req => (
          <div key={req._id} className={styles.requestCard}>
            <div className={styles.iconWrapperAcc}>
              <ShieldAlert size={20} />
            </div>
            <div className={styles.reqContent}>
              <p className={styles.reqMessage}>{req.message}</p>
              <p className={styles.reqType}>Accountability Partner Invitation</p>
            </div>
            <div className={styles.actions}>
              <button
                onClick={() => acceptAccMutation.mutate({ commitmentId: req.relatedId, notificationId: req._id })}
                className={`${styles.actionBtn} ${styles.acceptBtn}`}
                disabled={acceptAccMutation.isPending}
                title="Accept accountability request"
              >
                <Check size={16} />
              </button>
              <button
                onClick={() => rejectAccMutation.mutate({ commitmentId: req.relatedId, notificationId: req._id })}
                className={`${styles.actionBtn} ${styles.rejectBtn}`}
                disabled={rejectAccMutation.isPending}
                title="Decline accountability request"
              >
                <X size={16} />
              </button>
              <button
                onClick={() => dismiss(req._id)}
                className={`${styles.actionBtn} ${styles.dismissBtn}`}
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
