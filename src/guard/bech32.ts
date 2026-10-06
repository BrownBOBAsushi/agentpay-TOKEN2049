const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const HRP = "addr_test";

export function isPreprodBech32Address(value: string): boolean {
  if (value !== value.toLowerCase() || !value.startsWith(`${HRP}1`)) {
    return false;
  }

  const data = value.slice(HRP.length + 1);
  // Require payload data and six checksum symbols. Cardano permits more than 90 characters.
  if (data.length < 7) return false;

  const hrpCodes = Array.from(HRP, (character) => character.charCodeAt(0));
  const values = [...hrpCodes.map((code) => code >> 5), 0, ...hrpCodes.map((code) => code & 31)];
  for (const character of data) {
    const digit = ALPHABET.indexOf(character);
    if (digit === -1) return false;
    values.push(digit);
  }

  // BIP-173 polymod: bech32 requires the residue 1 (not the bech32m constant).
  let checksum = 1;
  for (const digit of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ digit;
    for (let bit = 0; bit < GENERATORS.length; bit += 1) {
      if ((top >>> bit) & 1) checksum ^= GENERATORS[bit];
    }
  }
  return checksum === 1;
}
