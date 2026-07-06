import { Module } from "@nestjs/common";
import { HandshakeModule } from "@jayalfredprufrock/handshake/nestjs";
import { api } from "@jayalfredprufrock/handshake-example-contract";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [HandshakeModule.forRoot({ apis: [api] })],
  controllers: [UserController],
  providers: [UserService],
})
export class AppModule {}
