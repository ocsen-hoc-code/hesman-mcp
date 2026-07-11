/**
 * Package B - depends on utilities from Package A.
 */

// This import simulates a cross-package dependency
// (in a real workspace this would be resolved via the package name)
import { User, createUser, formatUserName } from '@monorepo/pkg-a';

export function greetUser(name: string, email: string): string {
  const user = createUser(name, email);
  return `Hello, ${formatUserName(user)}!`;
}

export function buildProfile(name: string, email: string): User {
  return createUser(name, email);
}

export function isAdmin(email: string): boolean {
  return email.endsWith('@admin.example.com');
}

export class ProfileManager {
  private profiles: Map<string, User> = new Map();

  register(email: string, name: string): User {
    const user = createUser(name, email);
    this.profiles.set(email, user);
    return user;
  }

  findByEmail(email: string): User | undefined {
    return this.profiles.get(email);
  }
}
