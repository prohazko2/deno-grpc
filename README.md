# deno-grpc

You probably should wait for more mature and standard aligned implementation.  
I couldn't wait no more, so i made this.

## goals - keep it simple

- [x] load proto files
- [ ] `server` unary calls
- [ ] `client` unary calls
- [ ] errors (figure out how to send http2 trailers)
- [ ] `server` server streams
- [ ] `client` server streams
- [ ] context deadlines

## maybe goals

- [ ] calls metadata
- [ ] builtin retries

## non goals - gRPC bloat

- [x] codegen (there is already better tools anyway)
- [x] no TLS
- [x] no client streams
- [x] no bidirectional streams
- [x] no load balancers
- [x] no interceptors (revisit this later)
