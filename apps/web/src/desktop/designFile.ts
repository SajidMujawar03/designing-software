/**
 * The .design file format (desktop app files on disk):
 *
 *   bytes 0-3   "DSGN"
 *   byte  4     format version (1)
 *   bytes 5-8   length of the header, little-endian
 *   then        the header, JSON (UTF-8)
 *   then        the document's full state (a Yjs update)
 *
 * The header says which document it is (`docId`, kept across saves) and what
 * wrote it. The document itself is upgraded on open by the document
 * migrations, like any other file. Kept free of imports beyond the browser
 * and Node built-ins: the desktop main process uses it too.
 */

export const DESIGN_EXTENSION = 'design';
const MAGIC = [0x44, 0x53, 0x47, 0x4e]; // DSGN
export const FORMAT_VERSION = 1;
/** Headers are small; anything bigger is not a .design file. */
const MAX_HEADER = 64 * 1024;

export interface DesignFileHeader {
  format: number;
  /** Stays the same for the life of the document (copies made with Save As get a new one). */
  docId: string;
  /** The app version that wrote it. */
  app: string;
  savedAt: string;
}

export class DesignFileError extends Error {}

export function encodeDesignFile(header: DesignFileHeader, state: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(9 + json.length + state.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT_VERSION;
  new DataView(out.buffer).setUint32(5, json.length, true);
  out.set(json, 9);
  out.set(state, 9 + json.length);
  return out;
}

export function decodeDesignFile(bytes: Uint8Array): { header: DesignFileHeader; state: Uint8Array } {
  if (bytes.length < 9 || MAGIC.some((b, i) => bytes[i] !== b)) throw new DesignFileError("This isn't a .design file.");
  if (bytes[4]! > FORMAT_VERSION) throw new DesignFileError('This file was saved by a newer version of the app. Update the app to open it.');
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5, true);
  if (len > MAX_HEADER || 9 + len > bytes.length) throw new DesignFileError('This file is damaged (its header is cut off).');
  let header: DesignFileHeader;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + len)));
  } catch {
    throw new DesignFileError('This file is damaged (its header is unreadable).');
  }
  if (!header || typeof header.docId !== 'string') throw new DesignFileError('This file is damaged (it has no document id).');
  return { header, state: bytes.slice(9 + len) };
}

export const newDocId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
