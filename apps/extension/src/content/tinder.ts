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

// =============================================================================
// SOURCE IMAGE EXTRACTION (Not Screenshot)
// =============================================================================
// This extracts the ACTUAL image URL from the page, avoiding UI overlay issues.
// Strategy: Find <img src> or <div style="background-image"> and fetch the raw URL.

interface ExtractedImage {
  url: string
  type: 'img_src' | 'background_image'
  element: Element
  width: number
  height: number
}

/**
 * Extract the main profile image URL from the page.
 * This is the SOURCE EXTRACTION strategy - gets the clean image URL
 * instead of taking a screenshot that includes UI overlays.
 */
function extractProfileImageUrl(): ExtractedImage | null {
  console.log('[Catfish] Extracting profile image URL...')
  
  // =========================================
  // Strategy 1: Find the largest visible <img>
  // =========================================
  const images = Array.from(document.querySelectorAll('img')) as HTMLImageElement[]
  let bestImg: HTMLImageElement | null = null
  let bestArea = 0
  
  for (const img of images) {
    // Skip tiny images (icons, avatars, etc.)
    if (!img.src || img.src.startsWith('data:')) continue
    
    const bounds = img.getBoundingClientRect()
    const area = bounds.width * bounds.height
    
    // Must be reasonably large and visible
    if (bounds.width >= 200 && bounds.height >= 200 && 
        bounds.top < window.innerHeight && bounds.bottom > 0 &&
        area > bestArea) {
      
      // Check if it looks like a profile image (not UI element)
      const src = img.src.toLowerCase()
      const isProfileImage = 
        src.includes('images-ssl') ||  // Tinder CDN
        src.includes('gotinder') ||
        src.includes('tindersparks') ||
        src.includes('profile') ||
        src.includes('photo') ||
        src.includes('user') ||
        src.includes('media') ||
        src.includes('cdn') ||
        // Generic image hosting
        src.includes('cloudfront') ||
        src.includes('amazonaws') ||
        src.includes('imgix') ||
        // Exclude obvious non-profile images
        (!src.includes('logo') && 
         !src.includes('icon') && 
         !src.includes('emoji') &&
         !src.includes('badge') &&
         !src.includes('button'))
      
      if (isProfileImage) {
        bestArea = area
        bestImg = img
      }
    }
  }
  
  if (bestImg && bestImg.src) {
    console.log('[Catfish] Found profile image via <img> tag:', bestImg.src.substring(0, 80) + '...')
    const bounds = bestImg.getBoundingClientRect()
    return {
      url: bestImg.src,
      type: 'img_src',
      element: bestImg,
      width: bounds.width,
      height: bounds.height
    }
  }
  
  // =========================================
  // Strategy 2: Find div with background-image
  // (Common on Tinder/Bumble for card-style layouts)
  // =========================================
  console.log('[Catfish] No <img> found, checking background-image...')
  
  // Selectors for profile card containers
  const containerSelectors = [
    '[class*="profileCard"]',
    '[class*="recCard"]',
    '[class*="StretchedBox"]',
    '[class*="keen-slider__slide"]',
    '[class*="Expand"]',
    '[class*="gamepad-profile"]',
    '[data-testid*="profile"]',
    'main [class*="Pos(r)"]',
    'main [class*="Bgp(c)"]',  // Tinder: background-position: center
    'main [class*="Bgsz(cv)"]', // Tinder: background-size: cover
  ]
  
  // Search in profile containers and their children
  for (const selector of containerSelectors) {
    try {
      const containers = document.querySelectorAll(selector)
      for (const container of containers) {
        const bgUrl = extractBackgroundImageUrl(container)
        if (bgUrl) {
          const bounds = container.getBoundingClientRect()
          if (bounds.width >= 200 && bounds.height >= 200) {
            console.log('[Catfish] Found profile image via background-image:', bgUrl.substring(0, 80) + '...')
            return {
              url: bgUrl,
              type: 'background_image',
              element: container,
              width: bounds.width,
              height: bounds.height
            }
          }
        }
        
        // Check children too
        const children = container.querySelectorAll('div, span')
        for (const child of children) {
          const childBgUrl = extractBackgroundImageUrl(child)
          if (childBgUrl) {
            const bounds = child.getBoundingClientRect()
            if (bounds.width >= 200 && bounds.height >= 200) {
              console.log('[Catfish] Found profile image via child background-image:', childBgUrl.substring(0, 80) + '...')
              return {
                url: childBgUrl,
                type: 'background_image',
                element: child,
                width: bounds.width,
                height: bounds.height
              }
            }
          }
        }
      }
    } catch {
      // Selector failed, continue
    }
  }
  
  // =========================================
  // Strategy 3: Brute force - check ALL visible divs
  // =========================================
  console.log('[Catfish] Fallback: checking all divs for background-image...')
  
  const allDivs = document.querySelectorAll('div')
  let bestBgDiv: Element | null = null
  let bestBgUrl = ''
  let bestBgArea = 0
  
  for (const div of allDivs) {
    const bgUrl = extractBackgroundImageUrl(div)
    if (bgUrl) {
      const bounds = div.getBoundingClientRect()
      const area = bounds.width * bounds.height
      
      if (bounds.width >= 200 && bounds.height >= 200 &&
          bounds.top < window.innerHeight && bounds.bottom > 0 &&
          area > bestBgArea) {
        // Exclude obvious non-profile patterns
        const isLikelyProfile = 
          !bgUrl.includes('gradient') &&
          !bgUrl.includes('logo') &&
          !bgUrl.includes('icon') &&
          (bgUrl.includes('http://') || bgUrl.includes('https://'))
        
        if (isLikelyProfile) {
          bestBgArea = area
          bestBgDiv = div
          bestBgUrl = bgUrl
        }
      }
    }
  }
  
  if (bestBgDiv && bestBgUrl) {
    const bounds = bestBgDiv.getBoundingClientRect()
    console.log('[Catfish] Found profile image via brute-force search:', bestBgUrl.substring(0, 80) + '...')
    return {
      url: bestBgUrl,
      type: 'background_image',
      element: bestBgDiv,
      width: bounds.width,
      height: bounds.height
    }
  }
  
  console.log('[Catfish] Could not find profile image URL')
  return null
}

