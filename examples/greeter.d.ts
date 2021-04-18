export interface Greeter {
  SayHello(request: HelloRequest): HelloReply | Promise<HelloReply>;
}

export interface HelloRequest {
  name?: string;
}

export interface HelloReply {
  message?: string;
  time?: string;
}
