import type { DefaultSession } from "next-auth";
import type { Role } from "../lib/db-enums";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: Role;
      committeeId: string | null;
      mustChangePassword: boolean;
      sessionVersion: number;
      image?: string | null;
      googleLinked: boolean;
      telegramLinked: boolean;
    };
  }

  interface User {
    role: Role;
    committeeId: string | null;
    mustChangePassword: boolean;
    sessionVersion: number;
    rememberMe?: boolean;
    image?: string | null;
    googleLinked: boolean;
    telegramLinked: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    committeeId: string | null;
    mustChangePassword: boolean;
    sessionVersion: number;
    rememberMe?: boolean;
    image?: string | null;
    googleLinked: boolean;
    telegramLinked: boolean;
  }
}
