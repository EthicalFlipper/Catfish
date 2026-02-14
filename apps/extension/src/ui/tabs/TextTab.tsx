import { useState } from 'react'

function TextTab() {
  const [text, setText] = useState('')

  return (
    <div className="tab-panel">
      <h2>Text Analysis</h2>
      <p>Paste conversation snippets to analyze for red flags and authenticity.</p>
      
      <textarea
        placeholder="Paste your conversation here..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
      />

      <button className="btn btn-primary" disabled={!text.trim()}>
        Analyze Text
      </button>
    </div>
  )
}

export default TextTab
