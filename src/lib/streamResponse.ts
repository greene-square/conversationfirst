export async function streamResponse(messages, callbacks, accessToken, memories = []) {
  const { onChunk, onDone, onError, onSearchStart, onSearchDone, onContentBlock, onPauseTurn } = callbacks;

  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const payload = { messages };
  if (memories && memories.length > 0) {
    payload.memories = memories;
  }

  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    onError('Network error. Check your connection.');
    return;
  }

  if (!response.ok) {
    let errMsg = `Error ${response.status}`;
    try {
      const data = await response.json();
      errMsg = data.error || errMsg;
    } catch {}
    onError(errMsg);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = null;

  // A declined request may stop with partial or no text: show an error
  // rather than saving it as the assistant's reply.
  const finish = () => stopReason === 'refusal'
    ? onError('That request was declined. Try rephrasing your message.')
    : onDone(stopReason);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          finish();
          return;
        }
        try {
          const parsed = JSON.parse(data);

          // Content block started: detect search tool use and results
          if (parsed.type === 'content_block_start') {
            const block = parsed.content_block;
            if (block.type === 'server_tool_use' && block.name === 'web_search') {
              onSearchStart?.();
            }
            if (block.type === 'web_search_tool_result') {
              onSearchDone?.(block.content);
            }
            // Track all content blocks for multi-turn
            onContentBlock?.(block);
          }

          // Text deltas: regular text streaming
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            onChunk(parsed.delta.text);
          }

          // Capture stop reason (may be pause_turn)
          if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
            stopReason = parsed.delta.stop_reason;
          }

          if (parsed.type === 'message_stop') {
            finish();
            return;
          }
        } catch {}
      }
    }
  } catch (err) {
    onError('Stream interrupted.');
    return;
  }

  finish();
}
