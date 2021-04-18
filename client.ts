import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse, Root } from "./proto.ts";

import { Http2Conn } from "./http2/conn.ts";

export class GrpcClient {
  def: Root;
  conn: Http2Conn;

  constructor(_def: string | Root, conn: Deno.Conn) {
    this.def = _def as Root;
    if (typeof _def === "string") {
      this.def = parse(_def).root;
    }
    this.conn = new Http2Conn(conn, "CLIENT");
  }
}

export function getClient<T>(
  _def: string | Root,
  conn: Deno.Conn
): GrpcClient & T {
  const client = new GrpcClient(_def, conn);
  return client as GrpcClient & T;
}
