import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse, Root, Service } from "./proto.ts";

import { Http2Conn } from "./http2/conn.ts";

export type ClientInitOptions = Deno.ConnectOptions & {
  root: string | Root;
  serviceName: string;
};

export class GrpcClient {
  conn: Deno.Conn = null!;
  http2: Http2Conn = null!;

  serviceName: string;
  root: Root;
  svc: Service;

  state = "?";

  constructor(private options: ClientInitOptions) {
    const { root, serviceName } = options;

    this.root = root as Root;
    if (typeof root === "string") {
      this.root = parse(root).root;
    }
    this.serviceName = serviceName;
    this.svc = this.root.lookupService(serviceName);
  }

  async ensureConn() {
    if (this.state === "ok") {
      return;
    }
    this.conn = await Deno.connect(this.options);
    this.http2 = new Http2Conn(this.conn, "CLIENT");

    this.state = "init";
    this.http2._readToCompletion().catch((err) => {
      console.log(err);
    });

    await this.http2.sendPrelude();
    await this.http2.sendSettings();

    this.state = "ok";
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

  async _callMethod<Req, Res>(name: string, req: Req): Promise<Res> {
    await this.ensureConn();

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

    await this.http2.sendHeaders(headers);

    const reqBytes = this.root
      .lookupType(method.requestType)
      .encode(req)
      .finish();

    const dataBytes = new Uint8Array(5 + reqBytes.length);
    dataBytes.set([0x00, 0x00, 0x00, 0x00, reqBytes.length]);
    dataBytes.set(reqBytes, 5);

    await this.http2.endData(dataBytes);

    const respBytes = await this.http2._waitForDataFrame();

    const res = (this.root
      .lookupType(method.responseType)
      .decode(respBytes.slice(5)) as any) as Res;

    return res;
  }

  close() {
    this.http2.close();
    this.state = "?";
  }
}

export function getClient<T>(options: ClientInitOptions): GrpcClient & T {
  const client = new GrpcClient(options);

  Object.keys(client.svc.methods).forEach((methodName) => {
    (client as any)[methodName] = (req: any) =>
      client._callMethod(methodName, req);
  });

  return client as GrpcClient & T;
}
