import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import {
  scanStream,
  parseScanReply,
  resolveClamAvPort,
  ClamAvUnavailableError,
  ClamAvProtocolError,
} from "./clamav";

/** The standard EICAR anti-malware test string (harmless, but every scanner flags it). */
const EICAR =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

type ServerBehaviour =
  | "clean"
  | "infected"
  | "error"
  | "silent"
  | "close-immediately"
  | "infected-fragmented"
  | "clean-unterminated";

const activeServers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    activeServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

/**
 * A fake clamd that speaks the real INSTREAM wire protocol: it parses the
 * `zINSTREAM\0` handshake and the length-prefixed chunk framing, so these
 * tests exercise the actual bytes our client emits.
 */
async function startFakeClamd(behaviour: ServerBehaviour): Promise<number> {
  const server = net.createServer((socket) => {
    if (behaviour === "close-immediately") {
      socket.destroy();
      return;
    }

    let buffer = Buffer.alloc(0);
    let handshakeSeen = false;
    let payload = Buffer.alloc(0);
    let replied = false;

    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!handshakeSeen) {
        const terminator = buffer.indexOf(0);
        if (terminator === -1) return;
        const command = buffer.subarray(0, terminator).toString("utf8");
        if (command !== "zINSTREAM") {
          socket.end("UNKNOWN COMMAND\0");
          return;
        }
        handshakeSeen = true;
        buffer = buffer.subarray(terminator + 1);
      }

      // Consume as many complete <uint32 length><bytes> frames as we have.
      while (buffer.byteLength >= 4 && !replied) {
        const frameLength = buffer.readUInt32BE(0);

        if (frameLength === 0) {
          buffer = buffer.subarray(4);
          replied = true;
          if (behaviour === "error") {
            socket.end("INSTREAM size limit exceeded. ERROR\0");
          } else if (behaviour === "silent") {
            socket.end();
          } else if (behaviour === "clean-unterminated") {
            socket.end("stream: OK");
          } else {
            socket.end("stream: OK\0");
          }
          return;
        }

        if (buffer.byteLength < 4 + frameLength) return;

        payload = Buffer.concat([payload, buffer.subarray(4, 4 + frameLength)]);
        buffer = buffer.subarray(4 + frameLength);

        // Real clamd answers and hangs up the moment it matches a signature,
        // without waiting for the rest of the stream.
        if (behaviour === "infected" && payload.includes(EICAR)) {
          replied = true;
          socket.end("stream: Win.Test.EICAR_HDB-1 FOUND\0");
          return;
        }

        // Same verdict, but split across two TCP packets at the worst possible
        // offset: the first packet ends in "...Trojan.OK", which is exactly the
        // shape that must NOT be mistaken for a clean reply.
        if (behaviour === "infected-fragmented" && payload.includes(EICAR)) {
          replied = true;
          socket.write("stream: Trojan.OK");
          setTimeout(() => socket.end("-1 FOUND\0"), 25);
          return;
        }
      }
    });
  });

  activeServers.push(server);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected the fake clamd server to be bound to a TCP port");
  }
  return address.port;
}

async function* toStream(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield Buffer.from(part, "utf8");
  }
}

describe("parseScanReply", () => {
  it("recognises a clean verdict", () => {
    expect(parseScanReply("stream: OK\0")).toEqual({ status: "clean" });
  });

  it("recognises an infected verdict and extracts the signature", () => {
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({
      status: "infected",
      signature: "Win.Test.EICAR_HDB-1",
    });
  });

  it("returns null for an incomplete reply so the caller keeps reading", () => {
    expect(parseScanReply("")).toBeNull();
    expect(parseScanReply("stre")).toBeNull();
  });

  it("throws on an explicit ERROR reply", () => {
    expect(() => parseScanReply("INSTREAM size limit exceeded. ERROR\0")).toThrow(
      ClamAvProtocolError,
    );
  });

  // A verdict is decided by the reply's trailing keyword. Matching "OK"
  // anywhere would let a signature named `Trojan.OK-1` be reported as clean —
  // a malware file silently accepted.
  it("reports a threat whose signature contains OK as infected, not clean", () => {
    expect(parseScanReply("stream: Trojan.OK-1 FOUND\0")).toEqual({
      status: "infected",
      signature: "Trojan.OK-1",
    });
  });

  it("reports a threat whose signature contains ERROR as infected, not a protocol error", () => {
    expect(parseScanReply("stream: Trojan.ERROR-1 FOUND\0")).toEqual({
      status: "infected",
      signature: "Trojan.ERROR-1",
    });
  });

  it("reports a threat whose signature contains FOUND as infected", () => {
    expect(parseScanReply("stream: Trojan.FOUND-Dropper FOUND\0")).toEqual({
      status: "infected",
      signature: "Trojan.FOUND-Dropper",
    });
  });

  // A verdict may only be read from a *terminated* reply. These prefixes are
  // what a TCP-fragmented `stream: Trojan.OK-1 FOUND\0` looks like on the
  // first packet; treating one as clean would wave malware through.
  it.each([
    "stream: Trojan.OK",
    "stream: Trojan.OK-1 FO",
    "stream: Malware.ERROR",
    "stream: O",
  ])("returns null for the unterminated prefix %j", (prefix) => {
    expect(parseScanReply(prefix)).toBeNull();
  });

  it("returns a verdict as soon as the terminator arrives, ignoring trailing bytes", () => {
    expect(parseScanReply("stream: OK\0extra-noise")).toEqual({ status: "clean" });
  });

  it("accepts a newline-terminated reply", () => {
    expect(parseScanReply("stream: Trojan.OK-1 FOUND\n")).toEqual({
      status: "infected",
      signature: "Trojan.OK-1",
    });
  });
});

