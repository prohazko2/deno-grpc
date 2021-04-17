import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { startsWith } from "https://deno.land/std@0.93.0/bytes/mod.ts";

const PRELUDE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

import { Deserializer, Serializer, Frame } from "./http2_frames.ts";

//const d = new Deserializer("SERVER");

export class Http2Request {
  #d = new Deserializer("SERVER");
  #s = new Serializer();

  #dataFrameResolvers: ((f: Uint8Array) => void)[] = [];

  constructor(public conn: Deno.Conn) {
    this.#d.on("data", (x: Frame) => {
      if (x.type === "DATA") {
        this._resolveDataFrameWith(x);
      }
      //console.log(x);
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
    return new Promise((resolve) => this.#dataFrameResolvers.push(resolve));
  }

  _resolveDataFrameWith(frame: Frame) {
    const b = new Uint8Array(frame.data.buffer);
    for (const resolve of this.#dataFrameResolvers) {
      resolve(b);
    }
    this.#dataFrameResolvers = [];
  }
}
