import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse, Root, Service } from "./proto.ts";

import { Http2Conn } from "./http2/conn.ts";

export class GrpcCall {}

export class GrpcClient {
  #denoConn: Deno.Conn;

  serviceName: string;
  root: Root;
  conn: Http2Conn;
  svc: Service;

  state = "?";

  constructor(conn: Deno.Conn, _def: string | Root, serviceName: string) {
    this.#denoConn = conn;

    this.root = _def as Root;
    if (typeof _def === "string") {
      this.root = parse(_def).root;
    }
    this.serviceName = serviceName;
    this.svc = this.root.lookupService(serviceName);
    this.conn = new Http2Conn(conn, "CLIENT");
  }

  async ensureConn() {
    if (this.state === "ok") {
      return;
    }
    this.state = "init";
    this.conn._readToCompletion();

    await this.conn.sendPrelude();
    await this.conn.sendSettings();

    this.state = "ok";
  }

  getAuthority() {
    const { hostname, port } = this.#denoConn.remoteAddr as Deno.NetAddr;
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
      //":path": "/ric.echo.Greeter/SayHello",
    };
  }

  async _callMethod<Req, Res>(name: string, req: Req): Promise<Res> {
    // TODO: throw error here on not found

    const method = this.svc.methods[name];
    const path = `/${this.svc.fullName.replace(".", "")}/${method.name}`;

    const headers = {
      ...this.getDefaultHeaders(),
      ":path": path,
    };

    await this.ensureConn();

    await this.conn.sendHeaders(headers);

    const reqBytes = this.root
      .lookupType(method.requestType)
      .encode(req)
      .finish();

    const dataBytes = new Uint8Array(5 + reqBytes.length);
    dataBytes.set([0x00, 0x00, 0x00, 0x00, reqBytes.length]);
    dataBytes.set(reqBytes, 5);

    await this.conn.endData(dataBytes);

    const respBytes = await this.conn._waitForDataFrame();

    const res = (this.root
      .lookupType(method.responseType)
      .decode(respBytes.slice(5)) as any) as Res;

    return res;
  }

  close() {
    this.conn.close();
  }
}

export function getClient<T>(
  conn: Deno.Conn,
  _def: string | Root,
  serviceName: string
): GrpcClient & T {
  const client = new GrpcClient(conn, _def, serviceName);
  return client as GrpcClient & T;
}
