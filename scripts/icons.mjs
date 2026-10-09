// Renders extension/icons/icon.svg to the PNG sizes Chrome wants. Needs Playwright:
//   npx -y -p playwright node scripts/icons.mjs   (or point PLAYWRIGHT at an installed copy)
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
const dir = join(import.meta.dirname, '../extension/icons')
const svg = await readFile(join(dir, 'icon.svg'), 'utf8')
const browser = await chromium.launch()
for (const size of [16, 32, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.screenshot({ path: join(dir, `icon-${size}.png`), omitBackground: true })
  await page.close()
}
await browser.close()
console.log(`rendered ${dir}/icon-{16,32,48,128}.png`)
