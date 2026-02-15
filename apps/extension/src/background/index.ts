// Catfish Background Service Worker
// Handles extension lifecycle and message passing

console.log('[Catfish] Background service worker started')

// Helper function to crop an image using OffscreenCanvas
async function cropImage(
  dataUrl: string, 
  bounds: { x: number; y: number; width: number; height: number }
): Promise<string> {
  // Fetch the image as a blob
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  
  // Create ImageBitmap from blob
  const imageBitmap = await createImageBitmap(blob)
  
  // Ensure bounds don't exceed image dimensions
  const x = Math.max(0, Math.min(bounds.x, imageBitmap.width - 1))
  const y = Math.max(0, Math.min(bounds.y, imageBitmap.height - 1))
  const width = Math.min(bounds.width, imageBitmap.width - x)
  const height = Math.min(bounds.height, imageBitmap.height - y)
  
  // Create OffscreenCanvas for cropping
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  
  if (!ctx) {
    throw new Error('Could not get canvas context')
  }
  
  // Draw the cropped portion
  ctx.drawImage(
    imageBitmap,
    x, y, width, height,  // Source rectangle
    0, 0, width, height   // Destination rectangle
  )
  
  // Convert back to data URL
  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' })
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(croppedBlob)
  })
}

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id })
  }
})

// Message listener for communication between UI and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Catfish] Received message:', message.type, 'from:', sender.tab?.url || 'extension')

  switch (message.type) {
    case 'HEALTH_CHECK':
      sendResponse({ ok: true, timestamp: Date.now() })
      break

    case 'THREAD_IMPORT':
      // Store the thread import in chrome.storage.local
      chrome.storage.local.set({ lastThreadImport: message }, () => {
        console.log('[Catfish] Thread import stored')
        
        // Also try to open side panel if not already open
        if (sender.tab?.id) {
          chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {
            // Panel might already be open, that's fine
          })
        }
        
        sendResponse({ ok: true, stored: true })
      })
      return true // Keep channel open for async response

    case 'GET_LAST_IMPORT':
      // Retrieve last thread import
      chrome.storage.local.get('lastThreadImport', (result) => {
        sendResponse({ import: result.lastThreadImport || null })
      })
      return true

    case 'CLEAR_LAST_IMPORT':
      // Clear the stored import after it's been used
      chrome.storage.local.remove('lastThreadImport', () => {
        sendResponse({ ok: true })
      })
      return true

    case 'FETCH_PROFILE_IMAGE':
      // NEW: Fetch the actual image from URL (Source Extraction strategy)
      // This gets the CLEAN image without UI overlays
      console.log('[Catfish] Fetching profile image from URL...')
      
      handleFetchProfileImage(message.imageUrl, message.site, message.page_url, sender.tab?.id)
        .then((result) => sendResponse(result))
        .catch((err) => {
          console.error('[Catfish] Fetch image error:', err)
          sendResponse({ error: err.message })
        })
      return true // Keep channel open for async

    case 'CAPTURE_VISIBLE_TAB':
      // FALLBACK: Capture screenshot of the current visible tab
      // Only used when source extraction fails
      console.log('[Catfish] Fallback: Capturing visible tab screenshot...')
      chrome.tabs.captureVisibleTab({ format: 'png' }, async (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error('[Catfish] captureVisibleTab error:', chrome.runtime.lastError)
          sendResponse({ error: chrome.runtime.lastError.message })
          return
        }
        
        let finalDataUrl = dataUrl
        
        // Crop the image if bounds were provided
        if (message.cropBounds) {
          try {
            finalDataUrl = await cropImage(dataUrl, message.cropBounds)
            console.log('[Catfish] Image cropped successfully')
          } catch (e) {
            console.error('[Catfish] Crop failed, using full image:', e)
            // Fall back to full screenshot
          }
        }
        
        const captureData = {
          dataUrl: finalDataUrl,
          site: message.site || 'unknown',
          page_url: message.page_url || '',
          captured_at: Date.now(),
          cropped: !!message.cropBounds,
          sourceType: 'screenshot_fallback',  // Mark as fallback
        }
        
        // Store in chrome.storage.local
        chrome.storage.local.set({ lastImageCapture: captureData }, () => {
          console.log('[Catfish] Screenshot stored in storage (fallback)')
          
          // Open side panel
          if (sender.tab?.id) {
            chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {})
          }
          
          sendResponse({ ok: true, captured: true, cropped: !!message.cropBounds })
        })
      })
      return true // Keep channel open for async

    case 'GET_LAST_CAPTURE':
      // Retrieve last image capture
      chrome.storage.local.get('lastImageCapture', (result) => {
        sendResponse({ capture: result.lastImageCapture || null })
      })
      return true

    case 'CLEAR_LAST_CAPTURE':
      // Clear the stored capture
      chrome.storage.local.remove('lastImageCapture', () => {
        sendResponse({ ok: true })
      })
      return true

    case 'START_TAB_RECORDING':
      // Start recording tab audio via offscreen document
      handleStartRecording(sender.tab?.id)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }))
      return true // Keep channel open for async

    case 'STOP_TAB_RECORDING':
      // Stop recording and get audio data
      handleStopRecording()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ error: err.message }))
      return true // Keep channel open for async

    case 'GET_RECORDING_STATUS':
      // Check if currently recording
      sendResponse({ recording: isRecording })
      break

    default:
      sendResponse({ error: 'Unknown message type' })
  }

  return true // Keep message channel open for async response
})

