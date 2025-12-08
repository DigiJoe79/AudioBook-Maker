/**
 * Audio Silence Generation Utilities
 * For MSE pause insertion
 */

/**
 * Create a silence buffer with specified duration
 * Used for automatic pauses and divider segments
 */
export function createSilenceBuffer(
  audioContext: AudioContext,
  durationMs: number,
  sampleRate: number = 24000,
  numberOfChannels: number = 1
): AudioBuffer {
  const durationSeconds = durationMs / 1000
  const length = Math.floor(sampleRate * durationSeconds)

  const buffer = audioContext.createBuffer(numberOfChannels, length, sampleRate)

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel)
    channelData.fill(0)
  }

  return buffer
}

/**
 * Convert AudioBuffer to WAV Blob
 * Used for MSE SourceBuffer.appendBuffer()
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const length = buffer.length * buffer.numberOfChannels * 2 + 44
  const arrayBuffer = new ArrayBuffer(length)
  const view = new DataView(arrayBuffer)
  const channels: Float32Array[] = []
  let offset = 0
  let pos = 0

  // Write WAV header
  writeString(view, pos, 'RIFF'); pos += 4
  view.setUint32(pos, length - 8, true); pos += 4
  writeString(view, pos, 'WAVE'); pos += 4
  writeString(view, pos, 'fmt '); pos += 4
  view.setUint32(pos, 16, true); pos += 4  // Subchunk1Size (16 for PCM)
  view.setUint16(pos, 1, true); pos += 2   // AudioFormat (1 for PCM)
  view.setUint16(pos, buffer.numberOfChannels, true); pos += 2
  view.setUint32(pos, buffer.sampleRate, true); pos += 4
  view.setUint32(pos, buffer.sampleRate * buffer.numberOfChannels * 2, true); pos += 4 // ByteRate
  view.setUint16(pos, buffer.numberOfChannels * 2, true); pos += 2 // BlockAlign
  view.setUint16(pos, 16, true); pos += 2  // BitsPerSample
  writeString(view, pos, 'data'); pos += 4
  view.setUint32(pos, buffer.length * buffer.numberOfChannels * 2, true); pos += 4

  // Write interleaved audio data
  const interleaved = interleaveChannels(buffer)

  // Convert float to 16-bit PCM
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]))
    view.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
    pos += 2
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

/**
 * Write string to DataView at offset
 */
function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Interleave channels from AudioBuffer
 */
function interleaveChannels(buffer: AudioBuffer): Float32Array {
  const numberOfChannels = buffer.numberOfChannels
  const length = buffer.length * numberOfChannels
  const interleaved = new Float32Array(length)

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel)
    for (let i = 0; i < buffer.length; i++) {
      interleaved[i * numberOfChannels + channel] = channelData[i]
    }
  }

  return interleaved
}
