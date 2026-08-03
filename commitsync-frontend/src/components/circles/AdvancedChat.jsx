import React, { useRef, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, MessageCircle, Send, X, Pin, CornerUpLeft, AlertTriangle, TrendingUp, ChevronDown, CheckCheck } from 'lucide-react';
import api from '../../api/axios';
import styles from './AdvancedChat.module.css';
import StackedAvatars from './StackedAvatars';
import ChatContextMenu from './ChatContextMenu';

export default function AdvancedChat({ 
  activeConv, 
  messages, 
  user, 
  messageText, 
  setMessageText, 
  handleSendMessage,
  getConversationName,
  accountableToUsers,
  onStartChat,
  showQuickPrompts,
  setShowQuickPrompts
}) {
  const queryClient = useQueryClient();
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, message }
  const [replyingTo, setReplyingTo] = useState(null); // { messageId, senderName, textPreview }
  const [showScrollFab, setShowScrollFab] = useState(false);
  const [activePinIndexOffset, setActivePinIndexOffset] = useState(0);

  // Auto-scroll on new message if already near bottom
  useEffect(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    // If we were within 150px of the bottom, auto scroll
    if (scrollHeight - scrollTop - clientHeight < 150) {
      containerRef.current.scrollTo({
        top: scrollHeight,
        behavior: 'auto'
      });
    }
  }, [messages]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight > 250) {
      setShowScrollFab(true);
    } else {
      setShowScrollFab(false);
    }
  };

  const scrollToBottom = () => {
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: 'auto'
      });
    }
  };

  // ── Mutations ──────────────────────────────────────────────────────────
  const pinMutation = useMutation({
    mutationFn: async ({ convId, msgId }) =>
      api.patch(`/chat/conversations/${convId}/messages/${msgId}/pin`),
    onMutate: async ({ convId, msgId }) => {
      await queryClient.cancelQueries({ queryKey: ['messages', convId] });
      const prev = queryClient.getQueryData(['messages', convId]);
      queryClient.setQueryData(['messages', convId], old => {
        if (!old) return old;
        return old.map(msg => {
          if (msg._id !== msgId) return msg;
          return { ...msg, isPinned: !msg.isPinned };
        });
      });
      return { prev };
    },
    onError: (err, vars, context) => queryClient.setQueryData(['messages', vars.convId], context.prev),
    onSettled: (data, err, vars) => queryClient.invalidateQueries({ queryKey: ['messages', vars.convId] })
  });

  const reactMutation = useMutation({
    mutationFn: async ({ convId, msgId, emoji }) =>
      api.post(`/chat/conversations/${convId}/messages/${msgId}/react`, { emoji }),
    onMutate: async ({ convId, msgId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: ['messages', convId] });
      const prev = queryClient.getQueryData(['messages', convId]);
      queryClient.setQueryData(['messages', convId], old => {
        if (!old) return old;
        return old.map(msg => {
          if (msg._id !== msgId) return msg;
          const myId = user?._id?.toString() || user?.id?.toString();
          let reactions = [...(msg.reactions || [])];
          const existing = reactions.findIndex(r => r.emoji === emoji && (r.userId?._id?.toString() === myId || r.userId?.toString() === myId));
          if (existing >= 0) reactions.splice(existing, 1);
          else reactions.push({ emoji, userId: { _id: myId, name: user?.name || 'You' } });
          return { ...msg, reactions };
        });
      });
      return { prev };
    },
    onError: (err, vars, context) => queryClient.setQueryData(['messages', vars.convId], context.prev),
    onSettled: (data, err, vars) => queryClient.invalidateQueries({ queryKey: ['messages', vars.convId] })
  });

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, message: msg });
  };

  const handlePin = (msg) => {
    if (!activeConv) return;
    pinMutation.mutate({ convId: activeConv._id, msgId: msg._id });
  };

  const handleReply = (msg) => {
    const myId = user?._id?.toString() || user?.id?.toString();
    const senderIdStr = msg.senderId?._id?.toString() || '';
    const isMe = senderIdStr === myId;
    const senderName = msg.senderModel === 'System' ? 'System' : (isMe ? 'You' : (msg.senderId?.name || 'Unknown'));
    setReplyingTo({
      messageId: msg._id,
      senderName,
      textPreview: msg.text?.slice(0, 100) || ''
    });
  };

  const handleReact = (msg, emoji) => {
    if (!activeConv) return;
    reactMutation.mutate({ convId: activeConv._id, msgId: msg._id, emoji });
  };

  const handleSendWithReply = (e) => {
    e.preventDefault();
    if (!messageText.trim() || !activeConv) return;
    // Pass replyTo context up to parent via a custom event or by wrapping
    handleSendMessage(e, replyingTo);
    setReplyingTo(null);
    // Force scroll to bottom immediately after sending
    setTimeout(scrollToBottom, 50);
  };

  // Group reactions by emoji
  const groupReactions = (reactions = []) => {
    const map = {};
    reactions.forEach(r => {
      const emoji = r.emoji;
      if (!map[emoji]) map[emoji] = { emoji, count: 0, reacted: false };
      map[emoji].count++;
      const myId = user?._id?.toString() || user?.id?.toString();
      if (r.userId?._id?.toString() === myId || r.userId?.toString() === myId) {
        map[emoji].reacted = true;
      }
    });
    return Object.values(map);
  };

  if (!activeConv) {
    return (
      <div className={styles.emptyChat}>
        <MessageCircle size={64} className={styles.emptyChatIcon} />
        <h3>Select a conversation</h3>
        <p>Choose a friend or team to start collaborating.</p>
      </div>
    );
  }

  const isTeam = activeConv.type === 'TEAM';
  const myId = user?._id?.toString() || user?.id?.toString();
  
  // Try to determine the other person in a Direct Message to show their avatar
  let otherParticipant = null;
  if (!isTeam && activeConv.participants) {
    otherParticipant = activeConv.participants.find(p => p._id !== myId && p.toString() !== myId);
  }
  const chatName = getConversationName(activeConv);
  const avatarChar = chatName ? chatName.charAt(0).toUpperCase() : 'U';

  const pinnedMessages = messages.filter(m => m.isPinned);
  let validOffset = activePinIndexOffset;
  if (validOffset >= pinnedMessages.length) validOffset = 0;
  
  const displayPinnedIndex = pinnedMessages.length > 0 ? pinnedMessages.length - 1 - validOffset : -1;
  const latestPinned = displayPinnedIndex >= 0 ? pinnedMessages[displayPinnedIndex] : null;

  return (
    <div className={styles.chatContainer}>
      {/* Header */}
      <div className={styles.chatHeader}>
        <div className={styles.headerInfo}>
          <div className={styles.chatAvatar}>
            {isTeam ? <Users size={24} /> : <span>{avatarChar}</span>}
          </div>
          <div className={styles.chatTitleBlock}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h3 className={styles.chatTitle}>{chatName}</h3>
              {/* Focus mode indicator / Online badge can go here */}
              {!isTeam && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981' }} title="Online"></div>}
            </div>
            {isTeam ? <span className={styles.teamTag}>Team Chat</span> : <span style={{ fontSize: '0.75rem', color: '#64748B' }}>Direct Message</span>}
          </div>
        </div>
      </div>

      {/* Pinned Banner */}
      {latestPinned && (
        <div 
          className={styles.pinnedBanner} 
          onClick={() => {
            const el = document.getElementById(`message-${latestPinned._id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add(styles.highlightMessage);
              setTimeout(() => el.classList.remove(styles.highlightMessage), 2000);
            }
            if (pinnedMessages.length > 1) {
              setActivePinIndexOffset(prev => (prev + 1) % pinnedMessages.length);
            }
          }}
        >
          <Pin size={16} className={styles.pinnedBannerIcon} />
          <div className={styles.pinnedBannerContent}>
            <span className={styles.pinnedBannerTitle}>Pinned Message</span>
            <span className={styles.pinnedBannerText}>
              {latestPinned.text || (latestPinned.notificationSnapshot ? latestPinned.notificationSnapshot.title : '')}
            </span>
          </div>
          {pinnedMessages.length > 1 && (
            <div className={styles.pinnedBannerCount}>
              {validOffset + 1}/{pinnedMessages.length}
            </div>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div className={styles.messagesContainer} ref={containerRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <p className={styles.emptyText}>No messages yet. Start the conversation!</p>
        ) : (
          messages.map((msg, index) => {
            const senderIdStr = msg.senderId?._id?.toString() || msg.senderId?.toString() || '';
            const isMe = senderIdStr === myId;
            const isSystem = msg.senderModel === 'System' || !msg.senderId;
            const isAdmin = isTeam && activeConv.teamId?.adminId === senderIdStr;
            const grouped = groupReactions(msg.reactions || []);

            // Message Grouping Logic
            let showHeader = true;
            let showTail = true;
            if (index > 0) {
              const prevMsg = messages[index - 1];
              const prevSenderStr = prevMsg.senderId?._id?.toString() || prevMsg.senderId?.toString() || '';
              // If same sender and within 5 minutes, group them
              const timeDiff = new Date(msg.createdAt) - new Date(prevMsg.createdAt);
              if (prevSenderStr === senderIdStr && !isSystem && prevMsg.senderModel !== 'System' && timeDiff < 5 * 60000) {
                showHeader = false;
              }
            }
            if (index < messages.length - 1) {
              const nextMsg = messages[index + 1];
              const nextSenderStr = nextMsg.senderId?._id?.toString() || nextMsg.senderId?.toString() || '';
              const timeDiffNext = new Date(nextMsg.createdAt) - new Date(msg.createdAt);
              if (nextSenderStr === senderIdStr && !isSystem && nextMsg.senderModel !== 'System' && timeDiffNext < 5 * 60000) {
                showTail = false;
              }
            }

            if (isSystem) {
              // ── System message (from "Share to Chat") ──
              return (
                <div key={msg._id} id={`message-${msg._id}`} className={styles.systemMessageWrapper}
                  onContextMenu={(e) => handleContextMenu(e, msg)}>
                  <div className={styles.systemMessage}>
                    <div className={styles.systemHeader}>
                      {msg.notificationSnapshot?.type?.includes('ALERT') || msg.notificationSnapshot?.type?.includes('RISK') || msg.notificationSnapshot?.type?.includes('BOTTLENECK')
                        ? <AlertTriangle size={14} className={styles.systemIconWarn} />
                        : <TrendingUp size={14} className={styles.systemIconGood} />
                      }
                      <span className={styles.systemLabel}>
                        {msg.notificationSnapshot?.title || 'System Update'}
                      </span>
                    </div>
                    <p className={styles.systemText}>{msg.notificationSnapshot?.message || msg.text}</p>
                    {/* Rich stats block */}
                    {msg.notificationSnapshot?.stats && (
                      <div className={styles.statsBlock}>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Commitment</span>
                          <span className={styles.statValue}>{msg.notificationSnapshot.stats.commitmentTitle}</span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Progress</span>
                          <span className={styles.statValue}>{msg.notificationSnapshot.stats.progress}%</span>
                        </div>
                        {msg.notificationSnapshot.stats.riskScore != null && (
                          <div className={styles.statRow}>
                            <span className={styles.statLabel}>Risk Score</span>
                            <span className={`${styles.statValue} ${msg.notificationSnapshot.stats.riskScore >= 75 ? styles.statDanger : msg.notificationSnapshot.stats.riskScore >= 50 ? styles.statWarning : styles.statSafe}`}>
                              {msg.notificationSnapshot.stats.riskScore}%
                            </span>
                          </div>
                        )}
                        {msg.notificationSnapshot.stats.riskBreakdown && (
                          <div className={styles.statRow} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                            <span className={styles.statLabel} style={{ marginBottom: '0.2rem' }}>Risk Factors</span>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', width: '100%', fontSize: '0.75rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(239, 68, 68, 0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                                <span style={{ color: '#EF4444' }}>Time:</span>
                                <strong>{Math.round(msg.notificationSnapshot.stats.riskBreakdown.timePressure || 0)}%</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(245, 158, 11, 0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                                <span style={{ color: '#F59E0B' }}>Workload:</span>
                                <strong>{Math.round(msg.notificationSnapshot.stats.riskBreakdown.workloadDensity || 0)}%</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(59, 130, 246, 0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                                <span style={{ color: '#3B82F6' }}>Reliability:</span>
                                <strong>{Math.round(msg.notificationSnapshot.stats.riskBreakdown.historicalReliability || 0)}%</strong>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(139, 92, 246, 0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                                <span style={{ color: '#8B5CF6' }}>Recommit:</span>
                                <strong>{Math.round(msg.notificationSnapshot.stats.riskBreakdown.recommitFrequency || 0)}%</strong>
                              </div>
                            </div>
                          </div>
                        )}
                        <div className={styles.statRow} style={{ marginTop: '0.4rem' }}>
                          <span className={styles.statLabel}>Days Left</span>
                          <span className={styles.statValue}>{msg.notificationSnapshot.stats.daysLeft}d</span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Hours Done / Total</span>
                          <span className={styles.statValue}>
                            {msg.notificationSnapshot.stats.hoursCompleted}h / {msg.notificationSnapshot.stats.totalHours}h
                          </span>
                        </div>
                      </div>
                    )}

                    {/* ── Team risk analytics card ── */}
                    {msg.notificationSnapshot?.stats?.teamRiskScore != null && (
                      <div className={styles.statsBlock}>
                        {/* Team name + commitment */}
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Team</span>
                          <span className={styles.statValue}>{msg.notificationSnapshot.stats.teamName}</span>
                        </div>
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Commitment</span>
                          <span className={styles.statValue}>{msg.notificationSnapshot.stats.commitmentTitle}</span>
                        </div>

                        {/* Team risk score */}
                        <div className={styles.statRow}>
                          <span className={styles.statLabel}>Team Risk Score</span>
                          <span className={`${styles.statValue} ${
                            msg.notificationSnapshot.stats.teamRiskScore >= 85 ? styles.statDanger
                            : msg.notificationSnapshot.stats.teamRiskScore >= 70 ? styles.statWarning
                            : styles.statSafe}`}>
                            {msg.notificationSnapshot.stats.teamRiskScore}%
                          </span>
                        </div>

                        {/* Key team metrics */}
                        <div className={styles.statRow} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                          <span className={styles.statLabel} style={{ marginBottom: '0.2rem' }}>Team Overview</span>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', width: '100%', fontSize: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(239,68,68,0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                              <span style={{ color: '#EF4444' }}>Bottlenecks:</span>
                              <strong>{msg.notificationSnapshot.stats.bottleneckCount ?? 0}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(245,158,11,0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                              <span style={{ color: '#F59E0B' }}>Critical Path:</span>
                              <strong>{msg.notificationSnapshot.stats.criticalPathCount ?? 0} tasks</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(239,68,68,0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                              <span style={{ color: '#EF4444' }}>High-Risk Members:</span>
                              <strong>{msg.notificationSnapshot.stats.highRiskMemberCount ?? 0} / {msg.notificationSnapshot.stats.memberCount ?? '?'}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(99,102,241,0.05)', padding: '0.3rem', borderRadius: '4px' }}>
                              <span style={{ color: '#6366F1' }}>Days Left:</span>
                              <strong>{msg.notificationSnapshot.stats.daysLeft}d</strong>
                            </div>
                          </div>
                        </div>

                        {/* Risk factor badges */}
                        {msg.notificationSnapshot.stats.riskFactors?.length > 0 && (
                          <div className={styles.statRow} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.4rem', paddingTop: '0.4rem', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                            <span className={styles.statLabel} style={{ marginBottom: '0.2rem' }}>Risk Factors</span>
                            {msg.notificationSnapshot.stats.riskFactors.map((rf, idx) => (
                              <div key={idx} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', padding: '0.25rem 0.4rem', borderRadius: '4px', background: rf.severity === 'CRITICAL' ? 'rgba(239,68,68,0.08)' : rf.severity === 'HIGH' ? 'rgba(245,158,11,0.08)' : 'rgba(100,116,139,0.06)' }}>
                                <span style={{ color: rf.severity === 'CRITICAL' ? '#EF4444' : rf.severity === 'HIGH' ? '#F59E0B' : '#64748B' }}>
                                  {(rf.factor || '').replace(/_/g, ' ')}
                                </span>
                                <span style={{ fontWeight: 700, fontSize: '0.68rem', padding: '0.1rem 0.35rem', borderRadius: '3px', background: rf.severity === 'CRITICAL' ? '#EF4444' : rf.severity === 'HIGH' ? '#F59E0B' : '#64748B', color: '#fff' }}>
                                  {rf.severity}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <span className={styles.systemTime}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {' · '}Right-click to reply
                    </span>
                  </div>
                  {/* Reactions */}
                  {grouped.length > 0 && (
                    <div className={styles.reactionsRow}>
                      {grouped.map(r => (
                        <button key={r.emoji} className={`${styles.reactionPill} ${r.reacted ? styles.reactionPillActive : ''}`}
                          onClick={() => handleReact(msg, r.emoji)}>
                          {r.emoji} {r.count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={msg._id} id={`message-${msg._id}`} className={`${styles.messageWrapper} ${isMe ? styles.messageMe : styles.messageThem} ${!showTail ? styles.groupedMsg : ''}`}
                onContextMenu={(e) => handleContextMenu(e, msg)}>

                <div className={styles.messageContent}>
                  {showHeader && (
                    <div className={styles.senderHeader}>
                      {isMe ? (
                        <span className={styles.senderName} style={{ color: '#007AFF', fontWeight: 'bold' }}>You</span>
                      ) : (
                        <>
                          <span className={styles.senderName}>{msg.senderId?.name || 'Unknown'}</span>
                          {isAdmin && <span className={styles.adminBadge}>Admin</span>}
                        </>
                      )}
                      {msg.isPinned && <span className={styles.pinnedBadge}>📌 Pinned</span>}
                    </div>
                  )}

                  {/* WhatsApp-style reply quote */}
                  {msg.replyTo?.messageId && (
                    <div className={`${styles.replyQuote} ${isMe ? styles.replyQuoteMe : styles.replyQuoteThem}`}>
                      <span className={styles.replyQuoteSender}>{msg.replyTo.senderName}</span>
                      <span className={styles.replyQuoteText}>{msg.replyTo.textPreview}</span>
                    </div>
                  )}

                  <div className={`${styles.messageBubble} ${!showTail ? styles.bubbleNoTail : ''}`}>
                    {msg.text}
                  </div>
                  
                  {/* Status row (Time + Read receipt for me) */}
                  <div className={styles.messageStatusRow}>
                    <span className={styles.messageTime}>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isMe && <CheckCheck size={12} className={styles.readReceipt} />}
                  </div>

                  {/* Emoji Reactions */}
                  {grouped.length > 0 && (
                    <div className={`${styles.reactionsRow} ${isMe ? styles.reactionsRowMe : ''}`}>
                      {grouped.map(r => (
                        <button key={r.emoji} className={`${styles.reactionPill} ${r.reacted ? styles.reactionPillActive : ''}`}
                          onClick={() => handleReact(msg, r.emoji)}>
                          {r.emoji} {r.count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        
        {/* Typing indicator slot */}
        <div className={styles.typingIndicatorSlot} style={{ minHeight: '1.5rem', margin: '0.5rem 0', fontStyle: 'italic', color: '#94A3B8', fontSize: '0.8rem' }}>
          {/* Future WebSocket "User is typing..." goes here */}
        </div>

        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to Bottom FAB */}
      {showScrollFab && (
        <button className={styles.scrollFab} onClick={scrollToBottom}>
          <ChevronDown size={20} />
        </button>
      )}

      {/* Quick Prompts */}
      {showQuickPrompts && activeConv.type === 'DIRECT' && !messageText.trim() && (
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0 1.5rem 1rem 1.5rem', flexWrap: 'wrap' }}>
          {['Hey, How is it going?', 'Did you hit your goal today?'].map(prompt => (
            <button key={prompt}
              style={{ padding: '0.5rem 1rem', borderRadius: '20px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10B981', color: '#059669', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem', fontFamily: 'Outfit, sans-serif', transition: 'all 0.2s' }}
              onClick={() => { setMessageText(prompt); setShowQuickPrompts(false); }}
            >
              <MessageCircle size={14} /> {prompt}
            </button>
          ))}
        </div>
      )}

      {/* Reply Bar */}
      {replyingTo && (
        <div className={styles.replyBar}>
          <CornerUpLeft size={15} className={styles.replyBarIcon} />
          <div className={styles.replyBarContent}>
            <span className={styles.replyBarSender}>Replying to {replyingTo.senderName}</span>
            <span className={styles.replyBarPreview}>{replyingTo.textPreview}</span>
          </div>
          <button className={styles.replyBarClose} onClick={() => setReplyingTo(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input Area — no pin button */}
      <div className={styles.chatInputArea}>
        <form onSubmit={handleSendWithReply} className={styles.chatForm}>
          <input 
            type="text" 
            placeholder="Type a message..." 
            className={styles.chatInput}
            value={messageText}
            onChange={(e) => {
              setMessageText(e.target.value);
              if (showQuickPrompts && e.target.value.trim().length > 0) setShowQuickPrompts(false);
            }}
          />
          <button type="submit" className={styles.sendBtn} disabled={!messageText.trim()}>
            <Send size={18} />
          </button>
        </form>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ChatContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          message={contextMenu.message}
          onClose={() => setContextMenu(null)}
          onPin={() => handlePin(contextMenu.message)}
          onReply={() => handleReply(contextMenu.message)}
          onReact={(emoji) => handleReact(contextMenu.message, emoji)}
        />
      )}
    </div>
  );
}
