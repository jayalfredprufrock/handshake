import { Injectable } from "@nestjs/common";

export interface User {
  id: string;
  name: string;
  email: string;
}

@Injectable()
export class UserService {
  private readonly users = new Map<string, User>([
    ["1", { id: "1", name: "Alice", email: "alice@example.com" }],
    ["2", { id: "2", name: "Bob", email: "bob@example.com" }],
  ]);
  private nextId = 3;

  findAll(): User[] {
    return [...this.users.values()];
  }

  find(id: string): User | undefined {
    return this.users.get(id);
  }

  create(data: { name: string; email: string }): User {
    const id = String(this.nextId++);
    const user: User = { id, ...data };
    this.users.set(id, user);
    return user;
  }

  remove(id: string): void {
    this.users.delete(id);
  }
}
