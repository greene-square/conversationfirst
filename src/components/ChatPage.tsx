import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '../hooks/useChat';
import { useChatDB } from '../hooks/useChatDB';
import { useBrain } from '../hooks/useBrain';
import { useBrainGuest } from '../hooks/useBrainGuest';
import { validateImage, validateImageCount } from '../lib/imageUpload';
import ChatMessage from './ChatMessage';
import ChatProcessing from './ChatProcessing';
import ChatInput from './ChatInput';
import MarkdownRenderer from './MarkdownRenderer';

const SUGGESTIONS = [
  'Write me a system prompt that follows the 7 voice rules',
  'How do I set up the typography tokens?',
  'Show me how the citation system works',
  'What are the 5 processing state tiers?',
  'Help me configure dark mode with the colour tokens',
  'What components are in the framework?',
];

let nextImageId = 0;

export default function ChatPage({
  conversations,
  activeId,
  setActiveId,
  createConversation,
  updateTitle,
  deleteConversation,
  isAuthenticated,
  useDB = false,
  user,
  session,
}) {
  const [stagedImages, setStagedImages] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showDropFlash, setShowDropFlash] = useState(false);
  const dragCounter = useRef(0);

  const accessToken = session?.access_token || null;
  const newConvoIdRef = useRef(null);

  // Handle ?new hash for creating a new conversation from landing page
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('?new')) {
      const result = createConversation();
      if (result && typeof result.then === 'function') {
        result.then(id => { if (id) newConvoIdRef.current = id; });
      } else if (result) {
        newConvoIdRef.current = result;
      }
      window.location.hash = '#/chat';
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeConversation = conversations.find(c => c.id === activeId);

  // Brain: memory system for recall and summarization
  const brain = useBrain(accessToken);
  const brainGuest = useBrainGuest(accessToken);
  const activeBrain = useDB ? brain : brainGuest;

  // Use DB-backed hook when authenticated AND DB is available, otherwise localStorage
  const guestChat = useChat(useDB ? null : activeId, updateTitle, activeBrain);
  const dbChat = useChatDB(useDB ? activeId : null, updateTitle, accessToken, activeBrain);
  const { messages, isStreaming, isSearching, isUploading, streamingContent, error, sendMessage, clearError } =
    useDB ? dbChat : guestChat;

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const lastUserMsgRef = useRef(null);
  const prevStreamingRef = useRef(false);
  const pendingSentRef = useRef(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);

  // Send pending message from landing page floating input
  useEffect(() => {
    if (!activeId || pendingSentRef.current) return;
    const pending = sessionStorage.getItem('cf-pending-message');
    if (!pending) return;
    if (newConvoIdRef.current && activeId !== newConvoIdRef.current) return;
    sessionStorage.removeItem('cf-pending-message');
    pendingSentRef.current = true;
    newConvoIdRef.current = null;
    setTimeout(() => sendMessage(pending), 50);
  }, [activeId, sendMessage, isAuthenticated]);

  // Scroll user's prompt to the top of the viewport when streaming starts.
  // No auto-scroll during streaming. The user reads at their own pace.
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current && lastUserMsgRef.current) {
      lastUserMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Show header border on scroll
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const onScroll = () => setHeaderScrolled(el.scrollTop > 8);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Clean up staged image previews on unmount or clear
  useEffect(() => {
    return () => {
      stagedImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, [stagedImages]);

  // Image staging
  const addImages = useCallback((files) => {
    const validFiles = [];
    for (const file of files) {
      const err = validateImage(file);
      if (err) continue;
      validFiles.push(file);
    }

    setStagedImages(prev => {
      const countErr = validateImageCount(prev.length, validFiles.length);
      if (countErr) return prev;

      const newImages = validFiles.map(file => ({
        id: ++nextImageId,
        file,
        preview: URL.createObjectURL(file),
      }));
      return [...prev, ...newImages];
    });
  }, []);

  const removeImage = useCallback((id) => {
    setStagedImages(prev => {
      const img = prev.find(i => i.id === id);
      if (img) URL.revokeObjectURL(img.preview);
      return prev.filter(i => i.id !== id);
    });
  }, []);

  const handleSend = useCallback((text, imageFiles = []) => {
    sendMessage(text, imageFiles);
    setStagedImages(prev => {
      prev.forEach(img => URL.revokeObjectURL(img.preview));
      return [];
    });
  }, [sendMessage]);

  // Page-level drag and drop
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      addImages(files);
      setShowDropFlash(true);
      setTimeout(() => setShowDropFlash(false), 500);
    }
  }, [addImages]);

  // Auto-create a conversation if none is active
  useEffect(() => {
    if (!activeId && conversations.length === 0) {
      createConversation();
    } else if (!activeId && conversations.length > 0) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations, createConversation, setActiveId]);

  const inputDisabled = isStreaming || isUploading;

  // Wait for an active conversation before rendering
  if (!activeId) return null;

  // ─── CHAT VIEW ───
  return (
    <div
      className="chat-page"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <a href="#chat-main" className="skip-link">Skip to content</a>

      <header className={`chat-header${headerScrolled ? ' scrolled' : ''}`}>
        {activeConversation?.title && (
          <div className="chat-header-title">
            {activeConversation.title}
          </div>
        )}
      </header>

      <main id="chat-main" className="chat-messages" ref={messagesContainerRef} style={{ position: 'relative' }}>
        {isDragging && (
          <div className="chat-drop-overlay" aria-hidden="true">
            <div className="mic-drop-ripple" />
            <div className="mic-drop-ripple" />
            <div className="mic-drop-ripple" />
            <svg className="mic-drop-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="21" />
              <line x1="8" y1="21" x2="16" y2="21" />
            </svg>
            <span className="mic-drop-text">Drop it</span>
          </div>
        )}
        {showDropFlash && <div className="chat-drop-flash" />}

        <div className="chat-messages-inner">
          {messages.length === 0 && !isStreaming ? (
            <div className="chat-welcome">
              <div className="welcome-section">
                <div className="welcome-section-label">What this chat does</div>
                <p className="welcome-desc">
                  This assistant knows the entire Conversation First framework. It helps you apply the method, including voice rules, design tokens, citation system, processing states, and components, to your own AI products.
                </p>
              </div>

              <div className="welcome-section">
                <div className="welcome-section-label">Try asking</div>
                <div className="welcome-suggestions">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      className="welcome-suggestion"
                      onClick={() => sendMessage(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="welcome-rules">
                <div className="welcome-section-label">The 7 rules this chat follows</div>
                <div className="welcome-rules-grid">
                  {[
                    ['1', 'Answer first', 'Direct answer in the first sentence'],
                    ['2', 'Cite everything', 'Every claim has a source'],
                    ['3', 'Give examples', 'Code, data, or before/after'],
                    ['4', 'Stop when done', 'No padding or summaries'],
                    ['5', 'No emotion', 'Facts, not feelings'],
                    ['6', 'Short sentences', 'One idea per sentence'],
                    ['7', 'No filler', 'Every word earns its place'],
                  ].map(([num, title, desc]) => (
                    <div key={num} className="welcome-rule">
                      <span className="welcome-rule-num">{num}</span>
                      <div>
                        <strong>{title}.</strong>{' '}
                        <span className="welcome-rule-desc">{desc}.</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => {
                const isLastUser = m.role === 'user' &&
                  !messages.slice(i + 1).some(msg => msg.role === 'user');
                return (
                  <div key={i} ref={isLastUser ? lastUserMsgRef : undefined}>
                    <ChatMessage message={m} showPlayAction />
                  </div>
                );
              })}

              {isStreaming && (
                <div className="chat-bubble streaming">
                  {isSearching && (
                    <div className="search-indicator" role="status" aria-live="polite">
                      <div className="processing-status">
                        <div className="processing-cursor" aria-hidden="true" />
                        <span className="processing-text">
                          Searching the web<span className="dot" aria-hidden="true">.</span><span className="dot" aria-hidden="true">.</span><span className="dot" aria-hidden="true">.</span>
                        </span>
                      </div>
                    </div>
                  )}
                  {streamingContent ? (
                    <div className="streaming-content">
                      <MarkdownRenderer content={streamingContent} />
                      <span className="streaming-cursor" />
                    </div>
                  ) : !isSearching ? (
                    <ChatProcessing />
                  ) : null}
                </div>
              )}

              {error && (
                <div className="alert alert-destructive" role="alert">
                  <div style={{ flex: 1 }}><strong>Error:</strong> {error}</div>
                  <button
                    onClick={clearError}
                    aria-label="Dismiss error"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'var(--text-lg)', padding: 'var(--space-1)', lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </main>

      <ChatInput
        onSend={handleSend}
        disabled={inputDisabled}
        stagedImages={stagedImages}
        onAddImages={addImages}
        onRemoveImage={removeImage}
      />

      {isUploading && (
        <div className="chat-upload-indicator" role="status" aria-live="polite">
          Uploading images...
        </div>
      )}
    </div>
  );
}
