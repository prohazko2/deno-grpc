import { hexdump } from "https://deno.land/x/prohazko@1.3.3/hex.ts";
import { parse } from "./proto.ts";

import { Http2Request } from "./http2.ts";

const text = await Deno.readTextFile("./_/test.proto");
console.log(text);

const { root } = parse(text);

const Req = root.lookupType("HelloRequest");
const Res = root.lookupType("HelloReply");

export class GrpcService<T> {
  constructor(private impl: T) {}

  async handleUnary(conn: Deno.Conn) {
    const _req = new Http2Request(conn);
    _req._readToCompletion();

    const data = await _req._waitForDataFrame();

    const req = (Req.decode(data.slice(5)) as any) as { name: string };
    console.log(req);

    const res = Res.encode({
      message: `hello ${req.name || "stanger"}`,
    }).finish();

    const out = new Uint8Array(5 + res.length);
    out.set([0x00, 0x00, 0x00, 0x00, res.length]);
    out.set(res, 5);
    console.log(hexdump(out));

    await _req.sendSettings();

    await _req.sendSettings({ ACK: true });

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
