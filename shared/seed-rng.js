// Consume all eight HMAC bytes without converting a 64-bit integer to an imprecise Number.
// SplitMix64 has a fixed algorithm; output uses its high 53 bits in [0, 1).
export function seedRng(seed) {
  if (!/^[0-9a-f]{16}$/.test(seed)) throw new Error('每日種子格式錯誤');
  let value = BigInt(`0x${seed}`);
  const mask = (1n << 64n) - 1n;
  return () => {
    value = (value + 0x9e3779b97f4a7c15n) & mask;
    let z = value;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    return Number((z ^ (z >> 31n)) >> 11n) / 9007199254740992;
  };
}
