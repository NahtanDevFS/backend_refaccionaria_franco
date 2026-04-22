import { Pool } from "pg";
import { PayloadToken } from "./auth.types";

declare global {
  namespace Express {
    interface Request {
      usuario?: PayloadToken;
      dbPool?: Pool;
    }
  }
}
