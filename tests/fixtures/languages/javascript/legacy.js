'use strict';

/** Default number of retries. */
const DEFAULT_RETRIES = 3;

let attempts = 0, failures = 0;

/** Waits before the next attempt. */
function backoff(attempt) {
  return Math.min(1000 * 2 ** attempt, 30000);
}

/** Runs a task until it succeeds or the retries run out. */
class Retrier {
  constructor(retries = DEFAULT_RETRIES) {
    this.retries = retries;
  }

  /** Runs the task once per attempt. */
  async run(task) {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      attempts++;
      try {
        return await task();
      } catch (err) {
        failures++;
        await sleep(backoff(attempt));
      }
    }
    throw new Error(`retries exhausted after ${attempts} attempts, ${failures} failures`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Creates a retrier with the default settings. */
function createRetrier() {
  return new Retrier();
}

module.exports = { Retrier, createRetrier, backoff };
