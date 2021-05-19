import { startsWith } from "https://deno.land/std@0.93.0/bytes/mod.ts";

import { Root, parse, Type } from "./proto.ts";

import { Connection } from "./http2/conn.ts";
import { Status, error } from "./error.ts";
import { Serializer, Deserializer, Frame } from "./http2/frames.ts";
import { Compressor, Decompressor } from "./http2/hpack.ts";

import { Stream } from "./http2/stream.ts";

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

function encodeResult<T>(type: Type, v: T) {
  const res = type.encode(v || {}).finish();
  const buf = new Uint8Array(5 + res.length);
  buf.set([0x00, 0x00, 0x00, 0x00, res.length]);
  buf.set(res, 5);
  return buf;
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
      this.frames.push(f);
      this.flush();

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
    //console.log(`server flush with ${this.frames.length} frames`);

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
    //console.log("sendFrame", frame);

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
      }

      if (!n) {
        return;
      }

      b = b.slice(0, n);

      if (startsWith(b, PRELUDE)) {
        b = b.slice(PRELUDE.length);
      }

      for (const f of this.d.decode(b)) {
        if (f.type === "HEADERS") {
          f.headers = this.hd.decompress(f.data);
        }
        this.c._write(f, "", () => {});
      }
    }
  }
}

export class GrpcServer {
  _services: GrpcService[] = [];

  addService<T = any>(_root: string | Root, impl: T) {
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
    //console.log("got new connection");

    const conn = new Http2Conn(_conn);

    conn.c.on("stream", async (stream: Stream) => {
      //console.log("got stream", stream.id);

      const [headers, dataFrame] = await Promise.all([
        waitFor<Record<string, string>>(stream, "headers"),
        waitFor<Frame>(stream, "data_frame"),
      ]);

      await this.handleUnary(conn, stream, headers, dataFrame);

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
    const { responseType, requestType, handler, streamed } = impl;

    const req = requestType.decode(dataFrame.data.slice(5));
    let result: any = {};

    try {
      result = await handler(req);
    } catch (err) {
      return this.sendError(conn, stream, err);
    }

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
    });

    if (streamed) {
      result = result as AsyncGenerator;

      try {
        for await (const r of result) {
          stream.write(encodeResult(responseType, r));
        }
      } catch (err) {
        return this.sendError(conn, stream, err);
      }
    } else {
      stream.write(encodeResult(responseType, result));
    }

    this.sendTrailers(conn, stream, {
      "grpc-status": "0",
      "grpc-message": "OK",
    });
  }

  sendTrailers(
    conn: Http2Conn,
    stream: Stream,
    trailers: Record<string, string>
  ) {
    try {
      stream.sentEndStream = true;
      stream._pushUpstream({
        type: "HEADERS",
        flags: { END_HEADERS: true, END_STREAM: true },
        stream: stream.id,
        data: conn.hc.compress(trailers),
        headers: trailers,
      });
      stream.end();
    } catch (err) {
      console.error(err);
    }
  }

  sendError(conn: Http2Conn, stream: Stream, _err: Error) {
    const err = error(Status.UNKNOWN, _err.toString());
    this.sendTrailers(conn, stream, {
      "grpc-status": err.grpcCode.toString(),
      "grpc-message": err.grpcMessage,
    });
  }
}
