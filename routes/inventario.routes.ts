// routes/inventario.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { InventarioService } from "../services/InventarioService";
import { InventarioController } from "../controllers/InventarioController";

export function crearInventarioRouter(dbPool: Pool): Router {
  const router = Router();

  const inventarioService = new InventarioService(dbPool);
  const inventarioController = new InventarioController(inventarioService);

  router.get("/stock", inventarioController.consultarStock);
  router.get("/buscar", inventarioController.buscarMultiSucursal);

  return router;
}
