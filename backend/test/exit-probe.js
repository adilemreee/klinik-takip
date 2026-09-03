/**
 * Temporary CI diagnostic: says what is still holding the event loop open.
 *
 * The integration suite passes and then Jest reports that it did not exit —
 * only on the GitHub runner. It exits cleanly on macOS and in a Node 22 Linux
 * container built to match the runner (same services, same fresh database,
 * same log output down to the line counts), so the leak has to be identified
 * where it actually happens.
 */
const DEADLINE_MS = Number(process.env.EXIT_PROBE_MS ?? 150_000);

setTimeout(() => {
  const resources = {};
  for (const kind of process.getActiveResourcesInfo()) {
    resources[kind] = (resources[kind] ?? 0) + 1;
  }

  const describe = (item) => {
    const name = item?.constructor?.name ?? typeof item;
    try {
      if (item.remoteAddress) return `${name} ${item.remoteAddress}:${item.remotePort}`;
      if (item.spawnfile) return `${name} ${item.spawnfile} ${JSON.stringify(item.spawnargs)}`;
      if (typeof item.address === 'function') return `${name} ${JSON.stringify(item.address())}`;
      if (item.threadId !== undefined) return `${name} thread=${item.threadId}`;
    } catch {
      /* an inspected handle must never be the thing that fails the run */
    }
    return name;
  };

  const tally = (items) => {
    const counts = {};
    for (const item of items) {
      const key = describe(item);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };

  console.log('\n=== EXIT PROBE ===');
  console.log('resources:', JSON.stringify(resources));
  console.log('handles:', JSON.stringify(tally(process._getActiveHandles?.() ?? []), null, 2));
  console.log('requests:', JSON.stringify(tally(process._getActiveRequests?.() ?? []), null, 2));
  process.exit(90);
}, DEADLINE_MS);
