/**
 * Normalizes speech-to-text transcripts by mapping common browser STT phonetic
 * misinterpretations to exact technical terms, framework names, and tools.
 */
export function normalizeTechnicalSpeech(text: string): string {
  if (!text) return ''

  let normalized = text

  const replacements: Array<[RegExp, string]> = [
    // FastAPI & API terms
    [/\b(first|fast|farst|fastest)\s*api\b/gi, 'FastAPI'],
    [/\b(fast|first)\s*A\s*P\s*I\b/gi, 'FastAPI'],
    [/\bmuse\s*cellar\s*api\b/gi, 'molecular API'],
    [/\bmolecular\s*api\s*sim\b/gi, 'molecular API SIM'],
    
    // React / Frontend
    [/\breact\s*js\b/gi, 'React'],
    [/\bre\s*acted\b/gi, 'React'],
    [/\bnext\s*js\b/gi, 'Next.js'],
    [/\bvue\s*js\b/gi, 'Vue.js'],
    [/\btype\s*script\b/gi, 'TypeScript'],
    [/\bjava\s*script\b/gi, 'JavaScript'],
    [/\btail\s*wind\b/gi, 'Tailwind'],

    // Python / Backend & DB
    [/\bpie\s*thon\b/gi, 'Python'],
    [/\bpost\s*gress?\b/gi, 'PostgreSQL'],
    [/\bpost\s*gres\s*q\s*l\b/gi, 'PostgreSQL'],
    [/\bpost\s*gray\s*sql\b/gi, 'PostgreSQL'],
    [/\bmongo\s*db\b/gi, 'MongoDB'],
    [/\bnode\s*js\b/gi, 'Node.js'],
    [/\bexpress\s*js\b/gi, 'Express.js'],

    // AI & Automation
    [/\blie\s*dar\b/gi, 'LiDAR'],
    [/\blighter\s*annotation\b/gi, 'LiDAR annotation'],
    [/\bpie\s*torch\b/gi, 'PyTorch'],
    [/\bsci\s*kit\s*learn\b/gi, 'scikit-learn'],
    [/\bgit\s*hub\s*co\s*pilot\b/gi, 'GitHub Copilot'],
    [/\bco\s*pilot\b/gi, 'Copilot'],
    [/\bopen\s*ai\b/gi, 'OpenAI'],
    [/\bchat\s*g\s*p\s*t\b/gi, 'ChatGPT'],
    [/\bclaude\s*ai\b/gi, 'Claude'],
    [/\bcur\s*sor\b/gi, 'Cursor'],

    // DevOps & Cloud
    [/\bdoc\s*ker\b/gi, 'Docker'],
    [/\bcoober\s*netes\b/gi, 'Kubernetes'],
    [/\baws\b/gi, 'AWS'],
    [/\bgcp\b/gi, 'GCP'],
    [/\bazure\b/gi, 'Azure']
  ]

  for (const [pattern, replacement] of replacements) {
    normalized = normalized.replace(pattern, replacement)
  }

  return normalized
}
