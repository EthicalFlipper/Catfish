import { useState, useEffect } from 'react'

const API_URL = 'http://localhost:8000'

interface ImageCapture {
  dataUrl: string
  site: string
  page_url: string
  captured_at: number
}

interface ArtifactSignal {
  category: string
  signal: string
  description: string
  weight: number
  severity: 'low' | 'medium' | 'high'
}

interface ImageAnalysisResult {
  catfish_score: number
  ai_generated_score: number
  confidence_band: 'likely_real' | 'low_suspicion' | 'uncertain' | 'likely_ai' | 'strong_ai_indicators'
  top_signals: ArtifactSignal[]
  flags: string[]
  explanation: string
  ai_detection_rationale: string
  recommended_action: string
  reverse_search_steps: string[]
  signal_count: number
  escalation_applied: boolean
}

function ImageTab() {
  const [capture, setCapture] = useState<ImageCapture | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImageAnalysisResult | null>(null)

  // Load capture from storage on mount
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_LAST_CAPTURE' }, (response) => {
      if (response?.capture) {
        setCapture(response.capture)
        setPreviewUrl(response.capture.dataUrl)
      }
    })
  }, [])

  // Listen for new captures
  useEffect(() => {
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.lastImageCapture?.newValue) {
        const newCapture = changes.lastImageCapture.newValue
        setCapture(newCapture)
        setPreviewUrl(newCapture.dataUrl)
        setSelectedFile(null)
        setResult(null)
        setError(null)
      }
    }

    chrome.storage.onChanged.addListener(handleStorageChange)
    return () => chrome.storage.onChanged.removeListener(handleStorageChange)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setCapture(null)
      setPreviewUrl(URL.createObjectURL(file))
      setResult(null)
      setError(null)
    }
  }

  const handleClear = () => {
    setCapture(null)
    setSelectedFile(null)
    setPreviewUrl(null)
    setResult(null)
    setError(null)
    chrome.runtime.sendMessage({ type: 'CLEAR_LAST_CAPTURE' })
  }

  const dataUrlToBlob = (dataUrl: string): Blob => {
    const arr = dataUrl.split(',')
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png'
    const bstr = atob(arr[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  }

  const handleAnalyze = async () => {
    if (!previewUrl && !selectedFile && !capture) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()

      if (selectedFile) {
        formData.append('image', selectedFile)
      } else if (capture?.dataUrl) {
        const blob = dataUrlToBlob(capture.dataUrl)
        formData.append('image', blob, 'screenshot.png')
      }

      const response = await fetch(`${API_URL}/analyze/image`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(err.detail || `HTTP ${response.status}`)
      }

      const data: ImageAnalysisResult = await response.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze image')
    } finally {
      setLoading(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score <= 30) return '#10b981'
    if (score <= 70) return '#f59e0b'
    return '#ef4444'
  }

  const getConfidenceBandLabel = (band: string) => {
    switch (band) {
      case 'likely_real': return 'Likely Real'
      case 'low_suspicion': return 'Low Suspicion'
      case 'uncertain': return 'Uncertain'
      case 'likely_ai': return 'Likely AI'
      case 'strong_ai_indicators': return 'Strong AI Indicators'
      default: return band
    }
  }

  const getConfidenceBandColor = (band: string) => {
    switch (band) {
      case 'likely_real': return '#10b981'
      case 'low_suspicion': return '#22c55e'
      case 'uncertain': return '#f59e0b'
      case 'likely_ai': return '#f97316'
      case 'strong_ai_indicators': return '#ef4444'
      default: return '#64748b'
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return '#ef4444'
      case 'medium': return '#f59e0b'
      case 'low': return '#22c55e'
      default: return '#64748b'
    }
  }

  return (
    <div className="tab-panel">
      <h2>Image Analysis</h2>
      <p>Capture profile screenshots from Tinder or upload images for analysis.</p>

      {/* Capture status */}
      {capture && (
        <div className="import-banner">
          <span className="import-icon">◫</span>
          <span className="import-text">
            Captured: {capture.site}
          </span>
          <button className="import-clear" onClick={handleClear} title="Clear">×</button>
        </div>
      )}

      {/* Preview area */}
      <div className="image-preview-box">
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" className="image-preview" />
        ) : (
          <>
            <div className="icon">◫</div>
            <p>Use "Capture profile" on Tinder, or upload an image</p>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ marginTop: '12px' }}
            />
          </>
        )}
      </div>

      {/* Action buttons */}
      <div className="button-row">
        <button
          className="btn btn-primary"
          disabled={!previewUrl || loading}
          onClick={handleAnalyze}
        >
          {loading ? '◌ Processing...' : '▶ Analyze Image'}
        </button>
        {previewUrl && (
          <button className="btn btn-secondary" onClick={handleClear}>
            ✕ Clear
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
          {/* Confidence Band Header */}
          <div 
            className="result-header" 
            style={{ borderColor: getConfidenceBandColor(result.confidence_band) }}
          >
            <div 
              className="category-badge" 
              style={{ background: getConfidenceBandColor(result.confidence_band) }}
            >
              {getConfidenceBandLabel(result.confidence_band)}
            </div>
          </div>

          {/* Dual Scores */}
          <div className="scores-row">
            <div className="score-card">
              <div className="score-label">Catfish Risk</div>
              <div className="score-value" style={{ color: getScoreColor(result.catfish_score) }}>
                {result.catfish_score}
                <span style={{ fontSize: '16px', opacity: 0.7 }}>%</span>
              </div>
            </div>
            <div className="score-card">
              <div className="score-label">AI-Generated</div>
              <div className="score-value" style={{ color: getScoreColor(result.ai_generated_score) }}>
                {result.ai_generated_score}
                <span style={{ fontSize: '16px', opacity: 0.7 }}>%</span>
              </div>
              {result.escalation_applied && (
                <div style={{ 
                  fontSize: '9px', 
                  color: '#f59e0b', 
                  marginTop: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  ↑ Escalated
                </div>
              )}
            </div>
          </div>

          {/* Top AI Signals */}
          {result.top_signals && result.top_signals.length > 0 && (
            <div className="result-section">
              <h4>◈ Top AI Signals ({result.signal_count} detected)</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {result.top_signals.slice(0, 5).map((signal, i) => (
                  <div 
                    key={i} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'flex-start', 
                      gap: '10px',
                      padding: '10px 12px',
                      background: 'var(--noir-elevated)',
                      borderRadius: '4px',
                      borderLeft: `3px solid ${getSeverityColor(signal.severity)}`
                    }}
                  >
                    <div style={{ 
                      fontSize: '10px', 
                      fontWeight: 700,
                      color: getSeverityColor(signal.severity),
                      textTransform: 'uppercase',
                      minWidth: '50px'
                    }}>
                      {signal.severity}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ 
                        fontSize: '11px', 
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        marginBottom: '2px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        {signal.signal.replace(/_/g, ' ')}
                      </div>
                      <div style={{ 
                        fontSize: '12px', 
                        color: 'var(--text-secondary)',
                        lineHeight: 1.4
                      }}>
                        {signal.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {/* AI Detection Rationale */}
          {result.ai_detection_rationale && (
            <div className="result-section">
              <h4>◈ AI Detection Analysis</h4>
              <p>{result.ai_detection_rationale}</p>
            </div>
          )}

          {/* Explanation */}
          <div className="result-section">
            <h4>◈ Overall Summary</h4>
            <p>{result.explanation}</p>
          </div>

          {/* Recommended Action */}
          <div className="result-section">
            <h4>→ Recommended Action</h4>
            <p>{result.recommended_action}</p>
          </div>

          {/* Reverse Search Steps */}
          {result.reverse_search_steps.length > 0 && (
            <div className="result-section">
              <h4>◈ Reverse Image Search</h4>
              <ul className="search-steps">
                {result.reverse_search_steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ImageTab
