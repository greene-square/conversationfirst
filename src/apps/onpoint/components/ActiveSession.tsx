import { useState, useEffect, useRef, useCallback } from 'react'
import {
  ArrowLeftIcon,
  StopIcon,
  Cog6ToothIcon,
} from '@heroicons/react/24/outline'
import { QuestionDetector } from '../lib/questionDetector'
import { Matcher } from '../lib/matcher'
import { generateSessionTitle, formatDuration } from '../lib/storage'
import type {
  InterviewSession,
  TranscriptEntry,
  SessionQuestion,
  OnPointSettings,
  Example,
} from '../lib/types'
import MatchDisplay from './MatchDisplay'
import TranscriptPanel from './TranscriptPanel'
import SettingsPanel from './SettingsPanel'

interface ActiveSessionProps {
  session: InterviewSession
  deepgramKey: string | null
  examples: Example[]
  settings: OnPointSettings
  onSettingsChange: (settings: OnPointSettings) => void
  onSessionUpdate: (session: InterviewSession) => void
  onEnd: () => void
  onBack: () => void
}

export default function ActiveSession({
  session,
  deepgramKey,
  examples,
  settings,
  onSettingsChange,
  onSessionUpdate,
  onEnd,
  onBack,
}: ActiveSessionProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [duration, setDuration] = useState('00:00')

  const socketRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef(new QuestionDetector())
  const matcherRef = useRef(new Matcher(examples))
  useEffect(() => {
    matcherRef.current = new Matcher(examples)
  }, [examples])
  const speakerCountsRef = useRef<Record<string, number>>({})
  const mySpeakerRef = useRef<number | null>(null)
  const sessionRef = useRef(session)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startTimeRef = useRef(new Date(session.startedAt).getTime())

  // Keep sessionRef in sync
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // Duration timer
  useEffect(() => {
    if (session.status !== 'active') {
      setDuration(formatDuration(session.startedAt, session.endedAt))
      return
    }
    const tick = () => setDuration(formatDuration(session.startedAt, null))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [session.startedAt, session.endedAt, session.status])

  const debouncedSave = useCallback((updated: InterviewSession) => {
    sessionRef.current = updated
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      onSessionUpdate(updated)
    }, 2000)
  }, [onSessionUpdate])

  const immediateSave = useCallback((updated: InterviewSession) => {
    sessionRef.current = updated
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    onSessionUpdate(updated)
  }, [onSessionUpdate])

  const stopListening = useCallback(() => {
    const s = streamRef.current
    streamRef.current = null

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    if (s) {
      s.getTracks().forEach(track => track.stop())
    }

    setListening(false)
    detectorRef.current.reset()
    speakerCountsRef.current = {}
    mySpeakerRef.current = null
  }, [])

  const startListening = useCallback(async () => {
    if (!deepgramKey) {
      setErrorMsg('Add your Deepgram API key in the vault.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const dgUrl =
        'wss://api.deepgram.com/v1/listen?' +
        'model=nova-3&' +
        'punctuate=true&' +
        'interim_results=true&' +
        'utterance_end_ms=1500&' +
        'vad_events=true&' +
        'smart_format=true&' +
        'diarize=true'

      const socket = new WebSocket(dgUrl, ['token', deepgramKey])
      socketRef.current = socket

      socket.onopen = () => {
        setListening(true)
        setErrorMsg(null)
        speakerCountsRef.current = {}
        mySpeakerRef.current = null

        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
        recorderRef.current = recorder
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data)
          }
        }
        recorder.start(250)
      }

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data)
        const alt = data.channel?.alternatives?.[0]
        const text = alt?.transcript as string | undefined

        if (text) {
          const words = (alt.words || []) as Array<{ speaker?: number }>
          let utteranceSpeaker: number | null = null

          if (data.is_final && words.length > 0) {
            for (const w of words) {
              if (w.speaker !== undefined) {
                const spk = String(w.speaker)
                speakerCountsRef.current[spk] = (speakerCountsRef.current[spk] || 0) + 1
                utteranceSpeaker = w.speaker
              }
            }

            let maxWords = 0
            for (const [spk, count] of Object.entries(speakerCountsRef.current)) {
              if (count > maxWords) {
                maxWords = count
                mySpeakerRef.current = parseInt(spk)
              }
            }
          }

          if (data.is_final && text.trim().length > 3) {
            const speaker: TranscriptEntry['speaker'] =
              utteranceSpeaker !== null
                ? utteranceSpeaker === mySpeakerRef.current ? 'you' : 'them'
                : 'unknown'

            const entry: TranscriptEntry = {
              speaker,
              text: text.trim(),
              timestamp: Date.now() - startTimeRef.current,
            }

            const current = sessionRef.current
            const updated: InterviewSession = {
              ...current,
              transcript: [...current.transcript, entry],
            }

            const isInterviewer =
              utteranceSpeaker !== null && utteranceSpeaker !== mySpeakerRef.current
            const totalWords = Object.values(speakerCountsRef.current).reduce((a, b) => a + b, 0)
            const hasEnoughData = totalWords > 30

            if (!hasEnoughData || isInterviewer) {
              const result = detectorRef.current.process(text.trim())
              if (result.isQuestion) {
                const { match, runnerUp } = matcherRef.current.match(result.text)
                const question: SessionQuestion = {
                  id: crypto.randomUUID(),
                  text: result.text,
                  detectedAt: Date.now() - startTimeRef.current,
                  match,
                  runnerUp,
                }
                updated.questions = [...current.questions, question]

                // Auto-generate title from first question
                if (updated.questions.length === 1 && updated.title.startsWith('Interview \u2014')) {
                  updated.title = generateSessionTitle(updated)
                }
              }
            }

            debouncedSave(updated)
          }
        }
      }

      socket.onerror = () => {
        setErrorMsg('Connection error. Check your API key and internet connection.')
      }

      socket.onclose = () => {
        if (streamRef.current?.active) {
          setTimeout(() => {
            if (streamRef.current?.active) startListening()
          }, 3000)
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setErrorMsg('Microphone access denied. Allow mic access in System Settings \u203a Privacy \u203a Microphone.')
      } else {
        setErrorMsg(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }, [deepgramKey, debouncedSave])

  // Auto-start listening for active sessions
  useEffect(() => {
    if (session.status === 'active' && deepgramKey && !listening) {
      startListening()
    }
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      socketRef.current?.close()
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleEnd() {
    stopListening()
    const current = sessionRef.current
    const ended: InterviewSession = {
      ...current,
      status: 'completed',
      endedAt: new Date().toISOString(),
    }
    immediateSave(ended)
    onEnd()
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const updated = { ...sessionRef.current, title: e.target.value }
    immediateSave(updated)
  }

  const isActive = session.status === 'active'

  return (
    <>
      <div className="op-session-header">
        <div className="op-session-header-left">
          <button className="op-btn-icon" onClick={onBack} aria-label="Back to sessions">
            <ArrowLeftIcon width={16} height={16} aria-hidden="true" />
          </button>
          {isActive && (
            <>
              <div className="status-dot op-dot-listening" />
              <span className="op-live-badge">LIVE</span>
            </>
          )}
        </div>
        <input
          className="op-session-title-input"
          value={session.title}
          onChange={handleTitleChange}
          aria-label="Session title"
        />
        <div className="op-session-header-right">
          <span className="op-session-duration">{duration}</span>
          {isActive && (
            <button className="op-btn-stop" onClick={handleEnd}>
              <StopIcon width={12} height={12} aria-hidden="true" />
              End call
            </button>
          )}
          <button
            className="op-btn-icon"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <Cog6ToothIcon width={16} height={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {errorMsg && <div className="op-error-msg">{errorMsg}</div>}

      <div className="op-session-body">
        <div className="op-session-coaching">
          <MatchDisplay
            questions={session.questions}
            isLive={isActive && listening}
            stream={streamRef.current}
          />
        </div>
        <div className="op-session-transcript">
          <TranscriptPanel
            entries={session.transcript}
            isLive={isActive}
          />
        </div>
      </div>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onSave={onSettingsChange}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  )
}
