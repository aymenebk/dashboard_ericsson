const { buildSiteDetail } = require('../utils/siteDetail');
const { reportFor } = require('../config/reports');

const SITE = { _id: 's1', neId: 16001, neType: 'AMM 20PB', wilayaCode: 16 };
const LINK_A = { _id: 'la', measurePoint: '1/11/104', portRef: '1/11/104', label: null, notInUse: false, entityType: 'MLTN WAN Eth Bandwidth RX' };
const LINK_B = { _id: 'lb', measurePoint: "1/11/105 'To_2238'", portRef: '1/11/105', label: 'To_2238', notInUse: false, entityType: 'MLTN WAN Eth Bandwidth RX' };
const BINS = new Array(20).fill(0);

const rec = (link, day, p95, over = {}) => ({
  link, endTime: new Date(`2026-02-${String(day).padStart(2, '0')}T00:00:00Z`),
  status: p95 === null ? 'PM_INVALID' : 'OK', p95, failure: p95 === null ? 'PM Failure - NE PM data is invalid' : null,
  bins: BINS, ...over,
});
const detail = (measurements, links = [LINK_A, LINK_B]) => buildSiteDetail({ site: SITE, links, measurements });

describe('buildSiteDetail: history and summary', () => {
  const three = [rec('la', 10, 4.75), rec('la', 11, 64.75), rec('la', 12, 89.75)];

  test('history is oldest first, with the condition of each day', () => {
    const { history } = detail(three);
    expect(history.map((h) => [h.date, h.load, h.condition])).toEqual([
      ['2026-02-10', 4.75, 'good'], ['2026-02-11', 64.75, 'medium'], ['2026-02-12', 89.75, 'critical'],
    ]);
  });

  test('summary: average, maximum, minimum over the days of the window', () => {
    expect(detail(three).summary).toEqual({ windowDays: 3, measuredDays: 3, average: 53.08, maximum: 89.75, minimum: 4.75 });
  });

  test('the current state is the latest day', () => {
    const { current } = detail(three);
    expect(current).toEqual({ lastUpdate: new Date('2026-02-12T00:00:00Z'), load: 89.75, condition: 'critical', failureReasons: [], noMeasurementReason: null });
  });

  test('only the last 7 days are kept (9 days in, 7 out)', () => {
    const nine = Array.from({ length: 9 }, (_, i) => rec('la', i + 1, 5 * (i + 1) + 4.75));
    const { history, summary } = detail(nine);
    expect(history.map((h) => h.date)).toEqual(['2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-07', '2026-02-08', '2026-02-09']);
    expect(history.map((h) => h.load)).toEqual([19.75, 24.75, 29.75, 34.75, 39.75, 44.75, 49.75]);
    expect(summary).toEqual({ windowDays: 7, measuredDays: 7, average: 34.75, maximum: 49.75, minimum: 19.75 });
  });

  test('the window counts days WITH a record, so gaps between dates are not filled', () => {
    const { history } = detail([rec('la', 1, 10), rec('la', 20, 30)]);
    expect(history.map((h) => h.date)).toEqual(['2026-02-01', '2026-02-20']);
  });

  test('a failed day inside the window has a null load and is left out of the average', () => {
    const { history, summary } = detail([rec('la', 10, 64.75), rec('la', 11, null), rec('la', 12, 89.75)]);
    expect(history[1]).toMatchObject({ date: '2026-02-11', load: null, condition: 'no_data' });
    expect(summary).toEqual({ windowDays: 3, measuredDays: 2, average: 77.25, maximum: 89.75, minimum: 64.75 });
  });

  test('if the LATEST day failed the site is grey, with the reason, not its old value', () => {
    const d = detail([rec('la', 10, 64.75), rec('la', 11, null)]);
    expect(d.current).toMatchObject({ load: null, condition: 'no_data', failureReasons: ['PM Failure - NE PM data is invalid'], noMeasurementReason: 'PM Failure - NE PM data is invalid' });
    expect(d.report.level).toBe('no_data');
    expect(d.summary.average).toBe(64.75); // earlier measured days still count in the summary
  });

  test('every day failed: summary is null, nothing invented', () => {
    const { summary, current } = detail([rec('la', 10, null), rec('la', 11, null)]);
    expect(summary).toEqual({ windowDays: 2, measuredDays: 0, average: null, maximum: null, minimum: null });
    expect(current.condition).toBe('no_data');
  });

  test('the input order does not matter', () => {
    const shuffled = [three[1], three[2], three[0]];
    expect(detail(shuffled)).toEqual(detail(three));
  });
});

