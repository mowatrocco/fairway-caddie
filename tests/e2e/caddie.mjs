// Browser test for the Caddie screen (Stages 3 and 4), at iPhone size, with simulated GPS.
// Uses a made-up hole near the clubhouse; NOT real South Head geometry.
// LINZ photos are faked with a tiny image so the offline download can be tested here.
// Usage: npm run build && npm run test:e2e:caddie
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { join, resolve } from 'node:path'
import puppeteer from 'puppeteer-core'
import geodesic from 'geographiclib-geodesic'

const { Geodesic } = geodesic
const ROOT = resolve(import.meta.dirname, '../..')
const SHOTS = join(ROOT, 'tests/e2e/screenshots')
const PORT = 4182
const BASE = process.env.BASE_PATH ?? '/'
const ORIGIN = `http://localhost:${PORT}`
const URL = `${ORIGIN}${BASE}?e2e`
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome'
const IPHONE_15 = { width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const IPHONE_SE = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// 1×1 PNG, served in place of LINZ photos.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

const W = Geodesic.WGS84
const dest = ([lng, lat], bearing, m) => {
  const r = W.Direct(lat, lng, bearing, m)
  return [r.lon2, r.lat2]
}
const dist = (a, b) => W.Inverse(a[1], a[0], b[1], b[0]).s12

// ---------- Made-up ground heights, served as Terrain-RGB pictures ----------
function pngRgba(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function terrainTile(z, x, y, heightAt) {
  const n = 2 ** z * 256
  const rgba = Buffer.alloc(256 * 256 * 4)
  for (let py = 0; py < 256; py++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * 256 + py + 0.5)) / n))) * 180) / Math.PI
    for (let px = 0; px < 256; px++) {
      const lng = ((x * 256 + px + 0.5) / n) * 360 - 180
      const v = Math.round((heightAt(lng, lat) + 10000) / 0.1)
      rgba.set([(v >> 16) & 255, (v >> 8) & 255, v & 255, 255], (py * 256 + px) * 4)
    }
  }
  return pngRgba(256, 256, rgba)
}

// ---------- Made-up hole 1, played on a bearing of 20° ----------
const CLUB = [174.317846, -36.560186]
const G = dest(CLUB, 45, 400)
const P = dest(G, 200, 150) // golfer, 150 m short of the green middle
const ring = (pts) => [...pts, pts[0]]
const greenRing = ring([dest(dest(G, 180, 11), 270, 10), dest(dest(G, 180, 11), 90, 10), dest(dest(G, 0, 11), 90, 10), dest(dest(G, 0, 11), 270, 10)])
const bunkerC = dest(dest(P, 20, 120), 110, 12) // 120 m out, 12 m right
const bunker = ring([0, 72, 144, 216, 288].map((b) => dest(bunkerC, b, 4)))
const fence = [dest(dest(P, 20, -20), 290, 25), dest(dest(P, 20, 170), 290, 25)] // 25 m left
const hole2Tee = dest(G, 90, 60)
const now = new Date().toISOString()
const feat = (id, kind, geometry, extra = {}) => ({ id, kind, holes: [1], geometry, trust: 'traced-from-imagery', source: 'test', updatedAt: now, notes: '', ...extra })
const FEATURES = [
  feat('g1', 'green', { type: 'Polygon', coordinates: [greenRing] }),
  feat('tb', 'tee', { type: 'Point', coordinates: dest(G, 200, 324) }, { teeId: 'blue' }),
  feat('tw', 'tee', { type: 'Point', coordinates: dest(G, 200, 315) }, { teeId: 'white' }),
  feat('ty', 'tee', { type: 'Point', coordinates: dest(G, 200, 301) }, { teeId: 'yellow' }),
  // Deliberately drawn on the wrong hole (5): it sits on hole 1's line, so it must still show there.
  { ...feat('b1', 'bunker', { type: 'Polygon', coordinates: [bunker] }), holes: [5] },
  feat('ob1', 'out-of-bounds', { type: 'LineString', coordinates: fence }),
  { ...feat('t2', 'tee', { type: 'Point', coordinates: hole2Tee }, { teeId: 'white' }), holes: [2] },
]

