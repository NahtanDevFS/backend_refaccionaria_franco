// types/express.d.ts
import { PayloadToken } from "./auth.types";

declare global {
  namespace Express {
    interface Request {
      usuario?: PayloadToken;
    }
  }
}
