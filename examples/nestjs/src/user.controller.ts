import { Controller, NotFoundException } from "@nestjs/common";
import { HandshakeHandler, HandshakeReq } from "@jayalfredprufrock/handshake/nestjs";
import type { HandshakeInput } from "@jayalfredprufrock/handshake/nestjs";
import { contract } from "@jayalfredprufrock/handshake-example-contract";
import { UserService } from "./user.service";

// The contract owns the routes (basePath `/api`), so the controller needs no
// prefix. Handlers are ordinary Nest methods: inject services as usual, and the
// return type is enforced against the endpoint's response schema automatically.
@Controller()
export class UserController {
  constructor(private readonly users: UserService) {}

  @HandshakeHandler(contract, "listUsers")
  listUsers() {
    return this.users.findAll();
  }

  @HandshakeHandler(contract, "getUser")
  getUser(@HandshakeReq() req: HandshakeInput<typeof contract, "getUser">) {
    const user = this.users.find(req.params.id);
    // A Nest HttpException keeps its status; the client sees a non-handshake
    // HttpError. (Declare an error in the contract and `throw contract.error(...)`
    // to send a typed handshake envelope instead.)
    if (!user) throw new NotFoundException(`User ${req.params.id} not found`);
    return user;
  }

  @HandshakeHandler(contract, "createUser")
  createUser(@HandshakeReq() req: HandshakeInput<typeof contract, "createUser">) {
    return this.users.create(req.body);
  }

  @HandshakeHandler(contract, "deleteUser")
  deleteUser(@HandshakeReq() req: HandshakeInput<typeof contract, "deleteUser">) {
    this.users.remove(req.params.id);
    return { id: req.params.id };
  }
}
