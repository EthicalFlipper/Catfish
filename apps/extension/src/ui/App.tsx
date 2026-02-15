import { useState } from 'react'
import AudioTab from './tabs/AudioTab'
import ImageTab from './tabs/ImageTab'
import TextTab from './tabs/TextTab'

type TabType = 'audio' | 'image' | 'text'

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('audio')

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-indicator"></div>
          <div className="header-text">
            <h1>Catfish</h1>
            <p className="subtitle">Threat Analysis System</p>
          </div>
          <div className="header-status">
            <span className="status-dot"></span>
            <span className="status-text">Online</span>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => setActiveTab('audio')}
        >
          <span className="tab-icon">◉</span>
          Audio
        </button>
        <button
          className={`tab ${activeTab === 'image' ? 'active' : ''}`}
          onClick={() => setActiveTab('image')}
        >
          <span className="tab-icon">◫</span>
          Image
        </button>
        <button
          className={`tab ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
          <span className="tab-icon">≡</span>
          Text
        </button>
      </nav>

      <main className="content">
        {activeTab === 'audio' && <AudioTab />}
        {activeTab === 'image' && <ImageTab />}
        {activeTab === 'text' && <TextTab />}
      </main>
    </div>
  )
}

export default App