let failures = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!cond) failures++
}
mkdirSync(SHOTS, { recursive: true })

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

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))

/** A page with the made-up course loaded into its storage. */
async function preparedPage(context, { linzKey = null, noDistances = false, ground = null } = {}) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.setViewport(IPHONE_15)
  const linzHits = { count: 0 }
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    if (req.url().includes('basemaps.linz.govt.nz')) {
      linzHits.count++
      const m = /\/elevation\/3857\/(\d+)\/(\d+)\/(\d+)\.png/.exec(req.url())
      if (m && ground) {
        const body = terrainTile(Number(m[1]), Number(m[2]), Number(m[3]), ground)
        return req.respond({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body })
      }
      return req.respond({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG })
    }
    req.continue()
  })
  await page.goto(`${URL}#caddie`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.tabbar')
  await settle(500)
  await page.evaluate(
    async (features, key, noDistances) => {
      const req = indexedDB.open('fairway-caddie')
      const db = await new Promise((r) => (req.onsuccess = () => r(req.result)))
      const store = () => db.transaction('kv', 'readwrite').objectStore('kv')
      const rec = await new Promise((r) => {
        const g = store().get('appData')
        g.onsuccess = () => r(g.result)
      })
      rec.data.courseMaps[0].features = features
      rec.data.profile.usualTees = 'white'
      const driver = rec.data.bag.find((c) => c.category === 'driver')
      if (driver) Object.assign(driver, { roughM: 200, confidence: 'guess' })
      if (noDistances) for (const c of rec.data.bag) Object.assign(c, { carryM: null, totalM: null, roughM: null, confidence: 'unknown' })
      await new Promise((r) => (store().put(rec, 'appData').onsuccess = r))
      if (key) await new Promise((r) => (store().put(key, 'setting:linzKey').onsuccess = r))
      db.close()
    },
    FEATURES,
    linzKey,
    noDistances,
  )
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.tabbar')
  return { page, errors, linzHits }
}

