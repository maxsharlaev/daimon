import type { Terminal } from "@xterm/xterm";
import type { LocalOutputEvent } from "../types/local";

export function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function writeBase64(term: Terminal, decoder: TextDecoder, dataB64: string): void {
  const bytes = base64ToBytes(dataB64);
  term.write(decoder.decode(bytes, { stream: true }));
}

export function writeLocalOutput(term: Terminal, decoder: TextDecoder, ev: LocalOutputEvent): void {
  if (ev.dataB64) {
    writeBase64(term, decoder, ev.dataB64);
    return;
  }
  if (ev.data) {
    term.write(ev.data);
  }
}
