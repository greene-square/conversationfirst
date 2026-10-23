import { useState, useEffect } from 'react'
import { fetchConnections } from '../../lib/connections'
import type { Connection } from '../../lib/types'
import { loadSessions, saveSession, deleteSession } from './lib/storage'
import { loadExampleBank, type ExampleBank } from './lib/exampleStore'
import { SAMPLE_EXAMPLES } from './lib/sampleExamples'
import { getDefaultSettings } from './components/SettingsPanel'
import type { InterviewSession, OnPointView, OnPointSettings } from './lib/types'
import SessionHistory from './components/SessionHistory'
import ActiveSession from './components/ActiveSession'

interface OnPointProps {
  householdId: string | null
}

export default function OnPoint({ householdId }: OnPointProps) {
  const [view, setView] = useState<OnPointView>('history')
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [activeSession, setActiveSession] = useState<InterviewSession | null>(null)
  const [settings, setSettings] = useState<OnPointSettings>(getDefaultSettings)
  const [deepgramKey, setDeepgramKey] = useState<string | null>(null)
  const [loadingKey, setLoadingKey] = useState(true)
  const [exampleBank, setExampleBank] = useState<ExampleBank>({ examples: SAMPLE_EXAMPLES, source: 'sample' })

  // Load the household's private answer bank (falls back to the sample)
  useEffect(() => {
    let cancelled = false
    loadExampleBank(householdId)
      .then(bank => { if (!cancelled) setExampleBank(bank) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [householdId])

  // Fetch Deepgram API key from vault
  useEffect(() => {
    if (!householdId) {
      setLoadingKey(false)
      return
    }
    fetchConnections(householdId, { providerType: 'api', status: 'active' })
      .then(conns => {
        const dg = conns.find(
          (c: Connection) => c.provider_name === 'deepgram' && c.status === 'active'
        )
        if (dg?.access_token) {
          setDeepgramKey(dg.access_token)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingKey(false))
  }, [householdId])

  // Load sessions from localStorage
  useEffect(() => {
    if (!householdId) return
    setSessions(loadSessions(householdId))
  }, [householdId])

  // Emit screen context for sidebar chat
  useEffect(() => {
    const ctx: Record<string, unknown> = view === 'history'
      ? {
          view: 'session-history',
          summary: `${sessions.length} past interview sessions.`,
          sessionCount: sessions.length,
        }
      : {
          view: 'active-session',
          summary: activeSession
            ? `${activeSession.status === 'active' ? 'Live' : 'Reviewing'} session. ${activeSession.questions.length} questions detected.${activeSession.questions.length > 0 ? ` Last: "${activeSession.questions[activeSession.questions.length - 1].text}"` : ''}`
            : 'OnPoint session.',
          sessionTitle: activeSession?.title,
          questionCount: activeSession?.questions.length,
        }
    ;(window as unknown as Record<string, unknown>).__CF_SCREEN_CONTEXT = JSON.stringify(ctx)
    return () => {
      ;(window as unknown as Record<string, unknown>).__CF_SCREEN_CONTEXT = undefined
    }
  }, [view, sessions, activeSession])

  function handleNewSession() {
    const session: InterviewSession = {
      id: crypto.randomUUID(),
      title: `Interview \u2014 ${new Date().toLocaleDateString('en-IE', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: 'active',
      transcript: [],
      questions: [],
    }
    if (householdId) saveSession(householdId, session)
    setActiveSession(session)
    setView('session')
  }

  function handleSessionUpdate(updated: InterviewSession) {
    setActiveSession(updated)
    if (householdId) saveSession(householdId, updated)
  }

  function handleSessionEnd() {
    if (householdId) setSessions(loadSessions(householdId))
    setActiveSession(null)
    setView('history')
  }

  function handleSelectSession(session: InterviewSession) {
    setActiveSession(session)
    setView('session')
  }

  function handleDeleteSession(sessionId: string) {
    if (householdId) {
      deleteSession(householdId, sessionId)
      setSessions(loadSessions(householdId))
    }
  }

  function handleBack() {
    if (householdId) setSessions(loadSessions(householdId))
    setActiveSession(null)
    setView('history')
  }

  if (loadingKey) {
    return (
      <div className="cf-loading">
        <span className="cf-loading-cursor" aria-hidden="true" />
        <span className="cf-loading-text">Loading&hellip;</span>
      </div>
    )
  }

  return (
    <div className="op-container">
      {view === 'history' ? (
        <SessionHistory
          sessions={sessions}
          loading={false}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          hasDeepgramKey={!!deepgramKey}
          usingSampleExamples={exampleBank.source === 'sample'}
        />
      ) : activeSession ? (
        <ActiveSession
          session={activeSession}
          deepgramKey={deepgramKey}
          examples={exampleBank.examples}
          settings={settings}
          onSettingsChange={setSettings}
          onSessionUpdate={handleSessionUpdate}
          onEnd={handleSessionEnd}
          onBack={handleBack}
        />
      ) : null}
    </div>
  )
}
