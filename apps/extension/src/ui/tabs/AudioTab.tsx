function AudioTab() {
  return (
    <div className="tab-panel">
      <h2>Audio Analysis</h2>
      <p>Record voice notes from dating apps to analyze for authenticity.</p>
      
      <div className="placeholder-box">
        <div className="icon">🎙️</div>
        <p>Tab audio recording coming soon</p>
        <p style={{ fontSize: '12px', marginTop: '8px' }}>
          Will use tabCapture + offscreen API
        </p>
      </div>

      <button className="btn btn-primary" disabled>
        Start Recording
      </button>
    </div>
  )
}

export default AudioTab
