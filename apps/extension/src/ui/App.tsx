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
        <h1>Catfish</h1>
        <p className="subtitle">DateGuard Analysis</p>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'audio' ? 'active' : ''}`}
          onClick={() => setActiveTab('audio')}
        >
          Audio
        </button>
        <button
          className={`tab ${activeTab === 'image' ? 'active' : ''}`}
          onClick={() => setActiveTab('image')}
        >
          Image
        </button>
        <button
          className={`tab ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
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
