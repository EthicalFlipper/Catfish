import { useState } from 'react'
import ImageTab from './tabs/ImageTab'
import TextTab from './tabs/TextTab'

type TabType = 'image' | 'text'

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('image')

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
        {activeTab === 'image' && <ImageTab />}
        {activeTab === 'text' && <TextTab />}
      </main>
    </div>
  )
}

export default App
