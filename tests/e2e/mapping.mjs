// Browser test for the course-mapping screen, at iPhone size, in headless Chrome.
// Uses a made-up hole near the clubhouse; it is NOT real South Head geometry.
// Usage: npm run build && npm run test:e2e:map
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import geodesic from 'geographiclib-geodesic'

const { Geodesic } = geodesic
const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'tests/e2e/screenshots')
const DOWNLOADS = join(ROOT, 'tests/e2e/downloads-map')
const PORT = 4180
const BASE = process.env.BASE_PATH ?? '/'
const ORIGIN = `http://localhost:${PORT}`
const URL = `${ORIGIN}${BASE}?e2e`
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'

const IPHONE_15 = { width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const IPHONE_SE = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

const W = Geodesic.WGS84
const dest = ([lng, lat], bearing, m) => {
  const r = W.Direct(lat, lng, bearing, m)
  return [r.lon2, r.lat2]
}
const dist = (a, b) => W.Inverse(a[1], a[0], b[1], b[0]).s12

// Made-up hole 1: green 400 m north-east of the clubhouse pin, tees at card lengths.
const CLUB = [174.317846, -36.560186]
const G = dest(CLUB, 45, 400)
const greenCorners = [dest(dest(G, 180, 11), 270, 10), dest(dest(G, 180, 11), 90, 10), dest(dest(G, 0, 11), 90, 10), dest(dest(G, 0, 11), 270, 10)]
const tees = { blue: dest(G, 200, 324), white: dest(G, 200, 315), yellow: dest(G, 200, 301) }
const B = dest(G, 200, 40)
const bunker = [dest(B, 0, 5), dest(B, 120, 5), dest(B, 240, 5)]

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!cond) failures++
}

rmSync(DOWNLOADS, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
mkdirSync(DOWNLOADS, { recursive: true })

const server = spawn(join(ROOT, 'node_modules/.bin/vite'), ['preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe' })
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('preview server did not start')), 20000)
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && (clearTimeout(t), res()))
})

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})

