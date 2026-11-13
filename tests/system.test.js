// Runs the system suite (test.js) under the built-in node:test runner, so each
// case is reported on its own and can be filtered (--test-name-pattern) or
// measured (--experimental-test-coverage). The cases run in order because
// several of them share the on-disk database.
const { test, after } = require('node:test');

// Mutating API routes require API_KEY; the in-process API tests use this one.
if (!process.env.API_KEY) process.env.API_KEY = 'test-suite-key';

const { SystemTest } = require('../test');

const suite = new SystemTest();
for (const { name, test: run } of suite.getTests()) {
  test(name, { concurrency: false }, () => run());
}

// Some cases start cron jobs, servers or timers that are not closed; end the
// test process once every case has finished so the runner does not hang.
after(() => {
  setTimeout(() => process.exit(process.exitCode ?? 0), 0);
});
