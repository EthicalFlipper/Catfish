// Catfish Background Service Worker
// Handles extension lifecycle and message passing

console.log('[Catfish] Background service worker started')

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id })
  }
})

// Message listener for communication between UI and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Catfish] Received message:', message, 'from:', sender)

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

    case 'START_RECORDING':
      // TODO: Implement tabCapture + offscreen recording
      sendResponse({ status: 'not_implemented' })
      break

    case 'STOP_RECORDING':
      // TODO: Implement recording stop
      sendResponse({ status: 'not_implemented' })
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
