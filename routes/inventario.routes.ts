// routes/inventario.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { InventarioRepository } from "../repositories/InventarioRepository";
import { InventarioService } from "../services/InventarioService";
import { InventarioController } from "../controllers/InventarioController";

export function crearInventarioRouter(dbPool: Pool): Router {
  const router = Router();

  const inventarioRepository = new InventarioRepository(dbPool);
  const inventarioService = new InventarioService(inventarioRepository);
  const inventarioController = new InventarioController(inventarioService);

  // Endpoint: GET /api/inventario/stock?query=FRIC
  router.get("/stock", inventarioController.consultarStock);
  router.get("/buscar", inventarioController.buscarMultiSucursal);

  return router;
}
