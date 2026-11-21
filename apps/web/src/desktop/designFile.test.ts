import { DesignDocument } from '@figma/document';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { decodeDesignFile, DesignFileError, encodeDesignFile, FORMAT_VERSION, newDocId } from './designFile';

const header = () => ({ format: FORMAT_VERSION, docId: newDocId(), app: '0.1.0', savedAt: new Date(0).toISOString() });

describe('.design files', () => {
  it('round-trips a document', () => {
    const doc = new DesignDocument();
    doc.ensureInitialized();
    const id = doc.change(() => doc.createNode({ type: 'RECTANGLE', name: 'Saved box', parentId: doc.pages()[0]!.id, width: 40, height: 30 }));
    const h = header();
    const { header: back, state } = decodeDesignFile(encodeDesignFile(h, Y.encodeStateAsUpdate(doc.ydoc)));
    expect(back).toEqual(h);
    const reopened = new DesignDocument();
    Y.applyUpdate(reopened.ydoc, state);
    reopened.ensureInitialized();
    expect(reopened.get(id)).toMatchObject({ name: 'Saved box', width: 40, height: 30 });
  });

  it('rejects other files and damaged ones with a reason', () => {
    expect(() => decodeDesignFile(new TextEncoder().encode('{"not":"ours"}'))).toThrow(/isn't a .design file/);
    const good = encodeDesignFile(header(), new Uint8Array([1, 2, 3]));
    expect(() => decodeDesignFile(good.slice(0, 12))).toThrow(DesignFileError);
    const newer = good.slice();
    newer[4] = FORMAT_VERSION + 1;
    expect(() => decodeDesignFile(newer)).toThrow(/newer version/);
    const garbled = good.slice();
    garbled[10] = 0x7b; // '{' inside the header
    garbled[11] = 0x7b;
    expect(() => decodeDesignFile(garbled)).toThrow(/damaged/);
  });

  it('decodes from a view into a larger buffer', () => {
    const file = encodeDesignFile(header(), new Uint8Array([9, 8, 7]));
    const padded = new Uint8Array(file.length + 10);
    padded.set(file, 5);
    expect(decodeDesignFile(padded.subarray(5, 5 + file.length)).state).toEqual(new Uint8Array([9, 8, 7]));
  });
});
