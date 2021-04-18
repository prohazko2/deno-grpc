import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { startsWith } from "https://deno.land/std@0.93.0/bytes/mod.ts";

const PRELUDE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

import { Deserializer, Serializer, Frame } from "./http2_frames.ts";

import { Compressor, Decompressor } from "./http2_hpack.ts";

//const d = new Deserializer("SERVER");

export class Http2Request {
  #d = new Deserializer("SERVER");
  #s = new Serializer();

  #dataFrameResolvers: ((f: Uint8Array) => void)[] = [];

  #stream = 0;

  #dataFrame: Frame = null!;

  headers: Record<string, string> = {};

  constructor(public conn: Deno.Conn) {
    this.#d.on("data", (x: Frame) => {
      if (x.stream > 0) {
        this.#stream = x.stream;
      }

      if (x.type === "HEADERS") {
        this.headers = new Decompressor("REQUEST").decompress(x.data);
      }
      if (x.type === "DATA") {
        this.#dataFrame = x;
        this._resolveDataFrameWith(x);
      }
      if (x.type === "SETTINGS") {

      }
    });
  }

  async _readToCompletion() {
    for (;;) {
      let b = new Uint8Array(4096);
      let n: number | null = null;

      try {
        n = await this.conn.read(b);
      } catch (err) {
        console.error(err);
      }

      if (!n) {
        break;
      }

      b = b.slice(0, n);
      if (startsWith(b, PRELUDE)) {
        b = b.slice(PRELUDE.length);
      }

      this.#d._transform(b, "", () => {});
    }
  }

  _waitForDataFrame(): Promise<Uint8Array> {
    if (this.#dataFrame) {
      return Promise.resolve(new Uint8Array(this.#dataFrame.data.buffer));
    }

    return new Promise((resolve) => this.#dataFrameResolvers.push(resolve));
  }

  _resolveDataFrameWith(frame: Frame) {
    const b = new Uint8Array(frame.data.buffer);
    for (const resolve of this.#dataFrameResolvers) {
      resolve(b);
    }
    this.#dataFrameResolvers = [];
  }

  sendSettings(flags: Record<string, boolean> = {}) {
    return this.sendFrame({
      type: "SETTINGS",
      settings: {},
      flags,
      stream: 0,
    });
  }

  sendHeaders(headers: Record<string, string>) {
    return this.sendFrame({
      type: "HEADERS",
      flags: { END_HEADERS: true },
      stream: this.#stream,
      data: new Compressor("RESPONSE").compress(headers),
      headers,
    });
  }

  sendData(data: Uint8Array) {
    return this.sendFrame({
      type: "DATA",
      data: data,
      stream: this.#stream,
    });
  }

  sendTrailers(headers: Record<string, string>) {
    return this.sendFrame({
      type: "HEADERS",
      flags: { END_HEADERS: true, END_STREAM: true },
      stream: this.#stream,
      data: new Compressor("RESPONSE").compress(headers),
      headers,
    });
  }

  async sendFrame(frame: any) {
    for (const f of this.#s.__transform(frame, "", () => {})) {
      await this.conn.write(f);
    }
  }
}
