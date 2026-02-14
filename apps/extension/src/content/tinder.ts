// Catfish Content Script for Tinder Web
// Injects "Analyze this thread" button and extracts conversation

// ===== DEBUG: Prove content script loaded =====
console.log('[Catfish] tinder content script loaded', location.href)
document.documentElement.setAttribute('data-catfish-loaded', 'true')

// Inject a temporary debug banner to confirm script is running
const debugBanner = document.createElement('div')
debugBanner.id = 'catfish-debug-banner'
debugBanner.style.cssText = `
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #6366f1;
  color: white;
  padding: 8px 16px;
  font-size: 14px;
  font-weight: bold;
  z-index: 999999;
  text-align: center;
`
debugBanner.textContent = '🐱 Catfish content script injected! (debug banner - remove later)'
document.body?.appendChild(debugBanner) || document.addEventListener('DOMContentLoaded', () => document.body.appendChild(debugBanner))
// ===== END DEBUG =====

const BUTTON_ID = 'catfish-analyze-btn'
const MAX_MESSAGES = 30

interface ThreadImportMessage {
  type: 'THREAD_IMPORT'
  site: 'tinder'
  thread_text: string
  match_name?: string
  page_url: string
  error?: string
  timestamp: number
}

// Inject styles for the button
function injectStyles() {
  if (document.getElementById('catfish-styles')) return
  
  const style = document.createElement('style')
  style.id = 'catfish-styles'
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed;
      bottom: 80px;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 16px;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      border: none;
      border-radius: 24px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
      z-index: 999998;
    }
    #${BUTTON_ID}:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
    }
    #${BUTTON_ID}:active {
      transform: translateY(0);
    }
    #${BUTTON_ID}.loading {
      opacity: 0.7;
      cursor: wait;
    }
    #${BUTTON_ID} .icon {
      font-size: 16px;
    }
  `
  document.head.appendChild(style)
}

// Try to find the match name from the chat header
function extractMatchName(): string | undefined {
  // Tinder chat header selectors (may need updates as Tinder changes)
  const selectors = [
    '[class*="matchName"]',
    '[class*="Typs(display-1-strong)"]',
    '.messageListHeader h1',
    '.chatHeader span',
    '[data-testid="chat-header"] span',
    'header h1',
    'header h2',
  ]
  
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector)
      if (el?.textContent?.trim()) {
        return el.textContent.trim()
      }
    } catch {
      // Selector failed, try next
    }
  }
  return undefined
}

// Extract messages from the chat
function extractMessages(): { text: string; count: number } | { error: string } {
  console.log('[Catfish] Starting message extraction...')
  
  // Find message text elements - Tinder uses <span class="text ..."> for message content
  // Example: <span class="text D(ib) Va(t)">Yes plz</span>
  const messageSelectors = [
    'span.text',                    // Primary: span with class "text"
    '[class*="text"][class*="D("]', // Atomic CSS pattern
    '[class*="messageContent"]',
    '[dir="auto"]',
    'span[class*="Va(t)"]',
  ]
  
  let messageElements: Element[] = []
  
  for (const selector of messageSelectors) {
    try {
      const elements = document.querySelectorAll(selector)
      console.log(`[Catfish] Selector "${selector}" found ${elements.length} elements`)
      if (elements.length > 0) {
        messageElements = Array.from(elements)
        break
      }
    } catch (e) {
      console.log(`[Catfish] Selector "${selector}" failed:`, e)
    }
  }
  
  // Fallback: find all spans that look like message text
  if (messageElements.length === 0) {
    console.log('[Catfish] Trying fallback: all spans with text class')
    const allSpans = document.querySelectorAll('span')
    messageElements = Array.from(allSpans).filter(span => {
      const className = span.className || ''
      const text = span.textContent?.trim()
      // Look for spans with "text" in class and reasonable text content
      return className.includes('text') && 
             text && 
             text.length > 0 && 
             text.length < 500 &&
             !className.includes('timestamp') &&
             !className.includes('time')
    })
    console.log(`[Catfish] Fallback found ${messageElements.length} elements`)
  }
  
  // Last resort: find any element with text content in the main chat area
  if (messageElements.length === 0) {
    console.log('[Catfish] Trying last resort: any text in main')
    const main = document.querySelector('main')
    if (main) {
      const allElements = main.querySelectorAll('span, div')
      messageElements = Array.from(allElements).filter(el => {
        const text = el.textContent?.trim()
        const children = el.children.length
        return text && text.length > 1 && text.length < 500 && children === 0
      })
    }
    console.log(`[Catfish] Last resort found ${messageElements.length} elements`)
  }
  
  if (messageElements.length === 0) {
    return { error: 'Could not find messages. Try opening a conversation first, or copy/paste manually.' }
  }
  
  // Build conversation text
  const messages: string[] = []
  const matchName = extractMatchName() || 'Match'
  const seenTexts = new Set<string>() // Avoid duplicates
  
  // Take last N messages
  const recentMessages = messageElements.slice(-MAX_MESSAGES)
  console.log(`[Catfish] Processing ${recentMessages.length} message elements`)
  
  for (const el of recentMessages) {
    const text = el.textContent?.trim()
    if (!text || seenTexts.has(text)) continue
    seenTexts.add(text)
    
    // Determine sender by checking if message bubble is on right (user) or left (match)
    // Tinder uses Ta(e) for text-align:end (right side = user's messages)
    let isFromUser = false
    
    // Walk up the DOM to find the message container
    let parent: Element | null = el
    for (let i = 0; i < 10 && parent; i++) {
      const className = parent.className || ''
      // Check for right-alignment indicators (user's messages)
      if (className.includes('Ta(e)') || 
          className.includes('End') || 
          className.includes('sent') ||
          className.includes('self') ||
          className.includes('right')) {
        isFromUser = true
        break
      }
      // Check for left-alignment indicators (match's messages)  
      if (className.includes('Ta(s)') || 
          className.includes('Start') ||
          className.includes('received') ||
          className.includes('other') ||
          className.includes('left')) {
        isFromUser = false
        break
      }
      parent = parent.parentElement
    }
    
    const sender = isFromUser ? 'You' : matchName
    messages.push(`${sender}: ${text}`)
  }
  
  if (messages.length === 0) {
    return { error: 'Found elements but no text content. Try copy/paste manually.' }
  }
  
  console.log(`[Catfish] Extracted ${messages.length} messages`)
  return { text: messages.join('\n'), count: messages.length }
}

// Handle button click
async function handleAnalyzeClick(button: HTMLButtonElement) {
  console.log('[Catfish] Button clicked!')
  alert('[Catfish DEBUG] Button clicked! Check console for details.')
  
  button.classList.add('loading')
  button.textContent = 'Extracting...'
  
  try {
    console.log('[Catfish] Extracting match name...')
    const matchName = extractMatchName()
    console.log('[Catfish] Match name:', matchName)
    
    console.log('[Catfish] Extracting messages...')
    const result = extractMessages()
    console.log('[Catfish] Extract result:', result)
    
    const message: ThreadImportMessage = {
      type: 'THREAD_IMPORT',
      site: 'tinder',
      thread_text: '',
      match_name: matchName,
      page_url: window.location.href,
      timestamp: Date.now(),
    }
    
    if ('error' in result) {
      message.error = result.error
      message.thread_text = ''
      console.log('[Catfish] Extraction had error:', result.error)
      alert('[Catfish] Could not extract messages: ' + result.error)
    } else {
      message.thread_text = result.text
      console.log(`[Catfish] Extracted ${result.count} messages:`, result.text.substring(0, 200))
      alert(`[Catfish] Extracted ${result.count} messages! Sending to extension...`)
    }
    
    // Send to background script
    console.log('[Catfish] Sending message to background:', message.type)
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Catfish] Send error:', chrome.runtime.lastError)
        alert('Catfish: Failed to send to extension: ' + chrome.runtime.lastError.message)
      } else {
        console.log('[Catfish] Message sent successfully:', response)
        alert('[Catfish] Message sent! Open the Catfish side panel to see results.')
      }
    })
    
    // Reset button
    button.classList.remove('loading')
    button.innerHTML = '<span class="icon">🐱</span> Analyze this thread'
    
    if (!('error' in result)) {
      // Brief success indication
      button.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
      setTimeout(() => {
        button.style.background = ''
      }, 2000)
    }
  } catch (err) {
    console.error('[Catfish] Extraction error:', err)
    alert('[Catfish] Error: ' + (err as Error).message)
    button.classList.remove('loading')
    button.innerHTML = '<span class="icon">🐱</span> Analyze this thread'
    
    // Send error message
    chrome.runtime.sendMessage({
      type: 'THREAD_IMPORT',
      site: 'tinder',
      thread_text: '',
      page_url: window.location.href,
      error: 'Extraction failed. Please copy/paste the conversation manually.',
      timestamp: Date.now(),
    } as ThreadImportMessage)
  }
}

// Create and inject the button
function injectButton() {
  // Don't inject if already exists
  if (document.getElementById(BUTTON_ID)) {
    console.log('[Catfish] Button already exists, skipping injection')
    return
  }
  
  console.log('[Catfish] Attempting button injection...')
  
  // For debugging: always inject as fixed position button
  // This ensures visibility regardless of Tinder's DOM structure
  const button = document.createElement('button')
  button.id = BUTTON_ID
  button.innerHTML = '<span class="icon">🐱</span> Analyze this thread'
  button.addEventListener('click', () => handleAnalyzeClick(button))
  
  // Append to body with fixed positioning (styles handle the rest)
  document.body.appendChild(button)
  console.log('[Catfish] Button injected successfully!')
}

// Remove button if it exists
function removeButton() {
  const button = document.getElementById(BUTTON_ID)
  if (button) {
    button.remove()
  }
}

// Initialize
function init() {
  console.log('[Catfish] init() called')
  injectStyles()
  
  // Initial injection attempt - immediate and delayed
  injectButton()
  setTimeout(injectButton, 1000)
  setTimeout(injectButton, 3000)
  
  // Watch for SPA navigation/rerenders - re-inject if button disappears
  const observer = new MutationObserver((_mutations) => {
    const buttonExists = document.getElementById(BUTTON_ID)
    if (!buttonExists) {
      console.log('[Catfish] Button missing, re-injecting...')
      injectButton()
    }
  })
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })
  
  // Also try on URL changes (SPA navigation)
  let lastUrl = location.href
  setInterval(() => {
    if (location.href !== lastUrl) {
      console.log('[Catfish] URL changed, re-injecting button')
      lastUrl = location.href
      setTimeout(injectButton, 500)
    }
    // Periodic check to ensure button exists
    if (!document.getElementById(BUTTON_ID)) {
      injectButton()
    }
  }, 2000)
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
