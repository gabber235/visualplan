import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'packages/runtime/theme.css'), 'utf8')

function ruleBody(selector: string, after = 0): string {
  const selectorStart = css.indexOf(selector, after)
  const bodyStart = css.indexOf('{', selectorStart)
  let depth = 1
  let cursor = bodyStart + 1
  while (depth > 0 && cursor < css.length) {
    if (css[cursor] === '{') depth += 1
    if (css[cursor] === '}') depth -= 1
    cursor += 1
  }
  return css.slice(bodyStart + 1, cursor - 1)
}

function tokens(body: string): Record<string, string> {
  return Object.fromEntries(
    [...body.matchAll(/(--vp-[\w-]+):\s*([^;]+);/g)].map(match => [match[1], match[2]!.trim()]),
  )
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map(
    offset => Number.parseInt(color.slice(offset, offset + 2), 16) / 255,
  )
  const linear = channels.map(value =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0]! + 0.05) / (values[1]! + 0.05)
}

describe('theme color contracts', () => {
  const light = tokens(ruleBody(':root {'))
  const forcedDark = tokens(ruleBody(':root[data-theme="dark"]'))
  const mediaStart = css.indexOf('@media (prefers-color-scheme: dark)')
  const systemDark = tokens(ruleBody(':root:not([data-theme="light"])', mediaStart))

  it('keeps forced and system dark palettes identical', () => {
    expect(systemDark).toEqual(forcedDark)
  })

  it.each([
    ['light', light],
    ['dark', forcedDark],
  ])('keeps normal text readable across %s surfaces', (_name, palette) => {
    for (const [foreground, background] of [
      ['--vp-text', '--vp-bg'],
      ['--vp-muted', '--vp-bg'],
      ['--vp-muted', '--vp-surface'],
      ['--vp-muted', '--vp-tip-tint'],
      ['--vp-muted', '--vp-warn-tint'],
      ['--vp-muted', '--vp-risk-tint'],
      ['--vp-risk', '--vp-risk-tint'],
      ['--vp-muted', '--vp-note-tint'],
      ['--vp-muted', '--vp-decision-tint'],
      ['--vp-note', '--vp-note-tint'],
      ['--vp-tip', '--vp-tip-tint'],
      ['--vp-warn', '--vp-warn-tint'],
      ['--vp-decision', '--vp-decision-tint'],
    ]) {
      expect(contrast(palette[foreground]!, palette[background]!)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
