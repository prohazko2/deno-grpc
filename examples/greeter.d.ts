export interface Greeter {
  SayHello(request: HelloRequest): Promise<HelloReply>;
  ShoutHello(request: HelloRequest): AsyncGenerator<HelloReply, void, unknown>;
}

export interface HelloRequest {
  name?: string;
}

export interface HelloReply {
  message?: string;
  time?: string;
}