function helpers(page) {
  const text = () => page.evaluate(() => document.body.innerText)
  const clickText = async (selector, label) => {
    const candidates = []
    for (const el of await page.$$(selector)) {
      const info = await el.evaluate((n) => {
        n.scrollIntoView({ block: 'center' })
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
  const middle = () => page.$eval('[data-testid="middle-distance"]', (n) => Number(n.textContent))
  const numbers = () =>
    page.$$eval('.green-numbers:not(.green-numbers-compact) .gn-val', (ns) => ns.map((n) => Number(n.textContent)))
  const goTo = async (p, accuracy = 4) => {
    await page.setGeolocation({ latitude: p[1], longitude: p[0], accuracy })
    await settle(700)
  }
  return { text, clickText, middle, numbers, goTo }
}

try {
  const context = browser.defaultBrowserContext()
  await context.overridePermissions(ORIGIN, ['geolocation'])
  const { page, errors } = await preparedPage(context)
  const { text, clickText, middle, numbers, goTo } = helpers(page)
  await page.setGeolocation({ latitude: P[1], longitude: P[0], accuracy: 4 })

  // 1. Caddie shows the hole and asks before using GPS
  let t = await text()
  check(t.includes('Hole 1') && t.includes('Par 4, 315 m White'), 'Caddie tab shows hole 1 with your usual (White) tee length')
  check(t.includes('Turn on GPS'), 'asks before switching GPS on')
  await clickText('button', 'Turn on GPS')
  await settle(1200)

  // 2. Green numbers from 150 m short
  t = await text()
  check(t.includes('GPS ±4 m, good'), 'GPS badge shows ±4 m, good')
  const [back, mid, front] = await numbers()
  check(Math.abs(mid - Math.round(dist(P, G))) <= 1, `middle is ${mid} m (expected ${Math.round(dist(P, G))})`)
  check(front < mid && mid < back && back - front >= 18 && back - front <= 26, `front ${front} < middle ${mid} < back ${back}, green about 20 m deep`)
  await page.screenshot({ path: join(SHOTS, '20-caddie-quick-iphone15.png') })

  // 3. Hazards along the line
  check(/Bunker right\s*11\d reach, 12\d carry/.test(t.replace(/\n/g, ' ')), 'bunker 120 m out (drawn on another hole) shows as right, reach ~116, carry ~124')
  check(/Out of bounds left\s*25 m off your line/.test(t.replace(/\n/g, ' ')), 'fence shows as out of bounds left, 25 m off your line')

  // 3b. Club advice (Stage 4)
  const advice = async () => (await page.$eval('[data-testid="advice"]', (n) => n.innerText)).replace(/\n/g, ' ')
  let a = await advice()
  const BAG_NAMES = ['5 Iron', '7 Iron', '8 Iron', '9 Iron', 'Pitching Wedge']
  check(BAG_NAMES.some((n) => a.includes(n)), `advice names a club from your bag (${a.slice(0, 60)}…)`)
  check(/Aim .*(middle|left|right)/i.test(a) && /Carry \d+ m, finishes ~\d+ m/.test(a), 'advice gives an aim and carry/finish distances')
  check(a.includes('(roll estimated)'), 'roll is marked as estimated (no measured totals yet)')
  check(a.includes('Confidence: Medium') && a.includes('rough'), 'confidence is medium, and says your club distances are rough')
  check(/Wind and slope aren't included/.test(a), 'says wind and slope are not included')
  check(Boolean(await page.$('.strategy [aria-checked="true"]')) && (await page.$eval('.strategy [aria-checked="true"]', (n) => n.textContent)) === 'Normal', 'Normal strategy is picked by default')
  await page.screenshot({ path: join(SHOTS, '25-caddie-advice-iphone15.png'), fullPage: true })
  await clickText('.strategy button', 'Safe')
  await settle()
  const safeA = await advice()
  check((await page.$eval('.strategy [aria-checked="true"]', (n) => n.textContent)) === 'Safe', 'tapping Safe switches strategy')
  const pen = (s) => (/penalty under 1%/.test(s) ? 0 : Number(/penalty (\d+)%/.exec(s)?.[1] ?? 99))
  check(pen(safeA) <= 5, `Safe keeps the penalty chance at 5% or less (${pen(safeA)}%)`)
  await clickText('.strategy button', 'Aggressive')
  await settle()
  check((await advice()) !== '', 'Aggressive also gives advice')

  // 3b2. Lie buttons
  const pressed = () => page.$$eval('[data-testid="lie"] .chip-on', (ns) => ns.map((n) => n.textContent))
  check(JSON.stringify(await pressed()) === '["Fairway"]', 'lie starts as Fairway, no slope')
  const flatClub = await page.$eval('[data-testid="advice"] .advice-club', (n) => n.textContent)
  await clickText('[data-testid="lie"] button', 'Bunker')
  await settle()
  a = await advice()
  const sandClub = await page.$eval('[data-testid="advice"] .advice-club', (n) => n.textContent)
  check(a.includes('Fairway bunker') && sandClub !== flatClub, `tapping Bunker changes the advice straight away (${flatClub} → ${sandClub}) and says why`)
  await clickText('[data-testid="lie"] button', 'Ball above feet')
  await clickText('[data-testid="lie"] button', 'Ball below feet')
  await settle()
  check(JSON.stringify(await pressed()) === '["Bunker","Ball below feet"]', 'above and below feet can’t both be on')
  await page.screenshot({ path: join(SHOTS, '28-caddie-lie-iphone15.png'), fullPage: true })
  await goTo(dest(G, 200, 125))
  check(JSON.stringify(await pressed()) === '["Fairway"]', 'walking on to the next shot resets the lie')
  await goTo(P)

  // 3c. Driver only from the tee
  const mainClubNow = () => page.$eval('[data-testid="advice"] .advice-club', (n) => n.textContent)
  await clickText('.strategy button', 'Aggressive')
  await goTo(dest(G, 200, 315))
  check(/Driver/.test(await mainClubNow()), `on the white tee (315 m) it suggests driver (${await mainClubNow()})`)
  check(!(await page.$('[data-testid="lie"]')) && (await text()).includes('Teeing off'), 'on the tee the lie buttons are hidden')
  await goTo(dest(G, 200, 215))
  const fairwayText = await page.$eval('[data-testid="advice"]', (n) => n.textContent)
  check(!/Driver/.test(await mainClubNow()) && fairwayText.includes("Driver is left out because you're not on the tee"), `in the fairway (215 m out) it never suggests driver (${await mainClubNow()})`)
  await goTo(P)
  await clickText('.strategy button', 'Safe')
  await settle()

  // 4. Walking closer updates the numbers
  await goTo(dest(G, 200, 100))
  check(Math.abs((await middle()) - 100) <= 1, `walking to 100 m out updates the middle to ${await middle()}`)
  await goTo(dest(G, 200, 40))
  a = await advice()
  check(a.includes('Part swing') && a.includes('shortest'), `40 m out (inside your shortest full club) it says part swing (${a.slice(0, 70)}…)`)
  await goTo(dest(G, 200, 100))

  // 5. Rough GPS is flagged, never shown as exact
  await goTo(dest(G, 200, 100), 25)
  t = await text()
  check(t.includes('GPS ±25 m, poor') && t.includes('GPS is rough here (±25 m)'), 'poor GPS: badge and warning show ±25 m')
  check(Boolean(await page.$('.green-numbers-rough')), 'poor GPS: numbers are dimmed and carry a ±')
  a = await advice()
  check(a.includes('Confidence: Low') && /GPS/.test(a), 'poor GPS: advice confidence drops to Low and says why')
  await page.screenshot({ path: join(SHOTS, '21-caddie-poor-gps-iphone15.png') })
  await goTo(P, 4)

  // 6. Rangefinder cross-check
  await page.type('input[name="rangefinder"]', '180')
  await settle()
  check((await text()).includes("doesn't fit between the front and back"), 'a rangefinder reading beyond the back of the green is flagged')
  await page.focus('input[name="rangefinder"]')
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace')
  await page.type('input[name="rangefinder"]', '152')
  await settle()
  check(!(await text()).includes("doesn't fit between the front and back"), 'a reading inside the green is accepted quietly')
  const mainClub = () => page.$eval('[data-testid="advice"] .advice-club', (n) => n.textContent)
  a = await advice()
  check(a.includes('Playing to your rangefinder: 152 m to the flag'), 'the advice card says it is playing to the rangefinder reading')
  const clubAt152 = await mainClub()
  await page.focus('input[name="rangefinder"]')
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace')
  await page.type('input[name="rangefinder"]', '128')
  await settle()
  a = await advice()
  const clubAt128 = await mainClub()
  check(a.includes('Playing to your rangefinder: 128 m') && clubAt128 !== clubAt152, `a shorter reading changes the club (${clubAt152} at 152, ${clubAt128} at 128)`)
  const rfBox = await page.$eval('input[name="rangefinder"]', (n) => n.getBoundingClientRect().top)
  const adviceBox = await page.$eval('[data-testid="advice"]', (n) => n.getBoundingClientRect().top)
  check(rfBox < adviceBox, 'the rangefinder box sits above the advice, so you see the change as you type')
  await goTo(dest(G, 200, 120))
  t = await text()
  a = await advice()
  check(t.includes('no longer used') && a.includes('Playing to the green middle'), 'walking 30 m on drops the old reading and goes back to GPS')
  check((await page.$eval('input[name="rangefinder"]', (n) => n.value)) === '', 'the old reading is cleared from the box')

  // 7. Standing on another hole's tee suggests switching
  await goTo(hole2Tee, 4)
  t = await text()
  check(t.includes('You look to be on the 2nd tee'), 'standing on the 2nd tee suggests switching')
  await clickText('button', 'You look to be on the 2nd tee')
  await settle()
  t = await text()
  check(t.includes('Hole 2') && t.includes("Hole 2 isn't mapped yet"), 'switching goes to hole 2, which says it is not mapped')
  await page.tap('button[aria-label="Previous hole"]')
  await goTo(P, 4)

  // 8. A long way from the green: says so instead of showing a huge number
  await goTo(dest(G, 200, 2300), 4)
  check((await text()).includes('km from this green'), 'from 2.3 km away it asks if you are on the wrong hole')
  await goTo(P, 4)

  // 9. Map view: tap to measure, and set your position by hand
  await clickText('.seg button', 'Map')
  await page.waitForSelector('[data-testid="caddie-map"] .maplibregl-canvas', { timeout: 20000 })
  await page.waitForFunction(() => Boolean(window.__fairwayMap))
  await settle(1000)
  const box = await (await page.$('[data-testid="caddie-map"]')).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3)
  await settle(500)
  t = (await text()).replace(/\n/g, ' ')
  const m = /(\d+) m from you, (\d+) m on to the green middle/.exec(t)
  check(Boolean(m), `tapping the map measures from you and on to the green (${m?.[0] ?? 'no readout'})`)
  if (m) check(Number(m[1]) + Number(m[2]) >= Math.round(dist(P, G)) - 1, 'the two legs are never shorter than the straight distance')
  await page.screenshot({ path: join(SHOTS, '22-caddie-map-iphone15.png') })
  await clickText('button', "I'm standing here")
  await page.waitForFunction(() => document.body.innerText.includes('Position set by hand'), { timeout: 5000 }).catch(() => {})
  t = await text()
  check(t.includes('Position set by hand') && t.includes('Back to GPS'), '"I\'m standing here" switches to a hand-set position, with a way back')
  await clickText('button', 'Using a spot you set on the map')
  await settle()
  check((await text()).includes('GPS ±4 m'), 'back to GPS')
  await clickText('.seg button', 'Quick')

  // 9b. Map view shows the plan and all three strategies
  await clickText('.seg button', 'Map')
  await page.waitForSelector('.strategy-table')
  await settle(800)
  const rows = await page.$$eval('.strategy-table tbody tr', (rs) => rs.map((r) => r.innerText.replace(/\n/g, ' ')))
  check(rows.length === 3 && rows[0].startsWith('Safe') && rows[2].startsWith('Aggressive'), 'map view lists Safe, Normal and Aggressive side by side')
  const planCount = await page.evaluate(async () => {
    const s = window.__maplibre.getSource('plan')
    const d = await s.getData()
    return d.features.map((f) => f.geometry.type).sort().join(',')
  })
  check(planCount === 'LineString,Point,Polygon', `map draws the aim line, aim point and landing zone (${planCount})`)
  await page.screenshot({ path: join(SHOTS, '26-caddie-map-plan-iphone15.png') })
  await clickText('.seg button', 'Quick')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('[data-testid="advice"]', { timeout: 10000 })
  await settle(800)
  check((await page.$eval('.strategy [aria-checked="true"]', (n) => n.textContent)) === 'Safe', 'the strategy you picked is remembered after reopening')

  // 10. Keep-screen-on switch is offered
  check((await text()).includes('Keep screen on'), 'keep-screen-on switch is offered')

  // 11. Small iPhone fits
  await page.setViewport(IPHONE_SE)
  await settle(500)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(overflow <= 0, `Caddie screen fits iPhone SE width (overflow ${overflow}px)`)
  const midBox = await page.$eval('.gn-middle .gn-val', (n) => n.getBoundingClientRect().width)
  check(midBox > 120, `middle distance is big on a small phone (${Math.round(midBox)} px wide)`)
  await page.screenshot({ path: join(SHOTS, '23-caddie-quick-iphoneSE.png') })

  check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await page.close()

  // 12. Location blocked
  const blocked = await browser.createBrowserContext()
  const b = await preparedPage(blocked)
  const bh = helpers(b.page)
  await bh.clickText('button', 'Turn on GPS')
  await settle(1500)
  const bt = await bh.text()
  check(bt.includes('Location blocked') && bt.includes('Location Services'), 'with location blocked, explains how to allow it')
  await b.page.type('input[name="rangefinder"]', '128')
  await settle()
  const da = (await b.page.$eval('[data-testid="advice"]', (n) => n.innerText)).replace(/\n/g, ' ')
  check(da.includes('rangefinder') && da.includes('Confidence: Low') && !/Aim /.test(da), `no position: advice uses the rangefinder distance only, no aim, low confidence (${da.slice(0, 80)}…)`)
  await b.page.screenshot({ path: join(SHOTS, '27-caddie-distance-only-iphone15.png') })

  // 12b. No club distances: says so instead of guessing
  const nd = await browser.createBrowserContext()
  await nd.overridePermissions(ORIGIN, ['geolocation'])
  const n = await preparedPage(nd, { noDistances: true })
  await n.page.setGeolocation({ latitude: P[1], longitude: P[0], accuracy: 4 })
  await helpers(n.page).clickText('button', 'Turn on GPS')
  await settle(1200)
  const nt = await helpers(n.page).text()
  check(nt.includes('Add club distances') && !BAG_NAMES.some((x) => nt.includes(x)), 'with no club distances it asks for them and names no club')
  check(n.errors.length === 0, `no-distances run: no console errors${n.errors.length ? ': ' + n.errors.join(' | ') : ''}`)
  await nd.close()
  await blocked.close()

  // 12c. Slope from ground heights: rises 7% toward the green and 8% to the right
  const sl = await browser.createBrowserContext()
  await sl.overridePermissions(ORIGIN, ['geolocation'])
  const KX = 111320 * Math.cos((P[1] * Math.PI) / 180)
  const KY = 110574
  const s20 = Math.sin((20 * Math.PI) / 180)
  const c20 = Math.cos((20 * Math.PI) / 180)
  const slopeGround = (lng, lat) => {
    const dx = (lng - P[0]) * KX
    const dy = (lat - P[1]) * KY
    return 50 + 0.07 * (dx * s20 + dy * c20) + 0.08 * (dx * c20 - dy * s20)
  }
  const s = await preparedPage(sl, { linzKey: 'testkey1234567890abcd', ground: slopeGround })
  const sh = helpers(s.page)
  await s.page.setGeolocation({ latitude: P[1], longitude: P[0], accuracy: 4 })
  await sh.clickText('button', 'Turn on GPS')
  await s.page.waitForFunction(() => /plays \d+ m/.test(document.querySelector('[data-testid="advice"]')?.innerText ?? ''), { timeout: 15000 }).catch(() => {})
  const sa = (await s.page.$eval('[data-testid="advice"]', (n) => n.innerText)).replace(/\n/g, ' ')
  const playsLike = Number(/plays (\d+) m \((\d+) m up\)/.exec(sa)?.[1])
  check(playsLike >= 157 && playsLike <= 162, `green ~10 m above you: the card says it plays ${playsLike} m`)
  check(/middle is 1\d m above you, so it plays about 1\d\d m/.test(sa), 'and the reasons say how much higher the green is')
  check(sa.includes('Slope is, from LINZ ground heights'), 'says slope is now included')
  const slopeChips = await s.page.$$eval('[data-testid="lie"] .chip-on', (ns) => ns.map((n) => n.textContent))
  check(
    JSON.stringify(slopeChips) === '["Fairway","Ball above feet","Uphill"]' && Boolean(await s.page.$('[data-testid="lie-from-map"]')),
    `the slope buttons are pre-set from the ground (${slopeChips.join(', ')}) with a note to check them`,
  )
  await s.page.screenshot({ path: join(SHOTS, '29-caddie-slope-iphone15.png'), fullPage: true })
  await sh.clickText('[data-testid="lie"] button', 'Uphill')
  await settle()
  check(
    JSON.stringify(await s.page.$$eval('[data-testid="lie"] .chip-on', (ns) => ns.map((n) => n.textContent))) === '["Fairway","Ball above feet"]' &&
      !(await s.page.$('[data-testid="lie-from-map"]')),
    'tapping a pre-set slope turns it off and it becomes your call',
  )
  check(s.errors.length === 0, `slope run: no console errors${s.errors.length ? ': ' + s.errors.join(' | ') : ''}`)
  await sl.close()

  // 13. Offline photos: save the course, then go offline and still see the map
  const off = await browser.createBrowserContext()
  await off.overridePermissions(ORIGIN, ['geolocation'])
  const o = await preparedPage(off, { linzKey: 'testkey1234567890abcd' })
  const oh = helpers(o.page)
  await o.page.setGeolocation({ latitude: P[1], longitude: P[0], accuracy: 4 })
  await o.page.tap('button[aria-label="Settings"]')
  await o.page.waitForSelector('.sheet')
  const plan = (await oh.text()).replace(/\n/g, ' ')
  const tiles = Number(/(\d+) photo tiles/.exec(plan)?.[1])
  check(tiles > 20 && tiles < 400, `offline download covers ${tiles} photo tiles for the mapped area`)
  const heightTiles = Number(/(\d+) ground-height tiles/.exec(plan)?.[1])
  check(heightTiles > 0 && heightTiles < 60, `and ${heightTiles} ground-height tiles`)
  await oh.clickText('button', 'Save course photos and heights')
  await o.page.waitForFunction(() => /Course photos and ground heights saved|didn't download/.test(document.body.innerText), { timeout: 180000 })
  const after = (await oh.text()).replace(/\n/g, ' ')
  check(after.includes('Course photos and ground heights saved') && after.includes(`${tiles} photo and ${heightTiles} height tiles saved`), `all ${tiles} photo and ${heightTiles} height tiles saved on the phone`)
  const hitsBefore = o.linzHits.count
  check(hitsBefore >= tiles + heightTiles && hitsBefore <= tiles + heightTiles + 20, `fetched each tile about once (${hitsBefore} requests for ${tiles + heightTiles} tiles)`)
  await o.page.tap('.sheet button[aria-label="Close"]')
  await settle()
  await o.page.setOfflineMode(true)
  await oh.clickText('button', 'Turn on GPS')
  await settle(800)
  await oh.clickText('.seg button', 'Map')
  await o.page.waitForSelector('[data-testid="caddie-map"] .maplibregl-canvas', { timeout: 20000 })
  await settle(2500)
  const offlineState = await o.page.evaluate(() => {
    const m = window.__maplibre
    return { loaded: m.areTilesLoaded(), banner: document.body.innerText.includes("didn't load") }
  })
  check(o.linzHits.count === hitsBefore && offlineState.loaded && !offlineState.banner, 'offline: the map loads its photos from the phone with no network requests')
  await o.page.screenshot({ path: join(SHOTS, '24-caddie-map-offline-iphone15.png') })
  check(o.errors.length === 0, `offline run: no console errors${o.errors.length ? ': ' + o.errors.join(' | ') : ''}`)
  await off.close()
} catch (e) {
  console.error(e)
  failures++
} finally {
  await browser.close()
  server.kill()
}

console.log(failures === 0 ? '\nAll caddie checks passed.' : `\n${failures} caddie check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
