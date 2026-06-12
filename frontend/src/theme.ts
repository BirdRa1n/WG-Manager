export const C = {
  // Backgrounds
  bg:       '#070d1a',
  surface:  '#0d1520',
  surface2: '#111e30',
  surface3: '#162340',
  border:   '#1a2d45',
  border2:  '#243a55',

  // Text
  text:     '#e8f0ff',
  text2:    '#7a9abf',
  muted:    '#3d5a7a',

  // Accents
  blue:    '#3b82f6',
  blueL:   '#60a5fa',
  green:   '#10b981',
  greenL:  '#34d399',
  yellow:  '#f59e0b',
  yellowL: '#fbbf24',
  red:     '#ef4444',
  redL:    '#f87171',
  purple:  '#8b5cf6',
  purpleL: '#a78bfa',
  cyan:    '#06b6d4',
  cyanL:   '#22d3ee',

  // Gradients
  gradBlue:   'linear-gradient(135deg, #1e3a5f 0%, #0d1520 100%)',
  gradGreen:  'linear-gradient(135deg, #064e3b 0%, #0d1520 100%)',
  gradPurple: 'linear-gradient(135deg, #2e1065 0%, #0d1520 100%)',
  gradYellow: 'linear-gradient(135deg, #451a03 0%, #0d1520 100%)',
} as const

export const shadow = {
  sm:  '0 1px 3px rgba(0,0,0,0.4)',
  md:  '0 4px 12px rgba(0,0,0,0.5)',
  lg:  '0 8px 24px rgba(0,0,0,0.6)',
  glow: (color: string) => `0 0 20px ${color}33`,
} as const

export const card: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
  padding: 20,
}

export const cardElevated: React.CSSProperties = {
  background: C.surface2,
  border: `1px solid ${C.border2}`,
  borderRadius: 12,
  padding: 20,
  boxShadow: shadow.md,
}

import React from 'react'
