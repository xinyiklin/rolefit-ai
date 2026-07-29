export type JsonFileInput = string | ArrayBuffer | Uint8Array;

export type JsonFileCodecErrors = {
  tooLarge: () => never;
  invalidUtf8: () => never;
  invalidJson: () => never;
};

export function assertJsonFileSize(
  byteLength: number,
  maxBytes: number,
  tooLarge: () => never
): void {
  if (byteLength > maxBytes) tooLarge();
}

function decodeJsonFileInput(
  input: JsonFileInput,
  maxBytes: number,
  errors: Pick<JsonFileCodecErrors, "tooLarge" | "invalidUtf8">
): string {
  if (typeof input === "string") {
    assertJsonFileSize(
      new TextEncoder().encode(input).byteLength,
      maxBytes,
      errors.tooLarge
    );
    return input;
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  assertJsonFileSize(bytes.byteLength, maxBytes, errors.tooLarge);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return errors.invalidUtf8();
  }
}

export function parseJsonFile(
  input: JsonFileInput,
  maxBytes: number,
  errors: JsonFileCodecErrors
): unknown {
  const text = decodeJsonFileInput(input, maxBytes, errors);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return errors.invalidJson();
  }
}

export function serializeJsonFile(
  value: unknown,
  maxBytes: number,
  tooLarge: () => never
): string {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  assertJsonFileSize(
    new TextEncoder().encode(serialized).byteLength,
    maxBytes,
    tooLarge
  );
  return serialized;
}
