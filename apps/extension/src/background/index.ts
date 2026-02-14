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
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Catfish] Received message:', message)

  switch (message.type) {
    case 'HEALTH_CHECK':
      sendResponse({ ok: true, timestamp: Date.now() })
      break

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
