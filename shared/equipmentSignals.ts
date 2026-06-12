// Detect equipment requirements encoded in the Job Address text.
//
// Per the coordinator's convention:
// - a tire emoji (🛞) or the word "tire" in the address => the job needs an ARROWBOARD
// - a TV emoji (📺) in the address => the job needs a MESSAGE BOARD

const TIRE_EMOJI = "\u{1F6DE}"; // 🛞 wheel
const TV_EMOJI = "\u{1F4FA}"; // 📺 television

/** True when the job address signals an arrowboard is required. */
export function needsArrowboard(address?: string | null): boolean {
  if (!address) return false;
  if (address.includes(TIRE_EMOJI)) return true;
  // word-boundary match for the literal word "tire" (case-insensitive)
  return /\btire\b/i.test(address);
}

/** True when the job address signals a message board is required. */
export function needsMessageBoard(address?: string | null): boolean {
  if (!address) return false;
  return address.includes(TV_EMOJI);
}
