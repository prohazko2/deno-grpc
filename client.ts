import { parse, Root, Service } from "./proto.ts";

import { Connection } from "./http2/conn.ts";

import { Status, GrpcError } from "./error.ts";
import { Serializer, Deserializer, Frame } from "./http2/frames.ts";
import { Compressor, Decompressor } from "./http2/hpack.ts";

import { hexdump } from "https://deno.land/x/prohazko@1.3.4/hex.ts";

const PRELUDE = new TextEncoder().encode("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

export type ClientInitOptions = Deno.ConnectOptions & {
  root: string | Root;
  serviceName: string;
};

export class GrpcClient {
  serviceName: string;
  root: Root;
  svc: Service;

  s: Serializer = null!;
  d: Deserializer = null!;
  c: Connection = null!;

  conn: Deno.Conn = null!;

  frames: Frame[] = [];

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

    this.c.on("data", (f) => {
      console.log("http2 frame", JSON.stringify(f));
      this.frames.push(f);
    });
  }

  getAuthority() {
    const { hostname, port } = this.conn!.remoteAddr as Deno.NetAddr;
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

  async drain() {
    console.log(`draining with frames: ${this.frames.length}`);

    while (this.frames.length) {
      const f = this.frames.shift();
      if (!f) {
        break;
      }
      await this.sendFrame(f);
    }

    console.log("done draining");
  }

  sendPrelude() {
    return this.conn.write(PRELUDE);
  }

  async sendFrame(frame: Frame) {
    console.log("sendFrame", frame);

    for (const b of this.s.encode(frame)) {
      if (!b.length) {
        //continue;
      }

      try {
        //console.log("   send:");
        //console.log(hexdump(b));
        await this.conn!.write(b);
      } catch (err) {
        console.error("errrrrrr", err);
        console.log(frame);
      }
    }
  }

  async ensureConnection() {
    if (this.conn) {
      return;
    }
    this.conn = await Deno.connect(this.options);
    await this.sendPrelude();
  }

  async *readFrames() {
    for (;;) {
      let b = new Uint8Array(4096);
      let n: number | null = null;

      try {
        n = await this.conn.read(b);
      } catch (err) {
        console.error("__readToCompletion err", err);
      }

      if (!n) {
        console.log("no resp");
        Deno.exit(0);
      }

      b = b.slice(0, n);

      console.log("got", hexdump(b));

      for (const f of this.d.decode(b)) {
        console.log("gotFrame", f);

        if (f.type === "HEADERS") {
          f.headers = new Decompressor("REQUEST").decompress(f.data);
        }

        yield f;

        this.c._receive(f, () => {});
      }

      await this.drain();
    }
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
      data: new Compressor("RESPONSE").compress(headers),
      headers,
    } as any);

    const reqBytes = this.root
      .lookupType(method.requestType)
      .encode(req)
      .finish();

    const dataBytes = new Uint8Array(5 + reqBytes.length);
    dataBytes.set([0x00, 0x00, 0x00, 0x00, reqBytes.length]);
    dataBytes.set(reqBytes, 5);

    stream._pushUpstream({
      type: "DATA",
      flags: { END_STREAM: true },
      data: dataBytes,
      stream: stream.id,
    } as any);

    await this.drain();

    for await (const frame of this.readFrames()) {
      console.log("xxx frame", frame);

      if (frame.type === "DATA") {
        const res = this.root
          .lookupType(method.responseType)
          .decode(frame.data.slice(5)) as unknown as Res;

        return res;
      }

      if (frame.type === "HEADERS" && frame.flags.END_STREAM) {
        let textStatus = Status[+frame.headers["grpc-status"]];
        const message = decodeURIComponent(frame.headers["grpc-message"]);
        if (!textStatus) {
          textStatus = Status[Status.UNKNOWN];
        }
        const err = new GrpcError(`${textStatus}: ${message}`);
        err.grpcCode = +frame.headers["grpc-status"];
        err.grpcMessage = message;

        throw err;
      }
    }

    throw new Error("not expected");
  }
}

export function getClient<T>(options: ClientInitOptions): GrpcClient & T {
  const client = new GrpcClient(options) as any;

  for (const methodName of Object.keys(client.svc.methods)) {
    client[methodName] = (req: unknown) => client._callUnary(methodName, req);
  }

  return client as GrpcClient & T;
}
