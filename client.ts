const port = 4500;

const c = await Deno.connectTls({
  port,
  hostname: "localhost",
  certFile: "./cert/cert.pem",
});

console.log(c);