// Set side panel behavior
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Catfish] Side panel error:', error))

// ============= Source Image Extraction Logic =============

/**
 * Fetch a profile image from URL and store it as clean image data.
 * This is the SOURCE EXTRACTION strategy - gets the raw image
 * without any UI overlays that would appear in a screenshot.
 * 
 * The fetch happens in the background script to avoid CORS issues,
 * since extensions have different security policies than web pages.
 */
async function handleFetchProfileImage(
  imageUrl: string,
  site: string,
  pageUrl: string,
  tabId?: number
): Promise<{ ok: boolean; error?: string }> {
  
  if (!imageUrl) {
    throw new Error('No image URL provided')
  }
  
  console.log('[Catfish] Fetching image:', imageUrl.substring(0, 80) + '...')
  
  try {
    // Fetch the image from the URL
    // The background script can bypass CORS restrictions
    const response = await fetch(imageUrl, {
      method: 'GET',
      // Some CDNs need these headers
      headers: {
        'Accept': 'image/*,*/*',
      },
      // Use cors mode, but background scripts often bypass this anyway
      mode: 'cors',
      credentials: 'omit',  // Don't send cookies to CDN
    })
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    // Get the content type to determine image format
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    console.log('[Catfish] Image content-type:', contentType)
    
    // Read the image as a blob
    const blob = await response.blob()
    console.log('[Catfish] Image blob size:', blob.size, 'bytes')
    
    if (blob.size === 0) {
      throw new Error('Empty image received')
    }
    
    // Check if it's too large (10MB limit)
    if (blob.size > 10 * 1024 * 1024) {
      throw new Error('Image too large (>10MB)')
    }
    
    // Convert blob to data URL for storage
    const dataUrl = await blobToDataUrl(blob)
    
    // Store the clean image data
    const captureData = {
      dataUrl,
      site: site || 'unknown',
      page_url: pageUrl || '',
      captured_at: Date.now(),
      sourceType: 'source_extraction',  // Mark as clean source extraction
      originalUrl: imageUrl,
      contentType,
      sizeBytes: blob.size,
    }
    
    // Store in chrome.storage.local
    await new Promise<void>((resolve, reject) => {
      chrome.storage.local.set({ lastImageCapture: captureData }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else {
          resolve()
        }
      })
    })
    
    console.log('[Catfish] Clean image stored successfully (source extraction)')
    
    // Open side panel
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch(() => {})
    }
    
    return { ok: true }
    
  } catch (err) {
    const error = err as Error
    console.error('[Catfish] Failed to fetch image:', error.message)
    
    // If fetch fails, it might be due to CORS or the URL being invalid
    // Don't automatically fall back - let the content script decide
    throw new Error(`Failed to fetch image: ${error.message}`)
  }
}

/**
 * Convert a Blob to a data URL string
 */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to convert blob to data URL'))
      }
    }
    reader.onerror = () => reject(new Error('FileReader error'))
    reader.readAsDataURL(blob)
  })
}

// ============= Audio Recording Logic =============

let isRecording = false
let currentStreamId: string | null = null

const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html'

async function hasOffscreenDocument(): Promise<boolean> {
  // Check if offscreen document exists
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  })
  return contexts.length > 0
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    console.log('[Catfish] Offscreen document already exists')
    return
  }

  console.log('[Catfish] Creating offscreen document...')
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Recording tab audio for voice note analysis',
  })
  console.log('[Catfish] Offscreen document created')
}

async function handleStartRecording(_tabId?: number): Promise<{ ok: boolean; error?: string }> {
  if (isRecording) {
    return { ok: false, error: 'Already recording' }
  }

  try {
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const tabId = tab?.id

    if (!tabId) {
      return { ok: false, error: 'No active tab found' }
    }

    console.log('[Catfish] Starting tab capture for tab:', tabId)

    // In MV3, we use getMediaStreamId and pass it to the offscreen document
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!id) {
          reject(new Error('Failed to get media stream ID'))
          return
        }
        resolve(id)
      })
    })

    currentStreamId = streamId
    console.log('[Catfish] Got stream ID:', streamId.substring(0, 20) + '...')

    // Ensure offscreen document exists
    await ensureOffscreenDocument()

    // Tell offscreen document to start recording
    const response = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START_RECORDING',
      streamId,
    })

    if (response?.error) {
      throw new Error(response.error)
    }

    isRecording = true
    console.log('[Catfish] Recording started')
    return { ok: true }
  } catch (err) {
    console.error('[Catfish] Failed to start recording:', err)
    isRecording = false
    currentStreamId = null
    return { ok: false, error: (err as Error).message }
  }
}

async function handleStopRecording(): Promise<{ ok: boolean; audioData?: string; error?: string }> {
  if (!isRecording) {
    return { ok: false, error: 'Not recording' }
  }

  try {
    console.log('[Catfish] Stopping recording...')

    // Tell offscreen document to stop recording and get audio data
    const response = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_STOP_RECORDING',
    })

    if (response?.error) {
      throw new Error(response.error)
    }

    isRecording = false
    currentStreamId = null

    console.log('[Catfish] Recording stopped, audio data received')
    return { ok: true, audioData: response.audioData }
  } catch (err) {
    console.error('[Catfish] Failed to stop recording:', err)
    isRecording = false
    currentStreamId = null
    return { ok: false, error: (err as Error).message }
  }
}
