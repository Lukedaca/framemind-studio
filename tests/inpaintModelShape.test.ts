import { describe, expect, it } from 'vitest';
import { resizeLamaInput } from '../utils/inpaintModelShape';

const join = (...chunks: Uint8Array[]) => Uint8Array.from(chunks.flatMap(chunk => Array.from(chunk)));
const varint = (value: number): Uint8Array => {
  const bytes: number[] = [];
  do {
    const byte = value % 128;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Uint8Array.from(bytes);
};
const integer = (number: number, value: number) => join(varint(number * 8), varint(value));
const encoded = (number: number, payload: Uint8Array) => join(varint(number * 8 + 2), varint(payload.length), payload);
const string = (number: number, value: string) => encoded(number, new TextEncoder().encode(value));
const dim = (value: number | string) => encoded(1, typeof value === 'number' ? integer(1, value) : string(2, value));
const input = (name: string, dimensions: (number | string)[], elementType = 1) =>
  encoded(11, join(string(1, name), encoded(2, encoded(1, join(integer(1, elementType), encoded(2, join(...dimensions.map(dim))))))));
const weights = Uint8Array.from([0, 0x80, 0x04, 255, 0x80, 0x04, 12, 99, 0, 3]);
const model = (...inputs: Uint8Array[]) => join(integer(1, 8), encoded(7, join(encoded(5, weights), ...inputs)), string(2, 'test-producer'));
const goodInputs = (batch: number | string = 1) => [input('image', [batch, 3, 512, 512]), input('mask', [batch, 1, 512, 512])];
const unsupported = 'INPAINT_HD_UNSUPPORTED_MODEL';

describe('resizeLamaInput', () => {
  it('returns the original object for the normal 512 mode', () => {
    const bytes = new Uint8Array([255, 0, 128]);
    expect(resizeLamaInput(bytes, 512)).toBe(bytes);
  });

  it('changes exactly the four spatial metadata varints and leaves weights and source untouched', () => {
    const bytes = model(...goodInputs());
    const original = bytes.slice();
    const output = resizeLamaInput(bytes, 1024);
    expect(output).not.toBe(bytes);
    expect(output.length).toBe(bytes.length);
    const changed = Array.from(bytes.keys()).filter(index => bytes[index] !== output[index]);
    expect(changed).toHaveLength(4);
    for (const index of changed) {
      expect(bytes[index - 1]).toBe(0x80);
      expect(bytes[index]).toBe(0x04);
      expect(output[index]).toBe(0x08);
    }
    expect(output).toEqual(model(input('image', [1, 3, 1024, 1024]), input('mask', [1, 1, 1024, 1024])));
    expect(bytes).toEqual(original);
  });

  it('supports symbolic batch dimensions and reversed input order', () => {
    const output = resizeLamaInput(model(...goodInputs('batch').reverse()), 1024);
    expect(output).toEqual(model(input('mask', ['batch', 1, 1024, 1024]), input('image', ['batch', 3, 1024, 1024])));
  });

  it('skips unfamiliar metadata of each supported protobuf wire type without touching its payload', () => {
    const unknown = join(
      integer(200, 512),
      join(varint(201 * 8 + 1), new Uint8Array(8).fill(0x80)),
      encoded(202, Uint8Array.from([0x80, 0x04, 0, 255])),
      join(varint(203 * 8 + 5), new Uint8Array(4).fill(0x04)),
      // A legal uint64 varint larger than Number.MAX_SAFE_INTEGER is safe to skip.
      join(varint(204 * 8), Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 255, 255, 1])),
    );
    const output = resizeLamaInput(join(unknown, model(...goodInputs()), unknown), 1024);
    expect(output).toEqual(join(unknown, model(input('image', [1, 3, 1024, 1024]), input('mask', [1, 1, 1024, 1024])), unknown));
  });

  it('supports nonzero Uint8Array offsets without changing surrounding storage', () => {
    const bytes = model(...goodInputs());
    const backing = join(new Uint8Array([22, 33]), bytes, new Uint8Array([44, 55]));
    const original = backing.slice();
    const output = resizeLamaInput(backing.subarray(2, 2 + bytes.length), 1024);
    expect(output.length).toBe(bytes.length);
    expect(backing).toEqual(original);
  });

  it.each([
    ['missing image', model(input('mask', [1, 1, 512, 512]))],
    ['missing mask', model(input('image', [1, 3, 512, 512]))],
    ['duplicate input', model(...goodInputs(), input('image', [1, 3, 512, 512]))],
    ['unfamiliar input', model(...goodInputs(), input('extra', [1, 1, 512, 512]))],
    ['incorrect rank', model(input('image', [3, 512, 512]), input('mask', [1, 1, 512, 512]))],
    ['incorrect channels', model(input('image', [1, 1, 512, 512]), input('mask', [1, 1, 512, 512]))],
    ['incorrect spatial value', model(input('image', [1, 3, 256, 512]), input('mask', [1, 1, 512, 512]))],
    ['already resized', model(input('image', [1, 3, 1024, 1024]), input('mask', [1, 1, 1024, 1024]))],
    ['dynamic spatial dimension', model(input('image', [1, 3, 'height', 512]), input('mask', [1, 1, 512, 512]))],
    ['incompatible batch', model(input('image', [1, 3, 512, 512]), input('mask', [2, 1, 512, 512]))],
    ['empty batch parameter', model(...goodInputs(''))],
    ['zero batch', model(...goodInputs(0))],
    ['incorrect tensor element type', model(input('image', [1, 3, 512, 512], 2), input('mask', [1, 1, 512, 512]))],
    ['missing graph', integer(1, 8)],
    ['duplicate graph', join(model(...goodInputs()), encoded(7, new Uint8Array()))],
  ])('rejects %s before making changes', (_name, bytes) => {
    const original = bytes.slice();
    expect(() => resizeLamaInput(bytes, 1024)).toThrow(unsupported);
    expect(bytes).toEqual(original);
  });

  it('rejects truncation at every nested metadata boundary', () => {
    const bytes = model(...goodInputs());
    for (let end = 0; end < bytes.length; end++) {
      // A complete graph with no trailing optional producer is itself a valid model.
      if (end === bytes.length - string(2, 'test-producer').length) continue;
      expect(() => resizeLamaInput(bytes.subarray(0, end), 1024)).toThrow(unsupported);
    }
  });

  it.each([
    Uint8Array.from([0]),
    Uint8Array.from([0x80]),
    Uint8Array.from([0x3a, 0xff, 0x7f]),
    Uint8Array.from([0x3b]),
    Uint8Array.from([0x3a, 0x02, 0x59, 0]),
    Uint8Array.from([0x3a, 0x02, 0x5d, 0]),
    Uint8Array.from([0x3a, 0x02, 0x58, 0x80]),
    Uint8Array.from([0x3a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 2]),
  ])('rejects malformed protobuf %#', bytes => {
    expect(() => resizeLamaInput(bytes, 1024)).toThrow(unsupported);
  });
});
