/**
 * CommitSync Brand Logo
 *
 * Props:
 *   variant  — "light" (dark mark on light bg) | "dark" (white mark on dark bg)
 *   size     — icon height in px (wordmark scales proportionally)
 *   iconOnly — render just the mark, no wordmark (e.g. for favicon)
 *   className / style — passthrough
 *
 * Mark concept:
 *   Two sync-rotation arrows (arcs + arrowheads) arranged diagonally —
 *   one sweeping top-left, one sweeping bottom-right — forming an
 *   interlocked rotation symbol. A bold commit-tick in orange (#D35400)
 *   cuts across both arcs at the centre, reading as ✓ and bridging
 *   "Commit" → "Sync".
 *
 * Wordmark:
 *   "Commit" — Libre Baskerville Bold (editorial, authoritative)
 *   "Sync"   — Libre Baskerville Italic, #D35400 (dynamic, accent)
 */
import React from 'react';

const BLUE = '#2563EB';

export default function CommitSyncLogo({
  variant = 'light',
  size = 36,
  iconOnly = false,
  className = '',
  style = {},
}) {
  const isDark  = variant === 'dark';
  // 'light' variant = light mark on light bg (NotFound, LoadingScreen)
  // 'dark'  variant = white mark on dark bg  (Navbar, Marketing hero — default)
  const rings   = isDark ? '#FFFFFF' : '#1A1D20';
  const wdMain  = isDark ? '#FFFFFF' : '#1A1D20';

  // Wordmark SVG intrinsic dimensions
  // "Commit" at fontSize 21 Libre Baskerville ≈ 95px wide
  // " " gap = 8px → "Sync" starts at x=103
  // "Sync" ≈ 56px wide → total ≈ 159px
  const WM_W = 162;
  const WM_H = 28;
  const wmH  = Math.round(size * 0.61);
  const wmW  = Math.round(WM_W * wmH / WM_H);

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.45rem',
        userSelect: 'none',
        lineHeight: 1,
        ...style,
      }}
      aria-label="CommitSync"
    >
      {/* ══════════════ ICON MARK — 44×44 viewBox ══════════════ */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 44 44"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0, display: 'block' }}
      >
        {/*
          ARC 1 — upper-left rotation arrow
          ────────────────────────────────────────────────────────
          Circle centred at (13, 14), radius 9.
          We draw about 270° of it (the open side faces bottom-right).
          Path: start at the bottom of the circle (13, 23),
          sweep clockwise through left, top, right,
          end at the rightmost point (22, 14).
          SVG arc: rx ry x-rotation large-arc-flag sweep-flag x y
          sweep=1 → clockwise, large-arc-flag=1 → take the long way.
        */}
        <path
          d="M 13 23 A 9 9 0 1 1 22 14"
          stroke={rings}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        {/* Arrowhead at (22, 14) — tip points upward (arc arrives from right travelling upward) */}
        <polyline
          points="19,11  22,14  25,11"
          stroke={rings}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/*
          ARC 2 — lower-right rotation arrow
          ────────────────────────────────────────────────────────
          Mirror of Arc 1.
          Circle centred at (31, 30), radius 9.
          Start at top (31, 21), sweep clockwise through right, bottom, left,
          end at leftmost point (22, 30).
        */}
        <path
          d="M 31 21 A 9 9 0 1 1 22 30"
          stroke={rings}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        {/* Arrowhead at (22, 30) — tip points downward */}
        <polyline
          points="19,33  22,30  25,33"
          stroke={rings}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/*
          COMMIT TICK — the brand signature
          ────────────────────────────────────────────────────────
          A confident bold ✓ drawn diagonally across both arcs,
          slightly offset up-left to cut through Arc 1's body
          and Arc 2's body symmetrically.

          Short leg: (12, 22) → (18, 28.5)
          Long leg:  (18, 28.5) → (32, 13)
        */}
        <polyline
          points="12,22  18,28.5  32,13"
          stroke={BLUE}
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>

      {/* ══════════════ WORDMARK ══════════════ */}
      {!iconOnly && (
        <svg
          width={wmW}
          height={wmH}
          viewBox={`0 0 ${WM_W} ${WM_H}`}
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          style={{ flexShrink: 0, display: 'block', overflow: 'visible' }}
        >
          {/* "Commit" — bold, dark/white */}
          <text
            x="0"
            y="22"
            fontFamily="'Libre Baskerville', Georgia, 'Times New Roman', serif"
            fontWeight="700"
            fontSize="21"
            fill={wdMain}
            letterSpacing="0.2"
          >
            Commit
          </text>

          {/* "Sync" — italic, always orange — starts after "Commit" with a space */}
          <text
            x="95"
            y="22"
            fontFamily="'Libre Baskerville', Georgia, 'Times New Roman', serif"
            fontWeight="900"
            fontSize="26"
            fill={BLUE}
            letterSpacing="0.2"
          >
            Sync
          </text>
        </svg>
      )}
    </span>
  );
}
