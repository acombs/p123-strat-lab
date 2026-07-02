import { BarChart2, Bookmark, History, Moon, Settings, Sun, Zap } from 'lucide-react'
import type { QuotaInfo } from '../types'

interface Props {
  dark: boolean
  onToggleDark: () => void
  onOpenSaved: () => void
  onOpenSettings: () => void
  onOpenHistory: () => void
  quota: QuotaInfo | null
}

const LOW_QUOTA_THRESHOLD = 500

export default function Header({ dark, onToggleDark, onOpenSaved, onOpenSettings, onOpenHistory, quota }: Props) {
  const remaining = quota?.quotaRemaining
  const low = typeof remaining === 'number' && remaining < LOW_QUOTA_THRESHOLD

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-color)] bg-[var(--paper-bg)]">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-4 py-3 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-none bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] border border-[var(--border-color)]">
            <BarChart2 size={18} strokeWidth={2.5} />
          </div>
          <span className="text-base font-bold tracking-tight text-[var(--text-main)]">
            P123 Strategy Lab
          </span>
        </div>

        <div className="flex items-center gap-1">
          {typeof remaining === 'number' && (
            <div
              className={`mr-2 hidden items-center gap-1.5 border px-2.5 py-1 text-xs font-semibold rounded-none dark:rounded-[0.25rem] sm:flex ${
                low
                  ? 'border-[var(--border-color)] bg-[var(--pastel-red-bg)] text-[var(--pastel-red-text)]'
                  : 'border-[var(--border-color-light)] text-[var(--text-muted)]'
              }`}
              title={`API credits left this month${quota?.lastCost != null ? ` — last call cost ${quota.lastCost}` : ''}`}
            >
              <Zap size={12} />
              <span className="font-mono tabular-nums">{remaining.toLocaleString()}</span>
              <span className="hidden lg:inline text-[10px] font-normal uppercase tracking-wider">credits</span>
            </div>
          )}
          <button onClick={onOpenHistory} className="btn-ghost" title="Run history">
            <History size={16} />
            <span className="hidden sm:inline">History</span>
          </button>
          <button onClick={onOpenSaved} className="btn-ghost">
            <Bookmark size={16} />
            <span className="hidden sm:inline">Saved</span>
          </button>
          <button onClick={onOpenSettings} className="btn-ghost" aria-label="Settings" title="Settings">
            <Settings size={16} />
          </button>
          <button onClick={onToggleDark} className="btn-ghost" aria-label="Toggle theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  )
}