/**
 * Extract URL from background-image CSS property
 */
function extractBackgroundImageUrl(element: Element): string | null {
  const style = window.getComputedStyle(element)
  const bgImage = style.backgroundImage
  
  if (!bgImage || bgImage === 'none') return null
  
  // Parse url() from background-image
  // Handles: url("https://..."), url('https://...'), url(https://...)
  const match = bgImage.match(/url\(["']?(https?:\/\/[^"')]+)["']?\)/)
  if (match && match[1]) {
    return match[1]
  }
  
  return null
}

/**
 * Handle capture button click - EXTRACT SOURCE IMAGE (not screenshot)
 */
async function handleCaptureClick(button: HTMLButtonElement) {
  button.classList.add('loading')
  button.textContent = 'Extracting...'
  
  try {
    // Extract the profile image URL
    const extracted = extractProfileImageUrl()
    
    if (!extracted) {
      // Fallback to screenshot if no image URL found
      console.log('[Catfish] No image URL found, falling back to screenshot...')
      button.textContent = 'Capturing...'
      
      chrome.runtime.sendMessage({
        type: 'CAPTURE_VISIBLE_TAB',
        site: 'tinder',
        page_url: window.location.href,
        fallback: true,
      }, (response) => {
        button.classList.remove('loading')
        button.textContent = 'Capture Profile'
        
        if (chrome.runtime.lastError) {
          console.error('[Catfish] Capture error:', chrome.runtime.lastError)
        } else if (response?.error) {
          console.error('[Catfish] Capture error:', response.error)
        } else {
          button.classList.add('success')
          setTimeout(() => button.classList.remove('success'), 1500)
        }
      })
      return
    }
    
    console.log('[Catfish] Sending image URL to background for fetch:', extracted.url.substring(0, 80) + '...')
    
    // Send the URL to background script to fetch the clean image
    // (Background script handles CORS by fetching from extension context)
    chrome.runtime.sendMessage({
      type: 'FETCH_PROFILE_IMAGE',
      imageUrl: extracted.url,
      site: 'tinder',
      page_url: window.location.href,
      extractionType: extracted.type,
      dimensions: {
        width: extracted.width,
        height: extracted.height
      }
    }, (response) => {
      button.classList.remove('loading')
      button.textContent = 'Capture Profile'
      
      if (chrome.runtime.lastError) {
        console.error('[Catfish] Fetch error:', chrome.runtime.lastError)
      } else if (response?.error) {
        console.error('[Catfish] Fetch error:', response.error)
        // Show error state briefly
        button.textContent = 'Error - Retry'
        setTimeout(() => { button.textContent = 'Capture Profile' }, 2000)
      } else {
        console.log('[Catfish] Clean image fetched successfully')
        button.classList.add('success')
        setTimeout(() => button.classList.remove('success'), 1500)
      }
    })
    
  } catch (err) {
    console.error('[Catfish] Image extraction error:', err)
    button.classList.remove('loading')
    button.textContent = 'Capture Profile'
  }
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
