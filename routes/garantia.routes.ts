// routes/garantia.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { GarantiaController } from "../controllers/GarantiaController";
import { GarantiaService } from "../services/GarantiaService";

export const crearGarantiaRouter = (pool: Pool): Router => {
  const router = Router();

  const service = new GarantiaService(pool);
  const controller = new GarantiaController(service);

  // Solicitudes iniciales
  router.post("/", controller.crear);
  router.post("/resolver", controller.resolver);

  // Getters para pestañas
  router.get("/sucursal/:id_sucursal/pendientes", controller.obtenerPendientes);
  router.get(
    "/sucursal/:id_sucursal/recepciones",
    controller.obtenerPendientesRecepcion,
  );
  router.get(
    "/sucursal/:id_sucursal/inspecciones",
    controller.obtenerPendientesInspeccion,
  );

  // Acciones logísticas
  router.post("/retorno/recepcion", controller.recibirRetorno);
  router.post("/retorno/inspeccion", controller.inspeccionarRetorno);

  router.get("/sucursal/:id_sucursal/historial", controller.obtenerHistorial);

  return router;
};
