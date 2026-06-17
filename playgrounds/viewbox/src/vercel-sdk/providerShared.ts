import dotenv from 'dotenv'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { streamText } from 'ai'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'node:path'

const currentFilePath = fileURLToPath(import.meta.url)
const currentDir = dirname(currentFilePath)
const envPath = resolve(currentDir, '../../../.env.ds')

dotenv.config({ path: envPath, quiet: true })

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

export function getDeepSeekModelId(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-pro'
}

export function createProviderStreamResult(options: { prompt: string; system?: string }) {
  const apiKey = getRequiredEnv('DEEPSEEK_API_KEY')
  const baseURL = process.env.DEEPSEEK_BASE_URL?.trim()

  const deepseek = createDeepSeek({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  })

  return streamText({
    model: deepseek(getDeepSeekModelId()),
    system: options.system,
    prompt: options.prompt,
  })
}
