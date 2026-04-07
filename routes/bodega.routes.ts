// routes/bodega.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { BodegaRepository } from "../repositories/BodegaRepository";
import { BodegaService } from "../services/BodegaService";
import { BodegaController } from "../controllers/BodegaController";

export function crearBodegaRouter(dbPool: Pool): Router {
  const router = Router();

  const repository = new BodegaRepository(dbPool);
  const service = new BodegaService(repository);
  const controller = new BodegaController(service);

  router.get("/inventario", controller.obtenerInventario);
  router.get("/recepciones", controller.obtenerRecepciones);
  router.post("/despacho", controller.emitirDespacho);
  router.post("/recepcion/:id", controller.confirmarRecepcion);
  router.post("/ajuste", controller.registrarAjuste);

  return router;
}
