import { Connection } from "./http2/conn.ts";
import { Http2Conn } from "./http2/wrap.ts";

import { delay } from "https://deno.land/std@0.95.0/async/delay.ts";
import { Frame } from "./http2/frames.ts";
import { Compressor } from "./http2/hpack.ts";
import { hexdump } from "https://deno.land/x/prohazko@1.3.4/hex.ts";

const conn = await Deno.connect({
  port: 15070,
});

const http2 = new Http2Conn(conn, "CLIENT");

const frames: Frame[] = [];

http2.c.on("data", (x) => {
  frames.push(x);

  console.log("http2 frame", JSON.stringify(x));
});

async function drain() {
  console.log(`draining with frames: ${frames.length}`);

  while (frames.length) {
    const f = frames.shift();
    if (!f) {
      break;
    }
    await http2.sendFrame(f);
  }

  console.log("done draining");
}

await http2.sendPrelude();

const headers = {
  "content-type": "application/grpc",
  "accept-encoding": "identity",
  "grpc-accept-encoding": "identity",
  te: "trailers",
  ":scheme": "http",
  ":method": "POST",
  ":authority": "localhost",
  ":path": "/ric.echo.Greeter/SayHello",
};

const data = Uint8Array.from(
  "00 00 00 00 06 0a 04 6f 6c 65 67".split(" ").map((x) => parseInt(x, 16))
);

const s = http2.c.createStream();

s._pushUpstream({
  type: "HEADERS",
  flags: { END_HEADERS: true },
  stream: s.id,
  data: new Compressor("RESPONSE").compress(headers),
  headers,
} as any);

s._pushUpstream({
  type: "DATA",
  flags: { END_STREAM: true },
  data: data,
  stream: s.id,
} as any);

await drain();

for (;;) {
  let b = new Uint8Array(4096);
  let n: number | null = null;

  try {
    n = await http2.conn.read(b);
  } catch (err) {
    console.error("__readToCompletion err", err);
  }

  if (!n) {
    console.log("no resp");
    Deno.exit(0);
  }

  b = b.slice(0, n);

  console.log("got", hexdump(b));

  for (const f of http2.d.decode(b)) {
    console.log("gotFrame", f);

    http2.c._receive(f, () => {});
  }

  await drain();
}
