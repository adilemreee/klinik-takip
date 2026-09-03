/**
 * Temporary CI diagnostic: samples what is holding the event loop open.
 *
 * The integration suite passes on the GitHub runner and Jest then reports that
 * it did not exit. It exits cleanly on macOS and in a Node 22 Linux container
 * matched to the job — same services, same freshly migrated database, same log
 * output down to the line counts — so the handle can only be identified here.
 *
 * Sampled rather than read once: adding --detectOpenHandles made the hang go
 * away, which says the cause is a race in teardown rather than a handle held
 * for good, and a single reading at a fixed deadline can easily land after it
 * has cleared.
 */
const START_MS = Number(process.env.EXIT_PROBE_START_MS ?? 45_000);
const EVERY_MS = Number(process.env.EXIT_PROBE_EVERY_MS ?? 3_000);
const SAMPLES = Number(process.env.EXIT_PROBE_SAMPLES ?? 45);

const describe = (item) => {
  const name = item?.constructor?.name ?? typeof item;
  const bits = [name];

  try {
    if (item === process.stdout) bits.push('=process.stdout');
    else if (item === process.stderr) bits.push('=process.stderr');
    else if (item === process.stdin) bits.push('=process.stdin');

    if (item.remoteAddress) bits.push(`${item.remoteAddress}:${item.remotePort}`);
    if (item.spawnfile) bits.push(`${item.spawnfile} ${JSON.stringify(item.spawnargs)}`);
    if (item._handle?.fd !== undefined) bits.push(`fd=${item._handle.fd}`);
    if (item.threadId !== undefined) bits.push(`thread=${item.threadId}`);
    if (item.destroyed !== undefined) bits.push(`destroyed=${item.destroyed}`);
  } catch {
    /* an inspected handle must never be the thing that fails the run */
  }

  return bits.join(' ');
};

const tally = (items) => {
  const counts = {};
  for (const item of items) {
    const key = describe(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

let taken = 0;

const sample = () => {
  const resources = {};
  for (const kind of process.getActiveResourcesInfo()) {
    resources[kind] = (resources[kind] ?? 0) + 1;
  }

  console.log(
    `[exit-probe pid=${process.pid} t=${Math.round(process.uptime())}s] ` +
      `resources=${JSON.stringify(resources)} ` +
      `handles=${JSON.stringify(tally(process._getActiveHandles?.() ?? []))} ` +
      `requests=${JSON.stringify(tally(process._getActiveRequests?.() ?? []))}`,
  );

  if ((taken += 1) >= SAMPLES) {
    clearInterval(timer);
    process.exit(90);
  }
};

let timer;
setTimeout(() => {
  sample();
  timer = setInterval(sample, EVERY_MS);
}, START_MS);
