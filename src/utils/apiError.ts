/* src/utils/apiError.ts */

/**
 * Map an unknown error (usually from fetch or request helpers) to a user‑friendly
 * message that the UI can display. The mapping is based on the origin of the
 * request – backend API, government data API, AI service, or Firebase bridge.
 *
 * The caller should pass a context identifier so the function knows which
 * generic message to return.
 */
export function getReadableApiError(error: unknown, context: 'backend' | 'government' | 'ai' | 'firebase'): string {
  if (error instanceof Error) {
    const msg = error.message ?? ''
    if (
      msg.includes('Unable to connect to AquaSense backend') ||
      msg.includes('Unable to load government evidence') ||
      msg.includes('AI service unavailable') ||
      msg.includes('Live data connection unavailable')
    ) {
      return msg
    }
    if (msg.includes('Network') || msg.includes('Failed to fetch') || msg.includes('request failed')) {
      switch (context) {
        case 'backend':
          return 'Unable to connect to AquaSense backend'
        case 'government':
          return 'Unable to load government evidence'
        case 'ai':
          return 'AI service unavailable'
        case 'firebase':
          return 'Live data connection unavailable'
      }
    }
    return msg
  }
  switch (context) {
    case 'backend':
      return 'Unable to connect to AquaSense backend'
    case 'government':
      return 'Unable to load government evidence'
    case 'ai':
      return 'AI service unavailable'
    case 'firebase':
      return 'Live data connection unavailable'
  }
}

