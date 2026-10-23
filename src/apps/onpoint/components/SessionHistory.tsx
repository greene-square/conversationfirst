import { MicrophoneIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { InterviewSession } from '../lib/types'
import { formatDuration } from '../lib/storage'

interface SessionHistoryProps {
  sessions: InterviewSession[]
  loading: boolean
  onNewSession: () => void
  onSelectSession: (session: InterviewSession) => void
  onDeleteSession: (sessionId: string) => void
  hasDeepgramKey: boolean
  usingSampleExamples?: boolean
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-IE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function SessionHistory({
  sessions,
  loading,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  hasDeepgramKey,
  usingSampleExamples = false,
}: SessionHistoryProps) {
  return (
    <>
      <div className="op-history-header">
        <div>
          <span className="op-history-kicker">Interview coach</span>
          <h1 className="op-history-title">OnPoint</h1>
          <p className="op-history-desc">
            Real-time coaching that listens for questions and surfaces your best examples.
          </p>
        </div>
        <button
          className="op-btn-primary"
          onClick={onNewSession}
          disabled={!hasDeepgramKey}
        >
          <MicrophoneIcon width={16} height={16} aria-hidden="true" />
          New call
        </button>
      </div>

      {!hasDeepgramKey && (
        <div className="op-setup-hint">
          Add your Deepgram API key in the vault to get started. Get one free at deepgram.com
        </div>
      )}

      {usingSampleExamples && (
        <div className="op-setup-hint">
          Matching against sample answers. Import your own with scripts/seed-onpoint-examples.mjs.
        </div>
      )}

      {loading ? (
        <div className="op-session-table-wrapper">
          <div className="cf-loading">
            <span className="cf-loading-cursor" aria-hidden="true" />
            <span className="cf-loading-text">Loading&hellip;</span>
          </div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="op-session-table-wrapper">
          <div className="cf-empty">
            <MicrophoneIcon className="cf-empty-icon" aria-hidden="true" />
            <p className="cf-empty-title">No sessions yet</p>
            <p className="cf-empty-desc">Start a new call to begin coaching.</p>
          </div>
        </div>
      ) : (
        <div className="op-session-table-wrapper">
          <table className="op-session-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th className="col-num">Questions</th>
                <th className="col-num">Duration</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sessions.map(session => (
                <tr
                  key={session.id}
                  onClick={() => onSelectSession(session)}
                >
                  <td className="op-cell-date">
                    <span className="op-cell-date-day">{formatDate(session.startedAt)}</span>
                    <span className="op-cell-date-time">{formatTime(session.startedAt)}</span>
                  </td>
                  <td className="op-cell-title">{session.title}</td>
                  <td className="col-num op-cell-mono">{session.questions.length}</td>
                  <td className="col-num op-cell-mono">
                    {formatDuration(session.startedAt, session.endedAt)}
                  </td>
                  <td>
                    {session.status === 'active' ? (
                      <span className="op-status-badge op-status-active">
                        <span className="status-dot op-dot-listening" />
                        Live
                      </span>
                    ) : (
                      <span className="op-status-badge op-status-completed">Completed</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="op-btn-icon op-delete-btn"
                      onClick={e => {
                        e.stopPropagation()
                        onDeleteSession(session.id)
                      }}
                      aria-label={`Delete session ${session.title}`}
                    >
                      <TrashIcon width={14} height={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
