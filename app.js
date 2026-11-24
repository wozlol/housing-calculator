(function () {
  'use strict'
  const HC = window.HC
  const KEY = 'hc-v1'
  const SCENS = ['apartments', 'motel', 'prefab']

  const $ = (s, r) => (r || document).querySelector(s)
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))
  const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  function money(n, d) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a'
    const dd = d === undefined ? 0 : d
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dd, maximumFractionDigits: dd })
  }
  function num(n, d) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a'
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d === undefined ? 1 : d })
  }
  function dispVal(v) { return v === null || v === undefined ? '' : String(v) }
  function parseIn(txt) {
    const r = HC.read(txt)
    if (r.k === 'ok') return r.n
    if (r.k === 'unknown') return null
    return txt
  }
  function delta(d, goodWhenDown) {
    if (!isFinite(d) || Math.abs(d) < 0.5) return ''
    const up = d > 0
    const cls = (up === !!goodWhenDown) ? 'down' : 'up'
    return `<span class="chip ${cls}">${up ? '+' : '-'}${money(Math.abs(d))} vs pinned</span>`
  }

  // ---------- state ----------
  function fresh(demo) {
    const st = { v: 1, active: 'apartments', ref: 'apartments', scen: {}, ws: {}, baselines: {}, checklist: HC.defaultChecklist(), test: { who: '', date: '', did: '', hesitated: '', comments: '', change: '' } }
    SCENS.forEach(k => { st.scen[k] = HC.makeScenario(k, demo); st.ws[k] = HC.makeWorksheet() })
    return st
  }
  function normalize(o) {
    if (!o || typeof o !== 'object' || !o.scen) return null
    const st = fresh(false)
    for (const k of SCENS) {
      const s = o.scen[k]
      if (!s || !s.inputs || !Array.isArray(s.lines) || !Array.isArray(s.staff)) return null
      HC.INPUTS.forEach(m => { if (!s.inputs[m.key]) s.inputs[m.key] = HC.newField() })
      s.name = HC.SCEN_NAMES[k]
      s.kind = k
      st.scen[k] = s
      st.ws[k] = Object.assign(HC.makeWorksheet(), (o.ws && o.ws[k]) || {})
    }
    st.active = SCENS.includes(o.active) ? o.active : 'apartments'
    st.ref = SCENS.includes(o.ref) ? o.ref : 'apartments'
    st.baselines = o.baselines || {}
    if (Array.isArray(o.checklist)) st.checklist = o.checklist
    if (o.test) st.test = Object.assign(st.test, o.test)
    return st
  }
  function b64enc(str) {
    const bytes = new TextEncoder().encode(str)
    let bin = ''
    bytes.forEach(b => { bin += String.fromCharCode(b) })
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_')
  }
  function b64dec(b) {
    const bin = atob(b.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
  }
  function loadState() {
    try {
      const m = location.hash.match(/^#s=(.+)$/)
      if (m) {
        const st = normalize(JSON.parse(b64dec(m[1])))
        if (st) return { st, from: 'link' }
      }
    } catch (e) { /* ignore a bad link */ }
    try {
      const t = localStorage.getItem(KEY)
      if (t) {
        const st = normalize(JSON.parse(t))
        if (st) return { st, from: 'saved' }
      }
    } catch (e) { /* storage may be blocked */ }
    return { st: fresh(true), from: 'new' }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch (e) { /* storage may be blocked */ }
  }

  const loaded = loadState()
  let state = loaded.st
  let R = {}
  let tab = 'results'
  let snapshot = null

  function toast(msg) {
    const t = $('#toast')
    t.textContent = msg
    clearTimeout(toast.h)
    toast.h = setTimeout(() => { t.textContent = '' }, 6000)
  }
  function takeSnapshot() {
    snapshot = JSON.stringify(state)
    $('#btn-undo').hidden = false
  }
  const active = () => state.scen[state.active]
  const ar = () => R[state.active]

  function compute() {
    SCENS.forEach(k => { R[k] = HC.calc(state.scen[k]) })
  }

  // ---------- top strip and banner ----------
  function gapShort(r) {
    if (!r.ok) return 'Fix entries'
    if (r.gap === null) return 'Enter funding'
    return r.gap > 0 ? money(r.gap) : 'None'
  }
  function renderStrip() {
    const r = ar()
    const b = state.baselines[state.active]
    $$('.scen button').forEach(x => x.setAttribute('aria-selected', x.dataset.scen === state.active ? 'true' : 'false'))
    if (!r.ok) {
      $('#strip').innerHTML = '<div class="s"><b>Fix entries</b><span>Some entries are not valid numbers. See the red messages in Assumptions.</span></div>'
      return
    }
    const inc = r.complete ? '' : ' (known costs only)'
    const gapLabel = r.gap === null ? 'Committed funding not entered' : (r.gap > 0 ? 'Funding gap' + inc : 'Funding headroom ' + money(r.headroom))
    $('#strip').innerHTML =
      `<div class="s"><b>${money(r.K)}</b><span>Funding required${inc}${b ? delta(r.K - b.K) : ''}</span></div>` +
      `<div class="s"><b>${r.F === null ? 'Not entered' : money(r.F)}</b><span>Committed funding</span></div>` +
      `<div class="s"><b>${gapShort(r)}</b><span>${gapLabel}${b && r.gap !== null && b.gap !== null ? delta(r.gap - b.gap) : ''}</span></div>` +
      `<div class="s"><b>${num(r.avgRes)}</b><span>Average residents housed</span></div>` +
      `<div class="s"><b>${money(r.perResMonthSpend, 0)}</b><span>Spending per occupied resident month</span></div>`
  }
  function renderBanner() {
    const r = ar()
    let h = ''
    if (!r.ok) {
      h += `<div class="b err"><b>${Object.keys(r.errors).length} entries need fixing.</b> Results are hidden until every entry is valid. Open Assumptions and look for the red messages.</div>`
    }
    if (r.demo.length) {
      h += '<div class="b demo"><b>Demonstration values are loaded in this scenario.</b> They are invented test numbers, not Las Vegas prices or staffing advice. Replace them before using any figure.</div>'
    }
    h += '<p class="muted small">No resident information is collected. Entries stay in this browser unless you save a file or copy a share link. This tool does not estimate taxpayer savings.</p>'
    $('#banner').innerHTML = h
  }

  // ---------- results tab ----------
  function howtoHTML() {
    return '<b>How to use this</b><ol>' +
      '<li>Load the demonstration to see how it works, or start blank and enter your own numbers in Assumptions.</li>' +
      '<li>Set a source status on each number: local quote, published reference, planning assumption, or demonstration. A blank number means unknown, not zero.</li>' +
      '<li>Read the funding required and the gap here. Use the levers to see what changes when you balance things differently.</li>' +
      '<li>Compare apartments, motel rooms and prefab homes side by side in Compare housing.</li></ol>'
  }

  function actionList(s, r) {
    const a = []
    if (!r.ok) {
      a.push({ t: `Fix ${Object.keys(r.errors).length} invalid entries`, why: 'Results are hidden until every entry is a valid number in range. Open Assumptions and look for the red messages.' })
      return a
    }
    if (r.unknown.length) {
      a.push({ t: `Fill in ${r.unknown.length} required lines that are still blank`, why: `Blank means unknown, not zero. Enter 0 on purpose where a cost does not apply. Until then every total is known costs only. First ones: ${r.unknown.slice(0, 5).map(u => u.label).join(', ')}.` })
    }
    if (r.gap === null) {
      a.push({ t: 'Enter committed funding', why: 'Count only money that is confirmed. Without it there is no funding gap.' })
    } else if (r.gap > 0) {
      a.push({ t: `Decide how to close the ${money(r.gap)} funding gap`, why: 'See Ways to close the gap below. Each option changes one thing and shows what else changes.' })
    } else {
      a.push({ t: `Committed funding covers the requirement with ${money(r.headroom)} to spare`, why: 'Confirm each committed amount in writing before relying on it.' })
    }
    const verify = r.items.filter(i => i.hasValue && i.amount > 0 && HC.STATUS_RANK[i.st] <= 2).sort((x, y) => y.amount - x.amount).slice(0, 3)
    if (verify.length) {
      a.push({ t: 'Get local quotes or published sources for the biggest unverified costs', why: verify.map(i => `${i.label} (${money(i.amount)}, ${HC.STATUS_LABEL[i.st]})`).join('. ') + '.' })
    }
    if (r.noStatus.length) {
      a.push({ t: `Set a source status on ${r.noStatus.length} values`, why: 'These have a number but no source status, so a reader cannot tell where they came from.' })
    }
    if (r.demo.length) {
      a.push({ t: 'Replace demonstration values with real ones', why: `${r.demo.length} values are invented test numbers.` })
    }
    const wsu = HC.wsUnknownCount(state.ws[state.active])
    if (wsu > 0) {
      a.push({ t: `Check ${wsu} of ${HC.WS_ITEMS.length} housing worksheet items for this scenario`, why: 'Cost alone does not decide between housing types. Availability, readiness, approvals, accessibility and fit are still Unknown. See Compare housing.' })
    }
    return a
  }

  function headHTML(r) {
    const b = state.baselines[state.active]
    const inc = r.complete ? '' : '<span class="tag verify">known costs only</span> '
    const gapCls = r.gap === null ? '' : (r.gap > 0 ? 'gapbad' : 'gapgood')
    const gapBig = r.gap === null ? 'Not entered' : (r.gap > 0 ? money(r.gap) : 'None')
    const gapSub = r.gap === null ? 'Enter committed funding to see the gap' : (r.gap > 0 ? 'Funding required minus committed funding' : `Headroom: ${money(r.headroom)}`)
    let h = '<div class="cards">'
    h += `<div class="card"><div class="lab">Funding required (K)</div><div class="big">${money(r.K)}</div><div class="sub">${inc}All cash to be raised for the period, one time and ongoing${b ? '<br>' + delta(r.K - b.K) : ''}</div></div>`
    h += `<div class="card"><div class="lab">Committed funding (F)</div><div class="big">${r.F === null ? 'Not entered' : money(r.F)}</div><div class="sub">Confirmed money only${r.requested !== null ? `<br>Possible, not counted: ${money(r.requested)}` : ''}</div></div>`
    h += `<div class="card ${gapCls}"><div class="lab">Funding gap</div><div class="big">${gapBig}</div><div class="sub">${gapSub}${b && r.gap !== null && b.gap !== null ? '<br>' + delta(r.gap - b.gap) : ''}</div></div>`
    h += `<div class="card"><div class="lab">Average residents housed</div><div class="big">${num(r.avgRes)}</div><div class="sub">${r.cap.U} units, ${num(r.cap.O)}% occupied, ${num(r.cap.M)} months. ${num(r.resMonths)} resident months, ${num(r.resDays, 0)} resident days.</div></div>`
    h += `<div class="card"><div class="lab">Spending per occupied resident month</div><div class="big">${money(r.perResMonthSpend, 2)}</div><div class="sub">Funding required per resident month: ${money(r.perResMonthFunding, 2)}</div></div>`
    h += `<div class="card"><div class="lab">Spending per resident day</div><div class="big">${money(r.perResDay, 2)}</div><div class="sub">Planned spending divided by resident days</div></div>`
    h += '</div>'

    h += '<div class="panel"><h2>Spending versus funding required</h2>'
    h += '<p class="muted small">Spending is money paid out. Funding required also covers cash that is held and may come back or go unspent.</p>'
    h += '<div class="tablewrap"><table><thead><tr><th>Line</th><th class="num">Amount for the period</th><th>Note</th></tr></thead><tbody>'
    h += `<tr><td>Recurring operating costs (A)</td><td class="num">${money(r.A)}</td><td class="muted small">About ${money(r.monthlyOperating)} per month on average</td></tr>`
    h += `<tr><td>Startup and capital, one time (S)</td><td class="num">${money(r.S)}</td><td class="muted small">Kept apart from ongoing cost. A short period is not a lifecycle cost.</td></tr>`
    h += `<tr><td>Expected repairs paid from the reserve (X)</td><td class="num">${money(r.X)}</td><td></td></tr>`
    h += `<tr class="total"><td>Planned spending (E)</td><td class="num">${money(r.E)}</td><td></td></tr>`
    h += `<tr class="sub"><td>+ Refundable deposits held (H)</td><td class="num">${money(r.H)}</td><td class="small">Cash held, not spent</td></tr>`
    h += `<tr class="sub"><td>+ Unspent repair reserve at the end</td><td class="num">${money(r.unspentReserve)}</td><td class="small">Opening reserve ${money(r.R)} minus repairs ${money(r.X)}</td></tr>`
    h += `<tr class="sub"><td>+ Contingency allowance (C)</td><td class="num">${money(r.C)}</td><td class="small">${num(r.T)}% of planned spending, held for uncertainty</td></tr>`
    h += `<tr class="total"><td>Funding required (K)</td><td class="num">${money(r.K)}</td><td class="small">${r.G > 0 ? `Includes ${money(r.G)} of extra repair funding because the opening reserve is smaller than expected repairs` : ''}</td></tr>`
    h += '</tbody></table></div>'
    h += `<p class="small muted">Cash needed at the start (startup, deposits and opening reserve): <b>${money(r.upfront)}</b></p>`
    h += '</div>'
    return h
  }

  function actionsHTML(s, r) {
    const a = actionList(s, r)
    return '<div class="panel"><h2>What to do next, in order</h2><ol class="actions">' +
      a.map(x => `<li><b>${esc(x.t)}</b><span class="why">${esc(x.why)}</span></li>`).join('') + '</ol></div>'
  }

  function closeHTML(s, r) {
    const opts = HC.closeGap(s)
    if (r.gap === null || r.gap <= 0) {
      return '<div class="panel"><h2>Ways to close the funding gap</h2><p class="muted">There is no funding gap in this scenario right now.</p></div>'
    }
    let h = '<div class="panel"><h2>Ways to close the funding gap</h2>'
    h += `<p class="muted small">Gap to close: ${money(r.gap)}${r.complete ? '' : ' or more, because required lines are still blank'}. Each option changes one thing and holds everything else. These are options with trade-offs, not recommendations.</p>`
    opts.forEach(o => {
      if (o.id === 'fund') {
        let extra = ''
        if (r.requested !== null) extra = ` You entered ${money(r.requested)} as possible funding. If all of it were confirmed the gap would be ${money(Math.max(0, r.gap - r.requested))}.`
        h += `<div class="opt"><b>Raise committed funding by ${money(o.amount)}</b>Nothing else changes. It must be confirmed money, not requests.${extra}</div>`
      } else if (o.id === 'rent') {
        h += o.reachable
          ? `<div class="opt"><b>Lower rent per unit from ${money(o.from)} to ${money(o.to, 2)} a month (${num((1 - o.to / o.from) * 100)}% lower)</b>Residents housed and staffing stay the same. It needs owners to agree to the lower rent.</div>`
          : '<div class="opt"><b>Lower rent per unit</b>Does not close the gap on its own, even at $0 rent.</div>'
      } else if (o.id === 'units') {
        h += o.reachable
          ? `<div class="opt"><b>Lease ${o.to} units instead of ${o.from}</b>Average residents housed falls from ${num(o.residentsFrom)} to ${num(o.residentsTo)}. Staffing is held the same, so check whether that coverage still makes sense.</div>`
          : '<div class="opt"><b>Lease fewer units</b>Does not close the gap on its own, even at one unit. Staffing and startup costs stay.</div>'
      } else if (o.id === 'donated') {
        h += o.reachable
          ? `<div class="opt"><b>Raise donated meals from ${num(o.from)}% to ${num(o.to)}%</b>Residents get the same number of meals. It needs a food supply that is confirmed. Food rescue is a possible source, not a committed delivery, and storage and handling still cost money.</div>`
          : '<div class="opt"><b>Raise donated meals</b>Does not close the gap on its own, even at 100% donated.</div>'
      } else if (o.id === 'staff') {
        h += o.reachable
          ? `<div class="opt"><b>Cut all staff hours to ${num(o.scale * 100)}% of now (${num(o.from, 2)} FTE down to ${num(o.to, 2)} FTE)</b>Residents get less support. Staffing coverage is a choice to make with the operator.</div>`
          : '<div class="opt"><b>Cut staff hours</b>Does not close the gap on its own, even with no staff.</div>'
      }
    })
    h += '</div>'
    return h
  }

  function costsHTML(r) {
    const items = r.spendItems.filter(i => i.amount > 0.005)
    let h = '<div class="panel"><h2>Largest costs in planned spending</h2>'
    if (!items.length) return h + '<p class="muted">No costs entered yet.</p></div>'
    h += '<div class="tablewrap"><table><thead><tr><th>Cost</th><th class="num">Amount for the period</th><th class="num">Share of spending</th><th></th><th>Source status</th></tr></thead><tbody>'
    items.slice(0, 12).forEach(i => {
      const share = r.E > 0 ? i.amount / r.E * 100 : 0
      h += `<tr><td>${esc(i.label)}</td><td class="num">${money(i.amount)}</td><td class="num">${num(share)}%</td><td><div class="bar"><i style="width:${Math.min(100, share)}%"></i></div></td><td>${statusTag(i.st)}</td></tr>`
    })
    h += '</tbody></table></div>'
    h += `<p class="small muted">Held but not spent: refundable deposits ${money(r.H)}, unspent repair reserve ${money(r.unspentReserve)}, contingency ${money(r.C)}.</p></div>`
    return h
  }
  function statusTag(st) {
    const cls = HC.STATUS_RANK[st] <= 2 ? (st === 'demonstration' ? 'tag demo' : 'tag verify') : 'tag'
    return `<span class="${cls}">${esc(HC.STATUS_LABEL[st] || st)}</span>`
  }

  function sensHTML(s, r) {
    const rows = HC.sensitivity(s).slice(0, 8)
    let h = '<div class="panel"><h2>What moves the funding requirement most</h2>'
    h += '<p class="muted small">Each row nudges one number 10 percent up and 10 percent down and holds everything else. Rows tagged Verify first are large and not yet backed by a local quote or published source. Check those before you rely on the total.</p>'
    if (!rows.length) return h + '<p class="muted">Enter some numbers first.</p></div>'
    h += '<div class="tablewrap"><table><thead><tr><th>Number</th><th class="num">Now</th><th class="num">If 10% higher</th><th class="num">If 10% lower</th><th>Source status</th><th></th></tr></thead><tbody>'
    rows.forEach((x, i) => {
      const verify = i < 5 && HC.STATUS_RANK[x.st] <= 2
      h += `<tr><td>${esc(x.label)}</td><td class="num">${num(x.value, 2)}</td><td class="num">${x.up >= 0 ? '+' : '-'}${money(Math.abs(x.up))}</td><td class="num">${x.down >= 0 ? '+' : '-'}${money(Math.abs(x.down))}</td><td>${statusTag(x.st)}</td><td>${verify ? '<span class="tag verify">Verify first</span>' : ''}</td></tr>`
    })
    h += '</tbody></table></div></div>'
    return h
  }

  function missingHTML(r) {
    let h = '<div class="panel"><h2>Missing inputs and demonstration-only values</h2>'
    if (r.unknown.length) {
      h += `<h3>Required lines still blank (${r.unknown.length})</h3><p class="small muted">These are unknown, not zero. Totals leave them out.</p><ul>` + r.unknown.map(u => `<li>${esc(u.label)}</li>`).join('') + '</ul>'
    } else {
      h += '<p>No required lines are blank.</p>'
    }
    if (r.demo.length) {
      h += `<h3>Demonstration values (${r.demo.length})</h3><p class="small muted">Invented test numbers. They are not prices.</p><ul>` + r.demo.map(u => `<li>${esc(u.label)}</li>`).join('') + '</ul>'
    }
    if (r.noStatus.length) {
      h += `<h3>Values with no source status (${r.noStatus.length})</h3><ul>` + r.noStatus.map(u => `<li>${esc(u.label)}</li>`).join('') + '</ul>'
    }
    if (r.notEntered.length) {
      h += `<h3>Optional lines not entered (${r.notEntered.length})</h3><ul>` + r.notEntered.map(u => `<li>${esc(u.label)}</li>`).join('') + '</ul>'
    }
    return h + '</div>'
  }

  function renderResultsOutputs() {
    const r = ar(), s = active()
    if (!r.ok) {
      $('#r-head').innerHTML = ''
      $('#r-actions').innerHTML = actionsHTML(s, r)
      $('#r-close').innerHTML = ''
      $('#r-costs').innerHTML = ''
      $('#r-sens').innerHTML = ''
      $('#r-missing').innerHTML = ''
      return
    }
    $('#r-head').innerHTML = headHTML(r)
    $('#r-actions').innerHTML = actionsHTML(s, r)
    $('#r-close').innerHTML = closeHTML(s, r)
    $('#r-costs').innerHTML = costsHTML(r)
    $('#r-sens').innerHTML = sensHTML(s, r)
    $('#r-missing').innerHTML = missingHTML(r)
  }

  const LEVERS = [
    { key: 'in:U', label: 'Units leased', min: 1, max: v => Math.max(50, v * 2), step: 1, fmt: v => num(v, 0) },
    { key: 'in:O', label: 'Average occupancy', min: 0, max: () => 100, step: 1, fmt: v => num(v, 0) + '%' },
    { key: 'line:rent', label: 'Rent per unit per month', min: 0, max: v => Math.max(3000, v * 2), step: 10, fmt: v => money(v) },
    { key: 'in:donatedShare', label: 'Share of meals donated', min: 0, max: () => 100, step: 1, fmt: v => num(v, 0) + '%' },
    { key: 'in:M', label: 'Duration in months', min: 1, max: v => Math.max(36, v * 2), step: 1, fmt: v => num(v, 0) }
  ]
  function renderLevers() {
    const s = active()
    const b = state.baselines[state.active]
    let h = '<div class="panel"><h2>Balance the numbers</h2>'
    h += '<p class="muted small">Move one lever at a time. Results and the bar at the top change right away. Each lever edits only its own assumption.</p>'
    LEVERS.forEach(L => {
      const rv = HC.read(HC.getV(s, L.key))
      if (rv.k !== 'ok') {
        h += `<div class="lever"><label>${L.label}</label><span class="muted small">Enter this in Assumptions first</span><output></output></div>`
        return
      }
      const mx = Math.max(L.max(rv.n), rv.n)
      h += `<div class="lever"><label for="lv-${L.key}">${L.label}</label><input type="range" id="lv-${L.key}" data-lever="${L.key}" min="${L.min}" max="${mx}" step="${L.step}" value="${rv.n}"><output id="out-${L.key}">${L.fmt(rv.n)}</output></div>`
    })
    h += '<div style="margin-top:10px">'
    h += '<button type="button" data-act="pin">Pin the current numbers as a baseline</button> '
    if (b) h += `<button type="button" data-act="unpin">Clear baseline</button> <span class="small muted">Baseline: funding required ${money(b.K)}, gap ${b.gap === null ? 'not entered' : money(b.gap)}. Changes are shown against it.</span>`
    else h += '<span class="small muted">Pin first, then change levers, to see the difference from where you started.</span>'
    h += '</div></div>'
    $('#r-levers').innerHTML = h
  }

  function renderResults() {
    $('#howto').innerHTML = howtoHTML()
    renderLevers()
    renderResultsOutputs()
  }

  // ---------- assumptions tab ----------
  function statusSelect(key, st) {
    return `<select data-key="${esc(key)}" data-f="st" aria-label="Source status">` +
      HC.STATUSES.map(x => `<option value="${x}"${x === st ? ' selected' : ''}>${HC.STATUS_LABEL[x]}</option>`).join('') + '</select>'
  }
  function srcCells(key, o) {
    return `<td>${statusSelect(key, o.st)}</td>` +
      `<td><input type="text" class="note" data-key="${esc(key)}" data-f="src" value="${esc(o.src)}" placeholder="Quote, link or note" aria-label="Source link or note"></td>` +
      `<td><input type="date" data-key="${esc(key)}" data-f="dt" value="${esc(o.dt)}" aria-label="Date of source"></td>`
  }
  const SRC_HEAD = '<th>Source status</th><th>Source link or note</th><th>Date</th>'

  function inputRow(s, key, amtKey) {
    const m = HC.INPUT_META[key.split(':')[1]]
    const o = HC.metaObj(s, key)
    const opt = m.req === false ? ' <span class="muted small">(optional)</span>' : ''
    return `<tr><td>${esc(m.label)}${opt}</td><td class="muted small">${esc(m.unit)}</td>` +
      `<td><input type="text" inputmode="decimal" class="v" data-key="${key}" data-f="v" value="${esc(dispVal(o.v))}" aria-label="${esc(m.label)}"><span class="err" data-err="${key}"></span></td>` +
      `<td>${amtKey ? `<span class="calcval" data-amt="${amtKey}"></span>` : ''}</td>${srcCells(key, o)}</tr>`
  }
  function lineRow(l) {
    const key = 'line:' + l.id
    const lab = l.custom
      ? `<input type="text" class="lab" data-key="${key}" data-f="label" value="${esc(l.label)}" aria-label="Line name"> <button type="button" class="linkish" data-act="rmline" data-id="${esc(l.id)}">Remove</button>`
      : esc(l.label) + (l.req ? '' : ' <span class="muted small">(optional)</span>')
    const basis = `<select data-key="${key}" data-f="basis" aria-label="Basis">` + Object.keys(HC.BASES).map(b => `<option value="${b}"${b === l.basis ? ' selected' : ''}>${HC.BASES[b]}</option>`).join('') + '</select>'
    return `<tr><td>${lab}</td><td>${basis}</td>` +
      `<td><input type="text" inputmode="decimal" class="v" data-key="${key}" data-f="v" value="${esc(dispVal(l.v))}" aria-label="${esc(l.label)}"><span class="err" data-err="${key}"></span></td>` +
      `<td><span class="calcval" data-amt="${key}"></span></td>${srcCells(key, l)}</tr>`
  }
  function lineSection(s, title, groups, addGroup, note) {
    const lines = s.lines.filter(l => groups.includes(l.group))
    let h = `<div class="panel"><h2>${title}</h2>${note ? `<p class="muted small">${note}</p>` : ''}<div class="tablewrap"><table><thead><tr><th>Cost</th><th>Basis</th><th>Value in dollars</th><th>Amount for the period</th>${SRC_HEAD}</tr></thead><tbody>`
    h += lines.map(lineRow).join('')
    h += '</tbody></table></div>'
    if (addGroup) h += `<div class="addrow"><button type="button" data-act="addline" data-group="${addGroup}">Add a cost line</button></div>`
    return h + '</div>'
  }
  function staffRow(r) {
    const key = 'staff:' + r.id
    const role = r.custom
      ? `<input type="text" class="lab" data-key="${key}" data-f="role" value="${esc(r.role)}" aria-label="Role"> <button type="button" class="linkish" data-act="rmstaff" data-id="${esc(r.id)}">Remove</button>`
      : esc(r.role)
    const f = (fld, label) => `<td><input type="text" inputmode="decimal" class="v" data-key="${key}:${fld}" data-f="v" value="${esc(dispVal(r[fld]))}" aria-label="${esc(r.role + ' ' + label)}"><span class="err" data-err="${key}:${fld}"></span></td>`
    return `<tr><td>${role}</td>${f('fte', 'FTE')}${f('salary', 'annual salary')}${f('burden', 'payroll burden percent')}<td><span class="calcval" data-amt="${key}"></span></td>${srcCells(key, r)}</tr>`
  }

  function renderAssume() {
    const s = active()
    let h = `<p class="muted">Editing: <b>${esc(s.name)}</b>. White boxes are yours to edit. Gray boxes are calculated. Blank means unknown, not zero. Enter 0 on purpose where a cost truly does not apply, and say why in the note.</p>`

    h += '<div class="panel"><h2>Capacity and duration</h2><div class="tablewrap"><table><thead><tr><th>Input</th><th>Unit</th><th>Value</th><th>Result</th>' + SRC_HEAD + '</tr></thead><tbody>'
    h += inputRow(s, 'in:U') + inputRow(s, 'in:P') + inputRow(s, 'in:O') + inputRow(s, 'in:M')
    h += '<tr><td>Planning days (D)</td><td class="muted small">days, 365 x months / 12, an approximation</td><td></td><td><span class="calcval" data-amt="D"></span></td><td colspan="3"></td></tr>'
    h += '<tr><td>Average residents housed</td><td class="muted small">units x residents x occupancy</td><td></td><td><span class="calcval" data-amt="avgRes"></span></td><td colspan="3"></td></tr>'
    h += '<tr><td>Resident months</td><td class="muted small">average residents x months</td><td></td><td><span class="calcval" data-amt="resMonths"></span></td><td colspan="3"></td></tr>'
    h += '<tr><td>Resident days</td><td class="muted small">average residents x planning days</td><td></td><td><span class="calcval" data-amt="resDays"></span></td><td colspan="3"></td></tr>'
    h += '</tbody></table></div></div>'

    h += lineSection(s, 'Housing and other recurring costs', ['housing', 'other'], 'other', 'Rent applies to every leased unit, including empty ones. Fixed costs do not shrink with occupancy. If there is no rent, enter 0 on purpose and say why in the note.')
    h += lineSection(s, 'Startup and capital, one time', ['startup'], 'startup', s.kind === 'prefab' ? 'Prefab homes need land, delivery, site work, foundations, utility connections and approvals. None of these is assumed to be zero. Keep any recurring land lease or financing cost above, and never count the same financing principal as a purchase too. If the land is provided, enter 0 on purpose.' : 'For owned or prefab options, add purchase, delivery, site work, land, foundations, utility connections and approvals as separate lines.')
    h += lineSection(s, 'Refundable deposits (cash held)', ['deposit'], null, 'Held, not spent. They count toward funding required but not toward planned spending.')

    h += '<div class="panel"><h2>Staffing</h2><p class="muted small">Staffing is an explicit assumption. It does not rise or fall with occupancy. Food handling labor goes here, not in meal cost.</p><div class="tablewrap"><table><thead><tr><th>Role</th><th>Full-time equivalents</th><th>Annual salary in dollars</th><th>Payroll burden in percent</th><th>Amount for the period</th>' + SRC_HEAD + '</tr></thead><tbody>'
    h += s.staff.map(staffRow).join('')
    h += '</tbody></table></div><div class="addrow"><button type="button" data-act="addstaff">Add a staff role</button></div></div>'

    h += '<div class="panel"><h2>Meals</h2><div class="tablewrap"><table><thead><tr><th>Input</th><th>Unit</th><th>Value</th><th>Amount for the period</th>' + SRC_HEAD + '</tr></thead><tbody>'
    h += inputRow(s, 'in:mealsPerDay') + inputRow(s, 'in:donatedShare') + inputRow(s, 'in:costPerMeal', 'mealCost') + inputRow(s, 'in:supplementsPerDay', 'supplements') + inputRow(s, 'in:foodLogisticsMonthly', 'logistics')
    h += '<tr><td>Meals required</td><td class="muted small">resident days x meals per day</td><td></td><td><span class="calcval" data-amt="mealsRequired"></span></td><td colspan="3"></td></tr>'
    h += '<tr><td>Meals purchased</td><td class="muted small">meals required x (1 - donated share)</td><td></td><td><span class="calcval" data-amt="purchasedMeals"></span></td><td colspan="3"></td></tr>'
    h += '</tbody></table></div><p class="small muted">A donated meal is not a guaranteed delivery. Storage, transport and handling still cost money.</p></div>'

    h += lineSection(s, 'Housing continuity', ['transition'], null, 'A funding period is not a deadline for residents to lose housing. Enter what it takes to keep residents housed or moved safely when the period ends.')

    h += '<div class="panel"><h2>Repairs, contingency and funding</h2><div class="tablewrap"><table><thead><tr><th>Input</th><th>Unit</th><th>Value</th><th>Result</th>' + SRC_HEAD + '</tr></thead><tbody>'
    h += inputRow(s, 'in:X', 'X') + inputRow(s, 'in:R', 'R') + inputRow(s, 'in:T', 'C') + inputRow(s, 'in:F') + inputRow(s, 'in:requested')
    h += '</tbody></table></div><p class="small muted">A repair reserve lowers some risk. It does not mean zero landlord risk, instant repayment, or zero downtime. Keep possible funding out of committed funding.</p></div>'

    $('#tab-assume').innerHTML = h
    refreshAssume()
  }

  const AMT_NUM = { D: 1, avgRes: 1, resMonths: 1, resDays: 0, mealsRequired: 0, purchasedMeals: 0 }
  function refreshAssume() {
    const r = ar()
    $$('#tab-assume [data-amt]').forEach(el => {
      const k = el.dataset.amt
      const v = k in r.amounts ? r.amounts[k] : r[k]
      el.textContent = (k in AMT_NUM) ? num(v, AMT_NUM[k]) : money(v)
    })
    $$('#tab-assume [data-err]').forEach(el => {
      const m = r.errors[el.dataset.err] || ''
      el.textContent = m
      const inp = el.parentNode.querySelector('input[data-f="v"]')
      if (inp) inp.classList.toggle('bad', !!m)
    })
  }

  // ---------- compare tab ----------
  function cmpRows() {
    const rs = SCENS.map(k => R[k])
    const ref = R[state.ref]
    const cell = (r, fn) => r.ok ? fn(r) : 'n/a'
    const diff = (r, k) => {
      if (!r.ok || !ref.ok || r === ref || r[k] === null || ref[k] === null) return ''
      const d = r[k] - ref[k]
      return Math.abs(d) < 0.5 ? '' : ` <span class="small muted">(${d > 0 ? '+' : '-'}${money(Math.abs(d))})</span>`
    }
    const rows = [
      ['Units leased', rs.map(r => cell(r, x => num(x.cap.U, 0)))],
      ['Average occupancy', rs.map(r => cell(r, x => num(x.cap.O, 0) + '%'))],
      ['Average residents housed', rs.map(r => cell(r, x => num(x.avgRes)))],
      ['Recurring operating costs (A)', rs.map(r => cell(r, x => money(x.A) + diff(r, 'A')))],
      ['Startup and capital, one time (S)', rs.map(r => cell(r, x => money(x.S) + diff(r, 'S')))],
      ['Expected repairs from the reserve (X)', rs.map(r => cell(r, x => money(x.X)))],
      ['Planned spending (E)', rs.map(r => cell(r, x => money(x.E) + diff(r, 'E'))), true],
      ['Cash held: deposits, unspent reserve, contingency', rs.map(r => cell(r, x => money(x.H + x.unspentReserve + x.C)))],
      ['Funding required (K)', rs.map(r => cell(r, x => money(x.K) + diff(r, 'K'))), true],
      ['Committed funding (F)', rs.map(r => cell(r, x => x.F === null ? 'Not entered' : money(x.F)))],
      ['Funding gap', rs.map(r => cell(r, x => x.gap === null ? 'Unknown' : (x.gap > 0 ? money(x.gap) : 'None'))), true],
      ['Spending per occupied resident month', rs.map(r => cell(r, x => money(x.perResMonthSpend, 2)))],
      ['Spending per resident day', rs.map(r => cell(r, x => money(x.perResDay, 2)))],
      ['Funding required per occupied resident month', rs.map(r => cell(r, x => money(x.perResMonthFunding, 2)))],
      ['Budget status', rs.map(r => !r.ok ? 'Entries need fixing' : (r.complete ? 'All required lines entered' : `Incomplete: ${r.unknown.length} required lines blank`))],
      ['Demonstration values', rs.map(r => r.demo.length ? `Yes, ${r.demo.length} values` : 'None')],
      ['Housing worksheet items still unknown', rs.map((r, i) => `${HC.wsUnknownCount(state.ws[SCENS[i]])} of ${HC.WS_ITEMS.length}`)],
      ['Ready to recommend?', rs.map((r, i) => {
        const u = HC.wsUnknownCount(state.ws[SCENS[i]])
        if (!r.ok || !r.complete || u > 0) return 'Not yet. Budget or worksheet is incomplete.'
        return 'Data is complete. Decide with partners.'
      })]
    ]
    return rows
  }
  function renderCompareTop() {
    let h = '<div class="panel"><h2>Side by side, same duration and stated assumptions</h2>'
    h += '<p class="muted small">Differences in units, occupancy, services and staffing are shown, not hidden. No winner is picked, because launch speed, readiness and sanitation depend on actual sites that must be checked first.</p>'
    h += `<p class="small">Show differences against: <select id="refsel" aria-label="Compare against">${SCENS.map(k => `<option value="${k}"${k === state.ref ? ' selected' : ''}>${HC.SCEN_NAMES[k]}</option>`).join('')}</select></p>`
    h += '<div class="tablewrap"><table><thead><tr><th></th>' + SCENS.map(k => `<th>${HC.SCEN_NAMES[k]}</th>`).join('') + '</tr></thead><tbody>'
    cmpRows().forEach(r => {
      h += `<tr${r[2] ? ' class="total"' : ''}><td>${esc(r[0])}</td>` + r[1].map(c => `<td>${c}</td>`).join('') + '</tr>'
    })
    h += '</tbody></table></div></div>'
    $('#cmp-top').innerHTML = h
  }
  function renderCompare() {
    let h = '<div id="cmp-top"></div>'
    h += '<div class="panel"><h2>Housing worksheet</h2><p class="muted small">Everything starts as Unknown. Change an item only after it has been checked, and note how and when in the box. This is a checklist of facts, not a score.</p>'
    h += '<div class="tablewrap"><table><thead><tr><th>Check</th>' + SCENS.map(k => `<th>${HC.SCEN_NAMES[k]}</th>`).join('') + '</tr></thead><tbody>'
    HC.WS_ITEMS.forEach(it => {
      h += `<tr><td>${esc(it.label)}</td>` + SCENS.map(k => {
        const w = state.ws[k][it.id]
        return `<td><select data-ws="${k}:${it.id}" data-f="v" aria-label="${esc(it.label + ', ' + HC.SCEN_NAMES[k])}">` +
          Object.keys(HC.WS_VALUES).map(v => `<option value="${v}"${v === w.v ? ' selected' : ''}>${HC.WS_VALUES[v]}</option>`).join('') +
          `</select><br><input type="text" class="note" data-ws="${k}:${it.id}" data-f="note" value="${esc(w.note)}" placeholder="Source and date" aria-label="Note"></td>`
      }).join('') + '</tr>'
    })
    h += '</tbody></table></div></div>'
    $('#tab-compare').innerHTML = h
    renderCompareTop()
  }

  // ---------- sources tab ----------
  function renderSources() {
    const src = [
      ['Community Preventive Services Task Force', 'Review of 26 studies supports permanent supportive housing with Housing First for people experiencing homelessness who have disabling conditions.', 'It supports the service model. It does not support a particular unit count, inspection schedule, or guaranteed result for this pilot.', 'https://thecommunityguide.cdc.gov/pages/tffrs-social-determinants-health-housing-first-programs.html'],
      ['Urban Institute, Denver Supportive Housing evaluation', 'Randomized trial reported 27 percent fewer jail days. Cost offsets covered about half of the program\'s annual cost.', 'The difference in emergency medical service use was not statistically significant. Not a prediction for Las Vegas. Reduced demand is not the same as cash available to fund a pilot.', 'https://www.urban.org/policy-centers/metropolitan-housing-and-communities-policy-center/projects/denver-supportive-housing-social-impact-bond-initiative/what-we-learned-evaluation'],
      ['Three Square, Food Rescue and Distribution', 'Documents rescue of prepared, unserved resort food.', 'Not a committed delivery, guaranteed daily meals, or zero logistics and staffing cost. Availability for a new pilot needs confirmation.', 'https://www.threesquare.org/learn/programs/food-rescue-distribution'],
      ['Canadian Housing First Toolkit, Working with Landlords', 'Operating guidance on landlord contact, repairs, mitigation funds, support and tenant rights.', 'Not a substitute for local legal requirements.', 'https://housingfirsttoolkit.ca/implement/supplemental-resources/working-with-landlords/'],
      ['City of Las Vegas, Data on the Cost of Homelessness, September 18, 2019', 'A historical estimate of about $39,510 a year. The community estimate includes public and private spending.', 'Not today\'s avoidable government cost per person. It is not entered anywhere in this calculator.', 'https://www.lasvegasnevada.gov/News/Blog/Detail/data-on-the-cost-of-homelessness'],
      ['MGM Resorts, 2024 Corporate Responsibility Report, printed page 11', 'Separates five million donated meals from 2.2 million rescued through the prepared-food method.', 'Do not describe all five million as rescued banquet meals.', 'https://filecache.investorroom.com/mr5ir_mgmresorts/653/download/2024-corporate-responsibility-report.pdf'],
      ['FDA, Key Steps for Donating Food', 'Relevant to budgeting transport, safe storage, trained handling, labeling and recordkeeping.', 'Guidance, not a quote. Local health rules still apply.', 'https://www.fda.gov/food/retail-food-industryregulatory-assistance-training/key-steps-donating-food-retail-food-establishments']
    ]
    let h = '<div class="panel"><h2>Starting references</h2><p class="muted small">These are starting references, not current local price inputs.</p><div class="tablewrap"><table><thead><tr><th>Source</th><th>What it reports</th><th>What it does not show</th></tr></thead><tbody>'
    src.forEach(x => {
      h += `<tr><td><a href="${esc(x[3])}" target="_blank" rel="noopener">${esc(x[0])}</a></td><td>${esc(x[1])}</td><td>${esc(x[2])}</td></tr>`
    })
    h += '</tbody></table></div></div>'

    h += '<div class="panel"><h2>Open questions</h2><ul>' +
      '<li>No operator, property, funding source or food partnership has been secured. Nothing here claims otherwise.</li>' +
      '<li>Local quotes are needed for rent, deposits, utilities, insurance, furnishings, and repair costs in each housing type.</li>' +
      '<li>Figures from the original proposal for jail, ambulance, UMC, high-utilizer and Courtyard costs still need traceable, dated sources. Charges, payments, avoidable costs and broad social costs must be kept apart.</li>' +
      '<li>A room and meals do not mean emergency calls stop right away. The calculator makes no such assumption.</li>' +
      '<li>Eligibility and the support needed need local review. Families and people needing intensive clinical care may need different units or added services. This first pilot does not serve everyone.</li>' +
      '<li>Lease terms, tenant rights and landlord agreements need review under local law. This tool writes no legal clauses.</li>' +
      '<li>Prefab homes need a real site, land, approvals and utilities. Apartments and motels are not assumed to launch fastest, and prefab is not assumed easier to sanitize. Compare actual sites.</li></ul></div>'

    h += '<div class="panel"><h2>Design rules this tool follows</h2><ul>' +
      '<li>Housing First with ongoing support is the direction. Treatment or sobriety is not a condition of housing by default.</li>' +
      '<li>Residents keep tenant rights. Staff help residents complete required paperwork. The tool does not promise to remove leases, consent or eligibility records.</li>' +
      '<li>A 12-month funding period is not a deadline for residents to lose housing. Housing continuity has its own cost line.</li>' +
      '<li>A repair reserve lowers some risk. It does not give zero risk, instant repayment, or zero downtime.</li>' +
      '<li>The tool holds aggregate planning numbers only. No names, medical records, criminal histories or other personal information.</li>' +
      '<li>Helping people get food and a safe, stable place to live is the goal. The cost figures describe what the pilot needs. They are not the reason it matters.</li></ul></div>'

    h += '<div class="panel"><h2>Left out of version one on purpose</h2><p>There is no taxpayer savings figure. Subtracting a housing cost from $39,510 would be a false claim. A later service-offset module would need a matching population, a comparison period, sourced service-use estimates, avoidable unit costs, no double counting of overlapping services, and a clear line between reduced demand and cash a specific budget holder can recover. Denver\'s percentage reductions are not used as a prediction.</p></div>'
    $('#tab-sources').innerHTML = h
  }

  // ---------- checklist tab ----------
  function renderCheck() {
    let h = '<div class="panel"><h2>Operator checklist</h2><p class="muted small">Name who is responsible, set where each item stands, and note the evidence. Nothing is confirmed until you say so. This list holds no resident information.</p><div class="tablewrap"><table><thead><tr><th>Area</th><th>Item</th><th>Responsible</th><th>Status</th><th>Evidence needed or seen</th><th></th></tr></thead><tbody>'
    state.checklist.forEach(c => {
      const st = ['Not started', 'In progress', 'Confirmed']
      h += `<tr><td>${esc(c.area)}</td><td>${esc(c.item)}</td>` +
        `<td><input type="text" data-ck="${esc(c.id)}" data-f="who" value="${esc(c.who)}" aria-label="Responsible"></td>` +
        `<td><select data-ck="${esc(c.id)}" data-f="status" aria-label="Status">${st.map(x => `<option${x === c.status ? ' selected' : ''}>${x}</option>`).join('')}</select></td>` +
        `<td><input type="text" class="note" data-ck="${esc(c.id)}" data-f="evidence" value="${esc(c.evidence)}" aria-label="Evidence"></td>` +
        `<td><button type="button" class="linkish" data-act="rmck" data-id="${esc(c.id)}">Remove</button></td></tr>`
    })
    h += '</tbody></table></div><div class="addrow"><button type="button" data-act="addck">Add an item</button></div></div>'

    const t = state.test
    h += '<div class="panel"><h2>Test with one person outside the course</h2>'
    h += '<p class="muted small">Ask them to: load the demonstration, change the rent, explain the difference between spending and funding required, find the funding gap, and point to an assumption that is not verified. Write down what they actually do. This is a usability test only. It is not a clinical, legal or operational check. Do not record resident information. These notes are saved in this browser and in a saved file, never in a share link.</p>'
    const f = (k, label, area) => `<p><label>${label}<br>${area ? `<textarea data-test="${k}">${esc(t[k])}</textarea>` : `<input type="text" data-test="${k}" value="${esc(t[k])}">`}</label></p>`
    h += f('who', 'Who they are (role, not a full name needed)') + f('date', 'Date') + f('did', 'What they did', true) + f('hesitated', 'Where they hesitated', true) + f('comments', 'What they said', true) + f('change', 'What I changed because of it', true)
    h += '</div>'
    $('#tab-check').innerHTML = h
  }

  // ---------- math checks tab ----------
  function renderMath() {
    const res = window.HCChecks.run()
    const fails = res.filter(x => !x.pass).length
    let h = `<div class="panel"><h2>Math checks</h2><p>${fails === 0 ? '<span class="pass">All ' + res.length + ' checks passed.</span>' : `<span class="fail">${fails} of ${res.length} checks failed.</span>`} These run the required test cases against the same calculation code used on this page, including the invented demonstration fixture.</p>`
    h += '<div class="tablewrap"><table><thead><tr><th>Check</th><th>Result</th><th>Value seen</th></tr></thead><tbody>'
    res.forEach(x => {
      h += `<tr><td>${esc(x.name)}</td><td class="${x.pass ? 'pass' : 'fail'}">${x.pass ? 'Pass' : 'Fail'}</td><td class="muted small">${esc(x.detail)}</td></tr>`
    })
    h += '</tbody></table></div></div>'
    $('#tab-math').innerHTML = h
  }

  // ---------- print summary ----------
  function summaryHTML() {
    const r = ar()
    let h = '<h1>Las Vegas Housing and Meals Pilot Budget Calculator: summary</h1>'
    h += `<p>Printed ${new Date().toLocaleDateString('en-US')}. Planning numbers only. No resident information. No taxpayer savings claim.</p>`
    if (SCENS.some(k => R[k].demo.length)) h += '<p><b>Some values are Demonstration values. They are invented test numbers, not prices.</b></p>'
    h += '<h2>Housing scenarios side by side</h2><table><thead><tr><th></th>' + SCENS.map(k => `<th>${HC.SCEN_NAMES[k]}</th>`).join('') + '</tr></thead><tbody>'
    cmpRows().forEach(x => { h += `<tr><td>${esc(x[0])}</td>` + x[1].map(c => `<td>${c}</td>`).join('') + '</tr>' })
    h += '</tbody></table>'
    h += `<h2>${esc(active().name)}: largest costs</h2><table><thead><tr><th>Cost</th><th>Amount for the period</th><th>Source status</th></tr></thead><tbody>`
    if (r.ok) r.spendItems.filter(i => i.amount > 0.005).slice(0, 10).forEach(i => { h += `<tr><td>${esc(i.label)}</td><td>${money(i.amount)}</td><td>${esc(HC.STATUS_LABEL[i.st])}</td></tr>` })
    h += '</tbody></table>'
    if (r.unknown.length) h += `<h2>Required lines still blank in ${esc(active().name)}</h2><ul>` + r.unknown.map(u => `<li>${esc(u.label)}</li>`).join('') + '</ul>'
    return h
  }

  // ---------- rendering control ----------
  function showTab(t) {
    tab = t
    $$('nav#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === t ? 'true' : 'false'))
    $$('.tab').forEach(x => { x.hidden = x.id !== 'tab-' + t })
    if (t === 'results') renderResults()
    else if (t === 'assume') renderAssume()
    else if (t === 'compare') renderCompare()
    else if (t === 'sources') renderSources()
    else if (t === 'check') renderCheck()
    else if (t === 'math') renderMath()
  }
  function renderAll() {
    compute()
    renderStrip()
    renderBanner()
    showTab(tab)
  }
  function update() {
    compute()
    renderStrip()
    renderBanner()
    if (tab === 'results') renderResultsOutputs()
    else if (tab === 'assume') refreshAssume()
    else if (tab === 'compare') renderCompareTop()
  }

  // ---------- events ----------
  function onField(el) {
    const s = active()
    const key = el.dataset.key, f = el.dataset.f
    if (f === 'v') HC.setV(s, key, parseIn(el.value))
    else HC.metaObj(s, key)[f] = el.value
    save()
    update()
    if (f === 'basis') refreshAssume()
  }
  function onInput(e) {
    const el = e.target
    if (el.matches('[data-key]')) onField(el)
    else if (el.matches('[data-lever]')) {
      const L = LEVERS.find(x => x.key === el.dataset.lever)
      const v = Number(el.value)
      HC.setV(active(), L.key, v)
      document.getElementById('out-' + L.key).textContent = L.fmt(v)
      save()
      update()
    } else if (el.matches('[data-ws]')) {
      const p = el.dataset.ws.split(':')
      state.ws[p[0]][p[1]][el.dataset.f] = el.value
      save()
      update()
    } else if (el.matches('[data-ck]')) {
      const c = state.checklist.find(x => x.id === el.dataset.ck)
      if (c) c[el.dataset.f] = el.value
      save()
    } else if (el.matches('[data-test]')) {
      state.test[el.dataset.test] = el.value
      save()
    } else if (el.id === 'refsel') {
      state.ref = el.value
      save()
      renderCompareTop()
      const sel = $('#refsel')
      if (sel) sel.focus()
    }
  }
  document.addEventListener('input', onInput)
  document.addEventListener('change', onInput)

  function uid() { return 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36) }

  document.addEventListener('click', e => {
    const el = e.target.closest('button, [data-act]')
    if (!el) return
    if (el.dataset.scen) {
      state.active = el.dataset.scen
      save()
      renderAll()
      return
    }
    if (el.dataset.tab) { showTab(el.dataset.tab); return }
    const act = el.dataset.act
    if (!act) return
    const s = active()
    if (act === 'pin') {
      const r = ar()
      if (r.ok) { state.baselines[state.active] = { K: r.K, E: r.E, gap: r.gap, avgRes: r.avgRes }; save(); renderLevers(); update() }
    } else if (act === 'unpin') {
      delete state.baselines[state.active]; save(); renderLevers(); update()
    } else if (act === 'addline') {
      const g = el.dataset.group
      const l = HC.mkLine(uid(), g, 'New cost line', g === 'startup' ? 'once' : 'month', false)
      l.custom = true
      s.lines.push(l)
      save(); renderAssume(); update()
    } else if (act === 'rmline') {
      s.lines = s.lines.filter(l => l.id !== el.dataset.id); save(); renderAssume(); update()
    } else if (act === 'addstaff') {
      const r = HC.mkStaff(uid(), 'New role')
      r.custom = true
      s.staff.push(r)
      save(); renderAssume(); update()
    } else if (act === 'rmstaff') {
      s.staff = s.staff.filter(r => r.id !== el.dataset.id); save(); renderAssume(); update()
    } else if (act === 'addck') {
      state.checklist.push({ id: uid(), area: 'Other', item: 'New item', who: '', status: 'Not started', evidence: '' }); save(); renderCheck()
    } else if (act === 'rmck') {
      state.checklist = state.checklist.filter(c => c.id !== el.dataset.id); save(); renderCheck()
    }
  })

  $('#btn-demo').addEventListener('click', () => {
    takeSnapshot()
    SCENS.forEach(k => { state.scen[k] = HC.makeScenario(k, true); state.ws[k] = HC.makeWorksheet() })
    state.baselines = {}
    save(); renderAll()
    toast('Demonstration loaded. The numbers are invented test values. Undo is available.')
  })
  $('#btn-blank').addEventListener('click', () => {
    takeSnapshot()
    SCENS.forEach(k => { state.scen[k] = HC.makeScenario(k, false); state.ws[k] = HC.makeWorksheet() })
    state.baselines = {}
    save(); renderAll()
    toast('Blank planning scenarios started. Everything is unknown until you enter it. Undo is available.')
  })
  $('#btn-undo').addEventListener('click', () => {
    if (!snapshot) return
    const st = normalize(JSON.parse(snapshot))
    if (st) { state = st; save(); renderAll(); toast('Undone.') }
    snapshot = null
    $('#btn-undo').hidden = true
  })
  $('#btn-print').addEventListener('click', () => {
    $('#printOnly').innerHTML = summaryHTML()
    window.print()
  })
  $('#btn-link').addEventListener('click', () => {
    const share = { v: 1, active: state.active, ref: state.ref, scen: state.scen, ws: state.ws }
    const url = location.href.split('#')[0] + '#s=' + b64enc(JSON.stringify(share))
    const done = () => toast('Share link copied. It holds assumptions and the housing worksheet, not checklist or test notes.')
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => { location.hash = '#s=' + url.split('#s=')[1]; toast('Copy the address bar. It now holds the share link.') })
    else { location.hash = '#s=' + url.split('#s=')[1]; toast('Copy the address bar. It now holds the share link.') }
  })
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'housing-calculator-' + new Date().toISOString().slice(0, 10) + '.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast('File saved to your downloads.')
  })
  $('#file-import').addEventListener('change', e => {
    const f = e.target.files[0]
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const st = normalize(JSON.parse(rd.result))
        if (!st) throw new Error('bad')
        takeSnapshot()
        state = st
        save(); renderAll()
        toast('File opened. Undo is available.')
      } catch (err) { toast('That file is not a calculator file.') }
    }
    rd.readAsText(f)
    e.target.value = ''
  })

  // ---------- start ----------
  renderAll()
  if (loaded.from === 'link') toast('Opened from a share link.')
  window.__hc = { get state() { return state }, R: () => R }
})()
