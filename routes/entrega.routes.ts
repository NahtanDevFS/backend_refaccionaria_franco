import { Router } from "express";
import { Pool } from "pg";
import { EntregaRepository } from "../repositories/EntregaRepository";
import { EntregaService } from "../services/EntregaService";
import { EntregaController } from "../controllers/EntregaController";

export function crearEntregaRouter(dbPool: Pool): Router {
  const router = Router();

  const repository = new EntregaRepository(dbPool);
  const service = new EntregaService(repository);
  const controller = new EntregaController(service);

  router.get("/mis-pedidos", controller.obtenerMisPedidos);
  router.post("/:id/exito", controller.marcarExito);
  router.post("/:id/fallida", controller.marcarFallida);

  return router;
}
