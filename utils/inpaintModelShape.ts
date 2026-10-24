const unsupported = (): never => { throw new Error('INPAINT_HD_UNSUPPORTED_MODEL'); };

interface Field {
  number: number;
  wire: number;
  start: number;
  end: number;
  value?: number;
}

type Dimension =
  | { kind: 'value'; value: number; start: number; end: number }
  | { kind: 'parameter'; value: string };

const varint = (bytes: Uint8Array, start: number, end: number) => {
  let value = 0;
  for (let count = 0; count < 10; count++) {
    if (start + count >= end) return unsupported();
    const byte = bytes[start + count];
    if (count === 9 && byte > 1) return unsupported();
    value += (byte & 0x7f) * 2 ** (count * 7);
    if (!(byte & 0x80)) return { value, end: start + count + 1 };
  }
  return unsupported();
};

function* fields(bytes: Uint8Array, start: number, end: number): Generator<Field> {
  let at = start;
  while (at < end) {
    const key = varint(bytes, at, end);
    if (!Number.isSafeInteger(key.value) || key.value > 0xffffffff) return unsupported();
    const wire = key.value & 7;
    const number = Math.floor(key.value / 8);
    if (!number) return unsupported();
    at = key.end;
    let payloadStart = at;
    let payloadEnd: number;
    let value: number | undefined;
    if (wire === 0) {
      const integer = varint(bytes, at, end);
      payloadEnd = integer.end;
      value = integer.value;
    } else if (wire === 1) payloadEnd = at + 8;
    else if (wire === 5) payloadEnd = at + 4;
    else if (wire === 2) {
      const length = varint(bytes, at, end);
      if (!Number.isSafeInteger(length.value)) return unsupported();
      payloadStart = length.end;
      payloadEnd = payloadStart + length.value;
    } else return unsupported();
    if (payloadEnd > end || !Number.isSafeInteger(payloadEnd)) return unsupported();
    yield { number, wire, start: payloadStart, end: payloadEnd, value };
    at = payloadEnd;
  }
}

const message = (field: Field) => {
  if (field.wire !== 2) return unsupported();
  return field;
};

const text = (bytes: Uint8Array, field: Field) => {
  message(field);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(field.start, field.end));
  } catch {
    return unsupported();
  }
};

const dimension = (bytes: Uint8Array, field: Field): Dimension => {
  message(field);
  let result: Dimension | undefined;
  for (const entry of fields(bytes, field.start, field.end)) {
    if (entry.number !== 1 && entry.number !== 2) continue;
    if (result) return unsupported();
    if (entry.number === 1) {
      if (entry.wire !== 0 || !Number.isSafeInteger(entry.value) || entry.value! < 1) return unsupported();
      result = { kind: 'value', value: entry.value!, start: entry.start, end: entry.end };
    } else {
      const value = text(bytes, entry);
      if (!value) return unsupported();
      result = { kind: 'parameter', value };
    }
  }
  return result ?? unsupported();
};

const shape = (bytes: Uint8Array, type: Field): Dimension[] => {
  message(type);
  let tensor: Field | undefined;
  for (const field of fields(bytes, type.start, type.end)) {
    if (field.number !== 1) continue;
    if (tensor) return unsupported();
    tensor = message(field);
  }
  if (!tensor) return unsupported();
  let dimensions: Dimension[] | undefined;
  let elementType: number | undefined;
  for (const field of fields(bytes, tensor.start, tensor.end)) {
    if (field.number === 1) {
      if (elementType !== undefined || field.wire !== 0) return unsupported();
      elementType = field.value;
    } else if (field.number === 2) {
      if (dimensions) return unsupported();
      message(field);
      dimensions = [];
      for (const entry of fields(bytes, field.start, field.end)) {
        if (entry.number === 1) dimensions.push(dimension(bytes, entry));
      }
    }
  }
  // Both pinned LaMa inputs are float32 tensors.
  if (elementType !== 1 || !dimensions || dimensions.length !== 4) return unsupported();
  return dimensions;
};

/** Change only LaMa's two input-shape spatial varints; weights are never decoded. */
export function resizeLamaInput(bytes: Uint8Array, size: 512 | 1024): Uint8Array {
  if (size === 512) return bytes;
  if (size !== 1024) return unsupported();
  let graph: Field | undefined;
  for (const field of fields(bytes, 0, bytes.length)) {
    if (field.number !== 7) continue;
    if (graph) return unsupported();
    graph = message(field);
  }
  if (!graph) return unsupported();

  const names = new Set<string>();
  const offsets: number[] = [];
  let batch: Dimension | undefined;
  for (const input of fields(bytes, graph.start, graph.end)) {
    if (input.number !== 11) continue;
    message(input);
    let name: string | undefined;
    let type: Field | undefined;
    for (const field of fields(bytes, input.start, input.end)) {
      if (field.number === 1) {
        if (name !== undefined) return unsupported();
        name = text(bytes, field);
      } else if (field.number === 2) {
        if (type) return unsupported();
        type = message(field);
      }
    }
    if (!name || !type || names.has(name) || (name !== 'image' && name !== 'mask')) return unsupported();
    names.add(name);
    const dimensions = shape(bytes, type);
    const first = dimensions[0];
    if (batch && (batch.kind !== first.kind || batch.value !== first.value)) return unsupported();
    batch = first;
    const channels = dimensions[1];
    if (channels.kind !== 'value' || channels.value !== (name === 'image' ? 3 : 1)) return unsupported();
    for (const spatial of dimensions.slice(2)) {
      if (spatial.kind !== 'value' || spatial.value !== 512 || spatial.end - spatial.start !== 2) return unsupported();
      offsets.push(spatial.start);
    }
  }
  if (names.size !== 2 || offsets.length !== 4) return unsupported();
  const resized = bytes.slice();
  for (const offset of offsets) {
    resized[offset] = 0x80;
    resized[offset + 1] = 0x08;
  }
  return resized;
}
