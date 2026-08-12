export async function waitForRateLimit(error, sleep = defaultSleep) {
  if (error.retryAfter) {
    await sleep(Number(error.retryAfter) * 1000);
    return true;
  }

  if (error.reset) {
    const resetMs = Number(error.reset) * 1000;
    const delay = Math.max(0, resetMs - Date.now()) + 1000;
    await sleep(delay);
    return true;
  }

  if (error.rateLimit?.remaining === 0 && error.rateLimit.resetAt) {
    const delay = Math.max(0, Date.parse(error.rateLimit.resetAt) - Date.now()) + 1000;
    await sleep(delay);
    return true;
  }

  return false;
}

export function shouldStopForBudget(rateLimit, reserve = 50) {
  return Boolean(rateLimit && Number(rateLimit.remaining) <= reserve);
}

export function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
