export function graphLayoutFor(nodeCount: number) {
  const density = Math.max(0.55, Math.min(1, Math.sqrt(32 / Math.max(nodeCount, 1))));

  return {
    linkDistance: Math.round(90 * density),
    chargeStrength: Math.round(-280 * density),
    centerStrength: 0.025 + (1 - density) * 0.05,
    orphanStrength: 0.16,
  };
}
