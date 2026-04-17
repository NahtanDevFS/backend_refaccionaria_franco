import { Router } from "express";
import { Pool } from "pg";
import { EntregaService } from "../services/EntregaService";
import { EntregaController } from "../controllers/EntregaController";

export function crearEntregaRouter(dbPool: Pool): Router {
  const router = Router();
  const service = new EntregaService(dbPool);
  const controller = new EntregaController(service);

  router.get("/mis-pedidos", controller.obtenerMisPedidos);
  router.get("/mi-historial", controller.obtenerMiHistorial);
  router.get("/comprobante/:id_pago", controller.obtenerComprobante);
  router.post("/:id/exito", controller.marcarExito);
  router.post("/:id/fallida", controller.marcarFallida);

  return router;
}
