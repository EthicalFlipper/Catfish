import { useState, useEffect, useRef } from 'react'

const API_URL = 'http://localhost:8000'

interface AnalysisResult {
  ai_score: number
  risk_score: number
  category: 'safe' | 'suspicious' | 'scam_likely'
  flags: string[]
  explanation: string
  recommended_action: string
  suggested_reply: string
}

interface ThreadImport {
  type: 'THREAD_IMPORT'
  site: string
  thread_text: string
  match_name?: string
  page_url: string
  error?: string
  timestamp: number
}

function TextTab() {
  const [text, setText] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [importStatus, setImportStatus] = useState<{ site: string; matchName?: string } | null>(null)
  const lastProcessedTimestamp = useRef<number>(0)

  // Process an imported thread
  const processImport = (importData: ThreadImport, autoAnalyze = false) => {
    // Avoid processing the same import twice
    if (importData.timestamp <= lastProcessedTimestamp.current) {
      return
    }
    lastProcessedTimestamp.current = importData.timestamp

    if (importData.error) {
      setError(`Import error: ${importData.error}`)
      return
    }

    if (!importData.thread_text) {
      setError('No conversation text was extracted. Please try again or paste manually.')
      return
    }

    // Build the text content
    let content = ''
    if (importData.match_name) {
      content = `[Conversation with ${importData.match_name} on ${importData.site}]\n\n`
    }
    content += importData.thread_text

    setText(content)
    setImportStatus({ site: importData.site, matchName: importData.match_name })
    setError(null)
    setResult(null)

    // Clear the stored import
    chrome.runtime.sendMessage({ type: 'CLEAR_LAST_IMPORT' })

    // Auto-analyze if requested (only on fresh imports)
    if (autoAnalyze && content.trim()) {
      // Small delay to let UI update
      setTimeout(() => {
        handleAnalyzeInternal(content)
      }, 100)
    }
  }

  // Check for stored import on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_LAST_IMPORT' }, (response) => {
      if (response?.import) {
        processImport(response.import, true)
      }
    })
  }, [])

  // Listen for new imports via storage changes
  useEffect(() => {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.lastThreadImport?.newValue) {
        processImport(changes.lastThreadImport.newValue, true)
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange)
    }
  }, [])

  // Internal analyze function that accepts text directly
  const handleAnalyzeInternal = async (textToAnalyze: string) => {
    if (!textToAnalyze.trim()) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`${API_URL}/analyze/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textToAnalyze.trim(),
          user_notes: notes.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(err.detail || `HTTP ${response.status}`)
      }

      const data: AnalysisResult = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze text')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyze = async () => {
    await handleAnalyzeInternal(text)
  }

  const clearImport = () => {
    setImportStatus(null)
    setText('')
    setResult(null)
    setError(null)
  }

  const handleCopy = async () => {
    if (!result?.suggested_reply) return
    await navigator.clipboard.writeText(result.suggested_reply)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
      <h2>Text Analysis</h2>
      <p>Paste conversation snippets or import directly from Tinder.</p>

      {/* Import status banner */}
      {importStatus && (
        <div className="import-banner">
          <span className="import-icon">↓</span>
          <span className="import-text">
            Imported: {importStatus.site}
            {importStatus.matchName && ` → ${importStatus.matchName}`}
          </span>
          <button className="import-clear" onClick={clearImport} title="Clear">×</button>
        </div>
      )}

      <textarea
        placeholder={importStatus ? "// Conversation data loaded..." : "// Paste conversation or use 'Analyze thread' on Tinder..."}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (!e.target.value) setImportStatus(null)
        }}
        rows={6}
        disabled={loading}
      />

      <textarea
        placeholder="// Additional context (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        disabled={loading}
        style={{ minHeight: '60px' }}
      />

      <button
        className="btn btn-primary"
        disabled={!text.trim() || loading}
        onClick={handleAnalyze}
      >
        {loading ? '◌ Processing...' : '▶ Analyze Text'}
      </button>

      {error && (
        <div className="error-box">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div className="result-container">
          {/* Category Badge */}
          <div className="result-header" style={{ borderColor: getCategoryColor(result.category) }}>
            <div className="category-badge" style={{ background: getCategoryColor(result.category) }}>
              {getCategoryLabel(result.category)}
            </div>
          </div>

          {/* Dual Scores */}
          <div className="scores-row">
            <div className="score-card">
              <div className="score-label">AI-Written</div>
              <div className="score-value" style={{ color: getScoreColor(result.ai_score) }}>
                {result.ai_score}
                <span style={{ fontSize: '16px', opacity: 0.7 }}>%</span>
              </div>
            </div>
            <div className="score-card">
              <div className="score-label">Scam Risk</div>
              <div className="score-value" style={{ color: getScoreColor(result.risk_score) }}>
                {result.risk_score}
                <span style={{ fontSize: '16px', opacity: 0.7 }}>%</span>
              </div>
            </div>
          </div>

          {/* Flags */}
          {result.flags.length > 0 && (
            <div className="result-section">
              <h4>⚠ Detected Flags</h4>
              <div className="flags-container">
                {result.flags.map((flag, i) => (
                  <span key={i} className="flag-chip">{flag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Explanation */}
          <div className="result-section">
            <h4>◈ Analysis Summary</h4>
            <p>{result.explanation}</p>
          </div>

          {/* Recommended Action */}
          <div className="result-section">
            <h4>→ Recommended Action</h4>
            <p>{result.recommended_action}</p>
          </div>

          {/* Suggested Reply */}
          <div className="result-section">
            <h4>◈ Suggested Response</h4>
            <div className="suggested-reply">
              <p>{result.suggested_reply}</p>
              <button className="btn btn-copy" onClick={handleCopy}>
                {copied ? '✓ Copied' : '⎘ Copy'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TextTab
