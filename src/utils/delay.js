// Random whole-second delay in milliseconds, inclusive of both bounds.
function randomDelayMs(min, max, random = Math.random) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return (lo + Math.floor(random() * (hi - lo + 1))) * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  randomDelayMs,
  sleep
};