describe('buildSiteDetail: several links', () => {
  const sameDay = [rec('la', 12, 4.75), rec('lb', 12, 89.75)];

  test('the day takes its WORST link; the links are listed worst first, one flagged', () => {
    const d = detail(sameDay);
    expect(d.current.load).toBe(89.75);
    expect(d.history[0]).toMatchObject({ load: 89.75, measuredLinks: 2, totalLinks: 2 });
    expect(d.links.map((l) => [l.measurePoint, l.load, l.isWorst])).toEqual([
      ["1/11/105 'To_2238'", 89.75, true], ['1/11/104', 4.75, false],
    ]);
  });

  test('a failed link does not hide the measured one; its failure is not reported for the day', () => {
    const d = detail([rec('la', 12, null), rec('lb', 12, 64.75)]);
    expect(d.current).toMatchObject({ load: 64.75, condition: 'medium', failureReasons: [] });
    expect(d.history[0]).toMatchObject({ measuredLinks: 1, totalLinks: 2 });
    expect(d.links.find((l) => l.linkId === 'la')).toMatchObject({ status: 'PM_INVALID', load: null, isWorst: false });
  });

  test('each link shows its LATEST record only', () => {
    const d = detail([rec('la', 10, 20), rec('la', 12, 70), rec('lb', 11, 30)]);
    expect(d.links).toHaveLength(2);
    expect(d.links.find((l) => l.linkId === 'la')).toMatchObject({ load: 70, endTime: new Date('2026-02-12T00:00:00Z'), isWorst: true });
    expect(d.links.find((l) => l.linkId === 'lb')).toMatchObject({ load: 30, isWorst: false });
  });

  test('a link last seen on an OLDER day is listed after the current ones and flagged', () => {
    // la: 81 on day 10 (older); lb: 76 on day 15 (current): the site is at 76, la is not the current worst
    const d = detail([rec('la', 10, 81), rec('lb', 15, 76)]);
    expect(d.current).toMatchObject({ load: 76, condition: 'medium' });
    expect(d.links.map((l) => [l.linkId, l.load, l.onLatestDay, l.isWorst])).toEqual([
      ['lb', 76, true, true],
      ['la', 81, false, false],
    ]);
    expect(d.history.map((h) => [h.date, h.load])).toEqual([['2026-02-10', 81], ['2026-02-15', 76]]);
  });

  test('the link carries what the site page shows: measure point, entity type, bins', () => {
    const [l] = detail([rec('lb', 12, 50)]).links;
    expect(l).toMatchObject({ measurePoint: "1/11/105 'To_2238'", portRef: '1/11/105', label: 'To_2238', entityType: 'MLTN WAN Eth Bandwidth RX' });
    expect(l.bins).toHaveLength(20);
  });
});

describe('buildSiteDetail: identity and report', () => {
  test('identity with the wilaya name', () => {
    expect(detail([rec('la', 12, 50)]).site).toEqual({ id: 's1', neId: 16001, neType: 'AMM 20PB', wilayaCode: 16, wilayaName: 'Alger' });
  });

  test('the report follows the condition and quotes the configured thresholds', () => {
    expect(detail([rec('la', 12, 90)]).report).toEqual(reportFor('critical'));
    expect(detail([rec('la', 12, 60)]).report).toEqual(reportFor('medium'));
    expect(detail([rec('la', 12, 10)]).report).toEqual(reportFor('good'));
  });
});

describe('reportFor', () => {
  test.each(['critical', 'medium', 'good', 'no_data'])('%s has a level, a title and a text', (c) => {
    const r = reportFor(c);
    expect(r.level).toBe(c);
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.text.length).toBeGreaterThan(20);
    expect(r.text).not.toMatch(/[{}]/); // every placeholder was filled
  });

  test('thresholds appear in the text; no claim about "capacity"', () => {
    expect(reportFor('critical').text).toContain('80%');
    expect(reportFor('medium').text).toContain('50%');
    expect(reportFor('good').text).toContain('50%');
    ['critical', 'medium', 'good', 'no_data'].forEach((c) => expect(reportFor(c).text.toLowerCase()).not.toContain('of its capacity'));
    expect(reportFor('no_data').text).toContain('does not mean the site is idle or down');
  });
});