describe("scanStream", () => {
  it("returns clean for a harmless payload", async () => {
    const port = await startFakeClamd("clean");
    const verdict = await scanStream(toStream("# Business Requirements\n", "All good."), {
      host: "127.0.0.1",
      port,
    });
    expect(verdict).toEqual({ status: "clean" });
  });

  it("returns infected with the signature for an EICAR payload", async () => {
    const port = await startFakeClamd("infected");
    const verdict = await scanStream(toStream(EICAR), { host: "127.0.0.1", port });
    expect(verdict).toEqual({ status: "infected", signature: "Win.Test.EICAR_HDB-1" });
  });

  it("still reports infected when the daemon answers mid-stream and hangs up early", async () => {
    const port = await startFakeClamd("infected");
    // The EICAR marker arrives first, then many more chunks the daemon will
    // never read — writes must fail silently rather than clobber the verdict.
    const trailing = Array.from({ length: 200 }, () => "padding".repeat(1000));
    const verdict = await scanStream(toStream(EICAR, ...trailing), {
      host: "127.0.0.1",
      port,
    });
    expect(verdict).toEqual({ status: "infected", signature: "Win.Test.EICAR_HDB-1" });
  });

  it("reports infected when the daemon's reply is split mid-signature across packets", async () => {
    const port = await startFakeClamd("infected-fragmented");
    const verdict = await scanStream(toStream(EICAR), { host: "127.0.0.1", port });
    // Regression guard: the first packet ends in "Trojan.OK". Parsing that
    // prefix would return "clean" and the upload route would then promote
    // malware into permanent storage with scan_status='clean'.
    expect(verdict).toEqual({ status: "infected", signature: "Trojan.OK-1" });
  });

  it("scans a multi-chunk stream larger than a single frame", async () => {
    const port = await startFakeClamd("clean");
    const chunks = Array.from({ length: 50 }, (_, index) => `chunk-${index}-`.repeat(500));
    const verdict = await scanStream(toStream(...chunks), { host: "127.0.0.1", port });
    expect(verdict).toEqual({ status: "clean" });
  });

  it("skips empty chunks without corrupting the frame protocol", async () => {
    const port = await startFakeClamd("clean");
    const verdict = await scanStream(toStream("real data", "", "more data"), {
      host: "127.0.0.1",
      port,
    });
    expect(verdict).toEqual({ status: "clean" });
  });

  it("handles an empty stream as clean", async () => {
    const port = await startFakeClamd("clean");
    const verdict = await scanStream(toStream(), { host: "127.0.0.1", port });
    expect(verdict).toEqual({ status: "clean" });
  });

  it("throws ClamAvProtocolError when the daemon reports an error", async () => {
    const port = await startFakeClamd("error");
    await expect(
      scanStream(toStream("payload"), { host: "127.0.0.1", port }),
    ).rejects.toBeInstanceOf(ClamAvProtocolError);
  });

  it("throws ClamAvUnavailableError when nothing is listening", async () => {
    // Port 1 is privileged and never bound in the test environment.
    await expect(
      scanStream(toStream("payload"), { host: "127.0.0.1", port: 1 }),
    ).rejects.toBeInstanceOf(ClamAvUnavailableError);
  });

  // Sibling behaviours that must all fail closed the same way: a reply that
  // never completes (fragmented off, silently, or via an immediate close)
  // must surface as ClamAvUnavailableError (→ HTTP 503, nothing stored),
  // never as a silent clean verdict.
  it.each<[string, ServerBehaviour]>([
    ["fails closed rather than clean when the daemon hangs up on an unterminated reply", "clean-unterminated"],
    ["throws ClamAvUnavailableError when the daemon closes without replying", "silent"],
    ["throws ClamAvUnavailableError when the daemon hangs up during the handshake", "close-immediately"],
  ])("%s", async (_description, behaviour) => {
    const port = await startFakeClamd(behaviour);
    await expect(
      scanStream(toStream("payload"), { host: "127.0.0.1", port }),
    ).rejects.toBeInstanceOf(ClamAvUnavailableError);
  });

  it("times out instead of hanging when the daemon never answers", async () => {
    const port = await startFakeClamd("silent");
    async function* stalledSource(): AsyncGenerator<Uint8Array> {
      yield Buffer.from("payload", "utf8");
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    await expect(
      scanStream(stalledSource(), { host: "127.0.0.1", port, timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(ClamAvUnavailableError);
  });
});

describe("resolveClamAvPort", () => {
  const original = process.env.CLAMAV_PORT;
  afterEach(() => {
    if (original === undefined) delete process.env.CLAMAV_PORT;
    else process.env.CLAMAV_PORT = original;
  });

  it("defaults to 3310", () => {
    delete process.env.CLAMAV_PORT;
    expect(resolveClamAvPort()).toBe(3310);
  });

  it("reads a configured port", () => {
    process.env.CLAMAV_PORT = "9999";
    expect(resolveClamAvPort()).toBe(9999);
  });

  it("rejects a non-numeric port instead of silently falling back", () => {
    process.env.CLAMAV_PORT = "not-a-port";
    expect(() => resolveClamAvPort()).toThrow(/valid port/);
  });
});
