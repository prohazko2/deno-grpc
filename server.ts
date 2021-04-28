import { Root, parse } from "./proto.ts";

import { Http2Conn } from "./http2/conn.ts";
import { Status, error } from "./error.ts";

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
    const conn = new Http2Conn(_conn, "SERVER");
    conn._readToCompletion().catch((err) => {
      console.error(err);
      conn.close();
    });

    await conn.sendSettings();
    await conn.sendSettings({ ACK: true });

    const data = await conn._waitForDataFrame();

    let [serviceName, methodName] = conn.headers[":path"]
      .split("/")
      .filter((x) => !!x);

    if (serviceName.includes(".")) {
      serviceName = serviceName.split(".").reverse()[0];
    }

    const impl = this.findImpl(serviceName, methodName);
    if (!impl) {
      throw error(
        Status.UNIMPLEMENTED,
        `Method "${conn.headers[":path"]}" not implemented`
      );
    }
    const { responseType, requestType, handler } = impl;

    const req = requestType.decode(data.slice(5));

    let result: any = {};
    try {
      result = await handler(req);
    } catch (err) {
      return this.sendError(conn, err);
    }

    const res = responseType.encode(result || {}).finish();

    const buf = new Uint8Array(5 + res.length);
    buf.set([0x00, 0x00, 0x00, 0x00, res.length]);
    buf.set(res, 5);

    await conn.sendHeaders({
      ":status": "200",
      "grpc-accept-encoding": "identity",
      "grpc-encoding": "identity",
      "content-type": "application/grpc+proto",
    });

    await conn.sendData(buf);

    await conn.sendTrailers({
      "grpc-status": "0",
      "grpc-message": "OK",
    });
  }

  sendError(_req: Http2Conn, _err: Error) {
    const err = error(Status.UNKNOWN, _err.toString());

    return _req.sendTrailers({
      "grpc-status": err.grpcCode.toString(),
      "grpc-message": err.grpcMessage,
    });
  }
}
