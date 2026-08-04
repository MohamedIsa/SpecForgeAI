import net from "node:net";

/**
 * Minimal ClamAV `INSTREAM` client.
 *
 * Protocol (clamd):
 *   1. send `zINSTREAM\0`
 *   2. send each chunk as `<uint32 big-endian length><bytes>`
 *   3. send a zero-length chunk (`<uint32 0>`) to signal end of stream
 *   4. clamd replies `stream: OK\0` or `stream: <signature> FOUND\0`
 *
 * clamd may reply and close the socket *before* the whole stream has been
 * written (as soon as a signature matches), so writes are allowed to fail
 * once a verdict has already been received.
 */

const INSTREAM_COMMAND = "zINSTREAM\0";
const CHUNK_HEADER_BYTES = 4;
const DEFAULT_TIMEOUT_MS = 30_000;

/** clamd's own default StreamMaxLength; larger streams are refused by the daemon. */
export const CLAMAV_STREAM_MAX_BYTES = 25 * 1024 * 1024;

export type ScanVerdict = { status: "clean" } | { status: "infected"; signature: string };

/** The daemon could not be reached, timed out, or dropped the connection. */
export class ClamAvUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ClamAvUnavailableError";
  }
}

/** The daemon replied with something we do not understand, or an explicit ERROR. */
export class ClamAvProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClamAvProtocolError";
  }
}

export interface ScanOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
}

export function resolveClamAvHost(): string {
  return process.env.CLAMAV_HOST ?? "127.0.0.1";
}

export function resolveClamAvPort(): number {
  const raw = process.env.CLAMAV_PORT;
  if (!raw) return 3310;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`CLAMAV_PORT must be a valid port number, received "${raw}"`);
  }
  return parsed;
}

/**
 * Parses a clamd INSTREAM reply. Returns null when the reply is not yet
 * complete (clamd terminates replies with NUL or a newline).
 */
export function parseScanReply(reply: string): ScanVerdict | null {
  // Only ever parse a *terminated* reply. `scanStream` calls this on every
  // `data` event against an accumulating buffer, so a TCP-fragmented reply
  // arrives here as a prefix first. Testing a prefix would let
  // `stream: Trojan.OK` (the first packet of `stream: Trojan.OK-1 FOUND`)
  // match the clean pattern below and wave malware through — the scanner must
  // fail closed, so an unterminated buffer is "not an answer yet".
  const terminatorIndex = reply.search(/[\0\n]/);
  if (terminatorIndex === -1) return null;

  const trimmed = reply.slice(0, terminatorIndex).trim();
  if (!trimmed) return null;

  // clamd always terminates a reply with FOUND, OK or ERROR. Discriminating on
  // that trailing keyword — rather than searching anywhere in the string — is
  // what stops a signature *named* e.g. `Trojan.ERROR-1` or `Trojan.OK-1` from
  // being misread as an error or, far worse, as a clean verdict.
  const found = /^(?:.*?:)?\s*(.+?)\s+FOUND$/.exec(trimmed);
  if (found) {
    const signature = found[1];
    if (!signature) {
      throw new ClamAvProtocolError(`ClamAV reported a threat without a signature: ${trimmed}`);
    }
    return { status: "infected", signature };
  }

  if (/\bERROR$/.test(trimmed)) {
    throw new ClamAvProtocolError(`ClamAV returned an error: ${trimmed}`);
  }

  if (/\bOK$/.test(trimmed)) {
    return { status: "clean" };
  }

  return null;
}

function encodeChunkHeader(byteLength: number): Buffer {
  const header = Buffer.allocUnsafe(CHUNK_HEADER_BYTES);
  header.writeUInt32BE(byteLength, 0);
  return header;
}

/** Resolves once the socket has flushed, honouring backpressure. */
function writeToSocket(socket: net.Socket, data: Buffer): Promise<void> {
  return new Promise<void>((resolve) => {
    const flushed = socket.write(data);
    if (flushed) {
      resolve();
      return;
    }
    socket.once("drain", resolve);
  });
}

/**
 * Streams `source` through clamd and resolves with its verdict. The stream is
 * consumed lazily, so a 25MB upload never has to be buffered in memory.
 */
export function scanStream(
  source: AsyncIterable<Uint8Array>,
  options: ScanOptions = {},
): Promise<ScanVerdict> {
  const host = options.host ?? resolveClamAvHost();
  const port = options.port ?? resolveClamAvPort();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ScanVerdict>((resolve, reject) => {
    const socket = net.connect({ host, port });
    let reply = "";
    let settled = false;

    function settleWith(verdict: ScanVerdict): void {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(verdict);
    }

    function settleError(error: Error): void {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    }

    socket.setTimeout(timeoutMs);

    socket.on("timeout", () => {
      settleError(
        new ClamAvUnavailableError(`ClamAV did not respond within ${timeoutMs}ms`),
      );
    });

    socket.on("error", (error: Error) => {
      // A write failure after clamd has already answered is expected: it closes
      // the socket as soon as it matches a signature.
      settleError(
        new ClamAvUnavailableError(`Could not reach ClamAV at ${host}:${port}`, {
          cause: error,
        }),
      );
    });

    socket.on("data", (chunk: Buffer) => {
      reply += chunk.toString("utf8");
      let verdict: ScanVerdict | null;
      try {
        verdict = parseScanReply(reply);
      } catch (error) {
        settleError(error instanceof Error ? error : new ClamAvProtocolError(String(error)));
        return;
      }
      if (verdict) settleWith(verdict);
    });

    socket.on("close", () => {
      if (settled) return;
      settleError(
        new ClamAvUnavailableError(
          reply.trim()
            ? `ClamAV closed the connection with an incomplete reply: ${reply.trim()}`
            : "ClamAV closed the connection before replying",
        ),
      );
    });

    socket.on("connect", () => {
      void (async () => {
        try {
          await writeToSocket(socket, Buffer.from(INSTREAM_COMMAND, "utf8"));

          for await (const chunk of source) {
            if (settled) return;
            const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
            if (buffer.byteLength === 0) continue;
            await writeToSocket(socket, encodeChunkHeader(buffer.byteLength));
            await writeToSocket(socket, buffer);
          }

          if (settled) return;
          await writeToSocket(socket, encodeChunkHeader(0));
        } catch (error) {
          // Once clamd has answered, a broken pipe is normal and must not
          // overwrite the verdict we already resolved with.
          if (settled) return;
          settleError(
            new ClamAvUnavailableError("Failed while streaming data to ClamAV", {
              cause: error,
            }),
          );
        }
      })();
    });
  });
}
