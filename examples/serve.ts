import { GrpcService } from "../serve.ts";
import { Greeter } from "./greeter.d.ts";

const text = await Deno.readTextFile("./examples/greeter.proto");

const port = 15070;

const svc = new GrpcService<Greeter>(text, {
  SayHello({ name }) {
    const message = `hello ${name || "stranger"}`;
    return { message };
  },
});

console.log(`gonna listen on ${port} port`);
for await (const conn of Deno.listen({ port })) {
  await svc.handleUnary(conn);
}
