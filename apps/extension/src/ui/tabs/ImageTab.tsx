import { useState, useEffect } from 'react'

const API_URL = 'http://localhost:8000'

interface ImageCapture {
  dataUrl: string
  site: string
  page_url: string
  captured_at: number
}

interface ImageAnalysisResult {
  catfish_score: number
  ai_generated_score: number
  flags: string[]
  explanation: string
  recommended_action: string
  reverse_search_steps: string[]
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

  return (
    <div className="tab-panel">
      <h2>Image Analysis</h2>
      <p>Capture profile screenshots from Tinder or upload images for analysis.</p>

      {/* Capture status */}
      {capture && (
        <div className="import-banner" style={{ background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' }}>
          <span className="import-icon">📸</span>
          <span className="import-text">
            Captured from {capture.site}
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
            <div className="icon">🖼️</div>
            <p>Click "Capture profile" on Tinder, or upload an image</p>
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
          {loading ? 'Analyzing...' : 'Analyze Image'}
        </button>
        {previewUrl && (
          <button className="btn btn-secondary" onClick={handleClear}>
            Clear
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
          {/* Dual Scores */}
          <div className="scores-row">
            <div className="score-card">
              <div className="score-icon">🎣</div>
              <div className="score-value" style={{ color: getScoreColor(result.catfish_score) }}>
                {result.catfish_score}%
              </div>
              <div className="score-label">Catfish Score</div>
            </div>
            <div className="score-card">
              <div className="score-icon">🤖</div>
              <div className="score-value" style={{ color: getScoreColor(result.ai_generated_score) }}>
                {result.ai_generated_score}%
              </div>
              <div className="score-label">AI-Generated</div>
            </div>
          </div>

          {/* Flags */}
          {result.flags.length > 0 && (
            <div className="result-section">
              <h4>Flags</h4>
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

          {/* Reverse Search Steps */}
          {result.reverse_search_steps.length > 0 && (
            <div className="result-section">
              <h4>Reverse Image Search Steps</h4>
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
