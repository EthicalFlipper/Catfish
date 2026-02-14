// Catfish Offscreen Document for Tab Audio Recording
// This runs in a separate document context and handles MediaRecorder

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let mediaStream: MediaStream | null = null

console.log('[Catfish Offscreen] Offscreen document loaded')

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[Catfish Offscreen] Received message:', message.type)

  switch (message.type) {
    case 'OFFSCREEN_START_RECORDING':
      startRecording(message.streamId)
        .then(() => sendResponse({ ok: true, status: 'recording' }))
        .catch((err) => sendResponse({ error: err.message }))
      return true // Keep channel open for async

    case 'OFFSCREEN_STOP_RECORDING':
      stopRecording()
        .then((base64) => sendResponse({ ok: true, audioData: base64 }))
        .catch((err) => sendResponse({ error: err.message }))
      return true // Keep channel open for async

    case 'OFFSCREEN_GET_STATUS':
      sendResponse({
        recording: mediaRecorder?.state === 'recording',
        state: mediaRecorder?.state || 'inactive',
      })
      break

    default:
      sendResponse({ error: 'Unknown message type' })
  }

  return true
})

async function startRecording(streamId: string): Promise<void> {
  console.log('[Catfish Offscreen] Starting recording with streamId:', streamId)

  // Clean up any existing recording
  if (mediaRecorder) {
    mediaRecorder.stop()
    mediaRecorder = null
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop())
    mediaStream = null
  }
  recordedChunks = []

  // Get the media stream from the tab capture
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      } as MediaTrackConstraints,
      video: false,
    })
  } catch (err) {
    console.error('[Catfish Offscreen] getUserMedia failed:', err)
    throw new Error('Failed to capture tab audio: ' + (err as Error).message)
  }

  // Set up MediaRecorder
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'

  mediaRecorder = new MediaRecorder(mediaStream, { mimeType })

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data)
      console.log('[Catfish Offscreen] Chunk recorded:', event.data.size, 'bytes')
    }
  }

  mediaRecorder.onerror = (event) => {
    console.error('[Catfish Offscreen] MediaRecorder error:', event)
  }

  mediaRecorder.start(1000) // Collect data every second
  console.log('[Catfish Offscreen] MediaRecorder started')
}

async function stopRecording(): Promise<string> {
  console.log('[Catfish Offscreen] Stopping recording...')

  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      reject(new Error('No active recording'))
      return
    }

    mediaRecorder.onstop = async () => {
      console.log('[Catfish Offscreen] MediaRecorder stopped, chunks:', recordedChunks.length)

      // Stop all tracks
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop())
        mediaStream = null
      }

      if (recordedChunks.length === 0) {
        reject(new Error('No audio data recorded'))
        return
      }

      // Combine chunks into a single blob
      const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' })
      console.log('[Catfish Offscreen] Audio blob size:', audioBlob.size, 'bytes')

      // Convert to base64
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        recordedChunks = []
        mediaRecorder = null
        resolve(base64)
      }
      reader.onerror = () => {
        reject(new Error('Failed to convert audio to base64'))
      }
      reader.readAsDataURL(audioBlob)
    }

    mediaRecorder.stop()
  })
}
