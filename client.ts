import { Method, parse, Root, Service } from "./proto.ts";

import { Connection } from "./http2/conn.ts";

import { Status, GrpcError } from "./error.ts";
import { Serializer, Deserializer, Frame } from "./http2/frames.ts";
import { Compressor, Decompressor } from "./http2/hpack.ts";

import { Stream } from "./http2/stream.ts";

const PRELUDE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

export type ClientInitOptions = Deno.ConnectOptions & {
  root: string | Root;
  serviceName: string;
};

function waitForFrame(stream: Stream, frameEvent: string): Promise<Frame> {
  return new Promise((resolve) => {
    stream.once(frameEvent, (x) => {
      resolve(x);
    });
  });
}

function raiseErrorFrom(headers: Record<string, string>) {
  let textStatus = Status[+headers["grpc-status"]];

  const message = decodeURIComponent(headers["grpc-message"]);
  if (!textStatus) {
    textStatus = Status[Status.UNKNOWN];
  }
  const err = new GrpcError(`${textStatus}: ${message}`);
  err.grpcCode = +headers["grpc-status"];
  err.grpcMessage = message;
  return err;
}

class NodeStreamReader {
  frames: Frame[] = [];
  resolvers: ((f: Frame) => void)[] = [];

  constructor(stream: Stream) {
    stream.on("data_frame", (f: Frame) => {
      this.frames.push(f);
      this._resolveFrame(f);
    });
    stream.on("trailers", (f: Frame) => {
      this.frames.push(f);
      this._resolveFrame(f);
    });
  }

  _resolveFrame(frame: Frame) {
    for (const resolve of this.resolvers) {
      resolve(frame);
    }
    this.resolvers = [];
  }

  _waitForFrame(): Promise<Frame> {
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  async *next(): AsyncGenerator<Frame> {
    while (true) {
      let f0 = this.frames.shift();
      if (!f0) {
        f0 = await this._waitForFrame();
      }

      yield f0;

      while (this.frames.length) {
        const f1 = this.frames.shift();

        if (f1 !== f0) {
          yield f1!;
        }
      }
    }
  }
}

export interface GrpcClient {
  close(): void;

  //_callUnary<Req, Res>(name: string, req: Req): Promise<Res>;
  //_callStream<Req, Res>(name: string, req: Req): AsyncGenerator<Res>;
}

export class GrpcClientImpl implements GrpcClient {
  serviceName: string;
  root: Root;
  svc: Service;

  s: Serializer = null!;
  d: Deserializer = null!;
  c: Connection = null!;

  hc: Compressor = null!;
  hd: Decompressor = null!;

  conn: Deno.Conn = null!;

  frames: Frame[] = [];

  flushTimer?: number;
  flushing = false;

  connecting?: Promise<void>;
  closed = false;

  constructor(private options: ClientInitOptions) {
    const { root, serviceName } = options;

    this.root = root as Root;
    if (typeof root === "string") {
      this.root = parse(root).root;
    }

    this.serviceName = serviceName;
    this.svc = this.root.lookupService(serviceName);

    this.s = new Serializer();
    this.d = new Deserializer("CLIENT");
    this.c = new Connection(1, {});

    this.hc = new Compressor("REQUEST");
    this.hd = new Decompressor("RESPONSE");

    this.c.on("data", (f) => {
      this.frames.push(f);

      //TODO: move to throttling
      clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, 10);
    });
  }

  getAuthority() {
    const { hostname, port } = this.conn.remoteAddr as Deno.NetAddr;
    return `${hostname}:${port}`;
  }

  getDefaultHeaders() {
    return {
      "content-type": "application/grpc",
      "accept-encoding": "identity",
      "grpc-accept-encoding": "identity",
      te: "trailers",
      ":scheme": "http",
      ":method": "POST",
      ":authority": this.getAuthority(),
    };
  }

  async flush() {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    await this.ensureConnection();

    while (this.frames.length) {
      const f = this.frames.shift();
      if (!f) {
        break;
      }
      await this.sendFrame(f);
    }

    this.flushing = false;
  }

  sendPrelude() {
    return this.conn.write(PRELUDE);
  }

