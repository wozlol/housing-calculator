/* Required math checks. Run in Node with: node checks.js
   The same checks run in the page on the Math checks tab. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'))
  else root.HCChecks = factory(root.HC)
}(typeof self !== 'undefined' ? self : this, function (HC) {
  'use strict'

  function fixture() { return HC.makeScenario('apartments', true) }
  function near(a, b, tol) { return a !== null && Math.abs(a - b) <= (tol === undefined ? 0.005 : tol) }

  function run() {
    const out = []
    function t(name, pass, detail) { out.push({ name, pass: !!pass, detail: detail || '' }) }

    // Fixture, section 12 of the build instructions
    const r = HC.calc(fixture())
    t('Average residents = 8', near(r.avgRes, 8), String(r.avgRes))
    t('Resident months = 96', near(r.resMonths, 96), String(r.resMonths))
    t('Resident days = 2,920', near(r.resDays, 2920), String(r.resDays))
    t('Rent = $120,000', near(r.amounts['line:rent'], 120000), String(r.amounts['line:rent']))
    t('Staffing = $60,000', near(r.staffTotal, 60000), String(r.staffTotal))
    t('Meal purchase cost = $14,600', near(r.mealCost, 14600), String(r.mealCost))
    t('A = $194,600', near(r.A, 194600), String(r.A))
    t('E = $207,600', near(r.E, 207600), String(r.E))
    t('B = $214,600', near(r.B, 214600), String(r.B))
    t('K = $214,600', near(r.K, 214600), String(r.K))
    t('G = $0', near(r.G, 0), String(r.G))
    t('Unspent repair reserve = $7,000', near(r.unspentReserve, 7000), String(r.unspentReserve))
    t('Funding gap = $14,600', near(r.gap, 14600), String(r.gap))
    t('Spending per occupied resident month = $2,162.50', near(r.perResMonthSpend, 2162.5), String(r.perResMonthSpend))
    t('Spending per resident day is about $71.10', near(r.perResDay, 71.10, 0.005), String(r.perResDay))
    t('Funding requirement per occupied resident month is about $2,235.42', near(r.perResMonthFunding, 2235.42, 0.005), String(r.perResMonthFunding))
    t('Fixture is complete and valid', r.complete && r.ok)
    t('K = E + deposits + unspent reserve + contingency', near(r.K, r.E + r.H + r.unspentReserve + r.C))

    // Check 1
    let s = fixture()
    HC.setV(s, 'line:rent', 1100)
    let r1 = HC.calc(s)
    t('Check 1: rent up $100 raises E by $12,000', near(r1.E - r.E, 12000), String(r1.E - r.E))
    t('Check 1: rent up $100 raises K by $12,000', near(r1.K - r.K, 12000), String(r1.K - r.K))
    t('Check 1: changing rent leaves staffing unchanged', near(r1.staffTotal, r.staffTotal))

    // Check 2
    s = fixture()
    HC.setV(s, 'in:O', 0)
    const r2 = HC.calc(s)
    t('Check 2: zero occupancy keeps rent', near(r2.amounts['line:rent'], 120000))
    t('Check 2: zero occupancy keeps staffing', near(r2.staffTotal, 60000))
    t('Check 2: zero occupancy makes meal cost zero', near(r2.mealCost, 0))
    t('Check 2: per-resident outputs are not applicable', r2.perResMonthSpend === null && r2.perResDay === null && r2.perResMonthFunding === null)
    t('Check 2: no infinity or NaN anywhere in results', [r2.E, r2.K, r2.gap, r2.A].every(x => Number.isFinite(x)))

    // Check 3
    s = fixture()
    HC.setV(s, 'in:X', 15000)
    const r3 = HC.calc(s)
    t('Check 3: X = $15,000 makes G = $5,000', near(r3.G, 5000), String(r3.G))
    t('Check 3: E = $219,600', near(r3.E, 219600), String(r3.E))
    t('Check 3: K = $219,600 (repairs not added twice)', near(r3.K, 219600), String(r3.K))
    t('Check 3: unspent reserve = $0', near(r3.unspentReserve, 0))

    // Check 4
    s = fixture()
    HC.setV(s, 'in:donatedShare', 100)
    HC.setV(s, 'in:supplementsPerDay', 2)
    HC.setV(s, 'in:foodLogisticsMonthly', 300)
    const r4 = HC.calc(s)
    t('Check 4: 100 percent donated makes meal purchase cost zero', near(r4.mealCost, 0))
    t('Check 4: supplements remain ($2 x 2,920 = $5,840)', near(r4.supplements, 5840), String(r4.supplements))
    t('Check 4: food transport and storage remain ($300 x 12 = $3,600)', near(r4.logistics, 3600), String(r4.logistics))

    // Check 5
    const bad = (mod, key) => {
      const c = fixture()
      mod(c)
      const x = HC.calc(c)
      return !x.ok && !!x.errors[key]
    }
    t('Check 5: negative rent rejected', bad(c => HC.setV(c, 'line:rent', -1), 'line:rent'))
    t('Check 5: negative staff salary rejected', bad(c => HC.setV(c, 'staff:support:salary', -5), 'staff:support:salary'))
    t('Check 5: occupancy over 100 rejected', bad(c => HC.setV(c, 'in:O', 120), 'in:O'))
    t('Check 5: negative occupancy rejected', bad(c => HC.setV(c, 'in:O', -1), 'in:O'))
    t('Check 5: donated share over 100 rejected', bad(c => HC.setV(c, 'in:donatedShare', 101), 'in:donatedShare'))
    t('Check 5: contingency over 100 rejected', bad(c => HC.setV(c, 'in:T', 150), 'in:T'))
    t('Check 5: zero duration rejected', bad(c => HC.setV(c, 'in:M', 0), 'in:M'))
    t('Check 5: negative duration rejected', bad(c => HC.setV(c, 'in:M', -3), 'in:M'))
    t('Check 5: zero units rejected', bad(c => HC.setV(c, 'in:U', 0), 'in:U'))
    t('Check 5: fractional units rejected', bad(c => HC.setV(c, 'in:U', 2.5), 'in:U'))
    t('Check 5: text in a number field rejected', bad(c => HC.setV(c, 'line:rent', 'abc'), 'line:rent'))
    s = fixture()
    HC.setV(s, 'line:utilities', 250)
    const r5 = HC.calc(s)
    t('Check 5: changing one cost does not change staffing', near(r5.staffTotal, 60000))
    t('Check 5: changing one cost does not change units or occupancy', r5.cap.U === 10 && r5.cap.O === 80)

    // Check 6
    s = fixture()
    s.lines.find(l => l.id === 'insurance').v = null
    const r6 = HC.calc(s)
    t('Check 6: a blank required cost makes the budget incomplete', !r6.complete && r6.unknown.some(u => u.key === 'line:insurance'))
    const blank = HC.calc(HC.makeScenario('apartments', false))
    t('Check 6: a fully blank scenario is incomplete, not a zero-cost budget', !blank.complete && blank.unknown.length > 10)
    t('Check 6: a blank scenario has no per-resident figures', blank.perResMonthSpend === null)
    t('Check 6: a blank scenario has no funding gap', blank.gap === null)
    s = fixture()
    HC.setV(s, 'in:F', null)
    t('Unknown committed funding gives no gap', HC.calc(s).gap === null)

    // Extra checks
    s = fixture()
    HC.setV(s, 'in:T', 10)
    const rt = HC.calc(s)
    t('Contingency 10 percent = $20,760 and stays out of spending E', near(rt.C, 20760) && near(rt.E, 207600), String(rt.C))
    s = fixture()
    HC.setV(s, 'in:U', 20)
    const ru = HC.calc(s)
    t('Doubling units doubles rent but not staffing', near(ru.amounts['line:rent'], 240000) && near(ru.staffTotal, 60000))
    s = HC.makeScenario('prefab', true)
    const rp = HC.calc(s)
    t('Prefab demo counts capital and furnishings as startup spending S ($255,000)', near(rp.S, 255000), String(rp.S))
    const copy = HC.calc(JSON.parse(JSON.stringify(fixture())))
    t('A saved and reloaded scenario gives the same results', near(copy.K, r.K))
    s = fixture()
    HC.setV(s, 'in:F', 150000)
    const cg = HC.closeGap(s)
    const rentOpt = cg.find(o => o.id === 'rent')
    s = fixture()
    if (rentOpt && rentOpt.reachable) HC.setV(s, 'line:rent', rentOpt.to)
    t('Rent option closes the gap when applied', !!rentOpt && rentOpt.reachable && near(HC.calc(s).gap, 0, 0.5), rentOpt ? String(rentOpt.to) : 'no option')
    return out
  }

  return { run }
}))

if (typeof module === 'object' && module.exports && require.main === module) {
  const res = module.exports.run()
  let fail = 0
  res.forEach(x => {
    if (!x.pass) fail++
    console.log((x.pass ? 'PASS  ' : 'FAIL  ') + x.name + (x.pass ? '' : '  [' + x.detail + ']'))
  })
  console.log('\n' + (res.length - fail) + ' of ' + res.length + ' checks passed')
  process.exit(fail ? 1 : 0)
}
