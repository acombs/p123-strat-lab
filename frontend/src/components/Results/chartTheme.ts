// Recharts' default tooltip is white-on-white in dark mode — every chart's
// Tooltip should spread these props so hover cards match the app theme.
export const TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: 'var(--card-bg)',
    border: '1px solid var(--border-color)',
    borderRadius: 0,
    fontSize: 12,
  },
  labelStyle: { color: 'var(--text-main)', fontWeight: 600 },
  itemStyle: { color: 'var(--text-main)' },
} as const

// Hover treatment for bar charts: no cursor rectangle (it renders as a glaring
// column on the dark theme) — outline the hovered bar instead.
export const BAR_ACTIVE = {
  fill: 'var(--chart-benchmark)',
  stroke: 'var(--chart-portfolio)',
  strokeWidth: 1.5,
} as const
