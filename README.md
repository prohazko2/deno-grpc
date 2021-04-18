# `/x/grpc_basic`

You probably should wait for more mature and standard aligned implementation.  
I couldn't wait no more, so i made this.

## goals - keep it simple

- [x] load proto files
- [x] `server` unary calls
- [ ] `client` unary calls
- [ ] errors
- [ ] `server` server streams
- [ ] `client` server streams
- [ ] context deadlines
- [ ] calls metadata

## todo
- [ ] remove all deno/node compatibility (Buffer, stream.Transform, etc)
- [ ] read more about http2 settings frame

## maybe goals

- [ ] `*.d.ts` client/service codegen
- [ ] builtin retries

## non goals - gRPC bloat

- [x] no TLS
- [x] no client streams
- [x] no bidirectional streams
- [x] no load balancers
- [x] no interceptors (revisit this later)
