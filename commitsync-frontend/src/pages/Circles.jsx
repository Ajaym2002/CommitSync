import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, UserPlus, MessageCircle, Users, X, Check, AlertCircle, CheckCircle } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import DashboardNavbar from '../components/dashboard/DashboardNavbar';
import AccountabilityDragDrop from '../components/circles/AccountabilityDragDrop';
import AdvancedChat from '../components/circles/AdvancedChat';
import StackedAvatars from '../components/circles/StackedAvatars';
import RequestManager from '../components/circles/RequestManager';
import styles from './Circles.module.css';

export default function Circles() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const [activeConversationId, setActiveConversationId] = useState(null);
  // Mobile: 'list' shows sidebar, 'chat' shows the chat pane
  const [mobileView, setMobileView] = useState('list');

  // Local state for unread indicators
  const [readMap, setReadMap] = React.useState(() => JSON.parse(localStorage.getItem('chatReadStatus') || '{}'));

  // Auto-mark active conversation as read
  React.useEffect(() => {
    if (activeConversationId) {
      setReadMap(prev => {
        const next = { ...prev, [activeConversationId]: new Date().toISOString() };
        localStorage.setItem('chatReadStatus', JSON.stringify(next));
        return next;
      });
    }
  }, [activeConversationId]);

  const [searchEmail, setSearchEmail] = useState('');
  const [searchedUser, setSearchedUser] = useState(null);
  const [searchError, setSearchError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [messageText, setMessageText] = useState('');
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [friendToRemove, setFriendToRemove] = useState(null);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: notificationsData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => { 
      const r = await api.get('/notifications'); 
      return r.data.data; 
    },
    refetchInterval: 5000
  });
  const notifications = notificationsData?.notifications || [];

  const { data: conversationsData } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => { const r = await api.get('/chat/conversations'); return r.data.data.conversations; },
    refetchInterval: 10000
  });
  const conversations = conversationsData || [];

  const { data: activeMessagesData } = useQuery({
    queryKey: ['messages', activeConversationId],
    queryFn: async () => { 
      if (!activeConversationId) return [];
      const r = await api.get(`/chat/conversations/${activeConversationId}/messages`); 
      return r.data.data.messages; 
    },
    enabled: !!activeConversationId
    // Removed refetchInterval: 3000 to rely on WebSockets
  });
  // Filter out system-generated messages from personal (DIRECT) chats
  const activeConv = conversations.find(c => c._id === activeConversationId);
  const messages = (activeMessagesData || []).filter(msg => {
    if (activeConv?.type === 'DIRECT') {
      // Allow notification-type system messages (from "Share to Chat" — risk alert cards)
      if (msg.senderModel === 'System' && msg.type === 'notification') return true;
      // Suppress all other system/senderless messages
      if (!msg.senderId || msg.senderModel === 'System') return false;
      // Suppress legacy [System Alert] plain-text messages
      if (typeof msg.text === 'string' && msg.text.startsWith('[System Alert]')) return false;
    }
    return true;
  });

  const { data: friendsData } = useQuery({
    queryKey: ['friends'],
    queryFn: async () => { 
      const r = await api.get('/friends'); 
      return r.data.data.friends || r.data.data; 
    }
  });
  const friendsRaw = (friendsData || []).map(f => f.friendId ? f.friendId : f).filter(Boolean);
  // Deduplicate by _id as a safety net against any pre-existing DB duplicates
  const friends = friendsRaw.filter((f, idx, arr) => arr.findIndex(x => x._id === f._id) === idx);

  const { data: commitmentsData } = useQuery({
    queryKey: ['commitments', 'active'],
    queryFn: async () => { 
      const r = await api.get('/commitments/active'); 
      return r.data.data.commitments; 
    }
  });
  const commitments = commitmentsData || [];

  const { data: accountableToData } = useQuery({
    queryKey: ['commitments', 'accountable-to'],
    queryFn: async () => {
      const r = await api.get('/commitments/accountable-to');
      return r.data.data.commitments;
    }
  });
  const accountableToCommitments = accountableToData || [];

  // accountabilityPartners = people John invited to his commitments (for drag and drop)
  const accountabilityPartners = [];
  const partnerIds = new Set();
  
  const populatedCommitments = commitments.map(c => {
    const populatedPartners = [];
    const populatedPending = [];
    
    if (c.accountabilityPartners && Array.isArray(c.accountabilityPartners)) {
      c.accountabilityPartners.forEach(pId => {
        const pIdStr = pId._id ? pId._id.toString() : pId.toString();
        const friendObj = friends.find(f => f._id === pIdStr);
        if (friendObj) {
          populatedPartners.push(friendObj);
          if (!partnerIds.has(pIdStr)) {
            partnerIds.add(pIdStr);
            accountabilityPartners.push(friendObj);
          }
        } else if (pId._id) {
          populatedPartners.push(pId);
          if (!partnerIds.has(pIdStr)) {
            partnerIds.add(pIdStr);
            accountabilityPartners.push(pId);
          }
        }
      });
    }
    
    if (c.pendingAccountabilityPartners && Array.isArray(c.pendingAccountabilityPartners)) {
      c.pendingAccountabilityPartners.forEach(pId => {
        const pIdStr = pId._id ? pId._id.toString() : pId.toString();
        const friendObj = friends.find(f => f._id === pIdStr);
        if (friendObj) populatedPending.push(friendObj);
        else if (pId._id) populatedPending.push(pId);
      });
    }
    
    return { ...c, populatedPartners, populatedPending };
  });

  // accountableToUsers = people who invited John to be their accountability partner (for "Were you accountable to them?")
  const accountableToUsers = [];
  const accountableToUserIds = new Set();
  accountableToCommitments.forEach(c => {
    if (c.userId && c.userId._id) {
      const uIdStr = c.userId._id.toString();
      if (!accountableToUserIds.has(uIdStr)) {
        accountableToUserIds.add(uIdStr);
        accountableToUsers.push(c.userId);
      }
    }
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const searchUserMutation = useMutation({
    mutationFn: async (email) => {
      const r = await api.get(`/friends/search?email=${encodeURIComponent(email)}`);
      return r.data.data;
    },
    onSuccess: (data) => {
      setSearchedUser(data);
      setSearchError('');
    },
    onError: (err) => {
      setSearchedUser(null);
      setSearchError(err.response?.data?.error || 'User not found');
      setTimeout(() => setSearchError(''), 3000);
    }
  });

  const sendFriendRequestMutation = useMutation({
    mutationFn: async (email) => { await api.post('/friends', { email }); },
    onSuccess: () => { 
      setSuccessMessage('Friend request sent!');
      setTimeout(() => setSuccessMessage(''), 3000);
      setSearchEmail(''); 
      setSearchedUser(null);
    },
    onError: (err) => alert(err.response?.data?.error || 'Failed to send request')
  });

  const startDirectChatMutation = useMutation({
    mutationFn: async (targetUserId) => { 
      const r = await api.post('/chat/direct', { targetUserId }); 
      return r.data.data.conversation; 
    },
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setActiveConversationId(conv._id);
    }
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ convId, text, replyTo }) => {
      await api.post(`/chat/conversations/${convId}/messages`, { text, replyTo });
    },
    onMutate: async ({ convId, text, replyTo }) => {
      await queryClient.cancelQueries({ queryKey: ['messages', convId] });
      const previousMessages = queryClient.getQueryData(['messages', convId]);
      
      const optimisticMsg = {
        _id: `temp-${Date.now()}`,
        conversationId: convId,
        senderId: { _id: user?.id || user?._id, name: user?.name },
        senderModel: 'User',
        text,
        type: 'chat',
        createdAt: new Date().toISOString(),
        replyTo: replyTo ? { ...replyTo } : null,
        reactions: []
      };

      queryClient.setQueryData(['messages', convId], old => {
        return old ? [...old, optimisticMsg] : [optimisticMsg];
      });
      
      setMessageText('');
      return { previousMessages };
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData(['messages', variables.convId], context.previousMessages);
    },
    onSettled: (data, error, variables) => {
      // Background refetch to ensure sync
      queryClient.invalidateQueries({ queryKey: ['messages', variables.convId] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    }
  });

  const assignPartnerMutation = useMutation({
    mutationFn: async ({ commitmentId, partnerId }) => {
      await api.patch(`/commitments/${commitmentId}/partner`, { partnerId });
    },
    onSuccess: () => queryClient.invalidateQueries(['soloCommitments'])
  });

  const acceptRequestMutation = useMutation({
    mutationFn: async ({ commitmentId, notificationId }) => {
      await api.post(`/commitments/${commitmentId}/partner/accept/${notificationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['soloCommitments']);
    }
  });

  const rejectRequestMutation = useMutation({
    mutationFn: async ({ commitmentId, notificationId }) => {
      await api.post(`/commitments/${commitmentId}/partner/reject/${notificationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
    }
  });

  const acceptFriendInCirclesMutation = useMutation({
    mutationFn: async (notificationId) => { await api.post(`/friends/accept/${notificationId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries(['notifications']);
      queryClient.invalidateQueries(['friends']);
    }
  });

  const rejectFriendInCirclesMutation = useMutation({
    mutationFn: async (notificationId) => { await api.post(`/friends/reject/${notificationId}`); },
    onSuccess: () => { queryClient.invalidateQueries(['notifications']); }
  });

  const removeFriendMutation = useMutation({
    mutationFn: async (friendId) => { await api.delete(`/friends/${friendId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries(['friends']);
      queryClient.invalidateQueries(['commitments', 'active']);
      queryClient.invalidateQueries(['commitments', 'accountable-to']);
      setSuccessMessage('Friend removed.');
      setTimeout(() => setSuccessMessage(''), 3000);
    },
    onError: (err) => {
      const raw = err.response?.data?.error || err.message || 'Failed to remove friend';
      const msg = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(''), 4000);
    }
  });

  const handleSearchUser = (e) => {
    e.preventDefault();
    if (searchEmail) searchUserMutation.mutate(searchEmail);
  };

  const handleSendRequest = () => {
    if (searchedUser) sendFriendRequestMutation.mutate(searchedUser.email);
  };

  const handleRemoveFriend = (friendId) => {
    setFriendToRemove(friendId);
  };

  const confirmRemoveFriend = () => {
    if (friendToRemove) {
      removeFriendMutation.mutate(friendToRemove);
      setFriendToRemove(null);
    }
  };

  const cancelRemoveFriend = () => {
    setFriendToRemove(null);
  };

  const handleSendMessage = (e, replyTo = null) => {
    e.preventDefault();
    if (messageText.trim() && activeConversationId) {
      // Check if target user is in DND
      const conv = conversations.find(c => c._id === activeConversationId);
      if (conv && conv.type === 'DIRECT') {
        const myId = user?._id?.toString() || user?.id?.toString();
        const otherParticipant = conv.participants.find(p => (p._id?.toString() || p._id) !== myId);
        if (otherParticipant) {
          const friendData = friends.find(f => f._id === otherParticipant._id);
          if (friendData?.focusMode?.active && new Date(friendData.focusMode.endsAt) > new Date()) {
            if (!window.confirm(`${otherParticipant.name} is in focus mode. Your message will be delivered when they finish. Send anyway?`)) return;
          }
        }
      }
      sendMessageMutation.mutate({ convId: activeConversationId, text: messageText, replyTo });
    }
  };

  // Process openChatWith from router state
  React.useEffect(() => {
    if (conversationsData === undefined) return;
    if (location.state?.openChatWith) {
      const targetUserId = location.state.openChatWith;
      // Clear state immediately to avoid infinite loop
      navigate('/circles', { replace: true, state: {} });
      
      // Find direct chat
      const directConv = conversations.find(c => c.type === 'DIRECT' && c.participants.some(p => (p._id?.toString() || p._id) === targetUserId.toString()));
      
      if (directConv) {
        setActiveConversationId(directConv._id);
      } else {
        // Create it
        startDirectChatMutation.mutate(targetUserId, {
          onSuccess: (newConv) => {
            setActiveConversationId(newConv._id);
          }
        });
      }
    }
  }, [location.state, conversations, conversationsData, navigate]);

  // ── Socket Listeners ───────────────────────────────────────────────────
  React.useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data) => {
      if (data.conversationId) {
        // Mark as unread if it's not the active conversation
        if (data.conversationId !== activeConversationId) {
          setReadMap(prev => {
            const next = { ...prev, [data.conversationId]: '1970-01-01T00:00:00.000Z' };
            localStorage.setItem('chatReadStatus', JSON.stringify(next));
            return next;
          });
        }

        queryClient.setQueryData(['messages', data.conversationId], old => {
          if (!old) return [data.message];
          // Prevent duplicates (optimistic UI might have already added a similar one, but ID will differ)
          // We just filter out temp ones or trust the backend message
          const filtered = old.filter(m => !m._id.toString().startsWith('temp-') || m.text !== data.message.text);
          const exists = filtered.find(m => m._id === data.message._id);
          if (exists) return filtered;
          return [...filtered, data.message];
        });
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      }
    };

    const handleReactionUpdate = (data) => {
      if (data.conversationId && data.messageId) {
        queryClient.setQueryData(['messages', data.conversationId], old => {
          if (!old) return old;
          return old.map(msg => 
            msg._id === data.messageId ? { ...msg, reactions: data.reactions } : msg
          );
        });
      }
    };

    socket.on('new_message', handleNewMessage);
    socket.on('reaction_updated', handleReactionUpdate);

    return () => {
      socket.off('new_message', handleNewMessage);
      socket.off('reaction_updated', handleReactionUpdate);
    };
  }, [socket, queryClient, activeConversationId]);

  // Process shareToChat from router state
  // - alreadyPosted=true: message was already posted (partner RISK_HIGH flow), just open the conv
  // - otherwise: post system-message then open
  React.useEffect(() => {
    if (conversationsData === undefined) return;
    if (location.state?.shareToChat && conversations.length > 0) {
      const { notif, targetConvId, alreadyPosted } = location.state.shareToChat;
      navigate('/circles', { replace: true, state: {} });

      if (targetConvId) {
        setActiveConversationId(targetConvId);
        if (alreadyPosted) {
          // Message already in DB — just refresh the message list
          queryClient.invalidateQueries({ queryKey: ['messages', targetConvId] });
          setSuccessMessage('Risk alert shared to chat!');
          setTimeout(() => setSuccessMessage(''), 3000);
        } else {
          // Post the system message now
          api.post(`/chat/conversations/${targetConvId}/system-message`, { notificationId: notif._id })
            .then(() => {
              queryClient.invalidateQueries({ queryKey: ['messages', targetConvId] });
              setSuccessMessage('Notification shared to chat!');
              setTimeout(() => setSuccessMessage(''), 3000);
            })
            .catch((err) => {
              const raw = err.response?.data?.error || err.message || 'Failed to share';
              setErrorMessage(typeof raw === 'object' ? JSON.stringify(raw) : String(raw));
              setTimeout(() => setErrorMessage(''), 4000);
            });
        }
      }
    }
  }, [location.state, conversations, conversationsData, navigate]);

  const handleStartChatWithPartner = (partnerId, initialMsg) => {
    setShowQuickPrompts(true);
    const existingConv = conversations.find(c => 
      c.type === 'DIRECT' && c.participants.some(p => p._id === partnerId)
    );

    if (existingConv) {
      setActiveConversationId(existingConv._id);
      if (initialMsg) setMessageText(initialMsg);
    } else {
      startDirectChatMutation.mutate(partnerId, {
        onSuccess: () => {
          if (initialMsg) setMessageText(initialMsg);
        }
      });
    }
  };

  const handleConfirmAssignments = async (assignments) => {
    const promises = [];
    Object.entries(assignments).forEach(([commitmentId, assignedFriends]) => {
      assignedFriends.forEach(friend => {
        promises.push(
          assignPartnerMutation.mutateAsync({ commitmentId, partnerId: friend._id })
            .then(() => startDirectChatMutation.mutateAsync(friend._id))
        );
      });
    });
    
    try {
      await Promise.all(promises);
      setSuccessMessage('Accountability requests have been sent!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (e) {
      setErrorMessage(e.response?.data?.error || e.message || 'Some requests failed to send.');
      setTimeout(() => setErrorMessage(''), 4000);
    }
  };

  const getConversationName = (conv) => {
    if (conv.type === 'TEAM') return conv.teamId?.name || 'Team Chat';
    const myId = user?._id?.toString() || user?.id?.toString();
    const otherParticipant = conv.participants.find(p => (p._id?.toString() || p._id) !== myId);
    return otherParticipant?.name || 'Unknown User';
  };

  const isAccountabilityPartnerConv = (conv) => {
    if (conv.type !== 'DIRECT') return false;
    const myId = user?._id?.toString() || user?.id?.toString();
    const otherParticipant = conv.participants.find(p => (p._id?.toString() || p._id) !== myId);
    return otherParticipant && partnerIds.has(otherParticipant._id.toString());
  };

  const sortedConversations = [...conversations].sort((a, b) => {
    const aIsPartner = isAccountabilityPartnerConv(a);
    const bIsPartner = isAccountabilityPartnerConv(b);
    
    if (aIsPartner && !bIsPartner) return -1;
    if (!aIsPartner && bIsPartner) return 1;
    
    if (a.type === 'TEAM' && b.type !== 'TEAM') return -1;
    if (a.type !== 'TEAM' && b.type === 'TEAM') return 1;
    
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });


  return (
    <div className={styles.circlesContainer}>
      <DashboardNavbar activeSection="circles" />

      <div className={styles.contentWrapper}>
        {/* SECTION 1: Friends and Commitments (Drag & Drop) */}
        <section className={styles.topSection}>
          
          <RequestManager notifications={notifications} />

          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Grow your circle</h2>
            <p className={styles.sectionSubtitle}>Invite someone to share your journey.</p>
          </div>

          <form onSubmit={handleSearchUser} className={styles.searchForm}>
            <div className={styles.inputWrapper}>
              <Search size={16} className={styles.inputIcon} />
              <input 
                type="email" 
                placeholder="Find friend by exact email..." 
                className={styles.searchInput}
                value={searchEmail}
                onChange={(e) => {
                  setSearchEmail(e.target.value);
                  setSearchedUser(null);
                  setSearchError('');
                }}
              />
            </div>
            <button type="submit" className={styles.addBtn} disabled={!searchEmail || searchUserMutation.isPending}>
              <Search size={16} /> Search
            </button>
          </form>

          {searchError && (
            <div className={styles.inlineError}>
              <AlertCircle size={18} />
              <span>{searchError === 'User not found' ? "We couldn't find anyone with that email." : searchError}</span>
            </div>
          )}
          
          {searchedUser && (
            <div className={styles.matchCard}>
              <div className={styles.matchInfo}>
                <div className={styles.matchAvatar}>
                  {searchedUser.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className={styles.matchName}>{searchedUser.name}</p>
                  <p className={styles.matchEmail}>{searchedUser.email}</p>
                </div>
              </div>
              <button 
                onClick={handleSendRequest} 
                className={styles.addFriendBtn}
                disabled={sendFriendRequestMutation.isPending}
              >
                <UserPlus size={16} /> Add Friend
              </button>
            </div>
          )}

          <AccountabilityDragDrop 
            friends={friends} 
            commitments={populatedCommitments} 
            onConfirm={handleConfirmAssignments}
            onRemoveFriend={handleRemoveFriend}
          />
        </section>

        {/* SECTION 1.5 removed from here */}

        {/* SECTION 2: Advanced Chat & Conversations */}
        <section className={styles.bottomSection}>
          {/* Chat Sidebar list */}
          <div className={`${styles.chatSidebar} ${mobileView === 'chat' ? styles.chatSidebarHidden : styles.chatSidebarVisible}`}>
            <h3 className={styles.listSectionTitle}>Conversations</h3>
            
            <div className={styles.convListScroll}>
              {sortedConversations.length === 0 && <p className={styles.emptyText}>No conversations yet.</p>}
              
              {sortedConversations.map(conv => {
                const isPartner = isAccountabilityPartnerConv(conv);
                
                // Check if the other person is in DND
                let isDND = false;
                if (conv.type === 'DIRECT') {
                  const myId = user?._id?.toString() || user?.id?.toString();
                  const otherParticipant = conv.participants.find(p => (p._id?.toString() || p._id) !== myId);
                  if (otherParticipant) {
                    const friendData = friends.find(f => f._id === otherParticipant._id);
                    if (friendData?.focusMode?.active && new Date(friendData.focusMode.endsAt) > new Date()) {
                      isDND = true;
                    }
                  }
                }

                const isUnread = conv._id !== activeConversationId && 
                                 conv.lastMessageAt && 
                                 readMap[conv._id] && 
                                 new Date(conv.lastMessageAt).getTime() > new Date(readMap[conv._id]).getTime();

                return (
                  <div 
                    key={conv._id} 
                    className={`${styles.convItem} ${activeConversationId === conv._id ? styles.activeConvItem : ''} ${isPartner ? styles.partnerConvItem : ''}`}
                    onClick={() => {
                      setActiveConversationId(conv._id);
                      setReadMap(prev => ({ ...prev, [conv._id]: new Date() }));
                      setShowQuickPrompts(false);
                      setMobileView('chat'); // switch to chat pane on mobile
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <div className={`${styles.convAvatar} ${isPartner ? styles.partnerAvatarGlow : ''} ${isDND ? styles.friendAvatarDnd : ''}`}>
                        {conv.type === 'TEAM' ? <Users size={18} /> : <MessageCircle size={18} />}
                      </div>
                      {isUnread && (
                        <div style={{
                          position: 'absolute', top: 0, right: 0,
                          width: 12, height: 12, borderRadius: '50%',
                          background: '#007AFF', border: '2px solid #FFFFFF'
                        }} title="New message" />
                      )}
                    </div>
                    <div className={styles.convInfo}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <p className={styles.convName}>{getConversationName(conv)}</p>
                        {conv.lastMessageAt && (
                          <span style={{ fontSize: '0.7rem', color: '#94A3B8', fontWeight: 500 }}>
                            {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <p className={styles.convType}>
                        {isDND ? <span className={styles.dndBadge}>In Focus Mode</span> : (isPartner ? 'Accountability Partner' : conv.type === 'TEAM' ? 'Team Chat' : 'Direct Message')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Advanced Chat Area */}
          <div className={`${styles.chatAreaWrapper} ${mobileView === 'list' ? styles.chatAreaHidden : styles.chatAreaVisible}`}>
            {/* Mobile back button */}
            {mobileView === 'chat' && (
              <button
                className={styles.mobileBackBtn}
                onClick={() => setMobileView('list')}
                aria-label="Back to conversations"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>Conversations</span>
              </button>
            )}
            <AdvancedChat 
              activeConv={activeConv}
              messages={messages}
              user={user}
              messageText={messageText}
              setMessageText={setMessageText}
              handleSendMessage={handleSendMessage}
              getConversationName={getConversationName}
              accountableToUsers={accountableToUsers}
              onStartChat={handleStartChatWithPartner}
              showQuickPrompts={showQuickPrompts}
              setShowQuickPrompts={setShowQuickPrompts}
            />
          </div>
        </section>

        {/* SECTION 3: Accountability Partners (Below chat section) */}
        {accountableToUsers && accountableToUsers.length > 0 && (
          <div style={{ 
            marginTop: '2rem', 
            marginBottom: '4rem', 
            display: 'flex', 
            flexDirection: 'row', 
            justifyContent: 'center',
            alignItems: 'center',
            gap: '1.5rem',
            padding: '0 2rem'
          }}>
            <h2 className={styles.sectionTitle} style={{ margin: 0, fontSize: '2.25rem' }}>
              Are you accountable to them?
            </h2>
            <StackedAvatars partners={accountableToUsers} onStartChat={handleStartChatWithPartner} />
          </div>
        )}
      </div>

      {/* Success Toast */}
      {successMessage && (
        <div className={styles.toastPopup}>
          <CheckCircle size={18} />
          <span>{successMessage}</span>
        </div>
      )}
      {/* Error Toast */}
      {errorMessage && (
        <div className={styles.toastPopup} style={{ background: '#EF4444' }}>
          <X size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Remove Friend Confirmation Modal */}
      {friendToRemove && (
        <div className={styles.modalOverlay} onClick={cancelRemoveFriend}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Remove Friend</h3>
              <button className={styles.closeModalBtn} onClick={cancelRemoveFriend}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>Are you sure you want to remove this friend? This action cannot be undone.</p>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.modalBtnSecondary} onClick={cancelRemoveFriend}>
                Cancel
              </button>
              <button className={styles.modalBtnDanger} onClick={confirmRemoveFriend}>
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
