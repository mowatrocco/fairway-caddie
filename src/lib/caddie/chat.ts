import type { Club, Units } from '../../types'
import type { CourseFeature } from '../../types/courseMap'
import { formatDistance, unitLabel } from '../calculations/units'
import { pct, recommend, type CaddieInput, type CaddieResult } from './engine'
import { HARD_SWING, OPPOSITE, PLAIN_LIE, SLOPE_LABEL, SURFACE_LABEL, type Lie, type Slope, type Surface, type Swing } from './lie'
import { STRATEGY_LABEL } from './scoring'
import { bearingDeg } from '../geo/geodesic'
import { windFromTaps, windOnShot, WIND_STRENGTH_LABEL, type WindDir, type WindSetting, type WindStrength } from './wind'
import { carryNeeds, compareLayup, missCosts, tryClub } from './whatif'

// The caddie chat. No AI: questions are recognised by their key words, and every
// answer is built from the engine's own numbers. It says so when it doesn't know.

export type Intent =
  | { kind: 'what-club' }
  | { kind: 'compare'; club: Club; swing: Swing }
  | { kind: 'hard-which' }
  | { kind: 'safe-miss' }
  | { kind: 'carry'; hazard: 'water' | 'bunker' | 'trouble' | 'any' }
  | { kind: 'layup' }
  | { kind: 'lie'; surface: Surface | null; slopes: Slope[] }
  | { kind: 'wind'; dirs: WindDir[]; strength: WindStrength | null }
  | { kind: 'round' }
  | { kind: 'help' }
  | { kind: 'unknown' }

const WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }

