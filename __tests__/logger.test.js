const Logger = require('../src/logger');

describe('Logger.profile', () => {
  test('returns valid duration and logs debug message', () => {
    const logger = new Logger();
    const spy = jest.spyOn(logger, 'debug').mockImplementation(() => {});
    const profiler = logger.profile('test');
    const duration = profiler.end();
    expect(typeof duration).toBe('number');
    expect(Number.isNaN(duration)).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      'Profile: test',
      expect.objectContaining({ duration: expect.stringMatching(/ms$/) })
    );
  });
});
