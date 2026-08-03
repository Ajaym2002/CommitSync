import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Pin, PinOff, CornerUpLeft, Plus } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import styles from './ChatContextMenu.module.css';

const EMOJI_OPTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const PICKER_WIDTH = 280;
const PICKER_HEIGHT = 300;

export default function ChatContextMenu({ x, y, message, onClose, onPin, onReply, onReact }) {
  const menuRef = useRef(null);
  const plusBtnRef = useRef(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerStyle, setPickerStyle] = useState({});

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }
    function handleEscape(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay in viewport and expand inwards
  const isRightSide = x > window.innerWidth / 2;
  const isBottom = y > window.innerHeight / 2;

  const style = {
    top: isBottom ? undefined : y,
    bottom: isBottom ? window.innerHeight - y : undefined,
    left: isRightSide ? undefined : x,
    right: isRightSide ? window.innerWidth - x : undefined,
    transformOrigin: `${isRightSide ? 'right' : 'left'} ${isBottom ? 'bottom' : 'top'}`,
    flexDirection: isBottom ? 'column-reverse' : 'column'
  };

  // Compute picker position so it always stays within the viewport
  const computePickerStyle = useCallback(() => {
    if (!plusBtnRef.current) return;
    const btnRect = plusBtnRef.current.getBoundingClientRect();
    // clientWidth/clientHeight excludes scrollbar — more accurate than innerWidth/innerHeight
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const margin = 8;

    // Horizontal: right-align to the + button so the picker opens leftward.
    // This prevents overflow when the context menu is on the right side of the screen.
    let left = btnRect.right - PICKER_WIDTH;
    // If that pushes it past the left edge, clamp to the left margin
    if (left < margin) left = margin;
    // Final safety clamp: if somehow still too wide, push it left from the right edge
    if (left + PICKER_WIDTH > vw - margin) {
      left = Math.max(margin, vw - PICKER_WIDTH - margin);
    }

    // Vertical: prefer below the button, flip above if not enough space
    let top = btnRect.bottom + 4;
    if (top + PICKER_HEIGHT > vh - margin) {
      top = Math.max(margin, btnRect.top - PICKER_HEIGHT - 4);
    }

    setPickerStyle({ top, left });
  }, []);

  return createPortal(
    <div className={styles.menuWrapper} style={style} ref={menuRef}>
      <div className={styles.menu}>
        {/* Emoji Reactions */}
        <div className={styles.emojiRow}>
          {EMOJI_OPTIONS.map(emoji => (
            <button
              key={emoji}
              className={styles.emojiBtn}
              onClick={() => { onReact(emoji); onClose(); }}
              title={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
          <button
            ref={plusBtnRef}
            className={styles.emojiBtn}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => {
              if (!showPicker) computePickerStyle();
              setShowPicker(!showPicker);
            }}
            title="More emojis"
          >
            <Plus size={16} color="#64748B" />
          </button>
        </div>
        <div className={styles.divider} />
        {/* Actions */}
        <button className={styles.menuItem} onClick={() => { onReply(); onClose(); }}>
          <CornerUpLeft size={15} />
          Reply
        </button>
        <button className={styles.menuItem} onClick={() => { onPin(); onClose(); }}>
          {message.isPinned ? <PinOff size={15} /> : <Pin size={15} />}
          {message.isPinned ? 'Unpin message' : 'Pin message'}
        </button>
      </div>

      {showPicker && createPortal(
        <div
          className={styles.pickerContainer}
          style={{
            position: 'fixed',
            zIndex: 10000,
            ...pickerStyle
          }}
        >
          <EmojiPicker 
            onEmojiClick={(emojiData) => {
              onReact(emojiData.emoji);
              onClose();
            }}
            autoFocusSearch={false}
            skinTonesDisabled
            searchDisabled
            width={PICKER_WIDTH}
            height={PICKER_HEIGHT}
          />
        </div>,
        document.body
      )}
    </div>,
    document.body
  );
}
