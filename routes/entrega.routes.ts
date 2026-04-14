import { Router } from "express";
import { Pool } from "pg";
import { EntregaService } from "../services/EntregaService";
import { EntregaController } from "../controllers/EntregaController";

export function crearEntregaRouter(dbPool: Pool): Router {
  const router = Router();
  const service = new EntregaService(dbPool);
  const controller = new EntregaController(service);

  router.get("/mis-pedidos", controller.obtenerMisPedidos);
  router.post("/:id/exito", controller.marcarExito);
  router.post("/:id/fallida", controller.marcarFallida);

  return router;
}
