// routes/auth.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { AuthService } from "../services/AuthService";
import { AuthController } from "../controllers/AuthController";

export function crearAuthRouter(dbPool: Pool): Router {
  const router = Router();

  // Inyección directa del pool
  const authService = new AuthService(dbPool);
  const authController = new AuthController(authService);

  router.post("/registro", authController.registrar);
  router.post("/login", authController.login);

  return router;
}
