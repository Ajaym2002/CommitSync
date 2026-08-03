import React, { useState, useEffect } from 'react';
import { 
  DndContext, 
  useDraggable, 
  useDroppable, 
  closestCenter, 
  useSensor,
  useSensors,
  MouseSensor,
  TouchSensor,
  rectIntersection
} from '@dnd-kit/core';
import { Check, X } from 'lucide-react';
import styles from './AccountabilityDragDrop.module.css';

function ReliabilityRing({ score, totalCommitments, size = 80 }) {
  const hasData = score !== null && score !== undefined && totalCommitments >= 5;

  // Ring geometry
  const strokeWidth = 7;
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  // Target offset = how much of the arc is HIDDEN (the rest is drawn)
  const targetOffset = hasData
    ? circumference * (1 - Math.min(Math.max(score, 0), 100) / 100)
    : circumference;

  // Animate from fully-hidden (circumference) → target on mount
  const [displayOffset, setDisplayOffset] = useState(circumference);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDisplayOffset(targetOffset));
    return () => cancelAnimationFrame(raf);
  }, [targetOffset]);

  // Color palette — vivid, high-contrast
  let ringColor, gradId;
  if (!hasData) {
    ringColor = '#94A3B8'; gradId = 'ringGradNone';
  } else if (score >= 75) {
    ringColor = '#10B981'; gradId = 'ringGradGreen';
  } else if (score >= 50) {
    ringColor = '#6366F1'; gradId = 'ringGradIndigo';
  } else {
    ringColor = '#F97316'; gradId = 'ringGradOrange';
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        transform: 'rotate(-90deg)',
        pointerEvents: 'none'
      }}
    >
      <defs>
        <linearGradient id={`${gradId}_a`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={ringColor} stopOpacity="1" />
          <stop offset="100%" stopColor={ringColor} stopOpacity="0.65" />
        </linearGradient>
        <filter id={`${gradId}_glow`} x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Dark shadow ring — gives depth and makes white track pop */}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth={strokeWidth + 2}
      />
      {/* White track — full circle, always visible as outline */}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.65)"
        strokeWidth={strokeWidth}
      />

      {/* Partial progress arc — length driven by score */}
      {hasData && (
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={`url(#${gradId}_a)`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={displayOffset}
          filter={`url(#${gradId}_glow)`}
          style={{ transition: 'stroke-dashoffset 0.85s cubic-bezier(0.34, 1.2, 0.64, 1)' }}
        />
      )}
    </svg>
  );
}

