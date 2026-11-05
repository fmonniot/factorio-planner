/** "4 MJ" for a fuel value in kJ. */
export function fmtFuelValue(kj: number): string {
  return kj >= 1000 ? `${+(kj / 1000).toPrecision(4)} MJ` : `${+kj.toPrecision(4)} kJ`
}
