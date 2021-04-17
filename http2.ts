import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { startsWith } from "https://deno.land/std@0.93.0/bytes/mod.ts";

const PRELUDE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

import { Deserializer, Serializer, Frame } from "./http2_frames.ts";

import { Compressor } from "./http2_hpack.ts";

//const d = new Deserializer("SERVER");

export class Http2Request {
  #d = new Deserializer("SERVER");
  #s = new Serializer();

  #headersFrameResolvers: ((f: Uint8Array) => void)[] = [];
  #dataFrameResolvers: ((f: Uint8Array) => void)[] = [];

  constructor(public conn: Deno.Conn) {
    this.#d.on("data", (x: Frame) => {
      if (x.type === "HEADERS") {
        this._resolveHeadersFrameWith(x);
      }
      if (x.type === "DATA") {
        this._resolveDataFrameWith(x);
      }
      console.log(x);
    });

    this.#s.on("data", (x: any) => {
      console.log("Serializer", x);
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

  _waitForHeadersFrame(): Promise<Uint8Array> {
    return new Promise((resolve) => this.#headersFrameResolvers.push(resolve));
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

  _resolveHeadersFrameWith(frame: Frame) {
    const b = new Uint8Array(frame.data.buffer);
    for (const resolve of this.#headersFrameResolvers) {
      resolve(b);
    }
    this.#headersFrameResolvers = [];
  }

  sendHeaders(headers: Record<string, string>) {
    return this.sendFrame({
      type: "HEADERS",
      flags: {},
      stream: 1,
      data: new Compressor("RESPONSE").compress(headers),
      headers,
    });
  }

  sendData(data: Uint8Array) {
    return this.sendFrame({
      type: "DATA",
      data: data,
      stream: 1,
    });
  }

  sendTrailers(headers: Record<string, string>) {
    return this.sendFrame({
      type: "HEADERS",
      flags: { END_STREAM: true },
      stream: 1,
      data: new Compressor("RESPONSE").compress(headers),
      headers,
    });
  }

  async sendFrame(frame: any) {
    for (const f of this.#s.__transform(frame, "", () => {})) {
      const writen = await this.conn.write(f);
      console.log("frm", writen);
    }
  }

  //_push
}

/*
OutgoingResponse.prototype.writeHead = function writeHead(statusCode, reasonPhrase, headers) {
  if (this.headersSent) {
    return;
  }

  if (typeof reasonPhrase === 'string') {
    this._log.warn('Reason phrase argument was present but ignored by the writeHead method');
  } else {
    headers = reasonPhrase;
  }

  for (var name in headers) {
    this.setHeader(name, headers[name]);
  }
  headers = this._headers;

  if (this.sendDate && !('date' in this._headers)) {
    headers.date = (new Date()).toUTCString();
  }

  this._log.info({ status: statusCode, headers: this._headers }, 'Sending server response');

  headers[':status'] = this.statusCode = statusCode;

  this.stream.headers(headers);
  this.headersSent = true;
};

*/
