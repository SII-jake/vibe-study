/** 解析 Server-Sent Events 数据流，屏蔽 chunk 边界与注释行。 */

export interface SseEvent {
  data: string
}

export interface SseDecoder {
  push(chunk: string): SseEvent[]
}

export function createSseDecoder(): SseDecoder {
  let buffer = ''

  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk.replace(/\r\n/g, '\n')
      const events: SseEvent[] = []
      let separator = buffer.indexOf('\n\n')
      while (separator >= 0) {
        const block = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data !== '') events.push({ data })
        separator = buffer.indexOf('\n\n')
      }
      return events
    },
  }
}
