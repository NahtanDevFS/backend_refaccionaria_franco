// routes/garantia.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { GarantiaController } from "../controllers/GarantiaController";
import { GarantiaService } from "../services/GarantiaService";
import { GarantiaRepository } from "../repositories/GarantiaRepository";

export const crearGarantiaRouter = (pool: Pool): Router => {
  const router = Router();

  // Inyección de dependencias pasando el pool que viene desde index.ts
  const repository = new GarantiaRepository(pool);
  const service = new GarantiaService(repository);
  const controller = new GarantiaController(service);

  // Rutas (El middleware verificarToken ya se aplica en index.ts)
  router.post("/", controller.crear);
  router.post("/resolver", controller.resolver);
  router.get("/sucursal/:id_sucursal/pendientes", controller.obtenerPendientes);

  return router;
};
