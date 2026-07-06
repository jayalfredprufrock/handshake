import { Controller, NotFoundException } from "@nestjs/common";
import { ApiHandler, ApiInput } from "@jayalfredprufrock/handshake/nestjs";
import { api } from "@jayalfredprufrock/handshake-example-contract";
import { UserService } from "./user.service";

// The api owns the routes (base path `/api`), so the controller needs no prefix.
// Handlers are ordinary Nest methods: inject services as usual, and the return type
// is enforced against the endpoint's response schema automatically.
@Controller()
export class UserController {
  constructor(private readonly users: UserService) {}

  @ApiHandler(api, "listUsers")
  listUsers() {
    return this.users.findAll();
  }

  @ApiHandler(api, "getUser")
  getUser(@ApiInput() req: ApiInput<typeof api, "getUser">) {
    const user = this.users.find(req.params.id);
    // A Nest HttpException keeps its status; the client sees a non-handshake
    // HttpError. (Declare an error on the api and `throw api.error(...)` to send a
    // typed handshake envelope instead.)
    if (!user) throw new NotFoundException(`User ${req.params.id} not found`);
    return user;
  }

  @ApiHandler(api, "createUser")
  createUser(@ApiInput() req: ApiInput<typeof api, "createUser">) {
    return this.users.create(req.body);
  }

  @ApiHandler(api, "deleteUser")
  deleteUser(@ApiInput() req: ApiInput<typeof api, "deleteUser">) {
    this.users.remove(req.params.id);
    return { id: req.params.id };
  }
}