  async sendFrame(frame: Frame) {
    if (this.closed) {
      return;
    }
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

  ensureConnection() {
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this._ensureConnection();
    return this.connecting;
  }

  async _ensureConnection() {
    if (this.conn) {
      return;
    }
    this.conn = await Deno.connect(this.options);
    await this.sendPrelude();

    this.readFrames();
  }

  async readFrames() {
    for (;;) {
      let b = new Uint8Array(4096);
      let n: number | null = null;

      try {
        n = await this.conn.read(b);
      } catch (err) {
        if (!this.closed) {
          console.error("readFrames err", err);
        }
      }

      if (!n) {
        return;
      }

      b = b.slice(0, n);

      for (const f of this.d.decode(b)) {
        if (f.type === "HEADERS") {
          f.headers = this.hd.decompress(f.data);
        }

        this.c._write(f, "", () => {});
      }
    }
  }

  close() {
    this.conn.close();
    this.conn = null!;
    this.closed = true;
  }

  async _callUnary<Req, Res>(name: string, req: Req): Promise<Res> {
    await this.ensureConnection();

    // TODO: throw error here on not found
    const method = this.svc.methods[name];

    let serviceName = this.svc.fullName;
    if (serviceName.startsWith(".")) {
      serviceName = serviceName.replace(".", "");
    }
    const path = `/${serviceName}/${method.name}`;

    const headers = {
      ...this.getDefaultHeaders(),
      ":path": path,
    };

    const stream = this.c.createStream();

    stream._pushUpstream({
      type: "HEADERS",
      flags: { END_HEADERS: true },
      stream: stream.id,
      data: this.hc.compress(headers),
      headers,
    });

    const reqBytes = this.root
      .lookupType(method.requestType)
      .encode(req)
      .finish();

    const dataBytes = new Uint8Array(5 + reqBytes.length);
    dataBytes.set([0x00, 0x00, 0x00, 0x00, reqBytes.length]);
    dataBytes.set(reqBytes, 5);

    stream.write(dataBytes);
    stream.end();

    // TODO: check for event leaks
    const frame = await Promise.race([
      waitForFrame(stream, "trailers"),
      waitForFrame(stream, "data_frame"),
    ]);

    if (frame.type === "DATA") {
      const res = this.root
        .lookupType(method.responseType)
        .decode(frame.data.slice(5)) as unknown as Res;

      return res;
    }

    if (frame.type === "HEADERS" && frame.flags.END_STREAM) {
      const err = raiseErrorFrom(frame.headers);
      throw err;
    }

    throw new Error("not expected");
  }

  async *_callStream<Req, Res>(name: string, req: Req): AsyncGenerator<Res> {
    await this.ensureConnection();

    // TODO: throw error here on not found
    const method = this.svc.methods[name];

    let serviceName = this.svc.fullName;
    if (serviceName.startsWith(".")) {
      serviceName = serviceName.replace(".", "");
    }
    const path = `/${serviceName}/${method.name}`;

    const headers = {
      ...this.getDefaultHeaders(),
      ":path": path,
    };

    const stream = this.c.createStream();

    stream._pushUpstream({
      type: "HEADERS",
      flags: { END_HEADERS: true },
      stream: stream.id,
      data: this.hc.compress(headers),
      headers,
    });

    const reqBytes = this.root
      .lookupType(method.requestType)
      .encode(req)
      .finish();

    const dataBytes = new Uint8Array(5 + reqBytes.length);
    dataBytes.set([0x00, 0x00, 0x00, 0x00, reqBytes.length]);
    dataBytes.set(reqBytes, 5);

    stream.write(dataBytes);
    stream.end();

    // TODO: there must be better way
    const reader = new NodeStreamReader(stream);
    for await (const frame of reader.next()) {
      if (frame.type === "DATA") {
        const res = this.root
          .lookupType(method.responseType)
          .decode(frame.data.slice(5)) as unknown as Res;

        yield res;
      }

      if (frame.type === "HEADERS" && frame.flags.END_STREAM) {
        const err = raiseErrorFrom(frame.headers);
        if (err.grpcCode === Status.OK) {
          return;
        }
        throw err;
      }
    }
  }
}

export function getClient<T = any>(options: ClientInitOptions): GrpcClient & T {
  const client = new GrpcClientImpl(options) as any;

  for (const name of Object.keys(client.svc.methods)) {
    const m = client.svc.methods[name] as Method;

    if (m.responseStream) {
      client[name] = (req: unknown) => client._callStream(name, req);
    } else {
      client[name] = (req: unknown) => client._callUnary(name, req);
    }
  }

  return client as GrpcClient & T;
}
