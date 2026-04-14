// routes/venta.routes.ts
import { Router } from "express";
import { Pool } from "pg";
import { VentaService } from "../services/VentaService";
import { VentaController } from "../controllers/VentaController";

export function crearVentaRouter(dbPool: Pool): Router {
  const router = Router();

  // Inyección de dependencias simplificada (Directo al Pool)
  const ventaService = new VentaService(dbPool);
  const ventaController = new VentaController(ventaService);

  // Rutas estáticas primero
  router.get("/", ventaController.obtenerVentas);
  router.post("/orden", ventaController.crearOrden);
  router.get(
    "/repartidores/activos",
    ventaController.obtenerRepartidoresActivos,
  );
  router.get("/vendedores/activos", ventaController.obtenerVendedoresActivos);
  router.get(
    "/autorizaciones/pendientes",
    ventaController.obtenerAutorizacionesPendientes,
  );
  router.post("/autorizaciones/resolver", ventaController.resolverAutorizacion);

  // Rutas dinámicas (/:id) AL FINAL
  router.get("/:id", ventaController.obtenerVentaPorId);

  return router;
}
