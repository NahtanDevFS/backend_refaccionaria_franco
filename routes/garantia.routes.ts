// routes/garantia.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { GarantiaController } from "../controllers/GarantiaController";
import { GarantiaService } from "../services/GarantiaService";

export const crearGarantiaRouter = (pool: Pool): Router => {
  const router = Router();

  // Inyección de dependencias simplificada (Directo al Pool)
  const service = new GarantiaService(pool);
  const controller = new GarantiaController(service);

  router.post("/", controller.crear);
  router.post("/resolver", controller.resolver);
  router.get("/sucursal/:id_sucursal/pendientes", controller.obtenerPendientes);

  // Puedes conectar estos endpoints más adelante en el GarantiaController
  // router.post("/retorno/recepcion", controller.recibirRetorno);
  // router.post("/retorno/inspeccion", controller.inspeccionarRetorno);

  return router;
};
