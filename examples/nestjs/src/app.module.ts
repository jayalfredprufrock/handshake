import { Module } from "@nestjs/common";
import { HandshakeModule } from "@jayalfredprufrock/handshake/nestjs";
import { contract } from "@jayalfredprufrock/handshake-example-contract";
import { UserController } from "./user.controller";
import { UserService } from "./user.service";

@Module({
  imports: [HandshakeModule.forRoot({ contracts: [contract] })],
  controllers: [UserController],
  providers: [UserService],
})
export class AppModule {}
