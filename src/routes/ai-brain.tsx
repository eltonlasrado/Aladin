import { createFileRoute } from '@tanstack/react-router'
import { useState, useRef, useEffect } from 'react'
import { Brain, Send, User, Bot, Loader2, Code2 } from 'lucide-react'

export const Route = createFileRoute('/ai-brain')({
  component: AIBrain,
})

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED_QUESTIONS = [
  'Write a Python script to fetch live Nifty option chain data.',
  'What is the best strategy for Bank Nifty options this week?',
  'Explain Iron Condor strategy for Nifty monthly expiry',
  'Write a Pine Script for an EMA crossover strategy.',
  'What is Put-Call Ratio and how to interpret it?',
  'Explain Open Interest analysis for support/resistance',
]

function AIBrain() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Namaste! I am the AI Brain of the Aladdin Trading System. Powered by advanced models, I can assist you with F&O strategies, technical analysis, and even write custom algorithmic trading scripts. How can I help you today?',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Custom parser to format code blocks (```code```) and bold text (**text**) natively
  const formatMessage = (content: string) => {
    const segments = content.split(/(```[\s\S]*?```)/g)
    
    return segments.map((segment, index) => {
      // Handle Code Blocks
      if (segment.startsWith('```') && segment.endsWith('```')) {
        const match = segment.match(/```(\w+)?\n([\s\S]*?)```/)
        const lang = match?.[1] || 'code'
        const code = match?.[2] || segment.slice(3, -3)
        return (
          <div key={index} className="my-3 rounded-lg overflow-hidden border border-gray-700 shadow-lg">
            <div className="bg-gray-900 px-3 py-1.5 flex items-center gap-2 border-b border-gray-700">
              <Code2 className="w-3 h-3 text-green-400" />
              <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">{lang}</span>
            </div>
            <pre className="bg-[#0d1117] p-4 overflow-x-auto text-[13px] text-green-300 font-mono leading-relaxed">
              <code>{code.trim()}</code>
            </pre>
          </div>
        )
      }
      
      // Handle Bold Text and Line Breaks
      const boldSegments = segment.split(/(\*\*.*?\*\*)/g)
      return (
        <span key={index}>
          {boldSegments.map((boldSeg, bIndex) => {
            if (boldSeg.startsWith('**') && boldSeg.endsWith('**')) {
              return <strong key={bIndex} className="font-bold text-green-400">{boldSeg.slice(2, -2)}</strong>
            }
            return (
              <span key={bIndex}>
                {boldSeg.split('\n').map((line, lIndex) => (
                  <span key={lIndex}>
                    {line}
                    {lIndex < boldSeg.split('\n').length - 1 && <br />}
                  </span>
                ))}
              </span>
            )
          })}
        </span>
      )
    })
  }

  async function sendMessage(content: string) {
    if (!content.trim() || loading) return

    const userMsg: Message = { role: 'user', content: content.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      // Map history for Gemini API context awareness
      const apiHistory = newMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: apiHistory }),
      })
      
      const data = await res.json()
      setMessages([...newMessages, { role: 'assistant', content: data.response || 'Sorry, I encountered a systemic error.' }])
    } catch {
      setMessages([...newMessages, { role: 'assistant', content: '**Network Error:** Please check your connection to the Aladdin server.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#050a12]">
      {/* Header */}
      <div className="p-4 md:p-6 pb-3 border-b border-gray-800 shrink-0 bg-[#0a1221]">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Brain className="w-5 h-5 text-[#00d4ff]" />
          Aladdin AI Brain
        </h1>
        <p className="text-xs text-gray-400 mt-1">Institutional-Grade Market Intelligence & Code Generation</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-lg ${msg.role === 'user' ? 'bg-[#00d4ff]/20 border border-[#00d4ff]' : 'bg-purple-500/20 border border-purple-500'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4 text-[#00d4ff]" /> : <Bot className="w-4 h-4 text-purple-400" />}
            </div>
            <div className={`max-w-[85%] rounded-2xl px-5 py-3.5 text-sm leading-relaxed shadow-md ${msg.role === 'user' ? 'bg-[#00d4ff]/10 text-white border border-[#00d4ff]/30 rounded-tr-none' : 'bg-gray-800/50 text-gray-200 border border-gray-700 rounded-tl-none'}`}>
              {formatMessage(msg.content)}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3 flex-row">
            <div className="w-8 h-8 rounded-full bg-purple-500/20 border border-purple-500 flex items-center justify-center shrink-0 shadow-lg">
              <Bot className="w-4 h-4 text-purple-400" />
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl rounded-tl-none px-5 py-3.5 flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-[#00d4ff] animate-spin" />
              <span className="text-sm text-gray-400 tracking-wide">Processing market logic...</span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggested Questions */}
      {messages.length <= 1 && (
        <div className="px-4 md:px-6 pb-2 shrink-0">
          <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider font-semibold">Suggested Prompts:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="text-xs bg-gray-800/50 hover:bg-[#00d4ff]/10 hover:text-[#00d4ff] hover:border-[#00d4ff]/50 border border-gray-700 text-gray-300 px-3 py-2 rounded-lg transition-all text-left"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 md:p-6 pt-3 border-t border-gray-800 shrink-0 bg-[#0a1221]">
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Aladdin to analyze data, explain strategies, or write trading code... (Enter to send)"
            rows={2}
            className="flex-1 bg-black/50 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#00d4ff] focus:ring-1 focus:ring-[#00d4ff]/50 resize-none transition-all"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="px-5 bg-gradient-to-br from-[#00d4ff] to-blue-600 hover:from-blue-400 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-black rounded-xl transition-all flex items-center justify-center shrink-0 shadow-lg shadow-[#00d4ff]/20"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[10px] text-gray-600 mt-2 text-center uppercase tracking-widest">Aladdin AI can make mistakes. Verify critical trades.</p>
      </div>
    </div>
  )
}