function FriendBall({ friend }) {
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({
    id: `friend-${friend._id}`,
    data: { friend }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 9999,
  } : undefined;

  const score = friend.reliabilityScore;
  const hasData = score !== null && score !== undefined && (friend.totalCommitments || 0) >= 5;
  const scoreColor = hasData
    ? score >= 75 ? '#10B981' : score >= 50 ? '#6366F1' : '#F97316'
    : '#94A3B8';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.friendBall} ${isDragging ? styles.dragging : ''}`}
      {...listeners}
      {...attributes}
    >
      <button
        className={styles.removeFriendBtn}
        onClick={(e) => {
          e.stopPropagation();
          if (friend.onRemoveFriend) friend.onRemoveFriend(friend._id);
        }}
        title="Remove Friend"
      >
        <X size={10} />
      </button>

      {/* Ring + avatar */}
      <div
        className={styles.ringContainer}
        title={hasData ? `Reliability score: ${score}%` : 'Not enough data yet (need 5+ completed commitments)'}
      >
        <ReliabilityRing
          score={score}
          totalCommitments={friend.totalCommitments}
          size={80}
        />
        <div className={styles.avatarInner}>
          {friend.profilePicture ? (
            <img src={friend.profilePicture} alt={friend.name} />
          ) : (
            <span>{friend.name?.charAt(0) || 'U'}</span>
          )}
        </div>
      </div>

      <span className={styles.friendName}>{friend.name.split(' ')[0]}</span>

      {/* Reliability score — dark text, always readable */}
      {hasData && (
        <span className={styles.reliabilityLabel}>
          {score}%
        </span>
      )}
    </div>
  );
}


function CommitmentPot({ commitment, assignedFriends, onRemove }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `commitment-${commitment._id}`,
    data: { commitment }
  });

  const { populatedPartners = [], populatedPending = [] } = commitment;
  
  // Total assigned in UI is confirmed + pending + newly dragged
  const totalAssignedCount = populatedPartners.length + populatedPending.length + assignedFriends.length;
  const isFull = totalAssignedCount >= 3;

  return (
    <div 
      ref={setNodeRef} 
      className={`${styles.commitmentPot} ${isOver && !isFull ? styles.potHover : ''} ${isFull ? styles.potFull : ''}`}
    >
      <h4 className={styles.potTitle}>{commitment.title}</h4>
      <div className={styles.potCapacity}>{totalAssignedCount} / 3 Partners</div>
      
      <div className={styles.assignedArea}>
        {/* Render Confirmed Partners */}
        {populatedPartners.map(friend => (
          <div key={`confirmed-${friend._id}`} className={styles.assignedFriend}>
            <div className={styles.avatarMini}>
               {friend.profilePicture ? (
                <img src={friend.profilePicture} alt={friend.name} />
              ) : (
                <span>{friend.name?.charAt(0) || 'U'}</span>
              )}
            </div>
            {/* Cannot remove confirmed from this UI currently, need an unassign API. We just show them. */}
          </div>
        ))}
        
        {/* Render Pending Partners */}
        {populatedPending.map(friend => (
          <div key={`pending-${friend._id}`} className={styles.assignedFriend} style={{ opacity: 0.5 }}>
            <div className={styles.avatarMini}>
               {friend.profilePicture ? (
                <img src={friend.profilePicture} alt={friend.name} />
              ) : (
                <span>{friend.name?.charAt(0) || 'U'}</span>
              )}
            </div>
            <span style={{ fontSize: '0.6rem', position: 'absolute', bottom: '-15px', color: '#64748b' }}>Pending</span>
          </div>
        ))}

        {/* Render Newly Dragged Friends */}
        {assignedFriends.map(friend => (
          <div key={`new-${friend._id}`} className={styles.assignedFriend}>
            <div className={styles.avatarMini}>
               {friend.profilePicture ? (
                <img src={friend.profilePicture} alt={friend.name} />
              ) : (
                <span>{friend.name?.charAt(0) || 'U'}</span>
              )}
            </div>
            <button className={styles.removeBtn} onClick={() => onRemove(commitment._id, friend._id)}>
              <X size={12} />
            </button>
          </div>
        ))}
        
        {totalAssignedCount === 0 && (
          <div className={styles.emptySlotText}>Drop friends here</div>
        )}
      </div>
    </div>
  );
}

export default function AccountabilityDragDrop({ friends, commitments, onConfirm, onRemoveFriend }) {
  const [assignments, setAssignments] = useState({});
  const [activeFriend, setActiveFriend] = useState(null);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, 
        tolerance: 5,
      },
    })
  );

  const handleDragStart = (event) => {
    const { active } = event;
    if (active.data.current?.friend) {
      setActiveFriend(active.data.current.friend);
    }
  };

  const handleDragEnd = (event) => {
    setActiveFriend(null);
    const { active, over } = event;
    if (!over) return;

    const friend = active.data.current.friend;
    const commitment = over.data.current.commitment;

    setAssignments(prev => {
      const currentAssigned = prev[commitment._id] || [];
      const { populatedPartners = [], populatedPending = [] } = commitment;
      const totalAlready = populatedPartners.length + populatedPending.length;
      
      // Max 3 limit and prevent duplicates
      if (currentAssigned.length + totalAlready >= 3 || 
          currentAssigned.some(f => f._id === friend._id) ||
          populatedPartners.some(f => f._id === friend._id) ||
          populatedPending.some(f => f._id === friend._id)) {
        return prev;
      }
      return {
        ...prev,
        [commitment._id]: [...currentAssigned, friend]
      };
    });
  };

  const handleDragCancel = () => {
    setActiveFriend(null);
  };

  const handleRemove = (commitmentId, friendId) => {
    setAssignments(prev => ({
      ...prev,
      [commitmentId]: prev[commitmentId].filter(f => f._id !== friendId)
    }));
  };

  const hasChanges = Object.keys(assignments).some(k => assignments[k].length > 0);

  const submitAssignments = () => {
    onConfirm(assignments);
    setAssignments({});
  };

  return (
    <div className={styles.container}>
      <h3 className={styles.sectionTitle}>Your Friends</h3>

      <DndContext 
        sensors={sensors}
        collisionDetection={rectIntersection} 
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Friends Area */}
        <div className={styles.friendsSourceArea}>
          {(!friends || friends.length === 0) ? (
            <p className={styles.emptyFriends}>Your friends will appear here.</p>
          ) : (
            friends.map(friend => (
              <FriendBall 
                 key={friend._id} 
                 friend={{ ...friend, onRemoveFriend }} 
              />
            ))
          )}
        </div>

        {/* Commitments Area */}
        {commitments && commitments.length > 0 && (
          <div className={styles.potsContainer}>
            {commitments.map(commitment => (
               <CommitmentPot 
                 key={commitment._id} 
                 commitment={commitment} 
                 assignedFriends={assignments[commitment._id] || []}
                 onRemove={handleRemove}
               />
            ))}
          </div>
        )}
      </DndContext>

      {commitments && commitments.length > 0 && (
        <div className={styles.bottomInstruction}>
          <p>💡 Tip: Drag your friends into the commitments above to request them as accountability partners (Max 3 per goal).</p>
        </div>
      )}

      {hasChanges && (
        <div className={styles.confirmAction}>
          <button className={styles.confirmBtn} onClick={submitAssignments}>
            <Check size={18} /> Confirm Accountability Requests
          </button>
        </div>
      )}
    </div>
  );
}
