import { Bookmark, ChevronDown, Pin, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PinnedPeriod } from '../../types'

interface Props {
  startDate: string
  endDate: string
  onChange: (start: string, end: string) => void
  actionButton?: React.ReactNode
}

// P123's full point-in-time history for testing starts 2004-01-01.
export const MAX_START_DATE = '2004-01-01'

const PRESETS = [
  { label: '5Y',  years: 5 },
  { label: '10Y', years: 10 },
  { label: '15Y', years: 15 },
  { label: '20Y', years: 20 },
  { label: 'Max', years: null as number | null },
]

function yearsAgo(n: number) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - n)
  return d.toISOString().slice(0, 10)
}

function presetStart(years: number | null) {
  return years === null ? MAX_START_DATE : yearsAgo(years)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

const STORAGE_KEY = 'p123_pinned_periods'

export default function DateRangePicker({ startDate, endDate, onChange, actionButton }: Props) {
  const [pinned, setPinned] = useState<PinnedPeriod[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') }
    catch { return [] }
  })
  const [pinName, setPinName] = useState('')
  const [showPinInput, setShowPinInput] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pinned))
  }, [pinned])

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function applyPreset(years: number | null) {
    onChange(presetStart(years), today())
  }

  function applyPinned(p: PinnedPeriod) {
    onChange(p.startDate, p.endDate)
  }

  function addPin() {
    if (!pinName.trim()) return
    const newPin: PinnedPeriod = {
      id: crypto.randomUUID(),
      name: pinName.trim(),
      startDate,
      endDate,
    }
    setPinned((prev) => [newPin, ...prev])
    setPinName('')
    setShowPinInput(false)
  }

  function removePin(id: string) {
    setPinned((prev) => prev.filter((p) => p.id !== id))
  }

  const isActivePreset = (years: number | null) =>
    startDate === presetStart(years) && endDate === today()

  const isActivePinned = (p: PinnedPeriod) =>
    startDate === p.startDate && endDate === p.endDate

  const activePinned = pinned.find((p) => isActivePinned(p))

  return (
    <div className="space-y-3">
      {/* Preset pills and Action Button */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(({ label, years }) => (
          <button
            key={label}
            type="button"
            onClick={() => applyPreset(years)}
            className={isActivePreset(years) ? 'pill-btn-active' : 'pill-btn'}
          >
            {label}
          </button>
        ))}

        {/* Pinned periods dropdown */}
        {pinned.length > 0 && (
          <div className="relative inline-block text-left" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setShowDropdown((v) => !v)}
              className={activePinned ? 'pill-btn-active' : 'pill-btn flex items-center gap-1'}
              title="Select pinned period"
            >
              <span>{activePinned ? activePinned.name : `Pinned (${pinned.length})`}</span>
              <ChevronDown size={12} className={activePinned ? 'text-[var(--pastel-blue-text)]' : 'text-slate-400'} />
            </button>
            {showDropdown && (
              <div className="absolute left-0 mt-1 w-64 rounded-none border border-[var(--border-color)] bg-[var(--card-bg)] shadow-none z-50 p-1 divide-y divide-[var(--border-color-light)] max-h-60 overflow-y-auto">
                {pinned.map((p) => {
                  const active = isActivePinned(p)
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between px-2.5 py-1.5 text-xs rounded-none transition-colors ${
                        active
                          ? 'bg-[var(--pastel-blue-bg)] text-[var(--pastel-blue-text)]'
                          : 'text-[var(--text-main)] hover:bg-[var(--border-color-light)]/20'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          applyPinned(p)
                          setShowDropdown(false)
                        }}
                        className="flex-1 text-left"
                      >
                        <span className="block font-semibold truncate max-w-[190px]">{p.name}</span>
                        <span className={`block text-[10px] ${active ? 'text-[var(--pastel-blue-text)]/80' : 'text-[var(--text-muted)]'}`}>
                          {formatDate(p.startDate)} – {formatDate(p.endDate)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          removePin(p.id)
                        }}
                        className={`ml-2 p-1 rounded-none transition-colors ${
                          active
                            ? 'text-[var(--pastel-red-text)] hover:bg-[var(--pastel-red-bg)]/20'
                            : 'text-[var(--pastel-red-text)] hover:bg-[var(--pastel-red-bg)]'
                        }`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowPinInput((v) => !v)}
          className="pill-btn shrink-0 flex items-center gap-1"
          title="Pin current period"
        >
          <Pin size={13} />
          <span>Pin</span>
        </button>

        {actionButton}
      </div>

      {/* Pin name input */}
      {showPinInput && (
        <div className="flex gap-2">
          <input
            type="text"
            value={pinName}
            onChange={(e) => setPinName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPin()}
            placeholder="Period name…"
            className="input-base flex-1"
            autoFocus
          />
          <button type="button" onClick={addPin} className="btn-primary py-1.5 text-xs">
            <Bookmark size={13} /> Save
          </button>
          <button type="button" onClick={() => setShowPinInput(false)} className="btn-ghost py-1.5">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Date inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label mb-1.5">Start</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onChange(e.target.value, endDate)}
            max={endDate}
            className="input-base"
          />
        </div>
        <div>
          <label className="label mb-1.5">End</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onChange(startDate, e.target.value)}
            min={startDate}
            max={today()}
            className="input-base"
          />
        </div>
      </div>
    </div>
  )
}
