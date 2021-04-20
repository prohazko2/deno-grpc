# `/x/grpc_basic`

You probably should wait for more mature and standard aligned implementation beacuse:
 1. This lib doesn't use Deno's 1.9 HTTP/2 native bindings, but relies on JS implementation roughly ported from [node-http2](https://github.com/molnarg/node-http2)
 2. I'm not an expert in gRPC or HTTP/2, I just moved HTTP/2 frames around until it worked 
 3. It was never meant for production use, only for fun and some integration tests and scripts
 4. I have no plans on implementing full gRPC spec 

### goals - keep it simple

- [x] load proto files
- [x] `server` unary calls
- [x] `client` unary calls
- [ ] errors
- [ ] `server` server streams
- [ ] `client` server streams
- [ ] context deadlines
- [ ] calls metadata
- [ ] logging

### todo
- [ ] remove all deno/node compatibility (Buffer, stream.Transform, etc)
- [ ] acquire more knowledge about http2 frames

### maybe goals

- [ ] `*.d.ts` client/service codegen
- [ ] builtin retries

### non goals - gRPC bloat

- [x] no TLS
- [x] no client streams
- [x] no bidirectional streams
- [x] no load balancers
- [x] no interceptors (revisit this later)


## hello world

### `greeter.proto`

```proto
syntax = "proto3";

package prohazko;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply) {}
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
  string time = 2;
}
```

### `greeter.d.ts` (generated (maybe))
```ts
export interface Greeter {
  SayHello(request: HelloRequest): Promise<HelloReply>;
}

export interface HelloRequest {
  name?: string;
}

export interface HelloReply {
  message?: string;
  time?: string;
}
```

### `server.ts`

```ts
import { GrpcService } from "https://deno.land/x/grpc_basic@0.2.7/server.ts";
import { Greeter } from "./greeter.d.ts";

const port = 15070;
const root = await Deno.readTextFile("./greeter.proto");

const svc = new GrpcService<Greeter>(root, {
  async SayHello({ name }) {
    const message = `hello ${name || "world"}`;
    return { message, time: new Date().toISOString() };
  },
});

console.log(`gonna listen on ${port} port`);
for await (const conn of Deno.listen({ port })) {
  await svc.handle(conn);
}
```

### `client.ts`

```ts
import { getClient } from "https://deno.land/x/grpc_basic@0.2.7/client.ts";
import { Greeter } from "./greeter.d.ts";

const client = getClient<Greeter>({
  port: 15070,
  root: await Deno.readTextFile("./greeter.proto"),
  serviceName: "Greeter",
});

const resp = await client.SayHello({ name: "oleg" });
console.log(resp);

client.close();
```