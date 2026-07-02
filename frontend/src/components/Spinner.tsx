export default function Spinner({ size = 40 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center gap-4 w-64 max-w-full text-center">
      <div className="w-full border-2 border-[var(--border-color)] h-6 p-0.5 bg-[var(--paper-bg)]">
        <div
          className="h-full bg-[var(--border-color-light)] animate-progress-hatch"
          style={{
            backgroundImage: 'linear-gradient(45deg, var(--border-color) 25%, transparent 25%, transparent 50%, var(--border-color) 50%, var(--border-color) 75%, transparent 75%, transparent)',
            backgroundSize: '32px 32px'
          }}
          role="progressbar"
          aria-label="Loading"
        />
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] animate-pulse">
        Running backtest…
      </p>
    </div>
  )
}
