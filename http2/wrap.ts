import { startsWith } from "https://deno.land/std@0.93.0/bytes/mod.ts";

import { Deserializer, Serializer, Frame } from "./frames.ts";
import { Compressor, Decompressor } from "./hpack.ts";
import { Connection } from "./conn.ts";

const PRELUDE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

type Headers = Record<string, string>;

export class Http2Conn {
  #d: Deserializer = null!;
  c: Connection = null!;

  #s = new Serializer();

  #dataFrameResolvers: ((f: Uint8Array) => void)[] = [];
  #trailersResolvers: ((f: Headers) => void)[] = [];

  #stream = 0;

  dataFrame: Frame = null!;
  headers: Headers = {};
  trailers: Headers = {};
  trailersGot = false;

  constructor(public conn: Deno.Conn, public role = "CLIENT") {
    this.#d = new Deserializer(role);
    let firstStreamId = 1;
    if (role !== "CLIENT") {
      firstStreamId = 2;
      //compressorRole = 'REQUEST';
      //decompressorRole = 'RESPONSE';
    }

    this.c = new Connection(firstStreamId, {});

    // // TODO: figure out why
    // if (role == "CLIENT") {
    //   this.#stream = 1;
    // }
  }

  async __readToCompletion() {
    for (;;) {
      let b = new Uint8Array(4096);
      let n: number | null = null;

      try {
        n = await this.conn.read(b);
      } catch (err) {
        console.error("__readToCompletion err", err);
      }

      if (!n) {
        break;
      }

      b = b.slice(0, n);
      if (startsWith(b, PRELUDE)) {
        b = b.slice(PRELUDE.length);
      }

      for (const f of this.#d.decode(b)) {
        console.log("<<<< frame", f);

        // this.c._receive(f, () => {
        //   console.log("__readToCompletion _receive");
        // });

        // if (f.stream > 0) {
        //   this.#stream = f.stream;
        // }

        // if (f.type === "HEADERS") {
        //   const got = new Decompressor("REQUEST").decompress(f.data);
        //   this.headers = { ...this.headers, ...got };
        //   if (f.flags.END_STREAM) {
        //     this.trailersGot = true;
        //     this.trailers = { ...this.trailers, ...got };
        //     this._resolveTrailers();
        //   }
        // }
        // if (f.type === "DATA") {
        //   this.dataFrame = f;
        //   this._resolveDataFrameWith(f);
        // }

        // //yield f;
      }
    }
  }

  // async _readToCompletion() {
  //   for (;;) {
  //     let b = new Uint8Array(4096);
  //     let n: number | null = null;

  //     try {
  //       n = await this.conn.read(b);
  //     } catch (err) {
  //       //console.error(err);
  //     }

  //     if (!n) {
  //       break;
  //     }

  //     b = b.slice(0, n);
  //     if (startsWith(b, PRELUDE)) {
  //       b = b.slice(PRELUDE.length);
  //     }

  //     for (const f of this.#d.decode(b)) {
  //       //console.log("frame", f);

  //       if (f.stream > 0) {
  //         this.#stream = f.stream;
  //       }

  //       if (f.type === "HEADERS") {
  //         const got = new Decompressor("REQUEST").decompress(f.data);
  //         this.headers = { ...this.headers, ...got };
  //         if (f.flags.END_STREAM) {
  //           this.trailersGot = true;
  //           this.trailers = { ...this.trailers, ...got };
  //           this._resolveTrailers();
  //         }
  //       }
  //       if (f.type === "DATA") {
  //         this.dataFrame = f;
  //         this._resolveDataFrameWith(f);
  //       }

  //       //yield f;
  //     }
  //   }
  // }

  // _waitForDataFrame(): Promise<Uint8Array> {
  //   if (this.dataFrame) {
  //     return Promise.resolve(new Uint8Array(this.dataFrame.data.buffer));
  //   }
  //   return new Promise((resolve) => this.#dataFrameResolvers.push(resolve));
  // }

  // _waitForTrailers(): Promise<Headers> {
  //   if (this.trailersGot) {
  //     return Promise.resolve(this.trailers);
  //   }
  //   return new Promise((resolve) => this.#trailersResolvers.push(resolve));
  // }

  // _resolveDataFrameWith(frame: Frame) {
  //   const b = new Uint8Array(frame.data.buffer);
  //   for (const resolve of this.#dataFrameResolvers) {
  //     resolve(b);
  //   }
  //   this.#dataFrameResolvers = [];
  // }

  // _resolveTrailers() {
  //   for (const resolve of this.#trailersResolvers) {
  //     resolve(this.trailers);
  //   }
  //   this.#trailersResolvers = [];
  // }

  sendPrelude() {
    return this.conn.write(PRELUDE);
  }

  // sendSettings(flags: Record<string, boolean> = {}) {
  //   return this.sendFrame({
  //     type: "SETTINGS",
  //     settings: {},
  //     flags,
  //     stream: 0,
  //   });
  // }

  // sendHeaders(
  //   headers: Record<string, string>
  //   // flags: Record<string, boolean> = {}
  // ) {
  //   return this.sendFrame({
  //     type: "HEADERS",
  //     flags: { END_HEADERS: true },
  //     stream: this.#stream,
  //     data: new Compressor("RESPONSE").compress(headers),
  //     headers,
  //   });
  // }

  // sendData(data: Uint8Array) {
  //   return this.sendFrame({
  //     type: "DATA",
  //     data: data,
  //     stream: this.#stream,
  //   });
  // }

  // endData(data: Uint8Array) {
  //   return this.sendFrame({
  //     type: "DATA",
  //     flags: { END_STREAM: true },
  //     data: data,
  //     stream: this.#stream,
  //   });
  // }

  // sendTrailers(headers: Record<string, string>) {
  //   return this.sendFrame({
  //     type: "HEADERS",
  //     flags: { END_HEADERS: true, END_STREAM: true },
  //     stream: this.#stream,
  //     data: new Compressor("RESPONSE").compress(headers),
  //     headers,
  //   });
  // }

  // close() {
  //   try {
  //     // TODO: send some graceful close http frame here
  //     this.conn.close();
  //   } catch (err) {
  //     // TODO: log err
  //   }
  // }

  async sendFrame(frame: any) {
    for (const b of this.#s.encode(frame)) {
      try {
        await this.conn.write(b);
      } catch (err) {
        console.error("errrrrrr", err);
        console.log(frame);
      }
    }
  }
}
