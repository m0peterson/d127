export const D127 = 127;
export const D3 = 3;

const buf = new Uint32Array(1);

/** Равномерное целое от 1 до n. crypto + отбраковка, чтобы не было перекоса от остатка деления. */
export function randomInt(n) {
  if (!globalThis.crypto?.getRandomValues) return 1 + Math.floor(Math.random() * n);
  const limit = Math.floor(0x100000000 / n) * n;
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return 1 + (buf[0] % n);
}

/** Один бросок двух кубиков сразу. */
export function rollBoth() {
  return { d127: randomInt(D127), d3: randomInt(D3) };
}
