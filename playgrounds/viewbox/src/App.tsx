import { FormEvent, useState } from 'react'

const defaultPrompt = '用三句话说明 Vercel AI SDK 里 provider 的作用。'

const upcomingDemos = [
  {
    title: 'Structured output panel',
    description: '后续接对象生成、schema 校验和 provider metadata 展示。',
    status: '待接入',
  },
  {
    title: 'Tool call inspector',
    description: '预留给工具调用请求、输入参数和执行结果的可视化。',
    status: '待接入',
  },
  {
    title: 'Multi-step workflow',
    description: '预留给 agent step、reasoning 和多阶段输出的统一展示。',
    status: '待接入',
  },
]

export default function App() {
  const [prompt, setPrompt] = useState(defaultPrompt)
  const [responseText, setResponseText] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [modelId, setModelId] = useState('deepseek-chat')
  const [isLoading, setIsLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setResponseText('')
    setErrorMessage('')

    try {
      const response = await fetch('/api/vercel-sdk/provider-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      })

      setModelId(response.headers.get('X-Model-Id') || 'deepseek-chat')

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(payload.error || 'Request failed')
      }

      if (!response.body) {
        throw new Error('Streaming response body is not available')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          fullText += decoder.decode()
          break
        }

        fullText += decoder.decode(value, { stream: true })
        setResponseText(fullText)
      }

      setResponseText(fullText)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">playgrounds/viewbox</p>
        <h1>Vercel SDK Demo Viewer</h1>
        <p className="lead">
          所有后续 Vercel AI SDK 示例都在这里统一展示。当前第一个展示框已经接通 DeepSeek provider，后面的 demo 继续往下填。
        </p>
        <div className="hero-meta">
          <div>
            <span>目标目录</span>
            <strong>/playgrounds/vercel-sdk</strong>
          </div>
          <div>
            <span>当前状态</span>
            <strong>Viewbox ready</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="section-label">Demo Board</p>
            <h2>统一展示框</h2>
          </div>
          <p className="panel-copy">每个 demo 占一个独立展示框，前端统一承载，后端能力按需往里接。</p>
        </div>

        <div className="demo-grid">
          <article className="demo-card demo-card-live">
            <div className="demo-card-head">
              <div>
                <span className="demo-status demo-status-live">已接入</span>
                <h3>Provider stream panel</h3>
              </div>
              <p className="demo-model">{modelId}</p>
            </div>

            <p className="demo-copy">
              这个展示框直接调用本地 viewbox API，再由服务端使用 `@ai-sdk/deepseek` provider 转发给 DeepSeek。
            </p>

            <form className="prompt-form" onSubmit={handleSubmit}>
              <label className="prompt-label" htmlFor="provider-prompt">
                Prompt
              </label>
              <textarea
                id="provider-prompt"
                className="prompt-input"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={5}
              />
              <div className="prompt-actions">
                <button className="prompt-button" disabled={isLoading} type="submit">
                  {isLoading ? 'Streaming...' : 'Run demo'}
                </button>
                <button
                  className="prompt-button prompt-button-ghost"
                  onClick={() => {
                    setPrompt(defaultPrompt)
                    setResponseText('')
                    setErrorMessage('')
                  }}
                  type="button"
                >
                  Reset
                </button>
              </div>
            </form>

            <div className="stream-box">
              <div className="stream-box-head">
                <span>Streaming output</span>
                <span>{isLoading ? 'running' : 'idle'}</span>
              </div>
              <pre className="stream-box-body">{errorMessage || responseText || '输出会显示在这里。'}</pre>
            </div>
          </article>

          {upcomingDemos.map((demo) => (
            <article className="demo-card" key={demo.title}>
              <span className="demo-status">{demo.status}</span>
              <h3>{demo.title}</h3>
              <p>{demo.description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