function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/°/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => WORDS[w])
    .replace(/\s+/g, ' ')
    .trim()} `
}

/** "Ping G25 7 Iron" → "7": the number that names the club, not the model. */
function lastNumber(name: string): string | undefined {
  const all = name.match(/\d+/g)
  return all?.[all.length - 1]
}

/** The ways you might type a club's name. */
export function clubAliases(c: Club): string[] {
  const name = normalise(c.name).trim()
  const out = new Set<string>([name])
  const num = lastNumber(c.name)
  const lower = c.name.toLowerCase()
  if (c.category === 'iron' && num) [`${num} iron`, `${num}i`, `${num}-iron`].forEach((s) => out.add(s))
  if (c.category === 'wood' && num) [`${num} wood`, `${num}w`, `${num} w`].forEach((s) => out.add(s))
  if (c.category === 'hybrid') {
    ;['hybrid', 'rescue'].forEach((s) => out.add(s))
    if (num) [`${num} hybrid`, `${num}h`, `${num} h`].forEach((s) => out.add(s))
  }
  if (c.category === 'driver') ['driver', 'dr', '1w', '1 wood'].forEach((s) => out.add(s))
  if (c.category === 'putter') out.add('putter')
  if (c.category === 'wedge') {
    if (num && Number(num) >= 40) [num, `${num} degree`, `${num} deg`].forEach((s) => out.add(s))
    if (/pitch/.test(lower)) ['pw', 'pitching wedge', 'pitching', 'p wedge'].forEach((s) => out.add(s))
    if (/utility|gap|approach/.test(lower)) ['uw', 'utility', 'utility wedge', 'gw', 'gap wedge', 'gap', 'aw', 'approach wedge'].forEach((s) => out.add(s))
    if (/sand/.test(lower)) ['sw', 'sand wedge', 'sand'].forEach((s) => out.add(s))
    if (/lob/.test(lower)) ['lw', 'lob wedge', 'lob'].forEach((s) => out.add(s))
  }
  return [...out]
}

/** The club named in some text, if any. A bare "7" means the 7 iron. */
export function findClub(text: string, clubs: Club[]): Club | null {
  const t = normalise(text)
  let best: { club: Club; len: number } | null = null
  for (const c of clubs) {
    for (const a of clubAliases(c)) {
      if (t.includes(` ${a} `) && (!best || a.length > best.len)) best = { club: c, len: a.length }
    }
  }
  if (best) return best.club
  const bare = /\s(\d{1,2})\s/.exec(t)?.[1]
  if (bare) {
    const n = Number(bare)
    const byNum = (cat: Club['category']) => clubs.find((c) => c.category === cat && lastNumber(c.name) === bare)
    return (n >= 40 ? byNum('wedge') : (byNum('iron') ?? byNum('hybrid') ?? byNum('wood'))) ?? null
  }
  return null
}

/** Work out what's being asked. */
export function parseQuestion(text: string, clubs: Club[]): Intent {
  const t = normalise(text)
  const has = (re: RegExp) => re.test(t)
  if (has(/how did i (go|play|do)|cost me|review|my round/)) return { kind: 'round' }
  if (has(/^\s*(help|what can you)|what can i ask/)) return { kind: 'help' }
  if (has(/lay ?up|go for (it|the green|the pin)|layup|go for/)) return { kind: 'layup' }
  if (has(/safe (miss|side)|bail ?out|where.*miss|miss where|best miss|where.*(bail|safe)/)) return { kind: 'safe-miss' }
  if (has(/carry|clear |get over|to fly/)) {
    const hazard = has(/water|pond|lake|creek|dam/) ? 'water' : has(/bunker|sand|trap/) ? 'bunker' : has(/trouble|bush|trees/) ? 'trouble' : 'any'
    return { kind: 'carry', hazard }
  }

  if (has(/wind|breeze|blowing|gust/)) {
    const dirs: WindDir[] = []
    if (has(/\binto|against|in my face|head ?wind|hurting/)) dirs.push('into')
    else if (has(/helping|behind|down ?wind|tail ?wind|with me|at my back/)) dirs.push('helping')
    if (has(/left to right|l to r|from the left/)) dirs.push('left-to-right')
    else if (has(/right to left|r to l|from the right/)) dirs.push('right-to-left')
    const strength: WindStrength | null = has(/calm|no wind|still|dropped|gone/)
      ? 'calm'
      : has(/light|slight|bit of|little/)
        ? 'light'
        : has(/strong|big|howling|heaps|really windy|pumping|blowing hard/)
          ? 'strong'
          : has(/medium|moderate|decent|fair/)
            ? 'medium'
            : null
    if (dirs.length > 0 || strength) return { kind: 'wind', dirs, strength }
  }
  const club = findClub(text, clubs)
  const hard = has(/\bhard|smash|full send|go at it|swing out|rip it|extra/)
  if (hard && club) return { kind: 'compare', club, swing: 'hard' }
  if (hard) return { kind: 'hard-which' }
  if (club && !has(/i m in|im in|i am in|in the|my ball/)) return { kind: 'compare', club, swing: 'normal' }

  const surface: Surface | null = has(/rough/)
    ? 'light-rough'
    : has(/bunker|sand|trap/)
      ? 'bunker'
      : has(/hard ?pan|hard ground|bare|tight lie|hard lie/)
        ? 'hard'
        : has(/fairway|short grass/)
          ? 'fairway'
          : null
  const slopes: Slope[] = []
  if (has(/above (my )?feet/)) slopes.push('above-feet')
  if (has(/below (my )?feet/)) slopes.push('below-feet')
  if (has(/uphill|up ?slope|upslope/)) slopes.push('uphill')
  if (has(/downhill|down ?slope|downslope/)) slopes.push('downhill')
  if (surface || slopes.length > 0) return { kind: 'lie', surface, slopes }

  if (club) return { kind: 'compare', club, swing: 'normal' }
  if (has(/what club|which club|club\s*$|what (should|do) i hit|what to hit|whats the play|what s the play/)) return { kind: 'what-club' }
  return { kind: 'unknown' }
}

export interface ChatContext {
  input: CaddieInput
  result: CaddieResult
  features: CourseFeature[]
  units: Units
}

export interface ChatReply {
  text: string
  /** For "I'm in the rough" and the like: the lie to set on the buttons. */
  lie?: Lie
  /** For "into the wind" and the like: the wind to set on the buttons. */
  wind?: { dirs: WindDir[]; strength: WindStrength | null }
}

const HELP =
  "I can tell you: what club, why not a club (\"why not 7 iron\"), a club swung hard (\"8 hard\"), the safe miss, what it takes to carry the water or a bunker, and whether to lay up or go for it. You can also tell me your lie, like \"light rough\" or \"ball above my feet\"."

function shots(x: number): string {
  const a = Math.abs(x)
  if (a < 0.05) return 'about the same'
  return `about ${a.toFixed(1)} of a shot`
}

function describeResult(r: CaddieResult, d: (m: number) => string): string {
  if (r.kind === 'advice') {
    const p = r.primary
    const why = r.reasons.slice(0, 3).join(' ')
    const conf =
      r.confidence.because.length > 0
        ? ` Confidence is ${r.confidence.level}: ${r.confidence.because[0]}.`
        : ` Confidence is ${r.confidence.level}.`
    return `${p.clubName}. ${p.aimText}. ${why}${conf}`
  }
  if (r.kind === 'distance-only') return `${r.clubName}: carries about ${d(r.carryM)}. ${r.reason}`
  return r.reason
}

/** Answer a question about this shot, using short club names ("7 Iron", not "Ping G25 7 Iron"). */
export function answer(intent: Intent, ctx: ChatContext): ChatReply {
  const r = answerLong(intent, ctx)
  let text = r.text
  for (const c of [...ctx.input.clubs].sort((a, b) => b.name.length - a.name.length)) {
    const short = shortName(c)
    if (short !== c.name) text = text.split(c.name).join(short)
  }
  return { ...r, text }
}

function answerLong(intent: Intent, ctx: ChatContext): ChatReply {
  const { input, result, units } = ctx
  const u = unitLabel(units)
  const d = (m: number) => `${formatDistance(m, units)} ${u}`
  const needPosition = 'I need your position for that. Turn on GPS or set your spot on the Map view.'

  switch (intent.kind) {
    case 'help':
    case 'unknown':
      return { text: intent.kind === 'unknown' ? `I didn't catch that one. ${HELP}` : HELP }

    case 'round':
      return {
        text: "That comes once your rounds are being logged (the next stage). Then I'll be able to tell you where the shots went.",
      }

    case 'what-club':
      return { text: describeResult(result, d) }

    case 'wind': {
      if (!input.position) return { text: needPosition }
      const bearing = bearingDeg(input.position, input.greenMiddle)
      const strength: WindStrength = intent.strength ?? (input.wind && input.wind.kmh > 0 ? input.wind.strength : 'medium')
      if (strength === 'calm') {
        const r = recommend({ ...input, wind: null })
        return { text: `Got it: no wind. ${describeResult(r, d)}`, wind: { dirs: [], strength: 'calm' } }
      }
      let setting: WindSetting | null = null
      if (intent.dirs.length > 0) setting = { fromDeg: windFromTaps(intent.dirs, bearing), strength, setAt: 0 }
      else if (input.wind && input.wind.kmh > 0) {
        // Only the strength was given: keep the direction already set.
        const fromDeg = (bearing + (Math.atan2(-input.wind.cross, input.wind.head) * 180) / Math.PI + 360) % 360
        setting = { fromDeg, strength, setAt: 0 }
      }
      if (!setting) return { text: `Which way is it blowing on this shot? Try "into, ${WIND_STRENGTH_LABEL[strength].toLowerCase()}" or "left to right".`, wind: { dirs: [], strength } }
      const r = recommend({ ...input, wind: windOnShot(setting, bearing) })
      const said = [...intent.dirs.map((x) => x.replace(/-/g, ' ')), WIND_STRENGTH_LABEL[strength].toLowerCase()].join(', ')
      return { text: `Got it: wind ${said}. ${describeResult(r, d)}`, wind: { dirs: intent.dirs, strength } }
    }

    case 'hard-which':
      return { text: 'Which club? Try something like "8 hard".' }

    case 'lie': {
      const current = input.lie ?? PLAIN_LIE
      let slopes = current.slopes
      for (const s of intent.slopes) slopes = [...slopes.filter((x) => x !== s && x !== OPPOSITE[s]), s]
      const lie: Lie = { surface: intent.surface ?? current.surface, slopes }
      const named = [SURFACE_LABEL[lie.surface], ...lie.slopes.map((s) => SLOPE_LABEL[s].toLowerCase())].join(', ')
      if (input.fromTee) return { text: "You're on the tee, so you'll be teeing it up. Tell me the lie on your next shot." }
      const r = recommend({ ...input, lie })
      return { text: `Got it: ${named}. ${describeResult(r, d)}`, lie }
    }

    case 'compare': {
      if (result.kind === 'none') return { text: result.reason }
      if (!input.position) return { text: needPosition }
      const pick = result.kind === 'advice' ? result.primary : null
      const t = tryClub(input, intent.club, intent.swing)
      if (t.kind === 'driver-off-tee')
        return { text: "Driver's only an option off the tee. Off the fairway it's a low-percentage shot, so I leave it out." }
      if (t.kind === 'no-distance') return { text: `${intent.club.name} has no distance in My Bag yet, so I can't work it out.` }
      if (t.kind === 'too-much')
        return { text: `That's too much club: it carries about ${d(t.carryM)} and you've got ${d(t.targetM)}.` }
      const p = t.plan
      const hard = intent.swing === 'hard'
      if (!hard && pick && p.clubName === pick.clubName && p.aimText === pick.aimText)
        return { text: `That's my pick. ${describeResult(result, d)}` }
      const lead = hard ? `${HARD_SWING.says} ` : ''
      const watch = p.watchOut.length > 0 ? ` Watch: ${p.watchOut.join(', ')}.` : ''
      const theirs = `${lead}${p.clubName}${hard ? ' swung hard' : ''}: carries about ${d(p.carryM)}, finishes ~${d(p.totalM)}. ${p.aimText}. ${p.layup ? `Leaves about ${d(p.leaveM)}` : `On the green ${pct(p.pGreen)}`}, penalty ${pct(p.pPenalty)}.${watch}`
      if (!pick || result.kind !== 'advice') return { text: `${theirs} ${describeResult(result, d)}` }
      const mine = `My pick, ${pick.clubName}: ${pick.layup ? `leaves about ${d(pick.leaveM)}` : `on the green ${pct(pick.pGreen)}`}, penalty ${pct(pick.pPenalty)}.`
      const diff = p.expectedStrokes - pick.expectedStrokes
      let verdict: string
      if (Math.abs(diff) < 0.05) {
        const safer = p.pPenalty + 0.03 < pick.pPenalty ? p.clubName : pick.pPenalty + 0.03 < p.pPenalty ? pick.clubName : null
        verdict = safer
          ? `On average they score about the same, but ${safer} keeps you out of more trouble.`
          : 'On average they score about the same, so go with whichever you trust more.'
      } else if (diff > 0) {
        verdict = `On average it costs you ${shots(diff)} more.`
      } else {
        verdict = `On average it's ${shots(diff)} better, but it brings in more trouble (penalty ${pct(p.pPenalty)} against ${pct(pick.pPenalty)}), so ${STRATEGY_LABEL[result.strategy]} plays ${pick.clubName}.`
      }
      return { text: `${theirs} ${mine} ${verdict}` }
    }

    case 'safe-miss': {
      const costs = missCosts(input)
      if (!costs) return { text: needPosition }
      const [best, next] = costs
      const worst = costs[costs.length - 1]
      const vsBest = (c: (typeof costs)[number]) => {
        const x = c.extra - best.extra
        return x < 0.05 ? 'about the same' : `about ${x.toFixed(1)} of a shot worse`
      }
      const tag = (c: (typeof costs)[number]) => `${c.side}${c.worst ? ` (${c.worst})` : ''}`
      return {
        text: `Safest miss is ${tag(best)}. ${next.side.charAt(0).toUpperCase()}${tag(next).slice(1)} is next, ${vsBest(next)}. Worst is ${tag(worst)}, ${vsBest(worst)} than missing ${best.side}.`,
      }
    }

    case 'carry': {
      const needs = carryNeeds(input, ctx.features, intent.hazard)
      if (!needs) return { text: needPosition }
      const what = intent.hazard === 'any' ? 'hazards' : intent.hazard === 'water' ? 'water' : intent.hazard === 'bunker' ? 'bunkers' : 'trouble'
      if (needs.length === 0) return { text: `No ${what} to carry on your line to the ${input.flagDistanceM !== null ? 'flag' : 'middle'}.` }
      return {
        text: needs
          .map((n) => {
            const height = n.heightM !== null && Math.abs(n.heightM) >= 2 ? ` (its far edge is ${Math.round(Math.abs(n.heightM))} m ${n.heightM > 0 ? 'above' : 'below'} you, counted in)` : ''
            const sure = n.clubs.find((c) => c.pCarry >= 0.9)
            const list = n.clubs
              .filter((c) => c.pCarry < 0.995)
              .slice(0, 3)
              .map((c) => `${c.name} ${pct(c.pCarry)}`)
            const clubs =
              n.clubs.length === 0
                ? 'Nothing in your bag carries it reliably from here.'
                : `${sure ? `${sure.name} or longer carries it 9 times in 10 or better.` : 'No club carries it 9 times in 10.'}${list.length ? ` How often each club makes it: ${list.join(', ')}.` : ''}`
            return `${n.label} ${n.side === 'across' ? 'across your line' : n.side}: ${d(n.reachM)} to reach, ${d(n.carryM)} to carry${height}. ${clubs}`
          })
          .join(' '),
      }
    }

    case 'layup': {
      const c = compareLayup(input)
      if (!c) return { text: needPosition }
      if (!c.go && !c.layup) return { text: "I can't find a sensible plan from here. Check your clubs have distances in My Bag." }
      if (!c.go)
        return {
          text: `You can't get there from here: your longest club finishes about ${d(c.longestM)} and you've got ${d(c.targetM)}. Best lay-up: ${c.layup!.clubName} to about ${d(c.layup!.layM)}, leaving ${d(c.layup!.leaveM)} for your ${c.layup!.nextClubName}. You'd hit the green with that one about ${pct(c.layup!.pGreenNext)} of the time.`,
        }
      const g = c.go
      const goText = `Go for it: ${g.clubName}, ${g.aimText.charAt(0).toLowerCase()}${g.aimText.slice(1)}. On the green ${pct(g.pGreen)}, penalty ${pct(g.pPenalty)}.`
      if (!c.layup) return { text: `${goText} There's no sensible lay-up from this distance, so go for it.` }
      const l = c.layup
      const layText = `Lay up: ${l.clubName} to about ${d(l.layM)}, leaving ${d(l.leaveM)} for your ${l.nextClubName}. Penalty ${pct(l.pPenalty)}, and you'd be on the green after the next one about ${pct(l.pGreenNext)} of the time.`
      const diff = l.expectedStrokes - g.expectedStrokes
      const verdict =
        Math.abs(diff) < 0.05
          ? `On average they score about the same${l.pPenalty + 0.03 < g.pPenalty ? ', so laying up is the safer bet' : ''}.`
          : diff > 0
            ? `Going for it saves you ${shots(diff)} on average${g.pPenalty >= 0.1 ? `, but brings a penalty in about ${pct(g.pPenalty)} of the time` : ''}.`
            : `Laying up saves you ${shots(diff)} on average.`
      return { text: `${goText} ${layText} ${verdict}` }
    }
  }
}

/** Short name for buttons: "Ping G25 7 Iron" → "7 Iron". */
export function shortName(c: Club): string {
  const m = /(\d+\s*(iron|wood|hybrid))|(\d+°)|(pitching wedge|utility wedge|gap wedge|sand wedge|lob wedge|driver|putter|hybrid)/i.exec(c.name)
  return m ? m[0] : c.name
}
