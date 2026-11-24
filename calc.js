/* Housing and Meals Pilot Budget Calculator: calculation engine.
   No page code in this file. It runs in the browser and in Node, so the same math is checked in both. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory()
  else root.HC = factory()
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const STATUSES = ['unknown', 'planning assumption', 'local quote', 'published reference', 'demonstration']
  const STATUS_LABEL = {
    'unknown': 'Not set',
    'planning assumption': 'Planning assumption',
    'local quote': 'Local quote',
    'published reference': 'Published reference',
    'demonstration': 'Demonstration'
  }
  // Higher means stronger evidence. Rank 2 or lower still needs checking.
  const STATUS_RANK = { 'unknown': 0, 'demonstration': 1, 'planning assumption': 2, 'published reference': 3, 'local quote': 4 }

  const BASES = {
    unitMonth: 'per unit, per month',
    month: 'fixed, per month',
    residentDay: 'per resident day',
    once: 'one time, total',
    unitOnce: 'one time, per unit'
  }
  const GROUPS = {
    housing: 'Housing, recurring',
    other: 'Other operating, recurring',
    transition: 'Housing continuity',
    startup: 'Startup and capital, one time',
    deposit: 'Refundable deposits, cash held'
  }

  const INPUTS = [
    { key: 'U', label: 'Units leased', unit: 'units', rule: 'int1' },
    { key: 'P', label: 'Residents per occupied unit', unit: 'residents', rule: 'pos' },
    { key: 'O', label: 'Average occupancy', unit: 'percent', rule: 'pct' },
    { key: 'M', label: 'Duration', unit: 'months', rule: 'pos' },
    { key: 'mealsPerDay', label: 'Meals per resident per day', unit: 'meals per resident day', rule: 'nonneg' },
    { key: 'donatedShare', label: 'Share of meals supplied by donation', unit: 'percent of meals', rule: 'pct' },
    { key: 'costPerMeal', label: 'Cash cost per purchased meal', unit: 'dollars per meal', rule: 'nonneg' },
    { key: 'supplementsPerDay', label: 'Supplements or groceries', unit: 'dollars per resident day', rule: 'nonneg' },
    { key: 'foodLogisticsMonthly', label: 'Food transport and storage', unit: 'dollars per month', rule: 'nonneg' },
    { key: 'X', label: 'Expected repair spending paid from the reserve', unit: 'dollars for the period', rule: 'nonneg' },
    { key: 'R', label: 'Opening repair reserve', unit: 'dollars, one time', rule: 'nonneg' },
    { key: 'T', label: 'Contingency rate', unit: 'percent of planned spending', rule: 'pct' },
    { key: 'F', label: 'Committed funding (confirmed money only)', unit: 'dollars for the period', rule: 'nonneg' },
    { key: 'requested', label: 'Possible or requested funding (not confirmed)', unit: 'dollars for the period', rule: 'nonneg', req: false }
  ]
  const INPUT_META = {}
  INPUTS.forEach(m => { INPUT_META[m.key] = m })

  const WS_ITEMS = [
    { id: 'site', label: 'Specific sites or properties identified' },
    { id: 'avail', label: 'Units actually available, in the number needed' },
    { id: 'ready', label: 'Time until move-in ready, with a source' },
    { id: 'condition', label: 'Property condition checked on site' },
    { id: 'approvals', label: 'Zoning and approvals needed, and their status' },
    { id: 'utilities', label: 'Utilities and internet available or connectable' },
    { id: 'access', label: 'Accessibility checked for residents who need it' },
    { id: 'fit', label: 'Fit for the residents this pilot serves' },
    { id: 'sanitation', label: 'Cleaning, repair and turnover plan' },
    { id: 'owner', label: 'Owner or landlord willing, in writing' },
    { id: 'quotes', label: 'Cost lines backed by local quotes' }
  ]
  const WS_VALUES = { unknown: 'Unknown', yes: 'Yes', partly: 'Partly', no: 'No' }

  const SCEN_NAMES = { apartments: 'Apartments', motel: 'Motel rooms', prefab: 'Prefab homes' }

  // ---------- reading numbers ----------
  function read(v) {
    if (v === null || v === undefined || v === '') return { k: 'unknown' }
    if (typeof v === 'number') return isFinite(v) ? { k: 'ok', n: v } : { k: 'bad' }
    if (typeof v === 'string') {
      const t = v.replace(/[$,\s]/g, '').replace(/%$/, '')
      if (t === '') return { k: 'unknown' }
      if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return { k: 'bad' }
      return { k: 'ok', n: Number(t) }
    }
    return { k: 'bad' }
  }
  function check(rule, n) {
    if (rule === 'int1') return (!Number.isInteger(n) || n < 1) ? 'Whole number, 1 or more' : ''
    if (rule === 'pos') return n <= 0 ? 'Must be more than zero' : ''
    if (rule === 'pct') return (n < 0 || n > 100) ? 'Enter 0 to 100' : ''
    return n < 0 ? 'Cannot be negative' : ''
  }

  // ---------- scenario data ----------
  function newField() { return { v: null, st: 'unknown', src: '', dt: '' } }
  function mkLine(id, group, label, basis, req) {
    return { id, group, label, basis, req: req !== false, custom: false, v: null, st: 'unknown', src: '', dt: '' }
  }
  function mkStaff(id, role) {
    return { id, role, fte: null, salary: null, burden: null, st: 'unknown', src: '', dt: '', custom: false }
  }

  const PREFAB_LINES = [
    ['acquisition', 'startup', 'Unit purchase or acquisition', 'once'],
    ['delivery', 'startup', 'Delivery and installation', 'once'],
    ['siteWork', 'startup', 'Site work', 'once'],
    ['land', 'startup', 'Land purchase', 'once'],
    ['foundations', 'startup', 'Foundations', 'once'],
    ['utilityConn', 'startup', 'Utility connections', 'once'],
    ['approvals', 'startup', 'Permits and approvals', 'once'],
    ['landLease', 'housing', 'Recurring land lease', 'month'],
    ['financing', 'housing', 'Recurring financing cost (interest and fees only)', 'month']
  ]

  function makeScenario(kind, demo) {
    const s = { kind, name: SCEN_NAMES[kind], inputs: {}, lines: [], staff: [] }
    INPUTS.forEach(m => { s.inputs[m.key] = newField() })
    s.lines.push(mkLine('rent', 'housing', kind === 'motel' ? 'Rent or room rate per leased room' : 'Rent per leased unit', 'unitMonth'))
    s.lines.push(mkLine('utilities', 'housing', 'Utilities and internet', 'unitMonth'))
    if (kind === 'prefab') PREFAB_LINES.forEach(d => s.lines.push(mkLine(d[0], d[1], d[2], d[3])))
    s.lines.push(mkLine('insurance', 'other', 'Insurance', 'month'))
    s.lines.push(mkLine('admin', 'other', 'Administration', 'month'))
    s.lines.push(mkLine('maintenance', 'other', 'Maintenance not paid from the repair reserve', 'month'))
    s.lines.push(mkLine('otherRecurring', 'other', 'Other recurring costs', 'month'))
    s.lines.push(mkLine('furnishings', 'startup', 'Furnishings, equipment and setup', 'once'))
    s.lines.push(mkLine('deposits', 'deposit', 'Refundable deposits', 'once'))
    s.lines.push(mkLine('transition', 'transition', 'Support or transition costs so residents do not lose housing abruptly when the period ends', 'once'))
    s.staff.push(mkStaff('support', 'Resident support'))
    s.staff.push(mkStaff('peer', 'Peer support'))
    s.staff.push(mkStaff('property', 'Property coordination'))
    s.staff.push(mkStaff('food', 'Food handling'))
    if (demo) applyDemo(s, kind)
    return s
  }

  const DEMO_NOTE = 'Invented test value, not a price'
  const OMIT_NOTE = 'Set to zero and omitted from the demonstration. Review in a real scenario.'
  function setDemo(o, v, note) { o.v = v; o.st = 'demonstration'; o.src = note || DEMO_NOTE; o.dt = '' }

  function applyDemo(s, kind) {
    const base = { U: 10, P: 1, O: 80, M: 12, mealsPerDay: 1, donatedShare: 0, costPerMeal: 5, supplementsPerDay: 0, foodLogisticsMonthly: 0, X: 3000, R: 10000, T: 0, F: 200000 }
    const lv = { rent: 1000, utilities: 0, insurance: 0, admin: 0, maintenance: 0, otherRecurring: 0, transition: 0, furnishings: 10000, deposits: 0 }
    const notes = {}
    if (kind === 'motel') {
      base.O = 90
      lv.rent = 1400
      lv.furnishings = 4000
      notes.utilities = 'Included in the room rate (demonstration)'
    }
    if (kind === 'prefab') {
      lv.rent = 0
      notes.rent = 'Owned units, so no rent (demonstration)'
      Object.assign(lv, { acquisition: 150000, delivery: 20000, siteWork: 30000, land: 0, foundations: 15000, utilityConn: 25000, approvals: 5000, landLease: 1500, financing: 0 })
    }
    Object.keys(base).forEach(k => setDemo(s.inputs[k], base[k], (k === 'foodLogisticsMonthly' || k === 'supplementsPerDay') ? OMIT_NOTE : DEMO_NOTE))
    s.lines.forEach(l => {
      const v = lv[l.id]
      if (v === undefined) return
      setDemo(l, v, notes[l.id] || (v === 0 ? OMIT_NOTE : DEMO_NOTE))
    })
    s.staff.forEach(r => {
      if (r.id === 'support') { r.fte = 1; r.salary = 50000; r.burden = 20; r.src = DEMO_NOTE } else { r.fte = 0; r.salary = 0; r.burden = 0; r.src = OMIT_NOTE }
      r.st = 'demonstration'
    })
  }

  function makeWorksheet() {
    const w = {}
    WS_ITEMS.forEach(i => { w[i.id] = { v: 'unknown', note: '' } })
    return w
  }

  function defaultChecklist() {
    const rows = [
      ['Housing agreements', 'Written agreement with each property owner or landlord'],
      ['Housing agreements', 'Tenant rights and lease terms reviewed under local law'],
      ['Funding', 'Committed funding confirmed in writing'],
      ['Funding', 'Money set aside for housing continuity after the period ends'],
      ['Resident support', 'Support staff hired or assigned, with coverage hours set'],
      ['Resident support', 'Way to help residents complete required paperwork'],
      ['Rent payment', 'Who pays rent, and on what day each month'],
      ['Repairs', 'Repair reserve funded and held'],
      ['Repairs', 'Repair vendor and response time agreed'],
      ['Repairs', 'Process for repaying an owner for damage'],
      ['Food deliveries and storage', 'Food source confirmed in writing'],
      ['Food deliveries and storage', 'Safe storage, labeling and handling set up and staff trained'],
      ['Backup food', 'Backup food plan when a delivery fails'],
      ['Complaints and emergencies', 'How residents and neighbors raise a complaint'],
      ['Complaints and emergencies', 'Emergency contacts and steps posted'],
      ['Housing continuity', 'Plan for each resident when the funding period ends']
    ]
    return rows.map((r, i) => ({ id: 'c' + i, area: r[0], item: r[1], who: '', status: 'Not started', evidence: '' }))
  }

  // ---------- reading and writing one field by key ----------
  // Keys look like in:U, line:rent, staff:support:fte
  function metaObj(s, key) {
    const p = key.split(':')
    if (p[0] === 'in') return s.inputs[p[1]]
    if (p[0] === 'line') return s.lines.find(l => l.id === p[1])
    return s.staff.find(r => r.id === p[1])
  }
  function getV(s, key) {
    const p = key.split(':')
    return p[0] === 'staff' ? metaObj(s, key)[p[2]] : metaObj(s, key).v
  }
  function setV(s, key, val) {
    const p = key.split(':')
    if (p[0] === 'staff') metaObj(s, key)[p[2]] = val
    else metaObj(s, key).v = val
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)) }

  // ---------- the calculation ----------
  function factor(basis, U, M, resDays) {
    if (basis === 'unitMonth') return U * M
    if (basis === 'month') return M
    if (basis === 'residentDay') return resDays
    if (basis === 'unitOnce') return U
    return 1
  }

  function calc(s, opts) {
    const skip = !!(opts && opts.skipValidate)
    const errors = {}
    const unknown = []
    const notEntered = []
    const demo = []
    const noStatus = []

    function track(key, label, st, hasValue) {
      if (!hasValue) return
      if (st === 'demonstration') demo.push({ key, label })
      if (st === 'unknown') noStatus.push({ key, label })
    }
    function rd(key, label, v, rule, req, st, doTrack) {
      const r = read(v)
      if (r.k === 'bad') {
        if (!skip) errors[key] = 'Enter a number'
        return 0
      }
      if (r.k === 'unknown') {
        (req ? unknown : notEntered).push({ key, label })
        return 0
      }
      if (!skip) {
        const m = check(rule, r.n)
        if (m) errors[key] = m
      }
      if (doTrack !== false) track(key, label, st, true)
      return r.n
    }

    const n = {}
    INPUTS.forEach(m => {
      let req = m.req !== false
      if (m.key === 'costPerMeal') {
        const d = read(s.inputs.donatedShare.v)
        if (d.k === 'ok' && d.n >= 100) req = false
      }
      n[m.key] = rd('in:' + m.key, m.label, s.inputs[m.key].v, m.rule, req, s.inputs[m.key].st)
    })
    const capKnown = ['U', 'P', 'O', 'M'].every(k => read(s.inputs[k].v).k === 'ok')
    const U = n.U, P = n.P, O = n.O / 100, M = n.M
    const D = 365 * M / 12
    const avgRes = U * P * O
    const resMonths = avgRes * M
    const resDays = avgRes * D

    const items = []
    const amounts = {}
    let A = 0, S = 0, H = 0
    s.lines.forEach(l => {
      const key = 'line:' + l.id
      const v = rd(key, l.label, l.v, 'nonneg', l.req, l.st)
      const amt = v * factor(l.basis, U, M, resDays)
      amounts[key] = amt
      items.push({ key, label: l.label, group: l.group, amount: amt, st: l.st, src: l.src, hasValue: read(l.v).k === 'ok' })
      if (l.group === 'startup') S += amt
      else if (l.group === 'deposit') H += amt
      else A += amt
    })

    let staffTotal = 0
    let totalFte = 0
    s.staff.forEach(r => {
      const k = 'staff:' + r.id
      const fte = rd(k + ':fte', r.role + ', FTE', r.fte, 'nonneg', true, r.st, false)
      const sal = rd(k + ':salary', r.role + ', annual salary', r.salary, 'nonneg', true, r.st, false)
      const bur = rd(k + ':burden', r.role + ', payroll burden', r.burden, 'pct', true, r.st, false)
      const has = read(r.fte).k === 'ok' && read(r.salary).k === 'ok' && read(r.burden).k === 'ok'
      track(k, 'Staffing: ' + r.role, r.st, has)
      const c = fte * sal * (1 + bur / 100) * M / 12
      amounts[k] = c
      staffTotal += c
      totalFte += fte
      items.push({ key: k, label: 'Staffing: ' + r.role, group: 'staff', amount: c, st: r.st, src: r.src, hasValue: has })
    })

    const mealsRequired = resDays * n.mealsPerDay
    const purchasedMeals = mealsRequired * (1 - n.donatedShare / 100)
    const mealCost = purchasedMeals * n.costPerMeal
    const supplements = resDays * n.supplementsPerDay
    const logistics = n.foodLogisticsMonthly * M
    const mealRank = Math.min.apply(null, ['mealsPerDay', 'donatedShare', 'costPerMeal'].map(k => STATUS_RANK[s.inputs[k].st]))
    const mealSt = Object.keys(STATUS_RANK).find(k => STATUS_RANK[k] === mealRank)
    items.push({ key: 'in:costPerMeal', label: 'Meals purchased', group: 'food', amount: mealCost, st: mealSt, src: s.inputs.costPerMeal.src, hasValue: read(s.inputs.costPerMeal.v).k === 'ok' })
    items.push({ key: 'in:supplementsPerDay', label: 'Supplements or groceries', group: 'food', amount: supplements, st: s.inputs.supplementsPerDay.st, src: s.inputs.supplementsPerDay.src, hasValue: read(s.inputs.supplementsPerDay.v).k === 'ok' })
    items.push({ key: 'in:foodLogisticsMonthly', label: 'Food transport and storage', group: 'food', amount: logistics, st: s.inputs.foodLogisticsMonthly.st, src: s.inputs.foodLogisticsMonthly.src, hasValue: read(s.inputs.foodLogisticsMonthly.v).k === 'ok' })
    A += staffTotal + mealCost + supplements + logistics

    const X = n.X, Rr = n.R, T = n.T / 100
    items.push({ key: 'in:X', label: 'Expected repairs paid from the reserve', group: 'repairs', amount: X, st: s.inputs.X.st, src: s.inputs.X.src, hasValue: read(s.inputs.X.v).k === 'ok' })
    const E = A + S + X
    const C = T * E
    const B = A + S + H + Rr + C
    const G = Math.max(0, X - Rr)
    const K = B + G
    const unspentReserve = Math.max(0, Rr - X)
    const fk = read(s.inputs.F.v)
    const F = fk.k === 'ok' ? n.F : null
    const gap = F === null ? null : Math.max(0, K - F)
    const headroom = F === null ? null : Math.max(0, F - K)
    const rq = read(s.inputs.requested.v)
    const requested = rq.k === 'ok' ? n.requested : null

    const div = (a, b) => (b > 0 && capKnown ? a / b : null)

    const spendItems = items.filter(i => i.group !== 'deposit').map(i => ({ key: i.key, label: i.label, group: i.group, amount: i.amount, st: i.st }))
    spendItems.sort((a, b) => b.amount - a.amount)

    return {
      ok: Object.keys(errors).length === 0,
      errors, unknown, notEntered, demo, noStatus,
      complete: Object.keys(errors).length === 0 && unknown.length === 0,
      capKnown,
      cap: { U, P, O: n.O, M },
      D, avgRes, resMonths, resDays,
      mealsRequired, purchasedMeals, mealCost, supplements, logistics,
      staffTotal, totalFte,
      A, S, H, X, R: Rr, T: n.T, C, E, B, G, K, unspentReserve,
      F, gap, headroom, requested,
      perResMonthSpend: div(E, resMonths),
      perResDay: div(E, resDays),
      perResMonthFunding: div(K, resMonths),
      upfront: S + H + Rr,
      monthlyOperating: M > 0 ? A / M : null,
      items, amounts, spendItems
    }
  }

  // ---------- what moves the funding requirement most ----------
  function sensitivity(s) {
    const base = calc(s, { skipValidate: true })
    const keys = []
    const inputKeys = ['U', 'O', 'M', 'mealsPerDay', 'donatedShare', 'costPerMeal', 'supplementsPerDay', 'foodLogisticsMonthly', 'X', 'R', 'T']
    inputKeys.forEach(k => keys.push(['in:' + k, INPUT_META[k].label, s.inputs[k].st]))
    s.lines.forEach(l => keys.push(['line:' + l.id, l.label, l.st]))
    s.staff.forEach(r => keys.push(['staff:' + r.id + ':fte', 'Staffing: ' + r.role + ', FTE', r.st]))
    const rows = []
    keys.forEach(k => {
      const cur = read(getV(s, k[0]))
      if (cur.k !== 'ok' || cur.n <= 0) return
      const pct = k[0] === 'in:O' || k[0] === 'in:donatedShare' || k[0] === 'in:T'
      function withValue(x) {
        const c = clone(s)
        setV(c, k[0], pct ? Math.min(100, x) : x)
        return calc(c, { skipValidate: true }).K - base.K
      }
      const up = withValue(cur.n * 1.1)
      const down = withValue(cur.n * 0.9)
      const size = Math.max(Math.abs(up), Math.abs(down))
      if (size < 0.5) return
      rows.push({ key: k[0], label: k[1], st: k[2], value: cur.n, up, down, size })
    })
    rows.sort((a, b) => b.size - a.size)
    return rows
  }

  // ---------- ways to close a funding gap, one change at a time ----------
  function closeGap(s) {
    const base = calc(s)
    if (!base.ok || base.gap === null || base.gap <= 0) return []
    const gapWith = mod => {
      const c = clone(s)
      mod(c)
      return calc(c, { skipValidate: true }).gap
    }
    function bisect(f, bad, good) {
      // f(x) is the gap. bad has gap above zero. good is the far end.
      if (f(good) > 0.005) return null
      let a = bad, b = good
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2
        if (f(m) > 0.005) a = m
        else b = m
      }
      return b
    }
    const out = []
    out.push({ id: 'fund', amount: base.gap, reachable: true })

    const rent = read(getV(s, 'line:rent'))
    if (rent.k === 'ok' && rent.n > 0) {
      const x = bisect(v => gapWith(c => setV(c, 'line:rent', v)), rent.n, 0)
      out.push({ id: 'rent', from: rent.n, to: x === null ? null : Math.floor(x * 100) / 100, reachable: x !== null })
    }
    if (base.cap.U > 1) {
      let found = null
      for (let u = base.cap.U - 1; u >= 1; u--) {
        if (gapWith(c => setV(c, 'in:U', u)) <= 0.005) { found = u; break }
      }
      out.push({
        id: 'units', from: base.cap.U, to: found, reachable: found !== null,
        residentsFrom: base.avgRes, residentsTo: found === null ? null : found * base.cap.P * base.cap.O / 100
      })
    }
    const ds = read(s.inputs.donatedShare.v)
    if (ds.k === 'ok' && ds.n < 100) {
      const x = bisect(v => gapWith(c => setV(c, 'in:donatedShare', v)), ds.n, 100)
      out.push({ id: 'donated', from: ds.n, to: x === null ? null : Math.ceil(x * 10) / 10, reachable: x !== null })
    }
    if (base.totalFte > 0) {
      const scaleGap = f => gapWith(c => c.staff.forEach(r => {
        const v = read(r.fte)
        if (v.k === 'ok') r.fte = v.n * f
      }))
      const x = bisect(scaleGap, 1, 0)
      out.push({ id: 'staff', from: base.totalFte, to: x === null ? null : base.totalFte * (Math.floor(x * 100) / 100), reachable: x !== null, scale: x === null ? null : Math.floor(x * 100) / 100 })
    }
    return out
  }

  function wsUnknownCount(ws) {
    return WS_ITEMS.filter(i => !ws || !ws[i.id] || ws[i.id].v === 'unknown').length
  }

  return {
    STATUSES, STATUS_LABEL, STATUS_RANK, BASES, GROUPS, INPUTS, INPUT_META, WS_ITEMS, WS_VALUES, SCEN_NAMES,
    read, check, makeScenario, makeWorksheet, defaultChecklist, metaObj, getV, setV, clone,
    calc, sensitivity, closeGap, wsUnknownCount, newField, mkLine, mkStaff
  }
}))
