const port = 4500;

const pem = await Deno.readTextFile("./cert/cert.pem");

const client = Deno.createHttpClient({ caData: pem });
const req = await fetch(`https://localhost:${port}/test`, { client });

console.log(req);
