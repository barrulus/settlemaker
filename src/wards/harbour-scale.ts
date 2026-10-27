/** Population takes precedence over an explicit small/large harbour hint. */
export function harbourProvision(population: number): 'beach' | 'jetty' | 'port' {
  return population < 150 ? 'beach' : population < 1000 ? 'jetty' : 'port';
}

export const VILLAGE_JETTY_LENGTH_M = 6;
export const VILLAGE_JETTY_WIDTH_M = 1.2;

export function harbourAccessWidthM(population: number): number {
  const provision = harbourProvision(population);
  return provision === 'beach' ? 1.2 : provision === 'jetty' ? 2 : 3.5;
}
