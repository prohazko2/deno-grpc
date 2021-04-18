import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { Root, parse } from "./proto.ts";

import { Http2Conn } from "./http2/conn.ts";

export class GrpcService<T> {
  def: Root;
  impl: T;

  constructor(_def: string | Root, impl: T) {
    this.def = _def as Root;
    if (typeof _def === "string") {
      this.def = parse(_def).root;
    }

    this.impl = impl;
  }

  async handleUnary(conn: Deno.Conn) {
    const _req = new Http2Conn(conn, "SERVER");
    _req._readToCompletion();

    await _req.sendSettings();
    await _req.sendSettings({ ACK: true });

    const data = await _req._waitForDataFrame();

    let [serviceName, methodName] = _req.headers[":path"]
      .split("/")
      .filter((x) => !!x);

    if (serviceName.includes(".")) {
      serviceName = serviceName.split(".").reverse()[0];
    }

    const service = this.def.lookupService(serviceName);
    const method = service.methods[methodName];

    const Req = this.def.lookupType(method.requestType);
    const Res = this.def.lookupType(method.responseType);

    const req = Req.decode(data.slice(5)) as any;
    console.log(`body: `, req);

    const result = await (this.impl as any)[methodName](req);

    const res = Res.encode(result).finish();

    const out = new Uint8Array(5 + res.length);
    out.set([0x00, 0x00, 0x00, 0x00, res.length]);
    out.set(res, 5);
    //console.log(hexdump(out));

    await _req.sendHeaders({
      ":status": "200",
      "grpc-accept-encoding": "identity",
      "grpc-encoding": "identity",
      "content-type": "application/grpc+proto",
    });

    await _req.sendData(out);

    await _req.sendTrailers({
      "grpc-status": "0",
      "grpc-message": "OK",
    });
  }
}
