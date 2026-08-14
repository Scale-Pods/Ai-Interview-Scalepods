/**
 * Normalizes speech-to-text transcripts by mapping common browser/Deepgram STT
 * phonetic misinterpretations and spoken variations to exact technical terms,
 * framework names, automation tools, and infrastructure.
 */
export function normalizeTechnicalSpeech(text: string): string {
  if (!text) return ''

  let normalized = text

  const replacements: Array<[RegExp, string]> = [
    // Workflow & Automation Tools
    [/\b(n\s*8\s*n|n-8-n|n8n|n8\s*n|n\s*8n|n\s*eight\s*n|n\s*ate\s*n|and\s*8\s*and|and\s*eight\s*and|an\s*8\s*an|in\s*8\s*in|and\s*ate\s*and|nate\s*n|n\s*8\s*and|n\s*eight\s*and)\b/gi, 'n8n'],
    [/\b(zap\s*i\s*er|zapper|zapier)\b/gi, 'Zapier'],
    [/\b(integromat)\b/gi, 'Integromat'],

    // AI, LLM & Agent Frameworks
    [/\b(lang\s*chain|long\s*chain|lane\s*chain|land\s*chain)\b/gi, 'LangChain'],
    [/\b(llama\s*index|lama\s*index)\b/gi, 'LlamaIndex'],
    [/\b(open\s*ai|open\s*A\s*I)\b/gi, 'OpenAI'],
    [/\b(chat\s*g\s*p\s*t|chat\s*gpt)\b/gi, 'ChatGPT'],
    [/\b(claude\s*ai|claude)\b/gi, 'Claude'],
    [/\b(git\s*hub\s*co\s*pilot|copilot)\b/gi, 'GitHub Copilot'],
    [/\b(pie\s*torch|torch)\b/gi, 'PyTorch'],
    [/\b(tensor\s*flow)\b/gi, 'TensorFlow'],
    [/\b(sci\s*kit\s*learn|scikit)\b/gi, 'scikit-learn'],
    [/\b(hugging\s*face)\b/gi, 'Hugging Face'],
    [/\b(cur\s*sor)\b/gi, 'Cursor'],

    // APIs & Protocols
    [/\b(first|fast|farst|fastest)\s*(api|A\s*P\s*I)\b/gi, 'FastAPI'],
    [/\b(graph\s*q\s*l|graph\s*ql|graph\s*cutel)\b/gi, 'GraphQL'],
    [/\b(t\s*r\s*p\s*c|tea\s*r\s*p\s*c)\b/gi, 'tRPC'],
    [/\b(web\s*socket[s]?|web\s*sock\s*et[s]?)\b/gi, 'WebSockets'],
    [/\b(web\s*r\s*t\s*c|web\s*rtc)\b/gi, 'WebRTC'],
    [/\b(rest\s*api|rest\s*ful\s*api)\b/gi, 'REST API'],
    [/\b(g\s*r\s*p\s*c|gRPC)\b/gi, 'gRPC'],

    // Frontend Frameworks & Libraries
    [/\b(react\s*js|re\s*acted)\b/gi, 'React'],
    [/\b(next\s*js|neck\s*js)\b/gi, 'Next.js'],
    [/\b(vue\s*js|view\s*js)\b/gi, 'Vue.js'],
    [/\b(nuxt\s*js)\b/gi, 'Nuxt.js'],
    [/\b(type\s*script)\b/gi, 'TypeScript'],
    [/\b(java\s*script)\b/gi, 'JavaScript'],
    [/\b(tail\s*wind\s*css|tail\s*wind)\b/gi, 'Tailwind'],

    // Databases & ORMs
    [/\b(post\s*gress?|post\s*gres\s*q\s*l|post\s*gray\s*sql)\b/gi, 'PostgreSQL'],
    [/\b(supa\s*base|super\s*base|soup\s*a\s*base)\b/gi, 'Supabase'],
    [/\b(mongo\s*db|mongo)\b/gi, 'MongoDB'],
    [/\b(red\s*is|rediss)\b/gi, 'Redis'],
    [/\b(prisma\s*orm|priz\s*ma)\b/gi, 'Prisma'],
    [/\b(elastic\s*search)\b/gi, 'Elasticsearch'],

    // Cloud, Infrastructure & DevOps
    [/\b(coober\s*netes|k\s*8\s*s|k8s|k-8-s)\b/gi, 'Kubernetes'],
    [/\b(doc\s*ker|dock\s*er)\b/gi, 'Docker'],
    [/\b(ver\s*cell|ver\s*sell|vercel)\b/gi, 'Vercel'],
    [/\b(net\s*li\s*fy|netlify)\b/gi, 'Netlify'],
    [/\b(micro\s*services|micro\s*service)\b/gi, 'microservices'],
    [/\b(aws|A\s*W\s*S)\b/gi, 'AWS'],
    [/\b(gcp|G\s*C\s*P)\b/gi, 'GCP'],
    [/\b(azure)\b/gi, 'Azure'],

    // Python & Backend
    [/\b(pie\s*thon)\b/gi, 'Python'],
    [/\b(node\s*js)\b/gi, 'Node.js'],
    [/\b(express\s*js)\b/gi, 'Express.js']
  ]

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement)
  }

  return normalized
}