try {
  const context = browser.defaultBrowserContext()
  await context.overridePermissions(ORIGIN, ['geolocation'])
  const page = await browser.newPage()
  const errors = []
  globalThis.__errs = errors
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })
  await page.setViewport(IPHONE_15)

  const text = () => page.evaluate(() => document.body.innerText)
  const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms))
  // Taps the button a person could actually see and reach: it must be the top-most element
  // at its own centre (so buttons hidden behind the map screen don't count). Exact names win.
  const clickText = async (selector, label) => {
    const candidates = []
    for (const el of await page.$$(selector)) {
      const info = await el.evaluate((n) => {
        if (!n.closest('.mapper') && !n.closest('.sheet')) n.scrollIntoView({ block: 'center' })
        else n.scrollIntoView({ block: 'nearest' })
        const r = n.getBoundingClientRect()
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        return { t: n.textContent?.trim() ?? '', reachable: r.width > 0 && (top === n || n.contains(top)) }
      })
      if (info.reachable && (info.t === label || info.t.startsWith(label))) candidates.push({ el, exact: info.t === label })
    }
    const pick = candidates.find((c) => c.exact) ?? candidates[0]
    if (!pick) throw new Error(`No reachable ${selector} with text "${label}"`)
    return pick.el.tap()
  }
  const moveTo = (p) => page.evaluate((pt) => window.__fairwayMap.jumpTo(pt, 19), p)
  const addAt = async (p, label = 'Add point') => {
    await moveTo(p)
    await settle(120)
    await clickText('button', label)
    await settle(120)
  }

  // 1. Open the map
  await page.goto(`${URL}#caddie`, { waitUntil: 'networkidle0' })
  await clickText('button', 'Open course map')
  await page.waitForSelector('.mapper .maplibregl-canvas', { timeout: 20000 })
  await page.waitForFunction(() => Boolean(window.__fairwayMap))
  await settle(800)
  check(true, 'map screen opens with a map canvas')
  const webgl = await page.evaluate(() => Boolean(document.querySelector('.maplibregl-canvas')?.getContext('webgl2') ?? document.querySelector('.maplibregl-canvas')?.getContext('webgl')))
  check(webgl, 'map is drawing (WebGL available)')
  check((await text()).includes('No aerial photos yet'), 'without a key, says aerial photos need a LINZ key')
  check((await text()).includes('Hole 1') && (await text()).includes('Par 4'), 'starts on hole 1, par 4 shown')
  const fit = await page.evaluate(() => {
    const c = window.__maplibre.getCanvas().getBoundingClientRect()
    const box = document.querySelector('[data-testid="map"]').getBoundingClientRect()
    const cross = document.querySelector('.crosshair').getBoundingClientRect()
    return { dh: Math.abs(c.height - box.height), dw: Math.abs(c.width - box.width), dy: Math.abs(c.top + c.height / 2 - (cross.top + cross.height / 2)), dx: Math.abs(c.left + c.width / 2 - (cross.left + cross.width / 2)) }
  })
  check(fit.dh < 1 && fit.dw < 1 && fit.dx < 1 && fit.dy < 1, `map fills its box and its centre is under the crosshair (${JSON.stringify(fit)})`)

  // 2. Trace a green
  await clickText('.tool', 'Green')
  for (const c of greenCorners) await addAt(c)
  check((await text()).includes('4 points so far'), 'green outline counts its corners')
  await clickText('button', 'Finish')
  await settle()
  check((await text()).includes('Green added.'), 'green saved')

  // 3. Place three tees at card distance
  for (const [teeId, name] of [['blue', 'Blue'], ['white', 'White'], ['yellow', 'Yellow']]) {
    await clickText('.tool', 'Tee')
    await settle(100)
    await clickText('button', name)
    await addAt(tees[teeId], 'Place here')
  }
  await settle()
  const pill = await page.$eval('.status-pill', (n) => n.textContent)
  check(pill === 'Ready', `hole 1 is Ready once green and tees match the card (pill says "${pill}")`)

  // 4. Crosshair distances
  await moveTo(dest(G, 200, 150))
  await settle(300)
  const readout = await page.$eval('.cross-readout', (n) => n.innerText)
  const toGreen = Number(/(\d+)\s*m to green middle/.exec(readout.replace(/\n/g, ' '))?.[1])
  check(Math.abs(toGreen - 150) <= 1, `crosshair shows ${toGreen} m to green middle (expected 150)`)
  await page.screenshot({ path: join(SHOTS, '10-map-hole1-iphone15.png') })

  // 5. A bunker: select it by tapping, delete, undo
  await clickText('.tool', 'Bunker')
  for (const c of bunker) await addAt(c)
  await clickText('button', 'Finish')
  await settle()
  await clickText('button', 'Close').catch(() => {})
  await moveTo(B)
  await settle(500)
  const box = await (await page.$('[data-testid="map"]')).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await settle(400)
  let t = await text()
  check(t.includes('Bunker') && t.includes('Traced from imagery'), 'tapping the bunker selects it and shows its trust label')
  const counts = await page.$eval('[data-testid="counts-for"]', (n) => n.textContent).catch(() => '')
  check(counts.startsWith('Counts for hole 1,'), `the bunker says which holes it counts for ("${counts}")`)
  await page.screenshot({ path: join(SHOTS, '11-map-selected-iphone15.png') })
  await clickText('button', 'Delete')
  await clickText('button', 'Delete Bunker')
  await settle()
  check((await text()).includes('Bunker deleted'), 'bunker deleted')
  await clickText('.map-undo', 'Undo')
  await settle()
  const count = await page.evaluate(async () => {
    const req = indexedDB.open('fairway-caddie')
    const db = await new Promise((r) => (req.onsuccess = () => r(req.result)))
    const rec = await new Promise((r) => {
      const g = db.transaction('kv').objectStore('kv').get('appData')
      g.onsuccess = () => r(g.result)
    })
    return rec.data.courseMaps[0].features.length
  })
  check(count === 5, `undo brings the bunker back and it is saved (${count} features stored)`)

  // 6. Edit a corner of the green
  await moveTo(G)
  await settle(400)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await settle(300)
  await clickText('button', 'Edit corners')
  await settle()
  check((await text()).includes('Corner 1 of 4'), 'edit mode steps through corners')
  await clickText('button', 'Add corner after')
  await clickText('button', 'Save shape')
  await settle()
  check((await text()).includes('Shape saved.'), 'edited green saved')

  // 7. Simulated GPS capture of the green middle
  const closeBtn = await page.$('.mapper-panel button[aria-label="Close"]')
  if (closeBtn) await closeBtn.tap()
  await settle()
  await page.setGeolocation({ latitude: G[1], longitude: G[0], accuracy: 4 })
  await clickText('button', "GPS: I'm mid-green")
  for (const b of [0, 120, 240, 60]) {
    const p = dest(G, b, 1.5)
    await page.setGeolocation({ latitude: p[1], longitude: p[0], accuracy: 4 })
    await settle(250)
  }
  await page.waitForFunction(() => /readings?\. Latest accuracy/.test(document.body.innerText), { timeout: 8000 })
  await clickText('button', 'Use readings so far')
  await settle()
  t = await text()
  check(t.includes('GPS point: ±4 m, good') && t.includes('Verified on course'), 'GPS capture averages readings and grades them good')
  await clickText('button', 'Save point')
  await settle()
  t = await text()
  check(/Green middle \(GPS\) saved as Verified on course, ±4 m/.test(t), 'captured green middle is saved as Verified on course')

  // 8. Holes sheet
  await page.click('.status-pill')
  await page.waitForSelector('.hole-grid')
  t = await text()
  check(t.includes('1 of 18 holes ready'), 'holes sheet counts 1 of 18 ready')
  check(t.includes('Blue tee: 32') && t.includes('card says 324 m'), 'checklist compares Blue tee length with the card')
  await page.screenshot({ path: join(SHOTS, '12-map-holes-iphone15.png'), fullPage: false })
  await clickText('.hole-cell', '2')
  await settle()
  check((await text()).includes('Hole 2') && (await page.$eval('.status-pill', (n) => n.textContent)).includes('to do'), 'jumping to hole 2 shows its own to-do list')

  // 9. Reload straight into the map: everything still there
  await page.reload({ waitUntil: 'networkidle0' })
  check(page.url().endsWith('#map'), 'reloading keeps you on the map screen')
  await page.waitForSelector('.mapper .maplibregl-canvas', { timeout: 20000 })
  await settle(600)
  const pillNow = await page.$eval('.status-pill', (n) => n.textContent)
  check(pillNow === 'Ready', `after reload, hole 1 is still Ready (pill says "${pillNow}")`)

  // 10. Key form rejects junk
  await clickText('button', 'No aerial photos yet')
  await page.waitForSelector('input[name="linz-key"]')
  await page.type('input[name="linz-key"]', 'not a key')
  await clickText('button', 'Save map key')
  check((await text()).includes("doesn't look like a LINZ key"), 'map key form rejects text that is not a key')
  await page.click('.sheet button[aria-label="Close"]')
  await settle()

  // 11. Small iPhone: nothing runs off the side
  await page.setViewport(IPHONE_SE)
  await settle(500)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(overflow <= 0, `map screen fits iPhone SE width (overflow ${overflow}px)`)
  const panel = await page.$eval('.mapper-panel', (n) => n.getBoundingClientRect().height)
  check(panel < 667 * 0.5, `tool panel leaves at least half the screen for the map (${Math.round(panel)} px)`)
  await page.screenshot({ path: join(SHOTS, '13-map-iphoneSE.png') })

  // 12. GeoJSON export from Settings
  await clickText('button', 'Done')
  await settle()
  await page.click('button[aria-label="Settings"]')
  await page.waitForSelector('.sheet')
  await clickText('button', 'Export course map')
  let file = null
  for (let i = 0; i < 20 && !file; i++) {
    await settle()
    file = readdirSync(DOWNLOADS).find((f) => f.endsWith('.geojson'))
  }
  check(Boolean(file), `course map exported (${file})`)
  const fc = JSON.parse(readFileSync(join(DOWNLOADS, file), 'utf8'))
  check(fc.type === 'FeatureCollection' && fc.features.length === 6, `GeoJSON has 6 features (${fc.features.length})`)
  const blue = fc.features.find((f) => f.properties.teeId === 'blue')
  check(Math.abs(dist(blue.geometry.coordinates, tees.blue)) < 0.5, 'exported Blue tee is where it was placed (within 0.5 m)')
  await (await page.$('[data-testid="geojson-input"]')).uploadFile(join(DOWNLOADS, file))
  await page.waitForSelector('[aria-label="Confirm course map import"]')
  check((await text()).includes('6 features ready to import'), 're-importing the export shows 6 features ready')

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} catch (e) {
  console.error(e)
  failures++
  if (globalThis.__errs?.length) console.log('PAGE ERRORS:', globalThis.__errs.join(' | '))
} finally {
  await browser.close()
  server.kill()
}

console.log(failures === 0 ? '\nAll mapping checks passed.' : `\n${failures} mapping check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
