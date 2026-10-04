// Session-only ownership of the RAW original behind a generated preview.
// Weak keys let removed previews and their originals be collected together.
const originals = new WeakMap<File, File>();
export function rememberRawOriginal(preview: File, original: File): void { originals.set(preview, original); }
export function getRawOriginal(preview: File): File | undefined { return originals.get(preview); }
