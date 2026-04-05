// routes/auth.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { AuthRepository } from "../repositories/AuthRepository";
import { AuthService } from "../services/AuthService";
import { AuthController } from "../controllers/AuthController";

export function crearAuthRouter(dbPool: Pool): Router {
  const router = Router();
  const authRepository = new AuthRepository(dbPool);
  const authService = new AuthService(authRepository);
  const authController = new AuthController(authService);

  router.post("/registro", authController.registrar);
  router.post("/login", authController.login);

  return router;
}
