const upcomingDemos = [
  {
    title: 'Chat UI sandbox',
    description: '后续可以把 Vercel AI SDK 的基础聊天流式 demo 挂到这里。',
    status: '待接入',
  },
  {
    title: 'Structured output panel',
    description: '用于查看结构化输出、工具调用结果和调试信息。',
    status: '待接入',
  },
  {
    title: 'Multi-step workflow',
    description: '给后面的 agent / tool / step-by-step 交互做一个统一展示壳。',
    status: '待接入',
  },
]

export default function App() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">playgrounds/viewbox</p>
        <h1>Vercel SDK Demo Viewer</h1>
        <p className="lead">
          这是后续 Vercel AI SDK 示例的浏览容器。当前先提供一个最小 React + Vite 页面，后面可以继续接聊天面板、工具调用日志和多 demo 切换。
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
            <p className="section-label">Roadmap</p>
            <h2>预留展示位</h2>
          </div>
          <p className="panel-copy">先把壳搭起来，后面每个 demo 可以直接接进这块区域。</p>
        </div>

        <div className="card-grid">
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
