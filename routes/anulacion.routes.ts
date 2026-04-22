import { Router } from "express";
import { Pool } from "pg";
import { AnulacionService } from "../services/AnulacionService";
import { AnulacionController } from "../controllers/AnulacionController";
import { verificarToken } from "../middlewares/auth.middleware"; // ajustar al path real

export function crearAnulacionRouter(dbPool: Pool): Router {
  const router = Router();
  const service = new AnulacionService(dbPool);
  const controller = new AnulacionController(service);

  // Solo supervisores y administradores pueden anular ventas
  router.patch("/:id/anular", verificarToken, controller.anularVenta);

  return router;
}
