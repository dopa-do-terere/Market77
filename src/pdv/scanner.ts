/**
 * Barcode readers act as a keyboard: they type the code fast and finish with Enter.
 * Feed every keydown to the returned function; onScan fires with the accumulated code.
 */
export function createScanner(
  onScan: (code: string) => void,
  maxGapMs = 500,
): (key: string, now: number) => void {
  let buf = "";
  let last = 0;
  return (key, now) => {
    if (now - last > maxGapMs) buf = "";
    last = now;
    if (key === "Enter") {
      const code = buf;
      buf = "";
      if (code.length >= 4) onScan(code);
      return;
    }
    if (key.length === 1) buf += key;
  };
}
