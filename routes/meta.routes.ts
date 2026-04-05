// routes/meta.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { MetaRepository } from "../repositories/MetaRepository";
import { MetaService } from "../services/MetaService";
import { MetaController } from "../controllers/MetaController";

export function crearMetaRouter(dbPool: Pool): Router {
  const router = Router();

  const metaRepository = new MetaRepository(dbPool);
  const metaService = new MetaService(metaRepository);
  const metaController = new MetaController(metaService);

  // POST /api/metas/asignar
  router.post("/asignar", metaController.asignarMeta);

  // GET /api/metas/rendimiento/:id_empleado/:anio/:mes
  router.get(
    "/rendimiento/:id_empleado/:anio/:mes",
    metaController.consultarRendimiento,
  );

  // Endpoint: GET /api/metas/rendimiento
  router.get("/rendimiento", metaController.obtenerRendimientoMensual);

  return router;
}
