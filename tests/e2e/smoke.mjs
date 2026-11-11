// Browser test: runs the built app in headless Chrome at iPhone sizes.
// Usage: npm run build && npm run test:e2e
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'

const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'tests/e2e/screenshots')
const DOWNLOADS = join(ROOT, 'tests/e2e/downloads')
const PORT = 4179
const BASE = process.env.BASE_PATH ?? '/'
const URL = `http://localhost:${PORT}${BASE}`
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'

const IPHONE_15 = { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const IPHONE_SE = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!cond) failures++
}

rmSync(SHOTS, { recursive: true, force: true })
rmSync(DOWNLOADS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
mkdirSync(DOWNLOADS, { recursive: true })

const server = spawn(join(ROOT, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' })
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server did not start')), 20000)
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t)
      res()
    }
  })
})

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })

  await page.setViewport(IPHONE_15)
  const text = () => page.evaluate(() => document.body.innerText)
  const clickText = async (selector, label) => {
    const els = await page.$$(selector)
    for (const el of els) {
      const t = await el.evaluate((n) => n.textContent?.trim())
      if (t === label || t?.startsWith(label)) {
        await el.click()
        return true
      }
    }
    throw new Error(`No ${selector} with text "${label}"`)
  }
  const settle = () => new Promise((r) => setTimeout(r, 400))

  // 1. First launch
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.tabbar')
  check((await text()).includes('No distances yet.'), 'Caddie tab opens first and admits it has no distances')
  await page.screenshot({ path: join(SHOTS, '01-caddie-iphone15.png') })

  // 2. My Bag ladder
  await clickText('.tab', 'My Bag')
  await settle()
  const rows = await page.$$('.club-row')
  check(rows.length === 13, `bag shows 13 clubs (found ${rows.length})`)
  let t = await text()
  check(t.includes('≈15 m gap'), '5 iron to 7 iron gap flagged as ≈15 m')
  check(t.includes('≈155'), 'unconfirmed 5 iron shown with ≈')
  check(t.includes('7 distances are marked ≈'), 'banner counts 7 unconfirmed distances')
  await page.screenshot({ path: join(SHOTS, '02-bag-iphone15.png'), fullPage: true })

  // 3. Confirm all as carry
  await clickText('button', "They're all carry")
  await settle()
  t = await text()
  check(!t.includes('≈'), 'no ≈ left after confirming all as carry')
  check(t.includes('15 m gap'), 'gap still flagged, now based on carry')

  // 4. Edit 7 iron: add total
  await clickText('.club-main', 'Ping G25 7 Iron')
  await page.waitForSelector('.sheet')
  await page.screenshot({ path: join(SHOTS, '03-editor-iphone15.png') })
  await page.type('input[name="total"]', '148')
  await clickText('button', 'Save club')
  await settle()
  check((await text()).includes('m carry, 148 total'), '7 iron shows carry and new total')

  // 5. Bad input is blocked
  await clickText('.club-main', 'Ping G25 8 Iron')
  await page.waitForSelector('.sheet')
  await page.click('input[name="carry"]', { clickCount: 3 })
  await page.keyboard.press('Backspace')
  await page.type('input[name="carry"]', '900')
  const disabled = await page.$eval('.sheet-foot .btn-primary', (b) => b.disabled)
  check(disabled, 'Save is blocked for a 900 m carry')
  await clickText('button', 'Cancel')
  await settle()

  // 6. Persistence across reload
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.club-row')
  check((await text()).includes('m carry, 148 total'), 'edits survive a reload')

  // 7. Units switch
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.sheet')
  await clickText('.chip', 'Yards')
  await page.click('button[aria-label="Close"]')
  await settle()
  t = await text()
  check(t.includes('153') && t.includes('yd carry'), '7 iron shows 153 yd after switching to yards')
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.sheet')
  await clickText('.chip', 'Metres')

  // 8. Backup, change data, restore
  await clickText('button', 'Back up now')
  let file = null
  for (let i = 0; i < 20 && !file; i++) {
    await settle()
    file = readdirSync(DOWNLOADS).find((f) => f.endsWith('.json'))
  }
  check(Boolean(file), `backup file downloaded (${file})`)
  const backup = JSON.parse(readFileSync(join(DOWNLOADS, file), 'utf8'))
  check(backup.app === 'fairway-caddie' && backup.data.bag.length === 13, 'backup contains 13 clubs')
  await page.click('button[aria-label="Close"]')
  await settle()

  await clickText('.club-main', 'Ping G10 Driver')
  await page.waitForSelector('.sheet')
  await clickText('button', 'Delete this club')
  await clickText('button', 'Delete Ping G10 Driver')
  await settle()
  check((await page.$$('.club-row')).length === 12, 'driver deleted (12 clubs)')

  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.sheet')
  const input = await page.$('[data-testid="restore-input"]')
  await input.uploadFile(join(DOWNLOADS, file))
  await page.waitForSelector('[aria-label="Confirm restore"]')
  check((await text()).includes('13 clubs for Rocco, 0 mapped course features'), 'restore shows a summary before replacing')
  await clickText('button', 'Replace my data')
  await page.click('button[aria-label="Close"]')
  await settle()
  check((await page.$$('.club-row')).length === 13, 'restore brings the driver back (13 clubs)')

  // 9. A bad file is refused
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.sheet')
  const bad = join(DOWNLOADS, 'not-a-backup.json')
  await import('node:fs').then((fs) => fs.writeFileSync(bad, '{"hello":"world"}'))
  await (await page.$('[data-testid="restore-input"]')).uploadFile(bad)
  await page.waitForSelector('[role="alert"]')
  check((await text()).includes("isn't a Fairway Caddie backup"), 'a non-backup file is refused with a clear message')
  await page.screenshot({ path: join(SHOTS, '04-settings-iphone15.png') })
  await page.click('button[aria-label="Close"]')

  // 10. Scorecard
  await clickText('.tab', 'Round')
  await settle()
  t = await text()
  check(t.includes('5419') && t.includes('par 72'), 'Round tab shows the White card: 5419 m, par 72')
  await clickText('.chip', 'Blue')
  await settle()
  check((await text()).includes('5751'), 'switching to Blue shows 5751 m')
  await page.screenshot({ path: join(SHOTS, '07-scorecard-iphone15.png'), fullPage: true })

  // 11. Small screen layout: nothing wider than the screen
  await page.setViewport(IPHONE_SE)
  for (const tab of ['Caddie', 'Round', 'My Bag', 'Stats']) {
    await clickText('.tab', tab)
    await settle()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(overflow <= 0, `${tab}: no sideways scrolling on iPhone SE (overflow ${overflow}px)`)
    await page.screenshot({ path: join(SHOTS, `05-${tab.replace(' ', '').toLowerCase()}-iphoneSE.png`) })
  }
  await clickText('.tab', 'My Bag')
  await clickText('.club-main', 'Mizuno 5 Iron')
  await page.waitForSelector('.sheet')
  const sheetOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(sheetOverflow <= 0, 'club editor fits the iPhone SE width')
  await page.screenshot({ path: join(SHOTS, '06-editor-iphoneSE.png') })

  // 12. Touch targets
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button, input, textarea')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height < 40 || r.width < 40).length,
  )
  check(small === 0, `all visible controls are at least 40 px (${small} too small)`)

  // 13. Offline support registered
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 5000))])
    return Boolean(reg)
  })
  check(sw, 'service worker (offline support) is active')

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser.close()
  server.kill()
}

console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
