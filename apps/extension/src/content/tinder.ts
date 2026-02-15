// Catfish Content Script for Tinder Web
// Injects "Analyze this thread" and "Capture profile" buttons

console.log('[Catfish] Content script loaded')

const BUTTON_ID = 'catfish-analyze-btn'
const CAPTURE_BUTTON_ID = 'catfish-capture-btn'
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

// Inject styles for the buttons
function injectStyles() {
  if (document.getElementById('catfish-styles')) return
  
  const style = document.createElement('style')
  style.id = 'catfish-styles'
  style.textContent = `
    /* =============================================
       CATFISH INJECTED BUTTONS
       Consistent with main UI button system
       Using indigo primary color for visibility
       ============================================= */
    .catfish-btn {
      position: fixed;
      right: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 18px;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      font-family: 'Inter', -apple-system, sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      transition: all 0.15s ease;
      z-index: 999998;
    }
    
    /* Primary Action: Analyze Thread */
    #${BUTTON_ID} {
      bottom: 80px;
      background: #6366f1;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(99, 102, 241, 0.4);
    }
    #${BUTTON_ID}:hover {
      transform: translateY(-2px);
      background: #4f46e5;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), 0 6px 24px rgba(99, 102, 241, 0.5);
    }
    #${BUTTON_ID}:active {
      transform: translateY(0);
      background: #4338ca;
    }
    
    /* Secondary Action: Capture Profile */
    #${CAPTURE_BUTTON_ID} {
      bottom: 140px;
      background: #27272a;
      border: 1px solid #3f3f46;
      color: #e8e8ec;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    #${CAPTURE_BUTTON_ID}:hover {
      transform: translateY(-2px);
      background: #3f3f46;
      border-color: #52525b;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3), 0 6px 20px rgba(0, 0, 0, 0.3);
    }
    #${CAPTURE_BUTTON_ID}:active {
      transform: translateY(0);
      background: #52525b;
    }
    
    /* Loading state */
    .catfish-btn.loading {
      opacity: 0.7;
      cursor: wait;
      pointer-events: none;
    }
    
    /* Success state */
    .catfish-btn.success {
      background: #059669 !important;
      border-color: #059669 !important;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2), 0 4px 16px rgba(5, 150, 105, 0.4) !important;
    }
    
    /* Focus state for accessibility */
    .catfish-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px #0a0a0c, 0 0 0 4px rgba(99, 102, 241, 0.5);
    }
    
    /* Disabled state */
    .catfish-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
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
  // Tinder uses <span class="text ..."> for message content
  const messageSelectors = [
    'span.text',
    '[class*="text"][class*="D("]',
    '[class*="messageContent"]',
    '[dir="auto"]',
    'span[class*="Va(t)"]',
  ]
  
  let messageElements: Element[] = []
  
  for (const selector of messageSelectors) {
    try {
      const elements = document.querySelectorAll(selector)
      if (elements.length > 0) {
        messageElements = Array.from(elements)
        break
      }
    } catch {
      // Try next selector
    }
  }
  
  // Fallback: spans with text class
  if (messageElements.length === 0) {
    const allSpans = document.querySelectorAll('span')
    messageElements = Array.from(allSpans).filter(span => {
      const className = span.className || ''
      const text = span.textContent?.trim()
      return className.includes('text') && 
             text && text.length > 0 && text.length < 500 &&
             !className.includes('timestamp') && !className.includes('time')
    })
  }
  
  // Last resort: any text in main area
  if (messageElements.length === 0) {
    const main = document.querySelector('main')
    if (main) {
      const allElements = main.querySelectorAll('span, div')
      messageElements = Array.from(allElements).filter(el => {
        const text = el.textContent?.trim()
        return text && text.length > 1 && text.length < 500 && el.children.length === 0
      })
    }
  }
  
  if (messageElements.length === 0) {
    return { error: 'Could not find messages. Try opening a conversation first.' }
  }
  
  // Build conversation text
  const messages: string[] = []
  const matchName = extractMatchName() || 'Match'
  const seenTexts = new Set<string>()
  const recentMessages = messageElements.slice(-MAX_MESSAGES)
  
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
  
  return { text: messages.join('\n'), count: messages.length }
}

// Handle button click - extract and send to extension
async function handleAnalyzeClick(button: HTMLButtonElement) {
  button.classList.add('loading')
  button.textContent = 'Analyzing...'
  
  try {
    const matchName = extractMatchName()
    const result = extractMessages()
    
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
    } else {
      message.thread_text = result.text
    }
    
    // Send to background script
    chrome.runtime.sendMessage(message, () => {
      button.classList.remove('loading')
      button.textContent = 'Analyze Thread'
      
      if (chrome.runtime.lastError) {
        console.error('[Catfish] Send error:', chrome.runtime.lastError)
      } else if (!('error' in result)) {
        // Brief success indication
        button.classList.add('success')
        setTimeout(() => button.classList.remove('success'), 1500)
      }
    })
  } catch (err) {
    console.error('[Catfish] Extraction error:', err)
    button.classList.remove('loading')
    button.textContent = 'Analyze Thread'
    
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

// Find the profile card/image element on Tinder
function findProfileElement(): { element: Element; bounds: DOMRect } | null {
  const profileSelectors = [
    '[class*="profileCard"]',
    '[class*="Bdrs(8px)"][class*="Bgc(#fff)"]',
    '[class*="recCard"]',
    '[class*="StretchedBox"]',
    '[class*="keen-slider__slide"]',
    '[class*="profileCard__card"]',
    '[data-testid="profile"]',
    'main [class*="Pos(r)"][class*="Ovx(h)"]',
    'main img[class*="StretchedBox"]',
    'main [class*="Expand"]',
  ]
  
  for (const selector of profileSelectors) {
    try {
      const el = document.querySelector(selector)
      if (el) {
        const bounds = el.getBoundingClientRect()
        if (bounds.width >= 100 && bounds.height >= 100 && bounds.top < window.innerHeight) {
          return { element: el, bounds }
        }
      }
    } catch {
      // Try next selector
    }
  }
  
  // Fallback: largest image in main area
  const images = Array.from(document.querySelectorAll('main img')) as HTMLImageElement[]
  let largestImg: HTMLImageElement | null = null
  let largestArea = 0
  
  for (const img of images) {
    const bounds = img.getBoundingClientRect()
    const area = bounds.width * bounds.height
    if (area > largestArea && bounds.width > 150 && bounds.height > 150) {
      largestArea = area
      largestImg = img
    }
  }
  
  if (largestImg) {
    return { element: largestImg, bounds: largestImg.getBoundingClientRect() }
  }
  
  return null
}

// Handle capture button click - screenshot and send to extension
function handleCaptureClick(button: HTMLButtonElement) {
  button.classList.add('loading')
  button.textContent = 'Capturing...'
  
  // Find the profile element to get crop bounds
  const profileResult = findProfileElement()
  
  let cropBounds = null
  if (profileResult) {
    const { bounds } = profileResult
    const padding = 10
    cropBounds = {
      x: Math.max(0, bounds.left - padding) * window.devicePixelRatio,
      y: Math.max(0, bounds.top - padding) * window.devicePixelRatio,
      width: (bounds.width + padding * 2) * window.devicePixelRatio,
      height: (bounds.height + padding * 2) * window.devicePixelRatio,
    }
  }
  
  // Send message to background to capture the tab
  chrome.runtime.sendMessage({
    type: 'CAPTURE_VISIBLE_TAB',
    site: 'tinder',
    page_url: window.location.href,
    cropBounds,
    devicePixelRatio: window.devicePixelRatio,
  }, (response) => {
    button.classList.remove('loading')
    button.textContent = 'Capture Profile'
    
    if (chrome.runtime.lastError) {
      console.error('[Catfish] Capture error:', chrome.runtime.lastError)
    } else if (response?.error) {
      console.error('[Catfish] Capture error:', response.error)
    } else {
      // Brief success indication
      button.classList.add('success')
      setTimeout(() => button.classList.remove('success'), 1500)
    }
  })
}

// Create and inject the buttons
function injectButton() {
  // Inject analyze thread button
  if (!document.getElementById(BUTTON_ID)) {
    const button = document.createElement('button')
    button.id = BUTTON_ID
    button.className = 'catfish-btn'
    button.textContent = 'Analyze Thread'
    button.addEventListener('click', () => handleAnalyzeClick(button))
    document.body.appendChild(button)
  }
  
  // Inject capture profile button
  if (!document.getElementById(CAPTURE_BUTTON_ID)) {
    const captureBtn = document.createElement('button')
    captureBtn.id = CAPTURE_BUTTON_ID
    captureBtn.className = 'catfish-btn'
    captureBtn.textContent = 'Capture Profile'
    captureBtn.addEventListener('click', () => handleCaptureClick(captureBtn))
    document.body.appendChild(captureBtn)
  }
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
  injectStyles()
  injectButton()
  
  // Re-inject on delays for SPA
  setTimeout(injectButton, 1000)
  setTimeout(injectButton, 3000)
  
  // Watch for SPA navigation/rerenders
  const observer = new MutationObserver(() => {
    if (!document.getElementById(BUTTON_ID) || !document.getElementById(CAPTURE_BUTTON_ID)) {
      injectButton()
    }
  })
  
  observer.observe(document.body, { childList: true, subtree: true })
  
  // Handle SPA URL changes
  let lastUrl = location.href
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      setTimeout(injectButton, 500)
    }
    if (!document.getElementById(BUTTON_ID) || !document.getElementById(CAPTURE_BUTTON_ID)) {
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
