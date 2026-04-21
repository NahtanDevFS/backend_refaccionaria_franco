// routes/bodega.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { BodegaService } from "../services/BodegaService";
import { BodegaController } from "../controllers/BodegaController";

export function crearBodegaRouter(dbPool: Pool): Router {
  const router = Router();
  const service = new BodegaService(dbPool);
  const controller = new BodegaController(service);

  router.get("/inventario", controller.obtenerInventario);
  router.get("/lotes/:id_producto", controller.obtenerLotes);
  router.get("/recepciones", controller.obtenerRecepciones);
  router.post("/despacho", controller.emitirDespacho);
  router.post("/recepcion/:id", controller.confirmarRecepcion);
  router.post("/ajuste", controller.registrarAjuste);

  return router;
}
