/**
 * Package A - shared utilities for the monorepo fixture.
 */

export interface User {
  id: number;
  name: string;
  email: string;
}

export function createUser(name: string, email: string): User {
  return {
    id: Math.floor(Math.random() * 10000),
    name,
    email,
  };
}

export function formatUserName(user: User): string {
  return user.name.toUpperCase();
}

export class UserService {
  private users: Map<number, User> = new Map();

  addUser(user: User): void {
    this.users.set(user.id, user);
  }

  getUser(id: number): User | undefined {
    return this.users.get(id);
  }

  listUsers(): User[] {
    return Array.from(this.users.values());
  }
}

export const DEFAULT_USER: User = {
  id: 0,
  name: 'Guest',
  email: 'guest@example.com',
};
