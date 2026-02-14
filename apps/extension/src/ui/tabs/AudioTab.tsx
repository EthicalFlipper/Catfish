import { useState, useEffect, useRef } from 'react'

const API_URL = 'http://localhost:8000'

type RecordingStatus = 'idle' | 'recording' | 'processing' | 'done' | 'error'

interface AudioAnalysisResult {
  risk_score: number
  category: 'safe' | 'suspicious' | 'scam_likely'
  flags: string[]
  explanation: string
  recommended_action: string
  suggested_reply: string
  ai_voice_score: number
  ai_voice_rationale: string
  transcript: string
}

function AudioTab() {
  const [status, setStatus] = useState<RecordingStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AudioAnalysisResult | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  const startRecording = async () => {
    setStatus('recording')
    setError(null)
    setResult(null)
    setRecordingTime(0)

    // Start timer
    timerRef.current = window.setInterval(() => {
      setRecordingTime((t) => t + 1)
    }, 1000)

    try {
      const response = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'START_TAB_RECORDING' }, resolve)
      })

      if (!response.ok) {
        throw new Error(response.error || 'Failed to start recording')
      }
    } catch (err) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to start recording')
    }
  }

  const stopRecording = async () => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    setStatus('processing')

    try {
      // Stop recording and get audio data
      const response = await new Promise<{ ok: boolean; audioData?: string; error?: string }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'STOP_TAB_RECORDING' }, resolve)
      })

      if (!response.ok || !response.audioData) {
        throw new Error(response.error || 'Failed to stop recording')
      }

      // Get context from last thread import if available
      const importResponse = await new Promise<{ import: { thread_text?: string; match_name?: string; site?: string; page_url?: string } | null }>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_LAST_IMPORT' }, resolve)
      })

      // Convert base64 to blob
      const audioBlob = dataUrlToBlob(response.audioData)

      // Send to backend
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.webm')
      
      if (importResponse.import?.thread_text) {
        formData.append('context_text', importResponse.import.thread_text)
      }
      if (importResponse.import?.site) {
        formData.append('site', importResponse.import.site)
      }
      if (importResponse.import?.page_url) {
        formData.append('page_url', importResponse.import.page_url)
      }

      const analysisResponse = await fetch(`${API_URL}/analyze/audio`, {
        method: 'POST',
        body: formData,
      })

      if (!analysisResponse.ok) {
        const err = await analysisResponse.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(err.detail || `HTTP ${analysisResponse.status}`)
      }

      const analysisResult: AudioAnalysisResult = await analysisResponse.json()
      setResult(analysisResult)
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Analysis failed')
    }
  }

  const dataUrlToBlob = (dataUrl: string): Blob => {
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'audio/webm'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  }

  const handleCopy = async () => {
    if (!result?.suggested_reply) return
    await navigator.clipboard.writeText(result.suggested_reply)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const reset = () => {
    setStatus('idle')
    setError(null)
    setResult(null)
    setRecordingTime(0)
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'safe': return '#10b981'
      case 'suspicious': return '#f59e0b'
      case 'scam_likely': return '#ef4444'
      default: return '#64748b'
    }
  }

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'safe': return 'Safe'
      case 'suspicious': return 'Suspicious'
      case 'scam_likely': return 'Likely Scam'
      default: return category
    }
  }

  const getScoreColor = (score: number) => {
    if (score <= 30) return '#10b981'
    if (score <= 70) return '#f59e0b'
    return '#ef4444'
  }

  return (
    <div className="tab-panel">
      <h2>Audio Analysis</h2>
      <p>Record voice notes from the current tab to analyze for authenticity.</p>

      {/* Recording controls */}
      <div className="audio-controls">
        {status === 'idle' && (
          <button className="btn btn-record" onClick={startRecording}>
            <span className="record-icon">🔴</span> Record Tab Audio
          </button>
        )}

        {status === 'recording' && (
          <>
            <div className="recording-indicator">
              <span className="pulse-dot"></span>
              Recording... {formatTime(recordingTime)}
            </div>
            <button className="btn btn-stop" onClick={stopRecording}>
              <span>⏹</span> Stop Recording
            </button>
          </>
        )}

        {status === 'processing' && (
          <div className="processing-indicator">
            <span className="spinner"></span>
            Analyzing audio...
          </div>
        )}

        {(status === 'done' || status === 'error') && (
          <button className="btn btn-secondary" onClick={reset}>
            Record Again
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="result-container">
          {/* Category Badge */}
          <div className="result-header" style={{ borderColor: getCategoryColor(result.category) }}>
            <div className="category-badge" style={{ background: getCategoryColor(result.category) }}>
              {getCategoryLabel(result.category)}
            </div>
          </div>

          {/* Scores */}
          <div className="scores-row">
            <div className="score-card">
              <div className="score-icon">⚠️</div>
              <div className="score-value" style={{ color: getScoreColor(result.risk_score) }}>
                {result.risk_score}%
              </div>
              <div className="score-label">Scam Risk</div>
            </div>
            <div className="score-card">
              <div className="score-icon">🤖</div>
              <div className="score-value" style={{ color: getScoreColor(result.ai_voice_score) }}>
                {result.ai_voice_score}%
              </div>
              <div className="score-label">AI Voice</div>
            </div>
          </div>

          {/* AI Voice Rationale */}
          {result.ai_voice_rationale && (
            <div className="result-section">
              <h4>AI Voice Analysis</h4>
              <p>{result.ai_voice_rationale}</p>
            </div>
          )}

          {/* Transcript */}
          {result.transcript && (
            <div className="result-section">
              <h4>Transcript</h4>
              <p className="transcript-text">{result.transcript}</p>
            </div>
          )}

          {/* Flags */}
          {result.flags.length > 0 && (
            <div className="result-section">
              <h4>Red Flags</h4>
              <div className="flags-container">
                {result.flags.map((flag, i) => (
                  <span key={i} className="flag-chip">{flag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Explanation */}
          <div className="result-section">
            <h4>Analysis</h4>
            <p>{result.explanation}</p>
          </div>

          {/* Recommended Action */}
          <div className="result-section">
            <h4>Recommended Action</h4>
            <p>{result.recommended_action}</p>
          </div>

          {/* Suggested Reply */}
          <div className="result-section">
            <h4>Suggested Reply</h4>
            <div className="suggested-reply">
              <p>{result.suggested_reply}</p>
              <button className="btn btn-copy" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instructions when idle */}
      {status === 'idle' && !result && (
        <div className="audio-instructions">
          <h4>How to use:</h4>
          <ol>
            <li>Open a Tinder voice note or any audio in the current tab</li>
            <li>Click "Record Tab Audio" above</li>
            <li>Play the voice note / audio</li>
            <li>Click "Stop Recording" when done</li>
            <li>Wait for analysis results</li>
          </ol>
        </div>
      )}
    </div>
  )
}

export default AudioTab
