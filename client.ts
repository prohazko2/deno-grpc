import { parse, Root, Service } from "./proto.ts";

import { Http2Conn } from "./http2/conn.ts";

import { Status, GrpcError } from "./error.ts";

export type ClientInitOptions = Deno.ConnectOptions & {
  root: string | Root;
  serviceName: string;
};

class CallUnary {
  state = "?";

  conn: Deno.Conn = null!;
  http2: Http2Conn = null!;

  constructor(private options: ClientInitOptions) {}

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

  close() {
    this.http2.close();
    this.state = "?";
  }
}

export class GrpcClient {
  serviceName: string;
  root: Root;
  svc: Service;

  constructor(private options: ClientInitOptions) {
    const { root, serviceName } = options;

    this.root = root as Root;
    if (typeof root === "string") {
      this.root = parse(root).root;
    }
    this.serviceName = serviceName;
    this.svc = this.root.lookupService(serviceName);
  }

  async _callUnary<Req, Res>(name: string, req: Req): Promise<Res> {
    const call = new CallUnary(this.options);
    await call.ensureConn();

    // TODO: throw error here on not found
    const method = this.svc.methods[name];

    let serviceName = this.svc.fullName;
    if (serviceName.startsWith(".")) {
      serviceName = serviceName.replace(".", "");
    }
    const path = `/${serviceName}/${method.name}`;

    const headers = {
      ...call.getDefaultHeaders(),
      ":path": path,
    };

    await call.http2.sendHeaders(headers);

    const reqBytes = this.root
      .lookupType(method.requestType)
      .encode(req)
      .finish();

    const dataBytes = new Uint8Array(5 + reqBytes.length);
    dataBytes.set([0x00, 0x00, 0x00, 0x00, reqBytes.length]);
    dataBytes.set(reqBytes, 5);

    await call.http2.endData(dataBytes);

    const resp = await Promise.race([
      call.http2._waitForTrailers(),
      call.http2._waitForDataFrame(),
    ]);

    call.close();

    if (resp instanceof Uint8Array) {
      const res = (this.root
        .lookupType(method.responseType)
        .decode(resp.slice(5)) as unknown) as Res;

      return res;
    }

    let textStatus = Status[+resp["grpc-status"]];
    const message = decodeURIComponent(resp["grpc-message"]);

    if (!textStatus) {
      textStatus = Status[Status.UNKNOWN];
    }

    const err = new GrpcError(`${textStatus}: ${message}`);
    err.grpcCode = +resp["grpc-status"];
    err.grpcMessage = message;

    throw err;
  }
}

export function getClient<T>(options: ClientInitOptions): GrpcClient & T {
  const client = new GrpcClient(options) as any;

  for (const methodName of Object.keys(client.svc.methods)) {
    client[methodName] = (req: unknown) => client._callUnary(methodName, req);
  }

  return client as GrpcClient & T;
}
