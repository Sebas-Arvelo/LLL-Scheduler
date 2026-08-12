import { runScheduleBenchmark } from './schedule-benchmark';

describe('realistic scheduling benchmark', () => {
  it('runs the four reproducible 36-group scenarios without timing thresholds', () => {
    const report = runScheduleBenchmark(3);

    expect(report.scenarios.length).toBe(4);
    expect(report.scenarios.every((scenario) => scenario.groupCount === 36)).toBeTrue();
    expect(report.scenarios.every((scenario) => scenario.activityCount === 18)).toBeTrue();
    expect(report.scenarios.every((scenario) => scenario.assignments > 0)).toBeTrue();
    console.info('SCHEDULER_BENCHMARK', JSON.stringify(report));
  });
});
