import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createProviderStreamResult, getDeepSeekModelId } from './src/vercel-sdk/providerShared'

function readRequestBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''

    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      resolve(body)
    })
    req.on('error', reject)
  })
}

async function handleProviderStream(req: NodeJS.ReadableStream, res: import('node:http').ServerResponse) {
  try {
    const rawBody = await readRequestBody(req)
    const parsedBody = rawBody ? JSON.parse(rawBody) : {}
    const prompt = typeof parsedBody.prompt === 'string' && parsedBody.prompt.trim()
      ? parsedBody.prompt.trim()
      : '用三句话说明 Vercel AI SDK 里 provider 的作用。'

    const result = createProviderStreamResult({
      system: 'You are a concise technical assistant.',
      prompt,
    })

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Model-Id', getDeepSeekModelId())

    for await (const textPart of result.textStream) {
      res.write(textPart)
    }

    res.end()
  } catch (error) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    )
  }
}

function providerDemoPlugin() {
  return {
    name: 'provider-demo-api',
    configureServer(server: import('vite').ViteDevServer) {
      server.middlewares.use('/api/vercel-sdk/provider-stream', (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        void handleProviderStream(req, res)
      })
    },
    configurePreviewServer(server: import('vite').PreviewServer) {
      server.middlewares.use('/api/vercel-sdk/provider-stream', (req, res, next) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        void handleProviderStream(req, res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), providerDemoPlugin()],
  server: {
    host: '0.0.0.0',
    port: 4173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
})
