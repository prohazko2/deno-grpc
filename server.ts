import { startsWith } from "https://deno.land/std@0.93.0/bytes/mod.ts";

import { Root, parse } from "./proto.ts";

import { Connection } from "./http2/conn.ts";
import { Status, error } from "./error.ts";
import { Serializer, Deserializer, Frame } from "./http2/frames.ts";
import { Compressor, Decompressor } from "./http2/hpack.ts";

import { hexdump } from "https://deno.land/x/prohazko@1.3.4/hex.ts";
import { Stream } from "./http2/stream.ts";
import { delay } from "https://deno.land/std@0.93.0/async/delay.ts";

const PRELUDE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

export class GrpcService<T = unknown> {
  root: Root;
  impl: T;

  constructor(_root: string | Root, impl: T) {
    this.root = _root as Root;
    if (typeof _root === "string") {
      this.root = parse(_root).root;
    }
    this.impl = impl;
  }
}

function waitFor<T>(stream: Stream, frameEvent: string): Promise<T> {
  return new Promise((resolve) => {
    stream.once(frameEvent, (x) => {
      resolve(x);
    });
  });
}

export class Http2Conn {
  s!: Serializer;
  d!: Deserializer;
  c!: Connection;

  hc!: Compressor;
  hd!: Decompressor;

  conn!: Deno.Conn;

  frames: Frame[] = [];

  flushTimer?: number;
  flushing = false;

  connecting?: Promise<void>;
  closed = false;

  constructor(_conn: Deno.Conn) {
    this.conn = _conn;

    this.s = new Serializer();
    this.d = new Deserializer("SERVER");
    this.c = new Connection(2, {});

    this.hc = new Compressor("RESPONSE");
    this.hd = new Decompressor("REQUEST");

    this.c.on("data", (f) => {
      console.log("conn frame", f);
      this.frames.push(f);
      this.flush();

      // //TODO: move to throttling
      // clearTimeout(this.flushTimer);
      // this.flushTimer = setTimeout(() => {
      //   this.flush();
      // }, 10);
    });
  }

  async flush() {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    console.log(`server flush with ${this.frames.length} frames`);

    while (this.frames.length) {
      const f = this.frames.shift();
      if (!f) {
        break;
      }
      await this.sendFrame(f);
    }

    this.flushing = false;
  }

  async sendFrame(frame: Frame) {
    console.log("sendFrame", frame);

    for (const b of this.s.encode(frame)) {
      if (!b.length) {
        //continue;
      }

      try {
        await this.conn.write(b);
      } catch (err) {
        console.error("errrrrrr", err);
        console.log(frame);
      }
    }
  }

  async readFrames() {
    for (;;) {
      let b = new Uint8Array(4096);
      let n: number | null = null;

      try {
        n = await this.conn.read(b);
      } catch (err) {
        console.error("readFrames err", err);
        // if (!this.closed) {

        // }
      }

      if (!n) {
        return;
      }

      if (startsWith(b, PRELUDE)) {
        b = b.slice(PRELUDE.length);
      }

      b = b.slice(0, n);

      console.log("recv: ");
      console.log(hexdump(b));

      for (const f of this.d.decode(b)) {
        if (f.type === "HEADERS") {
          f.headers = this.hd.decompress(f.data);
        }
        console.log("got frame", f);

        if (f.type === "DATA" && f.data.length === 0) {
          console.log("got stange frame which breaks connection", f);
          continue;
        }

        this.c._receive(f, () => {});
      }
    }
  }
}

export class GrpcServer {
  _services: GrpcService[] = [];

  addService<T>(_root: string | Root, impl: T) {
    const svc = new GrpcService(_root, impl);
    this._services.push(svc);
    return svc;
  }

  findImpl(serviceName: string, methodName: string) {
    for (const { impl, root } of this._services) {
      const handler = (impl as any)[methodName] as Function;
      if (!handler) {
        continue;
      }

      try {
        const svc = root.lookupService(serviceName);
        const method = svc.methods[methodName];

        return {
          root,
          svc,
          method,
          handler,
          streamed: !!method.responseStream,
          requestType: root.lookupType(method.requestType),
          responseType: root.lookupType(method.responseType),
        };
      } catch {}
    }
    return null;
  }

  async handle(_conn: Deno.Conn) {
    console.log("got new connection");

    const conn = new Http2Conn(_conn);

    conn.c.on("ACKNOWLEDGED_SETTINGS_HEADER_TABLE_SIZE", () => {
      console.log("ACKNOWLEDGED_SETTINGS_HEADER_TABLE_SIZE");
    });
    conn.c.on("RECEIVING_SETTINGS_HEADER_TABLE_SIZE", () => {
      console.log("RECEIVING_SETTINGS_HEADER_TABLE_SIZE");
    });

    conn.c.on("stream", async (stream: Stream) => {
      console.log("got stream", "xxx");

      // stream.on("data", (f) => {
      //   console.log("got stream level frame", f);
      // });

      const [headers, dataFrame] = await Promise.all([
        waitFor<Record<string, string>>(stream, "headers"),
        waitFor<Frame>(stream, "data_frame"),
      ]);

      await this.handleUnary(conn, stream, headers, dataFrame);

      // only way to reset broken connection
      conn.d._cursor = 0;

      // await delay(5000);
      // await conn.flush();
    });

    conn.readFrames().catch((err) => {
      console.log("grpc server handle readFrames err", err);
    });
  }

  async handleUnary(
    conn: Http2Conn,
    stream: Stream,
    headers: Record<string, string>,
    dataFrame: Frame
  ) {
    let [serviceName, methodName] = headers[":path"]
      .split("/")
      .filter((x) => !!x);
    if (serviceName.includes(".")) {
      serviceName = serviceName.split(".").reverse()[0];
    }
    const impl = this.findImpl(serviceName, methodName);
    if (!impl) {
      throw error(
        Status.UNIMPLEMENTED,
        `Method "${headers[":path"]}" not implemented`
      );
    }
    const { responseType, requestType, handler } = impl;

    const req = requestType.decode(dataFrame.data.slice(5));
    let result: any = {};

    try {
      result = await handler(req);
    } catch (err) {
      return this.sendError(stream, err);
    }

    const res = responseType.encode(result || {}).finish();
    const buf = new Uint8Array(5 + res.length);
    buf.set([0x00, 0x00, 0x00, 0x00, res.length]);
    buf.set(res, 5);

    const responseHeaders = {
      ":status": "200",
      "grpc-accept-encoding": "identity",
      "grpc-encoding": "identity",
      "content-type": "application/grpc+proto",
    };

    stream._pushUpstream({
      type: "HEADERS",
      flags: { END_HEADERS: true },
      stream: stream.id,
      data: conn.hc.compress(responseHeaders),
      headers: responseHeaders,
    } as any);

    stream.write(buf);

    const trailers = {
      "grpc-status": "0",
      "grpc-message": "OK",
    };

    stream.sentEndStream = true;
    stream._pushUpstream({
      type: "HEADERS",
      flags: { END_HEADERS: true, END_STREAM: true },
      stream: stream.id,
      data: conn.hc.compress(trailers),
      headers: trailers,
    } as any);

    stream.end();
  }

  sendError(stream: Stream, _err: Error) {
    const err = error(Status.UNKNOWN, _err.toString());
    stream.trailers({
      "grpc-status": err.grpcCode.toString(),
      "grpc-message": err.grpcMessage,
    });
    stream.end();
  }
}
