import { useState } from 'react'

function ImageTab() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
    }
  }

  return (
    <div className="tab-panel">
      <h2>Image Analysis</h2>
      <p>Upload profile photos or screenshots for reverse image search and analysis.</p>
      
      <div className="placeholder-box">
        <div className="icon">🖼️</div>
        {selectedFile ? (
          <p>Selected: {selectedFile.name}</p>
        ) : (
          <p>Drag & drop or click to upload</p>
        )}
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ marginTop: '12px' }}
        />
      </div>

      <button className="btn btn-primary" disabled={!selectedFile}>
        Analyze Image
      </button>
    </div>
  )
}

export default ImageTab
